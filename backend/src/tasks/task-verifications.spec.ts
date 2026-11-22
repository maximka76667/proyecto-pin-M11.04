import {
  ConflictException,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import { PrismaService } from '../prisma/prisma.service';
import { TaskVerificationsController } from './task-verifications.controller';
import { monthKey } from '../points/points.service';
import { TaskVerificationsService } from './task-verifications.service';

// Verificación de tareas: marcar como hecha -> verificador al azar -> confirmar o rechazar.
describe('Verificación de tareas', () => {
  let app: INestApplication<App>;
  let service: TaskVerificationsService;

  const PISO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ASIGNACION = '5c9d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
  const ANA = '11111111-1111-1111-1111-111111111111';
  // El usuario que devuelve @CurrentUser() en los tests
  const YO = '22222222-2222-2222-2222-222222222222';
  const BRUNO = '33333333-3333-3333-3333-333333333333';

  const prisma = {
    taskAssignment: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    userApartment: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    taskSwapRequest: { findFirst: jest.fn() },
    taskPoints: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const asignacion = (over: Record<string, unknown> = {}) => ({
    id: ASIGNACION,
    user_id: YO,
    status: 'pending',
    verifier_id: null,
    task: { apartment_id: PISO, points: 10, title: 'Fregar' },
    ...over,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.taskSwapRequest.findFirst.mockResolvedValue(null);
    prisma.taskAssignment.updateMany.mockResolvedValue({ count: 1 });
    prisma.taskAssignment.findMany.mockResolvedValue([]);
    prisma.userApartment.findMany.mockResolvedValue([YO, ANA, BRUNO].map((user_id) => ({ user_id })));
    prisma.userApartment.findUnique.mockResolvedValue({ user_id: YO });
    prisma.user.findUnique.mockResolvedValue({ id: ANA, full_name: 'Ana' });

    const moduleRef = await Test.createTestingModule({
      controllers: [TaskVerificationsController],
      providers: [TaskVerificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    service = moduleRef.get(TaskVerificationsService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('submit', () => {
    it('pasa a esperar verificación con otro miembro como verificador y 24 h de plazo', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      const antes = Date.now();

      const resultado = await service.submit(ASIGNACION, YO);

      expect(resultado.status).toBe('waiting_verification');
      const { data } = prisma.taskAssignment.updateMany.mock.calls[0][0];
      expect([ANA, BRUNO]).toContain(data.verifier_id); // nunca el propio responsable
      expect(data.status).toBe('waiting_verification');
      const horas = (data.verification_deadline.getTime() - antes) / 3_600_000;
      expect(horas).toBeGreaterThan(23.9);
      expect(horas).toBeLessThan(24.1);
      expect(prisma.taskPoints.create).not.toHaveBeenCalled(); // aún no hay puntos
    });

    it('si no hay nadie más en el piso, se completa directamente y suma los puntos', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      prisma.userApartment.findMany.mockResolvedValue([{ user_id: YO }]);

      const resultado = await service.submit(ASIGNACION, YO);

      expect(resultado.status).toBe('completed');
      expect(prisma.taskPoints.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: YO, assignment_id: ASIGNACION, points: 10 }),
      });
    });

    it('solo quien tiene la tarea puede marcarla como hecha', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion({ user_id: ANA }));

      await expect(service.submit(ASIGNACION, YO)).rejects.toThrow(ForbiddenException);
      expect(prisma.taskAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('no se puede enviar a verificar una tarea con un intercambio pendiente', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      prisma.taskSwapRequest.findFirst.mockResolvedValue({ id: 'swap' });

      await expect(service.submit(ASIGNACION, YO)).rejects.toThrow(ConflictException);
      expect(prisma.taskAssignment.updateMany).not.toHaveBeenCalled();
    });

    it('no se puede marcar como hecha una tarea ya completada o en verificación', async () => {
      for (const status of ['completed', 'waiting_verification']) {
        prisma.taskAssignment.findUnique.mockResolvedValue(asignacion({ status }));
        await expect(service.submit(ASIGNACION, YO)).rejects.toThrow(ConflictException);
      }
    });

    it('si otra petición cambió la tarea a la vez, responde conflicto', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      prisma.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.submit(ASIGNACION, YO)).rejects.toThrow(ConflictException);
    });
  });

  describe('verify', () => {
    const enEspera = (over = {}) =>
      asignacion({ user_id: ANA, status: 'waiting_verification', verifier_id: YO, ...over });

    it('el verificador confirma: completada y puntos para el responsable', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(enEspera());

      const resultado = await service.verify(ASIGNACION, YO);

      expect(resultado.status).toBe('completed');
      expect(prisma.taskPoints.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: ANA, // los puntos son de quien hizo la tarea, no del verificador
          apartment_id: PISO,
          assignment_id: ASIGNACION,
          points: 10,
          month: monthKey(new Date()),
        }),
      });
    });

    it('no suma nada si la tarea vale 0 puntos', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(
        enEspera({ task: { apartment_id: PISO, points: 0, title: 'Fregar' } }),
      );

      await service.verify(ASIGNACION, YO);

      expect(prisma.taskPoints.create).not.toHaveBeenCalled();
    });

    it('otro compañero no puede confirmarla', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(enEspera({ verifier_id: BRUNO }));

      await expect(service.verify(ASIGNACION, YO)).rejects.toThrow(ForbiddenException);
      expect(prisma.taskPoints.create).not.toHaveBeenCalled();
    });

    it('no se confirma dos veces', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(enEspera());
      prisma.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verify(ASIGNACION, YO)).rejects.toThrow(ConflictException);
      expect(prisma.taskPoints.create).not.toHaveBeenCalled();
    });

    it('no se puede confirmar una tarea que no está en verificación', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(enEspera({ status: 'pending' }));

      await expect(service.verify(ASIGNACION, YO)).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    it('vuelve a pendiente y guarda el motivo para el responsable', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(
        asignacion({ user_id: ANA, status: 'waiting_verification', verifier_id: YO }),
      );

      const resultado = await service.reject(ASIGNACION, YO, 'Falta fregar el suelo');

      expect(resultado).toEqual({ status: 'pending', rejection_reason: 'Falta fregar el suelo' });
      expect(prisma.taskAssignment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pending',
            rejection_reason: 'Falta fregar el suelo',
            verifier_id: null,
          }),
        }),
      );
      expect(prisma.taskPoints.create).not.toHaveBeenCalled();
    });

    it('POST /tasks/assignments/:id/reject exige un motivo', async () => {
      await request(app.getHttpServer())
        .post(`/tasks/assignments/${ASIGNACION}/reject`)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .post(`/tasks/assignments/${ASIGNACION}/reject`)
        .send({ reason: '  ' })
        .expect(400);
      expect(prisma.taskAssignment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('plazo vencido', () => {
    afterEach(() => jest.restoreAllMocks());

    const caducada = (verifier_id?: string) =>
      prisma.taskAssignment.findMany.mockResolvedValue([{ id: ASIGNACION, user_id: ANA, verifier_id }]);

    it('elige al azar a cualquier miembro menos a quien hizo la tarea', async () => {
      caducada(); // la hizo Ana; el piso es Yo, Ana y Bruno
      jest.spyOn(Math, 'random').mockReturnValue(0.99);

      const cambiadas = await service.reassignExpired(PISO);

      expect(cambiadas).toBe(1);
      const { data } = prisma.taskAssignment.updateMany.mock.calls[0][0];
      expect(data.verifier_id).toBe(BRUNO);
      expect(data.verification_deadline.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    });

    it('con otro candidato, no repite al verificador que no respondió', async () => {
      caducada(YO); // Yo no respondió; el piso es Yo, Ana (la hizo) y Bruno
      jest.spyOn(Math, 'random').mockReturnValue(0); // primero del grupo que queda: Bruno

      await service.reassignExpired(PISO);

      expect(prisma.taskAssignment.updateMany.mock.calls[0][0].data.verifier_id).toBe(BRUNO);
    });

    it('si no queda nadie más (piso de dos), se queda el mismo verificador con plazo nuevo', async () => {
      caducada(YO);
      prisma.userApartment.findMany.mockResolvedValue([YO, ANA].map((user_id) => ({ user_id })));

      await service.reassignExpired(PISO);

      const { data } = prisma.taskAssignment.updateMany.mock.calls[0][0];
      expect(data.verifier_id).toBe(YO);
      expect(data.verification_deadline.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    });

    it('nunca elige a quien hizo la tarea', async () => {
      caducada();
      for (const azar of [0, 0.34, 0.5, 0.99]) {
        prisma.taskAssignment.updateMany.mockClear();
        jest.spyOn(Math, 'random').mockReturnValue(azar);
        await service.reassignExpired(PISO);
        expect(prisma.taskAssignment.updateMany.mock.calls[0][0].data.verifier_id).not.toBe(ANA);
      }
    });

    it('no toca nada si no hay verificaciones caducadas', async () => {
      expect(await service.reassignExpired(PISO)).toBe(0);
      expect(prisma.taskAssignment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /tasks/verifications', () => {
    it('devuelve las tareas que el usuario tiene que revisar', async () => {
      prisma.taskAssignment.findMany
        .mockResolvedValueOnce([]) // caducadas
        .mockResolvedValueOnce([{ id: ASIGNACION }]); // por revisar

      const res = await request(app.getHttpServer())
        .get(`/tasks/verifications?apartment_id=${PISO}`)
        .expect(200);

      expect(res.body).toEqual([{ id: ASIGNACION }]);
    });

    it('rechaza un apartment_id que no es un identificador', async () => {
      await request(app.getHttpServer()).get('/tasks/verifications?apartment_id=hola').expect(400);
    });

    it('rechaza a quien no es del piso', async () => {
      prisma.userApartment.findUnique.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get(`/tasks/verifications?apartment_id=${PISO}`)
        .expect(403);
    });
  });
});
