import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

type GoogleEvent = { id?: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } };

@Injectable()
export class GoogleCalendarService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  isConfigured() {
    return Boolean(this.config.get('GOOGLE_CLIENT_ID') && this.config.get('GOOGLE_CLIENT_SECRET') && this.config.get('GOOGLE_REDIRECT_URI') && this.config.get('GOOGLE_TOKEN_ENCRYPTION_KEY'));
  }

  status(userId: string) {
    return this.prisma.googleCalendarConnection.findUnique({ where: { user_id: userId }, select: { connected_at: true } })
      .then((connection) => ({ configured: this.isConfigured(), connected: Boolean(connection), connected_at: connection?.connected_at ?? null }));
  }

  authorizationUrl(userId: string) {
    this.requireConfig();
    const state = this.signState(userId);
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow('GOOGLE_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow('GOOGLE_REDIRECT_URI'),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  async completeAuthorization(code: string, state: string) {
    this.requireConfig();
    const userId = this.verifyState(state);
    const body = new URLSearchParams({
      code,
      client_id: this.config.getOrThrow('GOOGLE_CLIENT_ID'),
      client_secret: this.config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      redirect_uri: this.config.getOrThrow('GOOGLE_REDIRECT_URI'),
      grant_type: 'authorization_code',
    });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const token = await response.json() as { refresh_token?: string; error?: string };
    if (!response.ok || !token.refresh_token) throw new BadRequestException(token.error ?? 'Google did not return offline access');
    await this.prisma.googleCalendarConnection.upsert({
      where: { user_id: userId },
      create: { user_id: userId, refresh_token: this.encrypt(token.refresh_token) },
      update: { refresh_token: this.encrypt(token.refresh_token), connected_at: new Date() },
    });
    return userId;
  }

  async disconnect(userId: string) {
    const connection = await this.prisma.googleCalendarConnection.findUnique({ where: { user_id: userId } });
    if (connection) {
      const token = this.decrypt(connection.refresh_token);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
      await this.prisma.googleCalendarConnection.delete({ where: { user_id: userId } });
    }
    return { connected: false };
  }

  async sync(userId: string, from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) throw new BadRequestException('Invalid calendar date range');
    const connection = await this.prisma.googleCalendarConnection.findUnique({ where: { user_id: userId } });
    if (!connection) return { blocks: [] };
    const accessToken = await this.accessToken(this.decrypt(connection.refresh_token));
    const start = new Date(`${from}T00:00:00.000Z`).toISOString();
    const end = new Date(`${to}T00:00:00.000Z`).toISOString();
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string; error?: { message?: string } };
      if (!response.ok) throw new BadRequestException(data.error?.message ?? 'Could not read Google Calendar');
      events.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    const blocks = events.flatMap((event) => {
      if (!event.id || !event.start || !event.end) return [];
      // All-day events have no occupied hour range, so they are ignored by the hourly calendar.
      if (!event.start.dateTime || !event.end.dateTime) {
        if (!event.start.date || !event.end.date) return [];
        const blocks = [];
        const day = new Date(`${event.start.date}T00:00:00.000Z`);
        const lastDay = new Date(`${event.end.date}T00:00:00.000Z`);
        while (day < lastDay) {
          const date = day.toISOString().slice(0, 10);
          const begin = new Date(`${date}T00:00:00.000Z`);
          const finish = new Date(begin.getTime() + 24 * 60 * 60_000);
          blocks.push({ id: createHash('sha256').update(`${userId}:${event.id}:${date}`).digest('hex'), user_id: userId, event_date: begin, start_at: begin, end_at: finish, title: event.summary?.trim() || null });
          day.setUTCDate(day.getUTCDate() + 1);
        }
        return blocks;
      }
      const begin = new Date(event.start.dateTime);
      const finish = new Date(event.end.dateTime);
      if (!Number.isFinite(begin.getTime()) || !Number.isFinite(finish.getTime()) || finish <= begin) return [];
      return [{
        id: createHash('sha256').update(`${userId}:${event.id}`).digest('hex'),
        user_id: userId,
        event_date: new Date(`${this.localDate(begin)}T00:00:00.000Z`),
        start_at: begin,
        end_at: finish,
        title: event.summary?.trim() || null,
      }];
    });
    // Google can return duplicate event rows, and the client may request a sync
    // for the same range from both calendar views at nearly the same time.
    // Keep one row per stable event key and let PostgreSQL ignore a concurrent
    // insert that already won the race.
    const uniqueBlocks = [...new Map(blocks.map((block) => [block.id, block])).values()];
    const rangeStart = new Date(`${from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${to}T00:00:00.000Z`);
    await this.prisma.$transaction([
      this.prisma.googleBusyBlock.deleteMany({ where: { user_id: userId, event_date: { gte: rangeStart, lt: rangeEnd } } }),
      ...(uniqueBlocks.length ? [this.prisma.googleBusyBlock.createMany({ data: uniqueBlocks, skipDuplicates: true })] : []),
    ]);
    return { blocks: uniqueBlocks.map(({ event_date, start_at, end_at }) => ({ date: event_date.toISOString().slice(0, 10), start: start_at, end: end_at, source: 'google' })) };
  }

  async getMyEvents(userId: string, from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) throw new BadRequestException('Invalid calendar date range');
    const connected = await this.prisma.googleCalendarConnection.findUnique({ where: { user_id: userId }, select: { user_id: true } });
    if (!connected) return { events: [] };
    const blocks = await this.prisma.googleBusyBlock.findMany({
      where: { user_id: userId, event_date: { gte: new Date(`${from}T00:00:00.000Z`), lt: new Date(`${to}T00:00:00.000Z`) } },
      orderBy: [{ event_date: 'asc' }, { start_at: 'asc' }],
      select: { id: true, event_date: true, start_at: true, end_at: true, title: true },
    });
    return { events: blocks.map((block) => ({
      id: block.id,
      date: block.event_date.toISOString().slice(0, 10),
      start: block.end_at.getTime() - block.start_at.getTime() >= 24 * 60 * 60_000 ? '00:00' : this.localTime(block.start_at),
      end: block.end_at.getTime() - block.start_at.getTime() >= 24 * 60 * 60_000 ? '24:00' : this.localTime(block.end_at),
      title: block.title || 'Ocupado',
    })) };
  }

  private async accessToken(refreshToken: string) {
    const body = new URLSearchParams({ client_id: this.config.getOrThrow('GOOGLE_CLIENT_ID'), client_secret: this.config.getOrThrow('GOOGLE_CLIENT_SECRET'), refresh_token: refreshToken, grant_type: 'refresh_token' });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const result = await response.json() as { access_token?: string; error?: string };
    if (!response.ok || !result.access_token) throw new BadRequestException(result.error ?? 'Google authorization expired; reconnect your calendar');
    return result.access_token;
  }

  private localDate(value: Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.config.get('CALENDAR_TIME_ZONE') ?? 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }

  private localTime(value: Date) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: this.config.get('CALENDAR_TIME_ZONE') ?? 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  }

  private requireConfig() {
    if (!this.isConfigured()) throw new ServiceUnavailableException('Google Calendar OAuth is not configured on the server');
  }

  private signingKey() { return this.config.getOrThrow('GOOGLE_TOKEN_ENCRYPTION_KEY'); }
  private signState(userId: string) {
    const payload = Buffer.from(JSON.stringify({ userId, expires: Date.now() + 10 * 60_000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
    const signature = createHmac('sha256', this.signingKey()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }
  private verifyState(state: string) {
    const [payload, signature] = state.split('.');
    if (!payload || !signature) throw new BadRequestException('Invalid OAuth state');
    const expected = createHmac('sha256', this.signingKey()).update(payload).digest();
    let received: Buffer;
    try { received = Buffer.from(signature, 'base64url'); } catch { throw new BadRequestException('Invalid OAuth state'); }
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new BadRequestException('Invalid OAuth state');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { userId: string; expires: number };
    if (data.expires < Date.now() || !data.userId) throw new BadRequestException('OAuth state expired');
    return data.userId;
  }
  private encrypt(value: string) {
    const key = createHash('sha256').update(this.signingKey()).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }
  private decrypt(value: string) {
    const [iv, tag, content] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    const key = createHash('sha256').update(this.signingKey()).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8');
  }
}
