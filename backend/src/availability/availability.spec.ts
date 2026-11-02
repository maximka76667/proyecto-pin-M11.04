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
        completeAuthorization: jest.fn(),
        callbackUriFromState: jest.fn(),
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

    it('PUT /availability/me guarda las franjas en minutos', async () => {
        await request(app.getHttpServer())
            .put('/availability/me')
            .send({
                blocks: [{ day_of_week: 'monday', start: '09:00', end: '13:30', label: ' Clases ' }],
            })
            .expect(200);
        expect(prisma.availabilityBlock.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({
                    day_of_week: 'monday',
                    start_minute: 540,
                    end_minute: 810,
                    label: 'Clases',
                }),
            ],
        });
    });

    it('rechaza fin <= inicio', async () => {
        await request(app.getHttpServer())
            .put('/availability/me')
            .send({ blocks: [{ day_of_week: 'monday', start: '10:00', end: '10:00' }] })
            .expect(400);
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

    it('devuelve al navegador web a la aplicación tras autorizar Google', async () => {
        googleCalendar.callbackUriFromState.mockReturnValue('http://localhost:8081/availability');
        googleCalendar.completeAuthorization.mockResolvedValue({ callbackUri: 'http://localhost:8081/availability' });

        await request(app.getHttpServer())
            .get('/availability/google/callback')
            .query({ code: 'oauth-code', state: 'signed-state' })
            .expect(302)
            .expect('Location', 'http://localhost:8081/availability?connected=1');
    });

    it('incluye la hora de la asignación manual en el calendario compartido', async () => {
        prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'u1' });
        prisma.user.findMany.mockResolvedValue([
            { id: 'u1', full_name: 'Ana', availability_blocks: [], google_busy_blocks: [] },
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
    });

    it('solo muestra al dueño los títulos de sus eventos de Google', async () => {
        prisma.userApartment.findUnique.mockResolvedValue({ user_id: 'u1' });
        prisma.user.findMany.mockResolvedValue([
            {
                id: 'u1',
                full_name: 'Ana',
                availability_blocks: [],
                google_busy_blocks: [{
                    id: 'google-1',
                    event_date: new Date('2026-11-02T00:00:00.000Z'),
                    start_at: new Date('2026-11-02T09:00:00.000Z'),
                    end_at: new Date('2026-11-02T10:00:00.000Z'),
                    title: 'Consulta privada',
                }],
            },
            {
                id: 'u2',
                full_name: 'Luis',
                availability_blocks: [],
                google_busy_blocks: [{
                    id: 'google-2',
                    event_date: new Date('2026-11-02T00:00:00.000Z'),
                    start_at: new Date('2026-11-02T09:00:00.000Z'),
                    end_at: new Date('2026-11-02T10:00:00.000Z'),
                    title: 'Evento privado',
                }],
            },
        ]);
        prisma.taskAssignment.findMany.mockResolvedValue([]);

        const result = await app.get(AvailabilityService).getCalendar(
            piso,
            'u1',
            '2026-11-02',
            '2026-11-03',
        );

        expect(result.events.find((event) => event.user_id === 'u1')?.title).toBe('Consulta privada');
        expect(result.events.find((event) => event.user_id === 'u2')?.title).toBe('Ocupado');
        expect(JSON.stringify(result.events)).not.toContain('Evento privado');
    });
});
