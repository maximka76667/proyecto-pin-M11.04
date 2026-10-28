import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DAYS, ReplaceAvailabilityDto } from './dto/replace-availability.dto';

export function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

export function toHHmm(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

@Injectable()
export class AvailabilityService {
    constructor(private readonly prisma: PrismaService) { }

    // Mis franjas, con etiqueta (solo yo la veo)
    async getMine(userId: string) {
        const rows = await this.prisma.availabilityBlock.findMany({
            where: { user_id: userId },
        });
        return {
            blocks: this.sort(rows).map((r) => ({
                day_of_week: r.day_of_week,
                start: toHHmm(r.start_minute),
                end: toHHmm(r.end_minute),
                label: r.label,
            })),
        };
    }

    // Sustituye toda mi semana de una vez
    async replaceMine(userId: string, dto: ReplaceAvailabilityDto) {
        const data = dto.blocks.map((b) => ({
            user_id: userId,
            day_of_week: b.day_of_week,
            start_minute: toMinutes(b.start),
            end_minute: toMinutes(b.end),
            label: b.label?.trim() || null,
        }));

        for (const b of data) {
            if (b.end_minute <= b.start_minute) {
                throw new BadRequestException('End time must be after start time');
            }
        }
        for (const day of DAYS) {
            const delDia = data
                .filter((b) => b.day_of_week === day)
                .sort((a, b) => a.start_minute - b.start_minute);
            for (let i = 1; i < delDia.length; i++) {
                if (delDia[i].start_minute < delDia[i - 1].end_minute) {
                    throw new BadRequestException(`Blocks overlap on ${day}`);
                }
            }
        }

        await this.prisma.$transaction([
            this.prisma.availabilityBlock.deleteMany({ where: { user_id: userId } }),
            this.prisma.availabilityBlock.createMany({ data }),
        ]);
        return this.getMine(userId);
    }

    // Calendario del hogar: sin etiquetas, los demás solo ven "ocupado"
    async getHousehold(apartmentId: string, currentUserId?: string) {
        const apartment = await this.prisma.apartment.findUnique({
            where: { id: apartmentId },
            select: { id: true },
        });
        if (!apartment) throw new NotFoundException('Apartment not found');

        const users = await this.prisma.user.findMany({
            where: { user_apartments: { some: { apartment_id: apartmentId } } },
            select: {
                id: true,
                full_name: true,
                availability_blocks: {
                    select: { day_of_week: true, start_minute: true, end_minute: true },
                },
            },
            orderBy: { full_name: 'asc' },
        });

        return {
            members: users.map((u) => ({
                id: u.id,
                full_name: u.full_name,
                isCurrentUser: u.id === currentUserId,
                blocks: this.sort(u.availability_blocks).map((b) => ({
                    day_of_week: b.day_of_week,
                    start: toHHmm(b.start_minute),
                    end: toHHmm(b.end_minute),
                })),
            })),
        };
    }

    async getCalendar(apartmentId: string, currentUserId: string, from: string, to: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
            throw new BadRequestException('Invalid calendar date range');
        }
        const membership = await this.prisma.userApartment.findUnique({
            where: { user_id_apartment_id: { user_id: currentUserId, apartment_id: apartmentId } },
            select: { user_id: true },
        });
        if (!membership) throw new NotFoundException('Apartment not found');
        const startDate = new Date(`${from}T00:00:00.000Z`);
        const endDate = new Date(`${to}T00:00:00.000Z`);
        const [users, assignments] = await Promise.all([
            this.prisma.user.findMany({
                where: { user_apartments: { some: { apartment_id: apartmentId } } },
                select: { id: true, full_name: true, availability_blocks: true, google_busy_blocks: { where: { event_date: { gte: startDate, lt: endDate } } } },
            }),
            this.prisma.taskAssignment.findMany({
                where: { due_date: { gte: startDate, lt: endDate }, task: { apartment_id: apartmentId } },
                include: { user: { select: { id: true, full_name: true } }, task: { select: { id: true, title: true } } },
            }),
        ]);
        const events: { id: string; user_id: string; person: string; title: string; date: string; start: string; end: string; kind: 'busy' | 'task' }[] = [];
        for (const user of users) {
            for (const day of this.eachDate(from, to)) {
                const dayName = this.weekday(day);
                for (const block of user.availability_blocks.filter((b) => b.day_of_week === dayName)) {
                    events.push({ id: `weekly-${user.id}-${day}-${block.start_minute}`, user_id: user.id, person: user.full_name, title: 'Ocupado', date: day, start: toHHmm(block.start_minute), end: toHHmm(block.end_minute), kind: 'busy' });
                }
            }
            for (const block of user.google_busy_blocks) {
                const allDay = block.end_at.getTime() - block.start_at.getTime() >= 24 * 60 * 60_000;
                events.push({ id: `google-${block.id}`, user_id: user.id, person: user.full_name, title: 'Ocupado', date: block.event_date.toISOString().slice(0, 10), start: allDay ? '00:00' : this.localTime(block.start_at), end: allDay ? '24:00' : this.localTime(block.end_at), kind: 'busy' });
            }
        }
        for (const assignment of assignments) {
            events.push({
                id: `task-${assignment.id}`, user_id: assignment.user_id, person: assignment.user.full_name, title: assignment.task.title,
                date: assignment.due_date.toISOString().slice(0, 10), start: toHHmm(assignment.start_minute), end: toHHmm(assignment.start_minute + 30), kind: 'task',
            });
        }
        return { events: events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)) };
    }

    private eachDate(from: string, to: string) {
        const result: string[] = [];
        const date = new Date(`${from}T00:00:00.000Z`);
        const end = new Date(`${to}T00:00:00.000Z`);
        while (date < end) { result.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 1); }
        return result;
    }

    private weekday(date: string) {
        const index = new Date(`${date}T00:00:00.000Z`).getUTCDay();
        return DAYS[(index + 6) % 7];
    }

    private localTime(value: Date) {
        return new Intl.DateTimeFormat('en-GB', { timeZone: process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
    }

    private sort<T extends { day_of_week: string; start_minute: number }>(rows: T[]) {
        return [...rows].sort(
            (a, b) =>
                DAYS.indexOf(a.day_of_week as (typeof DAYS)[number]) -
                DAYS.indexOf(b.day_of_week as (typeof DAYS)[number]) ||
                a.start_minute - b.start_minute,
        );
    }
}
