import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleCalendarService } from './google-calendar.service';

describe('GoogleCalendarService', () => {
  const encryptionKey = 'test-calendar-encryption-key';
  const configValues: Record<string, string> = {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/availability/google/callback',
    GOOGLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
  };
  const prisma = {
    googleCalendarConnection: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    googleBusyBlock: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => configValues[key]),
  };
  let service: GoogleCalendarService;

  function encryptToken(value: string) {
    const key = createHash('sha256').update(encryptionKey).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoogleCalendarService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(GoogleCalendarService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the browser origin for the local web OAuth return', () => {
    const { url } = service.authorizationUrl('user-1', 'http://localhost:8081');
    const authorization = new URL(url);
    expect(authorization.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(service.callbackUriFromState(authorization.searchParams.get('state')!)).toBe('http://localhost:8081/availability');
  });

  it('imports events from every accessible Google calendar', async () => {
    prisma.googleCalendarConnection.findUnique.mockResolvedValue({
      refresh_token: encryptToken('refresh-token'),
      calendar_id: 'primary',
    });

    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
      }
      if (url.includes('/users/me/calendarList')) {
        return new Response(JSON.stringify({ items: [{ id: 'primary' }, { id: 'shared@example.com' }] }), { status: 200 });
      }
      const calendarId = decodeURIComponent(new URL(url).pathname.split('/')[4]);
      return new Response(JSON.stringify({
        items: [{
          id: 'same-event-id',
          summary: calendarId === 'primary' ? 'Primary event' : 'Shared calendar event',
          start: { dateTime: calendarId === 'primary' ? '2026-11-02T23:30:00+01:00' : '2026-11-02T10:00:00+01:00' },
          end: { dateTime: calendarId === 'primary' ? '2026-11-03T01:00:00+01:00' : '2026-11-02T11:00:00+01:00' },
        }],
      }), { status: 200 });
    });

    await service.sync('user-1', '2026-11-02', '2026-11-09');

    const savedBlocks = prisma.googleBusyBlock.createMany.mock.calls[0][0].data;
    expect(savedBlocks).toHaveLength(3);
    expect(new Set(savedBlocks.map((block: { id: string }) => block.id)).size).toBe(3);
    expect(savedBlocks.map((block: { title: string }) => block.title).sort()).toEqual([
      'Primary event',
      'Primary event',
      'Shared calendar event',
    ]);
  });

  it('removes imported events when disconnecting', async () => {
    prisma.googleCalendarConnection.findUnique.mockResolvedValue(null);

    await service.disconnect('user-1');

    expect(prisma.googleCalendarConnection.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'user-1' } });
    expect(prisma.googleBusyBlock.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'user-1' } });
  });
});
