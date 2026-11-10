import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks.service';

// Datos mínimos de una asignación necesarios para validar y ejecutar un intercambio.
const ASSIGNMENT_SELECT = {
  id: true,
  user_id: true,
  due_date: true,
  due_time: true,
  start_minute: true,
  user: { select: { id: true, full_name: true } },
  task: {
    select: { id: true, title: true, apartment_id: true, duration_minutes: true },
  },
} satisfies Prisma.TaskAssignmentSelect;

type AssignmentForSwap = Prisma.TaskAssignmentGetPayload<{
  select: typeof ASSIGNMENT_SELECT;
}>;

@Injectable()
export class TaskSwapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
  ) {}

  // Tareas de OTROS miembros del piso que el usuario podría pedir a cambio: deben estar
  // asignadas y no implicadas ya en otro intercambio pendiente.
  async listSwappableTasks(apartmentId: string, currentUserId: string) {
    await this.tasksService.assertMember(apartmentId, currentUserId);

    const lockedIds = await this.pendingAssignmentIds(apartmentId);

    return this.prisma.taskAssignment.findMany({
      where: {
        user_id: { not: currentUserId },
        id: { notIn: lockedIds },
        task: { apartment_id: apartmentId },
      },
      select: ASSIGNMENT_SELECT,
      orderBy: [{ due_date: 'asc' }, { due_time: 'asc' }],
    });
  }

  // Peticiones en las que el usuario participa (como emisor o receptor) en ese piso.
  async listMySwaps(apartmentId: string, currentUserId: string) {
    await this.tasksService.assertMember(apartmentId, currentUserId);

    return this.prisma.taskSwapRequest.findMany({
      where: {
        apartment_id: apartmentId,
        OR: [{ from_user_id: currentUserId }, { to_user_id: currentUserId }],
      },
      include: {
        from_user: { select: { id: true, full_name: true } },
        to_user: { select: { id: true, full_name: true } },
        from_assignment: { select: ASSIGNMENT_SELECT },
        to_assignment: { select: ASSIGNMENT_SELECT },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // PA-1010.01 / PA-1010.04: el emisor crea una petición dirigida ofreciendo su tarea a cambio
  // de otra concreta de un compañero. Valida pertenencia al piso y disponibilidad cruzada.
  async createSwapRequest(
    fromAssignmentId: string,
    toAssignmentId: string,
    currentUserId: string,
  ) {
    if (fromAssignmentId === toAssignmentId) {
      throw new BadRequestException(
        'No puedes intercambiar una tarea consigo misma',
      );
    }

    const from = await this.buscarAsignacion(fromAssignmentId);
    const to = await this.buscarAsignacion(toAssignmentId);

    if (from.user_id !== currentUserId) {
      throw new ForbiddenException('Solo puedes ofrecer una tarea que sea tuya');
    }
    if (to.user_id === currentUserId) {
      throw new BadRequestException('No puedes intercambiar contigo mismo');
    }
    if (from.task.apartment_id !== to.task.apartment_id) {
      throw new ForbiddenException('Las tareas no pertenecen al mismo piso');
    }

    // Ambos tienen que ser miembros del piso de las tareas.
    await this.tasksService.assertMember(from.task.apartment_id, currentUserId);
    await this.tasksService.assertMember(to.task.apartment_id, to.user_id);

    await this.ensureNotAlreadyPending([fromAssignmentId, toAssignmentId]);

    await this.assertCrossAvailability(from, to);

    try {
      return await this.prisma.taskSwapRequest.create({
        data: {
          apartment_id: from.task.apartment_id,
          from_user_id: from.user_id,
          to_user_id: to.user_id,
          from_assignment_id: from.id,
          to_assignment_id: to.id,
        },
        include: {
          from_assignment: { select: ASSIGNMENT_SELECT },
          to_assignment: { select: ASSIGNMENT_SELECT },
          to_user: { select: { id: true, full_name: true } },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya hay un intercambio pendiente para una de las tareas',
        );
      }
      throw error;
    }
  }

  // PA-1010.02: el receptor acepta. Se intercambian los dueños de ambas asignaciones y se borra
  // la petición, todo en una transacción. Se revalida la disponibilidad por si cambió el estado.
  async acceptSwapRequest(id: string, currentUserId: string) {
    const request = await this.buscarPeticion(id);

    if (request.to_user_id !== currentUserId) {
      throw new ForbiddenException(
        'Solo el compañero que recibe la petición puede aceptarla',
      );
    }

    await this.assertCrossAvailability(
      request.from_assignment,
      request.to_assignment,
    );

    // La restricción única (user_id, due_date, due_time) se comprueba fila a fila, incluso dentro
    // de un mismo UPDATE. Si ambas tareas comparten hueco, intercambiar los dueños dejaría, un
    // instante, a una persona con dos tareas a la misma hora. Para que nunca exista ese duplicado
    // intermedio se aparca la hora de `from` (null nunca choca) y se restaura al final, todo
    // dentro de la transacción (atómico: o se aplica todo o nada).
    const fromDueTime = request.from_assignment.due_time;
    try {
      await this.prisma.$transaction([
        this.prisma.taskAssignment.update({
          where: { id: request.from_assignment_id },
          data: { due_time: null },
        }),
        this.prisma.taskAssignment.update({
          where: { id: request.to_assignment_id },
          data: { user_id: request.from_user_id },
        }),
        this.prisma.taskAssignment.update({
          where: { id: request.from_assignment_id },
          data: { user_id: request.to_user_id, due_time: fromDueTime },
        }),
        this.prisma.taskSwapRequest.delete({ where: { id } }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Una de las tareas ya ocupa ese horario para el nuevo responsable',
        );
      }
      throw error;
    }

    return { status: 'accepted' as const };
  }

  // PA-1010.03: el receptor rechaza. Se borra la petición; las tareas siguen con sus dueños.
  async rejectSwapRequest(id: string, currentUserId: string) {
    const request = await this.buscarPeticion(id);

    if (request.to_user_id !== currentUserId) {
      throw new ForbiddenException(
        'Solo el compañero que recibe la petición puede rechazarla',
      );
    }

    await this.prisma.taskSwapRequest.delete({ where: { id } });
    return { status: 'rejected' as const };
  }

  // PA-1010.05: el emisor cancela su propia petición mientras siga pendiente.
  async cancelSwapRequest(id: string, currentUserId: string) {
    const request = await this.buscarPeticion(id);

    if (request.from_user_id !== currentUserId) {
      throw new ForbiddenException(
        'Solo quien creó la petición puede cancelarla',
      );
    }

    await this.prisma.taskSwapRequest.delete({ where: { id } });
    return { status: 'cancelled' as const };
  }

  // --- helpers ---

  private async assertCrossAvailability(
    from: AssignmentForSwap,
    to: AssignmentForSwap,
  ) {
    // El emisor (dueño de `from`) pasaría a hacer `to`: debe tener su hueco libre, ignorando
    // su propia tarea `from`, que cede en el intercambio (si no, chocaría consigo misma).
    await this.tasksService.assertUserFreeAt(
      from.user_id,
      to.due_date,
      this.startMinute(to),
      to.task.duration_minutes ?? 30,
      from.id,
    );
    // El receptor (dueño de `to`) pasaría a hacer `from`: debe tener su hueco libre, ignorando
    // su propia tarea `to`, que cede en el intercambio.
    await this.tasksService.assertUserFreeAt(
      to.user_id,
      from.due_date,
      this.startMinute(from),
      from.task.duration_minutes ?? 30,
      to.id,
    );
  }

  private async ensureNotAlreadyPending(assignmentIds: string[]) {
    const pending = await this.prisma.taskSwapRequest.findFirst({
      where: {
        OR: [
          { from_assignment_id: { in: assignmentIds } },
          { to_assignment_id: { in: assignmentIds } },
        ],
      },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException(
        'Ya hay un intercambio pendiente para una de las tareas',
      );
    }
  }

  private async pendingAssignmentIds(apartmentId: string): Promise<string[]> {
    const pending = await this.prisma.taskSwapRequest.findMany({
      where: { apartment_id: apartmentId },
      select: { from_assignment_id: true, to_assignment_id: true },
    });
    return pending.flatMap((p) => [p.from_assignment_id, p.to_assignment_id]);
  }

  private async buscarAsignacion(id: string): Promise<AssignmentForSwap> {
    let assignment: AssignmentForSwap | null;
    try {
      assignment = await this.prisma.taskAssignment.findUnique({
        where: { id },
        select: ASSIGNMENT_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2023'
      ) {
        throw new BadRequestException('El id de la asignación no es válido');
      }
      throw error;
    }
    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }
    return assignment;
  }

  private async buscarPeticion(id: string) {
    let request:
      | Prisma.TaskSwapRequestGetPayload<{
          include: {
            from_assignment: { select: typeof ASSIGNMENT_SELECT };
            to_assignment: { select: typeof ASSIGNMENT_SELECT };
          };
        }>
      | null;
    try {
      request = await this.prisma.taskSwapRequest.findUnique({
        where: { id },
        include: {
          from_assignment: { select: ASSIGNMENT_SELECT },
          to_assignment: { select: ASSIGNMENT_SELECT },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2023'
      ) {
        throw new BadRequestException('El id de la petición no es válido');
      }
      throw error;
    }
    if (!request) {
      throw new NotFoundException('Petición de intercambio no encontrada');
    }
    return request;
  }

  // Minuto de inicio de una asignación: su hora si está definida, si no el minuto heredado.
  private startMinute(assignment: AssignmentForSwap): number {
    if (assignment.due_time) {
      const [hours, minutes] = assignment.due_time.split(':').map(Number);
      return hours * 60 + minutes;
    }
    return assignment.start_minute;
  }
}
