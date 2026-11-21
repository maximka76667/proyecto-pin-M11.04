import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssignmentStatus, Prisma, TaskStatus } from '@prisma/client';
import { monthKey } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  VERIFICACION_CONFIRMADA,
  VERIFICACION_RECHAZADA,
  VERIFICACION_SOLICITADA,
  VerificacionConfirmada,
  VerificacionRechazada,
  VerificacionSolicitada,
  type VerificationNotice,
} from './task.events';

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
  task_id: true,
  user_id: true,
  status: true,
  verifier_id: true,
  task: {
    select: { apartment_id: true, points: true, title: true, status: true },
  },
} satisfies Prisma.TaskAssignmentSelect;

type LoadedAssignment = Prisma.TaskAssignmentGetPayload<{
  select: typeof ASSIGNMENT_SELECT;
}>;

@Injectable()
export class TaskVerificationsService {
  constructor(
    private readonly prisma: PrismaService,
    // Opcional: sin él (p. ej. en los tests que no lo dan) no se emiten eventos ni hay avisos
    @Optional() private readonly events?: EventEmitter2,
  ) {}

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
    // Una tarea anulada ya no se hace: aunque su asignación siga pendiente, no se puede enviar
    if (assignment.task.status === TaskStatus.cancelled) {
      throw new ConflictException('Esta tarea ha sido anulada y ya no se puede marcar como hecha');
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

    // Solo el verificador elegido recibe un aviso
    await this.events?.emitAsync(
      VERIFICACION_SOLICITADA,
      new VerificacionSolicitada(this.notice(assignment, verifierId)),
    );

    const verifier = await this.prisma.user.findUnique({
      where: { id: verifierId },
      select: { id: true, full_name: true },
    });
    return { status: AssignmentStatus.waiting_verification, verifier };
  }

  // El verificador confirma: la tarea pasa a completada y su responsable gana los puntos
  async verify(assignmentId: string, userId: string) {
    const assignment = await this.loadForVerifier(assignmentId, userId);

    const result = await this.prisma.$transaction(async (tx) => {
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

    // Quien hizo la tarea recibe un aviso con los puntos que ha ganado
    await this.events?.emitAsync(
      VERIFICACION_CONFIRMADA,
      new VerificacionConfirmada({
        ...this.notice(assignment, userId),
        points: assignment.task.points,
      }),
    );
    return result;
  }

  // El verificador rechaza con un motivo: vuelve a pendiente y el responsable ve el motivo
  async reject(assignmentId: string, userId: string, reason: string) {
    const assignment = await this.loadForVerifier(assignmentId, userId);

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

    // Quien hizo la tarea recibe un aviso con el motivo
    await this.events?.emitAsync(
      VERIFICACION_RECHAZADA,
      new VerificacionRechazada({ ...this.notice(assignment, userId), reason }),
    );
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
  // piso menos quien hizo la tarea y menos el verificador que no respondió. Solo si no queda
  // nadie más (en un piso de dos) se queda el mismo, con un plazo nuevo: nunca verifica quien
  // hizo la tarea. Cada reasignación avisa al nuevo verificador
  async reassignExpired(apartmentId: string, now = new Date()) {
    const expired = await this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.waiting_verification,
        verification_deadline: { lt: now },
        task: { apartment_id: apartmentId },
      },
      select: ASSIGNMENT_SELECT,
    });
    if (expired.length === 0) return 0;

    const members = await this.memberIds(apartmentId);
    let reassigned = 0;
    for (const assignment of expired) {
      const candidates = members.filter((id) => id !== assignment.user_id);
      if (candidates.length === 0) continue;
      const others = candidates.filter((id) => id !== assignment.verifier_id);
      const next = this.pickRandom(others.length > 0 ? others : candidates);

      const { count } = await this.prisma.taskAssignment.updateMany({
        // Con esta condición dos peticiones a la vez no reasignan dos veces
        where: {
          id: assignment.id,
          status: AssignmentStatus.waiting_verification,
          verification_deadline: { lt: now },
        },
        data: {
          verifier_id: next,
          verification_deadline: this.newDeadline(now),
        },
      });
      reassigned += count;

      if (count === 1 && this.events) {
        await this.events.emitAsync(
          VERIFICACION_SOLICITADA,
          new VerificacionSolicitada({
            ...this.notice(assignment, next),
            reassigned: true,
          }),
        );
      }
    }
    return reassigned;
  }

  // Lo que necesitan los avisos: de qué tarea habla, quién la hizo y quién verifica
  private notice(assignment: LoadedAssignment, verifierId: string): VerificationNotice {
    return {
      assignmentId: assignment.id,
      taskId: assignment.task_id,
      taskTitle: assignment.task.title,
      apartmentId: assignment.task.apartment_id,
      ownerId: assignment.user_id,
      verifierId,
    };
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
