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

    private sort<T extends { day_of_week: string; start_minute: number }>(rows: T[]) {
        return [...rows].sort(
            (a, b) =>
                DAYS.indexOf(a.day_of_week as (typeof DAYS)[number]) -
                DAYS.indexOf(b.day_of_week as (typeof DAYS)[number]) ||
                a.start_minute - b.start_minute,
        );
    }
}
