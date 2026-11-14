import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// "YYYY-MM" en UTC: el mes en el que se ganan los puntos
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  // Marca la asignación como hecha y registra los puntos de la tarea en el ledger, todo en una
  // transacción. Es el ÚNICO sitio donde se otorgan puntos: cuando exista la verificación solo
  // hay que mover esta llamada al momento en que otra persona confirma la tarea.
  async completeAssignment(assignmentId: string, userId: string) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        user_id: true,
        status: true,
        task: { select: { apartment_id: true, points: true } },
      },
    });
    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }
    if (assignment.user_id !== userId) {
      throw new ForbiddenException(
        'Solo la persona asignada puede completar la tarea',
      );
    }
    if (assignment.status === AssignmentStatus.completed) {
      return { assignment_id: assignment.id, status: assignment.status, points: 0 };
    }
    if (assignment.status === AssignmentStatus.rejected) {
      throw new ConflictException('No puedes completar una tarea rechazada');
    }

    // PA-1010.01: una asignación con un intercambio pendiente queda bloqueada
    const pendingSwap = await this.prisma.taskSwapRequest.findFirst({
      where: {
        status: 'pending',
        OR: [
          { from_assignment_id: assignmentId },
          { to_assignment_id: assignmentId },
        ],
      },
      select: { id: true },
    });
    if (pendingSwap) {
      throw new ConflictException(
        'No puedes completar una tarea mientras tiene un intercambio pendiente',
      );
    }

    const points = assignment.task.points;
    try {
      await this.prisma.$transaction([
        this.prisma.taskAssignment.update({
          where: { id: assignmentId },
          data: { status: AssignmentStatus.completed },
        }),
        this.prisma.taskPoints.create({
          data: {
            user_id: userId,
            apartment_id: assignment.task.apartment_id,
            assignment_id: assignmentId,
            points,
            month: monthKey(new Date()),
          },
        }),
      ]);
    } catch (error) {
      // Dos peticiones a la vez: la segunda choca con el índice único y no suma otra vez
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          assignment_id: assignmentId,
          status: AssignmentStatus.completed,
          points: 0,
        };
      }
      throw error;
    }

    return {
      assignment_id: assignmentId,
      status: AssignmentStatus.completed,
      points,
    };
  }

  // Puntos de la persona en su casa: su fila del ranking (mes, total y posición). Sale del
  // mismo cálculo que el ranking para que el perfil y el ranking nunca digan cosas distintas
  async getMyPoints(apartmentId: string, userId: string, month?: string) {
    const { month: selectedMonth, ranking } = await this.getRanking(apartmentId, userId, month);
    const mine = ranking.find((row) => row.user_id === userId);
    return {
      month: selectedMonth,
      points: mine?.points ?? 0,
      total_points: mine?.total_points ?? 0,
      rank: mine?.rank ?? null,
    };
  }

  // Ranking de la casa: puntos del mes y totales de cada miembro (con 0 si aún no tiene),
  // de mayor a menor. Los empates comparten posición.
  async getRanking(apartmentId: string, userId: string, month?: string) {
    const selectedMonth = month ?? monthKey(new Date());
    if (!MONTH_PATTERN.test(selectedMonth)) {
      throw new BadRequestException('El mes debe tener el formato AAAA-MM');
    }

    const membership = await this.prisma.userApartment.findUnique({
      where: {
        user_id_apartment_id: { user_id: userId, apartment_id: apartmentId },
      },
      select: { user_id: true },
    });
    if (!membership) {
      throw new ForbiddenException('No perteneces a este piso');
    }

    const [members, monthly, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { user_apartments: { some: { apartment_id: apartmentId } } },
        select: { id: true, full_name: true },
      }),
      this.prisma.taskPoints.groupBy({
        by: ['user_id'],
        where: { apartment_id: apartmentId, month: selectedMonth },
        _sum: { points: true },
      }),
      this.prisma.taskPoints.groupBy({
        by: ['user_id'],
        where: { apartment_id: apartmentId },
        _sum: { points: true },
      }),
    ]);

    const monthlyById = new Map(monthly.map((row) => [row.user_id, row._sum.points ?? 0]));
    const totalById = new Map(total.map((row) => [row.user_id, row._sum.points ?? 0]));

    const rows = members
      .map((member) => ({
        user_id: member.id,
        full_name: member.full_name,
        isCurrentUser: member.id === userId,
        points: monthlyById.get(member.id) ?? 0,
        total_points: totalById.get(member.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.total_points - a.total_points ||
          a.full_name.localeCompare(b.full_name),
      );

    let rank = 0;
    const ranking = rows.map((row, index) => {
      if (index === 0 || row.points !== rows[index - 1].points) rank = index + 1;
      return { ...row, rank };
    });

    return { month: selectedMonth, ranking };
  }
}
