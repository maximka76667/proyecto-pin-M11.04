import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { GoogleCalendarService } from './google-calendar.service';

describe('Availability', () => {
    let app: INestApplication<App>;

    const prisma = {
        apartment: { findUnique: jest.fn() },
        user: { findMany: jest.fn() },
        userApartment: { findUnique: jest.fn() },
        taskAssignment: { findMany: jest.fn() },
        availabilityBlock: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
            createMany: jest.fn(),
        },
        $transaction: jest.fn(),
    };
    const googleCalendar = {
        status: jest.fn(),
        authorizationUrl: jest.fn(),
        callbackUriFromState: jest.fn().mockReturnValue('frontend://calendar/google-callback'),
        completeAuthorization: jest.fn(),
        sync: jest.fn(),
        getMyEvents: jest.fn(),
        disconnect: jest.fn(),
    };
    const piso = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    beforeEach(async () => {
        jest.resetAllMocks();
        prisma.$transaction.mockResolvedValue([]);
        prisma.availabilityBlock.findMany.mockResolvedValue([]);
        const moduleRef = await Test.createTestingModule({
            controllers: [AvailabilityController],
            providers: [
                AvailabilityService,
                { provide: PrismaService, useValue: prisma },
                { provide: GoogleCalendarService, useValue: googleCalendar },
            ],
        }).compile();
        app = moduleRef.createNestApplication();
        configureApp(app);
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it('PA: guarda una franja horaria manual válida y devuelve confirmación', async () => {
        const response = await request(app.getHttpServer())
            .put('/availability/me')
            .send({
                blocks: [{ day_of_week: 'tuesday', start: '09:00', end: '13:30', label: ' Clases ' }],
            })
            .expect(200);
        expect(response.body).toEqual({ blocks: [] });
        expect(prisma.availabilityBlock.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({
                    day_of_week: 'tuesday',
                    start_minute: 540,
                    end_minute: 810,
                    label: 'Clases',
                }),
            ],
        });
    });

    it('PA: rechaza una franja cuya hora de fin es anterior al inicio con HTTP 400', async () => {
        await request(app.getHttpServer())
            .put('/availability/me')
            .send({ blocks: [{ day_of_week: 'monday', start: '14:00', end: '11:00' }] })
            .expect(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza una franja que empieza antes de la hora actual del mismo día', async () => {
        const now = new Date();
        const day = new Intl.DateTimeFormat('en-US', {
            timeZone: process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid',
            weekday: 'long',
        }).format(now).toLowerCase();
        const currentMinute = Number(new Intl.DateTimeFormat('en-GB', {
            timeZone: process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(now).find((part) => part.type === 'hour')?.value) * 60
            + Number(new Intl.DateTimeFormat('en-GB', {
                timeZone: process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            }).formatToParts(now).find((part) => part.type === 'minute')?.value);
        const start = Math.max(0, currentMinute - 2);
        const end = Math.min(1440, start + 1);

        await request(app.getHttpServer())
            .put('/availability/me')
            .send({
                blocks: [{
                    day_of_week: day,
                    start: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
                    end: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
                }],
            })
            .expect(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('PA: importa los eventos de Google Calendar y actualiza la disponibilidad del hogar', async () => {
        googleCalendar.sync.mockResolvedValue({
            blocks: [{ date: '2026-11-02', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z', source: 'google' }],
        });

        const response = await request(app.getHttpServer())
            .post('/availability/google/sync')
            .send({ from: '2026-11-02', to: '2026-11-03' })
            .expect(201);

        expect(googleCalendar.sync).toHaveBeenCalledWith(
            expect.any(String),
            '2026-11-02',
            '2026-11-03',
        );
        expect(response.body).toEqual({
            blocks: [{
                date: '2026-11-02',
                start: '2026-11-02T09:00:00.000Z',
                end: '2026-11-02T10:00:00.000Z',
                source: 'google',
            }],
        });
    });

    it('PA: cancela la sincronización cuando Google deniega la autorización', async () => {
        googleCalendar.callbackUriFromState.mockReturnValue('frontend://calendar/google-callback');
        googleCalendar.completeAuthorization.mockRejectedValue(new Error('Permisos denegados'));

        const response = await request(app.getHttpServer())
            .get('/availability/google/callback')
            .query({ code: 'codigo-google', state: 'estado-oauth' })
            .expect(302);

        expect(googleCalendar.completeAuthorization).toHaveBeenCalledWith('codigo-google', 'estado-oauth');
        expect(response.headers.location).toBe('frontend://calendar/google-callback?connected=0');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza franjas solapadas el mismo día', async () => {
        await request(app.getHttpServer())
            .put('/availability/me')
            .send({
                blocks: [
                    { day_of_week: 'friday', start: '09:00', end: '11:00' },
                    { day_of_week: 'friday', start: '10:30', end: '12:00' },
                ],
            })
            .expect(400);
    });

    it('rechaza horas y días inválidos', async () => {
        await request(app.getHttpServer())
            .put('/availability/me')
            .send({ blocks: [{ day_of_week: 'funday', start: '9:00', end: '25:00' }] })
            .expect(400);
    });

    it('acepta semana vacía (borra todo)', async () => {
        await request(app.getHttpServer()).put('/availability/me').send({ blocks: [] }).expect(200);
        expect(prisma.availabilityBlock.deleteMany).toHaveBeenCalled();
    });

    it('GET /availability/apartment/:id no devuelve etiquetas', async () => {
        prisma.apartment.findUnique.mockResolvedValue({ id: piso });
        prisma.user.findMany.mockResolvedValue([
            {
                id: 'u1',
                full_name: 'Ana',
                availability_blocks: [{ day_of_week: 'monday', start_minute: 540, end_minute: 600 }],
            },
        ]);
        const res = await request(app.getHttpServer()).get(`/availability/apartment/${piso}`).expect(200);
        expect(res.body.members[0].blocks).toEqual([
            { day_of_week: 'monday', start: '09:00', end: '10:00' },
        ]);
        expect(JSON.stringify(res.body)).not.toContain('label');
    });

    it('GET /availability/apartment/:id devuelve 404 si no existe el piso', async () => {
        prisma.apartment.findUnique.mockResolvedValue(null);
        await request(app.getHttpServer()).get(`/availability/apartment/${piso}`).expect(404);
    });

    it('incluye la hora de la asignación manual en el calendario compartido', async () => {
        prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'u1' });
        prisma.user.findMany.mockResolvedValue([
            {
                id: 'u1',
                full_name: 'Ana',
                availability_blocks: [{ day_of_week: 'monday', start_minute: 540, end_minute: 600 }],
                google_busy_blocks: [{
                    id: 'google-1',
                    event_date: new Date('2026-11-02T00:00:00.000Z'),
                    start_at: new Date('2026-11-02T14:00:00.000Z'),
                    end_at: new Date('2026-11-02T15:00:00.000Z'),
                    title: 'Fisio Campanar',
                }],
            },
        ]);
        prisma.taskAssignment.findMany.mockResolvedValue([
            {
                id: 'assignment-1',
                user_id: 'u1',
                due_date: new Date('2026-11-02T00:00:00.000Z'),
                due_time: '12:30',
                start_minute: 540,
                user: { id: 'u1', full_name: 'Ana' },
                task: { id: 'task-1', title: 'Limpiar' },
            },
        ]);

        const result = await app.get(AvailabilityService).getCalendar(
            piso,
            'u1',
            '2026-11-02',
            '2026-11-03',
        );

        expect(result.events).toContainEqual(
            expect.objectContaining({
                id: 'task-assignment-1',
                start: '12:30',
                end: '13:00',
                kind: 'task',
            }),
        );
        expect(result.events).toContainEqual({
            id: 'weekly-u1-2026-11-02-540',
            user_id: 'u1',
            person: 'Ana',
            title: 'Ocupado',
            date: '2026-11-02',
            start: '09:00',
            end: '10:00',
            kind: 'busy',
        });
        expect(result.events).toContainEqual({
            id: 'google-google-1',
            user_id: 'u1',
            person: 'Ana',
            title: 'Ocupado',
            date: '2026-11-02',
            start: '15:00',
            end: '16:00',
            kind: 'busy',
        });
    });

    it('oculta la descripción de Google en el calendario de la casa aunque sea del usuario actual', async () => {
        prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'u1' });
        prisma.user.findMany.mockResolvedValue([
            {
                id: 'u1',
                full_name: 'Ana',
                availability_blocks: [],
                google_busy_blocks: [{
                    id: 'google-privado',
                    event_date: new Date('2026-11-03T00:00:00.000Z'),
                    start_at: new Date('2026-11-03T09:00:00.000Z'),
                    end_at: new Date('2026-11-03T10:00:00.000Z'),
                    title: 'Fisio Campanar',
                }],
            },
        ]);
        prisma.taskAssignment.findMany.mockResolvedValue([]);

        const result = await app.get(AvailabilityService).getCalendar(
            piso,
            'u1',
            '2026-11-03',
            '2026-11-04',
        );

        expect(result.events).toEqual([expect.objectContaining({
            id: 'google-google-privado',
            title: 'Ocupado',
        })]);
        expect(JSON.stringify(result.events)).not.toContain('Fisio Campanar');
    });
});
