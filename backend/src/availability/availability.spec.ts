import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

describe('Availability', () => {
    let app: INestApplication<App>;

    const prisma = {
        apartment: { findUnique: jest.fn() },
        user: { findMany: jest.fn() },
        availabilityBlock: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
            createMany: jest.fn(),
        },
        $transaction: jest.fn(),
    };
    const piso = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    beforeEach(async () => {
        jest.resetAllMocks();
        prisma.$transaction.mockResolvedValue([]);
        prisma.availabilityBlock.findMany.mockResolvedValue([]);
        const moduleRef = await Test.createTestingModule({
            controllers: [AvailabilityController],
            providers: [AvailabilityService, { provide: PrismaService, useValue: prisma }],
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
});
