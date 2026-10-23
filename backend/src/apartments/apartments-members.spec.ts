import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { ApartmentsController } from './apartments.controller';
import { ApartmentsService } from './apartments.service';

    // UT998: el formulario de gasto nuevo necesita que se elija quién debe el dinero.
    describe('GET /apartments/:id/members (UT998)', () => {
        let app: INestApplication<App>;

        const prisma = {
            apartment: {
             findUnique: jest.fn(),
            },
        };

    const id = '8b7c6d5e-4f3a-4210-9b8c-7d6e5f4a3210';

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [ApartmentsController],
            providers: [ApartmentsService, { provide: PrismaService, useValue: prisma }],
            }).compile();

        app = module.createNestApplication();
        configureApp(app);
        await app.init();
        });

        afterAll(async () => {
            await app.close();
        });

        beforeEach(() => {
            jest.clearAllMocks();
        });

      it('lista a los convivientes ordenados por nombre sin repetir al propietario', async () => {
           prisma.apartment.findUnique.mockResolvedValue({
                landlord: { id: 'u-leo', full_name: 'Leo' },
                 user_apartments: [
                   { user: { id: 'u-sara', full_name: 'Sara' } },
                   { user: { id: 'u-leo', full_name: 'Leo' } },
                   { user: { id: 'u-alex', full_name: 'Alex' } },
              ],
                });

        const response = await request(app.getHttpServer())
              .get(`/apartments/${id}/members`)
              .expect(200);

        expect(response.body).toEqual([
              { id: 'u-alex', full_name: 'Alex' },
              { id: 'u-leo', full_name: 'Leo' },
              { id: 'u-sara', full_name: 'Sara' },
            ]);
 });

      it('funciona para un apartamento sin propietario', async () => {
            prisma.apartment.findUnique.mockResolvedValue({
 landlord: null,
                  user_apartments: [{ user: { id: 'u-alex', full_name: 'Alex' } }],
                });

        const response = await request(app.getHttpServer())
              .get(`/apartments/${id}/members`)
              .expect(200);

        expect(response.body).toEqual([{ id: 'u-alex', full_name: 'Alex' }]);
  });

      it('devuelve 404 cuando el apartamento no existe', async () => {
            prisma.apartment.findUnique.mockResolvedValue(null);
        
                await request(app.getHttpServer()).get(`/apartments/${id}/members`).expect(404);
          });

      it('bloquea con 400 un identificador que no es un UUID', async () => {
            await request(app.getHttpServer()).get('/apartments/abc/members').expect(400);
        
               expect(prisma.apartment.findUnique).not.toHaveBeenCalled();
          });
});