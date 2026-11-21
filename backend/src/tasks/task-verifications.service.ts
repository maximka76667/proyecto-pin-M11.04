import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma } from '@prisma/client';
import { monthKey } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

// Plazo que tiene el verificador para responder antes de que se asigne a otro
export const VERIFICATION_HOURS = 24;

// Estados desde los que su responsable puede dar la tarea por hecha
const SUBMITTABLE: AssignmentStatus[] = [
  AssignmentStatus.pending,
  AssignmentStatus.accepted,
  AssignmentStatus.overdue,
];

const ASSIGNMENT_SELECT = {
  id: true,
  user_id: true,
  status: true,
  verifier_id: true,
  task: { select: { apartment_id: true, points: true, title: true } },
} satisfies Prisma.TaskAssignmentSelect;

type LoadedAssignment = Prisma.TaskAssignmentGetPayload<{
  select: typeof ASSIGNMENT_SELECT;
}>;

@Injectable()
export class TaskVerificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // El responsable marca su tarea como hecha. Se elige al azar a otro miembro del piso como
  // verificador; si no hay nadie más, la tarea se completa directamente
  async submit(assignmentId: string, userId: string) {
    const assignment = await this.load(assignmentId);
    if (assignment.user_id !== userId) {
      throw new ForbiddenException('Solo quien tiene la tarea puede marcarla como hecha');
    }
    if (!SUBMITTABLE.includes(assignment.status)) {
      throw new ConflictException('Esta tarea no se puede marcar como hecha ahora');
    }

    // Igual que al completar con puntos: una tarea con un intercambio pendiente queda bloqueada
    const pendingSwap = await this.prisma.taskSwapRequest.findFirst({
      where: {
        status: 'pending',
        OR: [{ from_assignment_id: assignmentId }, { to_assignment_id: assignmentId }],
      },
      select: { id: true },
    });
    if (pendingSwap) {
      throw new ConflictException(
        'No puedes marcar como hecha una tarea mientras tiene un intercambio pendiente',
      );
    }

    const candidates = (await this.memberIds(assignment.task.apartment_id)).filter(
      (id) => id !== userId,
    );

    if (candidates.length === 0) {
      return this.prisma.$transaction(async (tx) => {
        const { count } = await tx.taskAssignment.updateMany({
          where: { id: assignmentId, status: { in: SUBMITTABLE } },
          data: {
            status: AssignmentStatus.completed,
            verifier_id: null,
            verification_deadline: null,
            rejection_reason: null,
          },
        });
        if (count !== 1) {
          throw new ConflictException('Esta tarea ya ha cambiado de estado');
        }
        await this.awardPoints(tx, assignment);
        return { status: AssignmentStatus.completed, verifier: null };
      });
    }

    const verifierId = this.pickRandom(candidates);
    const { count } = await this.prisma.taskAssignment.updateMany({
      where: { id: assignmentId, status: { in: SUBMITTABLE } },
      data: {
        status: AssignmentStatus.waiting_verification,
        verifier_id: verifierId,
        verification_deadline: this.newDeadline(),
        rejection_reason: null,
      },
    });
    if (count !== 1) {
      throw new ConflictException('Esta tarea ya ha cambiado de estado');
    }

    const verifier = await this.prisma.user.findUnique({
      where: { id: verifierId },
      select: { id: true, full_name: true },
    });
    return { status: AssignmentStatus.waiting_verification, verifier };
  }

  // El verificador confirma: la tarea pasa a completada y su responsable gana los puntos
  async verify(assignmentId: string, userId: string) {
    const assignment = await this.loadForVerifier(assignmentId, userId);

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.taskAssignment.updateMany({
        where: {
          id: assignmentId,
          status: AssignmentStatus.waiting_verification,
          verifier_id: userId,
        },
        data: {
          status: AssignmentStatus.completed,
          verification_deadline: null,
          rejection_reason: null,
        },
      });
      if (count !== 1) {
        throw new ConflictException('Esta tarea ya ha sido verificada');
      }
      await this.awardPoints(tx, assignment);
      return { status: AssignmentStatus.completed };
    });
  }

  // El verificador rechaza con un motivo: vuelve a pendiente y el responsable ve el motivo
  async reject(assignmentId: string, userId: string, reason: string) {
    await this.loadForVerifier(assignmentId, userId);

    const { count } = await this.prisma.taskAssignment.updateMany({
      where: {
        id: assignmentId,
        status: AssignmentStatus.waiting_verification,
        verifier_id: userId,
      },
      data: {
        status: AssignmentStatus.pending,
        verifier_id: null,
        verification_deadline: null,
        rejection_reason: reason,
      },
    });
    if (count !== 1) {
      throw new ConflictException('Esta tarea ya ha sido verificada');
    }
    return { status: AssignmentStatus.pending, rejection_reason: reason };
  }

  // Bandeja "Tareas por revisar" del usuario. Antes reasigna las verificaciones caducadas
  // del piso, así que se ejecuta cada vez que alguien abre Chores
  async listForReview(apartmentId: string, userId: string) {
    await this.assertMember(apartmentId, userId);
    await this.reassignExpired(apartmentId);

    return this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.waiting_verification,
        verifier_id: userId,
        task: { apartment_id: apartmentId },
      },
      select: {
        id: true,
        due_date: true,
        due_time: true,
        verification_deadline: true,
        user: { select: { id: true, full_name: true } },
        task: { select: { id: true, title: true, description: true, points: true } },
      },
      orderBy: { verification_deadline: 'asc' },
    });
  }

  // Si el verificador no responde en el plazo, se elige a otro miembro al azar: cualquiera del
  // piso menos quien hizo la tarea. Al ser azar puro, puede tocarle otra vez al mismo
  // verificador que no respondió (así no hay casos especiales cuando hay pocos miembros)
  async reassignExpired(apartmentId: string, now = new Date()) {
    const expired = await this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.waiting_verification,
        verification_deadline: { lt: now },
        task: { apartment_id: apartmentId },
      },
      select: { id: true, user_id: true },
    });
    if (expired.length === 0) return 0;

    const members = await this.memberIds(apartmentId);
    let reassigned = 0;
    for (const assignment of expired) {
      const pool = members.filter((id) => id !== assignment.user_id);
      if (pool.length === 0) continue;

      const { count } = await this.prisma.taskAssignment.updateMany({
        // Con esta condición dos peticiones a la vez no reasignan dos veces
        where: {
          id: assignment.id,
          status: AssignmentStatus.waiting_verification,
          verification_deadline: { lt: now },
        },
        data: {
          verifier_id: this.pickRandom(pool),
          verification_deadline: this.newDeadline(now),
        },
      });
      reassigned += count;
    }
    return reassigned;
  }

  private async load(assignmentId: string): Promise<LoadedAssignment> {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      select: ASSIGNMENT_SELECT,
    });
    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }
    return assignment;
  }

  // Carga la asignación (tras reasignar las caducadas del piso) y comprueba que sigue
  // esperando verificación y que el usuario es su verificador
  private async loadForVerifier(assignmentId: string, userId: string) {
    const first = await this.load(assignmentId);
    await this.reassignExpired(first.task.apartment_id);
    const assignment = await this.load(assignmentId);

    if (assignment.status !== AssignmentStatus.waiting_verification) {
      throw new ConflictException('Esta tarea no está pendiente de verificación');
    }
    if (assignment.verifier_id !== userId) {
      throw new ForbiddenException('Solo el verificador asignado puede responder');
    }
    return assignment;
  }

  private async awardPoints(
    tx: Prisma.TransactionClient,
    assignment: LoadedAssignment,
  ) {
    if (assignment.task.points <= 0) return;
    // assignment_id es único en TaskPoints: aunque se repitiera la llamada, no se duplican
    await tx.taskPoints.create({
      data: {
        user_id: assignment.user_id,
        apartment_id: assignment.task.apartment_id,
        assignment_id: assignment.id,
        points: assignment.task.points,
        month: monthKey(new Date()),
      },
    });
  }

  private async memberIds(apartmentId: string): Promise<string[]> {
    const rows = await this.prisma.userApartment.findMany({
      where: { apartment_id: apartmentId },
      select: { user_id: true },
    });
    return rows.map(({ user_id }) => user_id);
  }

  private async assertMember(apartmentId: string, userId: string) {
    const member = await this.prisma.userApartment.findUnique({
      where: {
        user_id_apartment_id: { user_id: userId, apartment_id: apartmentId },
      },
      select: { user_id: true },
    });
    if (!member) {
      throw new ForbiddenException('No perteneces a este piso');
    }
  }

  private pickRandom<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
  }

  private newDeadline(from = new Date()): Date {
    return new Date(from.getTime() + VERIFICATION_HOURS * 60 * 60 * 1000);
  }
}
