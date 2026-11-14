import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { monthKey, PointsService } from './points.service';

const APARTMENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ANA = '11111111-1111-1111-1111-111111111111';
const LUIS = '22222222-2222-2222-2222-222222222222';
const ASSIGNMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('PointsService', () => {
  let service: PointsService;
  const prisma = {
    taskAssignment: { findUnique: jest.fn(), update: jest.fn() },
    taskSwapRequest: { findFirst: jest.fn() },
    taskPoints: { create: jest.fn(), groupBy: jest.fn() },
    userApartment: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const asignacion = (overrides: Record<string, unknown> = {}) => ({
    id: ASSIGNMENT,
    user_id: ANA,
    status: 'pending',
    task: { apartment_id: APARTMENT, points: 45 },
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.taskSwapRequest.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.taskAssignment.update.mockResolvedValue({});
    prisma.taskPoints.create.mockResolvedValue({});
    service = new PointsService(prisma as never);
  });

  describe('completeAssignment', () => {
    it('marca la tarea como completada y registra los puntos de la tarea', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());

      const result = await service.completeAssignment(ASSIGNMENT, ANA);

      expect(result).toEqual({ assignment_id: ASSIGNMENT, status: 'completed', points: 45 });
      expect(prisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: ASSIGNMENT },
        data: { status: 'completed' },
      });
      expect(prisma.taskPoints.create).toHaveBeenCalledWith({
        data: {
          user_id: ANA,
          apartment_id: APARTMENT,
          assignment_id: ASSIGNMENT,
          points: 45,
          month: monthKey(new Date()),
        },
      });
    });

    it('no suma puntos otra vez si la tarea ya estaba completada', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion({ status: 'completed' }));

      const result = await service.completeAssignment(ASSIGNMENT, ANA);

      expect(result.points).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('no suma dos veces si dos peticiones llegan a la vez (índice único)', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.completeAssignment(ASSIGNMENT, ANA);

      expect(result.points).toBe(0);
    });

    it('propaga los errores de base de datos que no son un duplicado', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      prisma.$transaction.mockRejectedValue(new Error('caída de la base de datos'));

      await expect(service.completeAssignment(ASSIGNMENT, ANA)).rejects.toThrow(
        'caída de la base de datos',
      );
    });

    it('rechaza una asignación que no existe', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(null);

      await expect(service.completeAssignment(ASSIGNMENT, ANA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('solo deja completarla a la persona asignada', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());

      await expect(service.completeAssignment(ASSIGNMENT, LUIS)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza una tarea rechazada', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion({ status: 'rejected' }));

      await expect(service.completeAssignment(ASSIGNMENT, ANA)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rechaza una tarea con un intercambio pendiente', async () => {
      prisma.taskAssignment.findUnique.mockResolvedValue(asignacion());
      prisma.taskSwapRequest.findFirst.mockResolvedValue({ id: 'swap-1' });

      await expect(service.completeAssignment(ASSIGNMENT, ANA)).rejects.toThrow(
        'intercambio pendiente',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getRanking', () => {
    beforeEach(() => {
      prisma.userApartment.findUnique.mockResolvedValue({ user_id: ANA });
      prisma.user.findMany.mockResolvedValue([
        { id: ANA, full_name: 'Ana' },
        { id: LUIS, full_name: 'Luis' },
        { id: 'u3', full_name: 'Marta' },
      ]);
    });

    it('ordena por puntos del mes e incluye a quien tiene 0', async () => {
      prisma.taskPoints.groupBy
        .mockResolvedValueOnce([
          { user_id: ANA, _sum: { points: 45 } },
          { user_id: LUIS, _sum: { points: 90 } },
        ])
        .mockResolvedValueOnce([
          { user_id: ANA, _sum: { points: 145 } },
          { user_id: LUIS, _sum: { points: 90 } },
        ]);

      const result = await service.getRanking(APARTMENT, ANA, '2026-11');

      expect(result.month).toBe('2026-11');
      expect(result.ranking.map((row) => [row.full_name, row.points, row.total_points, row.rank]))
        .toEqual([
          ['Luis', 90, 90, 1],
          ['Ana', 45, 145, 2],
          ['Marta', 0, 0, 3],
        ]);
      expect(result.ranking.find((row) => row.user_id === ANA)?.isCurrentUser).toBe(true);
    });

    it('filtra por casa y por mes, y los totales solo por casa', async () => {
      prisma.taskPoints.groupBy.mockResolvedValue([]);

      await service.getRanking(APARTMENT, ANA, '2026-11');

      expect(prisma.taskPoints.groupBy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { apartment_id: APARTMENT, month: '2026-11' } }),
      );
      expect(prisma.taskPoints.groupBy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { apartment_id: APARTMENT } }),
      );
    });

    it('los empates comparten posición', async () => {
      prisma.taskPoints.groupBy
        .mockResolvedValueOnce([
          { user_id: ANA, _sum: { points: 60 } },
          { user_id: LUIS, _sum: { points: 60 } },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getRanking(APARTMENT, ANA, '2026-11');

      expect(result.ranking.map((row) => row.rank)).toEqual([1, 1, 3]);
    });

    it('usa el mes actual si no se indica', async () => {
      prisma.taskPoints.groupBy.mockResolvedValue([]);

      const result = await service.getRanking(APARTMENT, ANA);

      expect(result.month).toBe(monthKey(new Date()));
    });

    it('rechaza un mes con formato incorrecto', async () => {
      await expect(service.getRanking(APARTMENT, ANA, '2026-13')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getRanking(APARTMENT, ANA, 'noviembre')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza a quien no pertenece al piso', async () => {
      prisma.userApartment.findUnique.mockResolvedValue(null);

      await expect(service.getRanking(APARTMENT, LUIS, '2026-11')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.taskPoints.groupBy).not.toHaveBeenCalled();
    });
  });
});
