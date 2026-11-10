import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Prisma,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  AssignmentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskAssignmentDto } from './dto/create-task-assignment.dto';
import { TaskAvailabilityQueryDto } from './dto/task-availability-query.dto';
import { toHHmm } from '../availability/availability.service';
import { GoogleCalendarService } from '../availability/google-calendar.service';

// Integrante con la franja ocupada; solo la hora, nunca el título del evento
type BusyMember = { id: string; full_name: string; busy: { start: string; end: string } };

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Opcional: sin él (p. ej. en los tests que solo dan Prisma) se usan los eventos ya guardados
    @Optional() private readonly googleCalendar?: GoogleCalendarService,
  ) { }

  findAll(apartmentId?: string) {
    return this.prisma.task.findMany({
      where: apartmentId ? { apartment_id: apartmentId } : undefined,
      include: {
        assignments: {
          include: { user: { select: { id: true, full_name: true } } },
          orderBy: [{ due_date: 'asc' }, { due_time: 'asc' }],
        },
      },
      orderBy: { title: 'asc' },
    });
  }

  async create(createTaskDto: CreateTaskDto) {
    const title = createTaskDto.title.trim();
    if (!title) {
      throw new BadRequestException('El nombre de la tarea es obligatorio');
    }

    const existingTask = await this.prisma.task.findFirst({
      where: {
        apartment_id: createTaskDto.apartment_id,
        title,
      },
      select: { id: true },
    });
    if (existingTask) {
      throw new ConflictException(
        'Ya existe una tarea con este nombre en tu hogar',
      );
    }

    try {
      return await this.prisma.task.create({
        data: {
          apartment_id: createTaskDto.apartment_id,
          title,
          description: createTaskDto.description?.trim() || null,
          duration_minutes: createTaskDto.duration_minutes ?? 30,
          frequency: createTaskDto.frequency,
          status: TaskStatus.pending,
          category: createTaskDto.category ?? TaskCategory.other,
          priority: TaskPriority.medium,
        },
        include: { assignments: true },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        assignments: {
          include: { user: { select: { id: true, full_name: true } } },
          orderBy: [{ due_date: 'asc' }, { due_time: 'asc' }],
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }

    return task;
  }

  async createAssignment(
    taskId: string,
    assignmentDto: CreateTaskAssignmentDto,
    currentUserId: string,
  ) {
    const requestedUserIds =
      assignmentDto.user_ids ??
      (assignmentDto.user_id ? [assignmentDto.user_id] : []);
    const userIds = [...new Set(requestedUserIds)];
    if (userIds.length === 0) {
      throw new BadRequestException(
        'Debes asignar la tarea al menos a una persona',
      );
    }

    const task = await this.buscarTarea(taskId);
    await this.asegurarMiembro(task.apartment_id, currentUserId);
    for (const userId of userIds) {
      await this.asegurarMiembro(task.apartment_id, userId);
    }

    const dueDate = new Date(
      `${assignmentDto.due_date.slice(0, 10)}T00:00:00.000Z`,
    );
    const startMinute = this.toMinutes(assignmentDto.due_time);
    const endMinute = startMinute + (task.duration_minutes ?? 30);
    if (endMinute > 24 * 60) {
      throw new BadRequestException(
        'La tarea no puede terminar después de medianoche',
      );
    }

    const exactConflict = await this.prisma.taskAssignment.findFirst({
      where: {
        user_id: { in: userIds },
        due_date: dueDate,
        due_time: assignmentDto.due_time,
      },
      include: { user: { select: { full_name: true } } },
    });
    if (exactConflict) {
      throw new ConflictException(
        `${exactConflict.user.full_name} ya tiene una tarea asignada en ese horario`,
      );
    }

    const existingAssignments = typeof this.prisma.taskAssignment.findMany === 'function'
      ? await this.prisma.taskAssignment.findMany({
        where: { user_id: { in: userIds }, due_date: dueDate },
        include: {
          user: { select: { full_name: true } },
          task: { select: { title: true, duration_minutes: true } },
        },
      })
      : [];
    const conflictingAssignment = existingAssignments.find((assignment) => {
      const otherStart = this.assignmentStartMinute(
        assignment.due_time,
        assignment.start_minute,
      );
      return this.overlaps(
        startMinute,
        endMinute,
        otherStart,
        otherStart + (assignment.task.duration_minutes ?? 30),
      );
    });
    if (conflictingAssignment) {
      throw new ConflictException(
        `${conflictingAssignment.user.full_name} ya tiene otra tarea asignada que se solapa con ese horario`,
      );
    }

    // Nadie con esa franja ocupada en su calendario (PA-1524.02 y .03)
    const busyMembers = await this.findBusyMembers(userIds, dueDate, startMinute, endMinute);
    if (busyMembers.length > 0) {
      throw new ConflictException(this.busyMessage(busyMembers));
    }

    try {
      const operations = userIds.map((userId) =>
        this.prisma.taskAssignment.create({
          data: {
            task_id: taskId,
            user_id: userId,
            due_date: dueDate,
            due_time: assignmentDto.due_time,
            status: AssignmentStatus.pending,
          },
          include: { user: { select: { id: true, full_name: true } } },
        }),
      );
      const results = await this.prisma.$transaction([
        ...operations,
        this.prisma.task.update({
          where: { id: taskId },
          data: {
            status:
              task.status === TaskStatus.pending
                ? TaskStatus.assigned
                : task.status,
          },
        }),
      ]);
      const assignments = results.slice(0, userIds.length);
      return assignmentDto.user_ids ? assignments : assignments[0];
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Una persona seleccionada ya tiene una tarea asignada en ese horario',
        );
      }
      this.handlePrismaError(error);
    }
  }

  // Para el diálogo "Asignar tarea": quién del hogar puede hacerla en esa franja.
  // La app desactiva a los ocupados; createAssignment vuelve a comprobarlo al confirmar
  async membersAvailability(
    taskId: string,
    query: TaskAvailabilityQueryDto,
    currentUserId: string,
  ) {
    const task = await this.buscarTarea(taskId);
    await this.asegurarMiembro(task.apartment_id, currentUserId);

    const dueDate = new Date(`${query.due_date}T00:00:00.000Z`);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('La fecha no es válida');
    }
    const startMinute = this.toMinutes(query.due_time);
    const endMinute = startMinute + (task.duration_minutes ?? 30);
    if (endMinute > 24 * 60) {
      throw new BadRequestException(
        'La tarea no puede terminar después de medianoche',
      );
    }

    const members = await this.prisma.user.findMany({
      where: { user_apartments: { some: { apartment_id: task.apartment_id } } },
      select: { id: true, full_name: true },
      orderBy: { full_name: 'asc' },
    });
    const busy = await this.findBusyMembers(
      members.map((member) => member.id),
      dueDate,
      startMinute,
      endMinute,
    );
    const busyById = new Map(busy.map((member) => [member.id, member.busy]));

    return {
      start: toHHmm(startMinute),
      end: toHHmm(endMinute),
      members: members.map((member) => ({
        id: member.id,
        full_name: member.full_name,
        isCurrentUser: member.id === currentUserId,
        available: !busyById.has(member.id),
        busy: busyById.get(member.id) ?? null,
      })),
    };
  }

  async update(id: string, updateTaskDto: UpdateTaskDto, userId: string) {
    // Los datos se validan antes de consultar la base de datos
    const data = this.datosEditados(updateTaskDto);

    const task = await this.buscarTarea(id);
    await this.asegurarMiembro(task.apartment_id, userId);

    try {
      return await this.prisma.task.update({
        where: { id },
        data,
        include: {
          assignments: {
            include: { user: { select: { id: true, full_name: true } } },
            orderBy: { due_date: 'asc' },
          },
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async removeAssignment(id: string, userId: string) {
    let assignment: { task: { apartment_id: string } } | null;
    try {
      assignment = await this.prisma.taskAssignment.findUnique({
        where: { id },
        select: { task: { select: { apartment_id: true } } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2023'
      ) {
        throw new BadRequestException('El id de la asignación no es válido');
      }
      this.handlePrismaError(error);
    }

    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }

    await this.asegurarMiembro(assignment.task.apartment_id, userId);

    try {
      return await this.prisma.taskAssignment.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Asignación no encontrada');
      }
      this.handlePrismaError(error);
    }
  }

  // La FK de TaskAssignment es ON DELETE RESTRICT: las asignaciones se borran antes
  // y en la misma transacción, para que no pueda quedar la tarea a medio borrar
  async remove(id: string, userId: string) {
    const task = await this.buscarTarea(id);
    await this.asegurarMiembro(task.apartment_id, userId);

    try {
      const [, tareaBorrada] = await this.prisma.$transaction([
        this.prisma.taskAssignment.deleteMany({ where: { task_id: id } }),
        this.prisma.task.delete({ where: { id } }),
      ]);
      return tareaBorrada;
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  // Comprueba que `userId` tiene el hueco libre en `dueDate` desde `startMinute` durante
  // `durationMinutes`, contra sus otras asignaciones, su disponibilidad semanal y sus eventos
  // de Google Calendar. Reutiliza las mismas reglas que al asignar una tarea. `excludeAssignmentId`
  // ignora una asignación propia (la que el usuario libera en un intercambio).
  async assertUserFreeAt(
    userId: string,
    dueDate: Date,
    startMinute: number,
    durationMinutes: number,
    excludeAssignmentId?: string,
  ): Promise<void> {
    const endMinute = startMinute + durationMinutes;

    const existingAssignments = await this.prisma.taskAssignment.findMany({
      where: {
        user_id: userId,
        due_date: dueDate,
        ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
      },
      include: {
        user: { select: { full_name: true } },
        task: { select: { duration_minutes: true } },
      },
    });
    const assignmentConflict = existingAssignments.find((assignment) => {
      const otherStart = this.assignmentStartMinute(
        assignment.due_time,
        assignment.start_minute,
      );
      return this.overlaps(
        startMinute,
        endMinute,
        otherStart,
        otherStart + (assignment.task.duration_minutes ?? 30),
      );
    });
    if (assignmentConflict) {
      throw new ConflictException(
        `${assignmentConflict.user.full_name} ya tiene otra tarea asignada que se solapa con ese horario`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        full_name: true,
        availability_blocks: {
          select: { day_of_week: true, start_minute: true, end_minute: true },
        },
        google_busy_blocks: {
          where: { event_date: dueDate },
          select: { start_at: true, end_at: true },
        },
      },
    });
    if (!user) return;

    const dayOfWeek = this.dayOfWeek(dueDate);
    const weeklyConflict = user.availability_blocks.find(
      (block) =>
        block.day_of_week === dayOfWeek &&
        this.overlaps(startMinute, endMinute, block.start_minute, block.end_minute),
    );
    if (weeklyConflict) {
      throw new ConflictException(
        `${user.full_name} está ocupado en su disponibilidad habitual a esa hora`,
      );
    }

    const googleConflict = user.google_busy_blocks.find((block) =>
      this.overlaps(
        startMinute,
        endMinute,
        this.localDateTimeMinutes(block.start_at, dueDate),
        this.localDateTimeMinutes(block.end_at, dueDate),
      ),
    );
    if (googleConflict) {
      throw new ConflictException(
        `${user.full_name} tiene un evento de Google Calendar que se solapa con ese horario`,
      );
    }
  }

  // Lanza ForbiddenException si el usuario no pertenece al piso (versión pública de asegurarMiembro).
  async assertMember(apartmentId: string, userId: string) {
    return this.asegurarMiembro(apartmentId, userId);
  }

  private async buscarTarea(id: string) {
    try {
      const task = await this.prisma.task.findUnique({
        where: { id },
        select: { apartment_id: true, status: true, duration_minutes: true },
      });
      if (task) return task;
    } catch (error) {
      this.handlePrismaError(error);
    }

    throw new NotFoundException('Tarea no encontrada');
  }

  private async asegurarMiembro(apartmentId: string, userId: string) {
    const miembro = await this.prisma.userApartment.findUnique({
      where: {
        user_id_apartment_id: { user_id: userId, apartment_id: apartmentId },
      },
      select: { user_id: true },
    });

    if (!miembro) {
      throw new ForbiddenException('No perteneces a este piso');
    }
  }

  // Un campo que no se envía no se toca. @IsOptional deja pasar null, pero el nombre,
  // la frecuencia y la categoría son obligatorios: null no puede vaciarlos
  private datosEditados(updateTaskDto: UpdateTaskDto) {
    const { title, description, frequency, category, duration_minutes } = updateTaskDto;
    if (title === null) {
      throw new BadRequestException('El nombre de la tarea es obligatorio');
    }
    if (frequency === null) {
      throw new BadRequestException('La frecuencia es obligatoria');
    }
    if (category === null) {
      throw new BadRequestException('La categoría es obligatoria');
    }

    const data: Prisma.TaskUpdateInput = {};
    if (title !== undefined) data.title = this.limpiarTitulo(title);
    // una descripción vacía o null borra la que hubiera, igual que al crear la tarea
    if (description !== undefined) {
      data.description = description?.trim() || null;
    }
    if (frequency !== undefined) data.frequency = frequency;
    if (category !== undefined) data.category = category;
    if (duration_minutes !== undefined) data.duration_minutes = duration_minutes;
    return data;
  }

  // Integrantes con la franja ocupada en su calendario: bloques semanales de "Tu disponibilidad"
  // y eventos de Google de ese día. Devuelve la primera franja ocupada de cada uno
  private async findBusyMembers(
    userIds: string[],
    dueDate: Date,
    startMinute: number,
    endMinute: number,
  ): Promise<BusyMember[]> {
    if (userIds.length === 0 || typeof this.prisma.user?.findMany !== 'function') {
      return [];
    }
    await this.syncGoogleCalendars(userIds, dueDate);

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        full_name: true,
        availability_blocks: {
          select: { day_of_week: true, start_minute: true, end_minute: true },
        },
        google_busy_blocks: {
          where: { event_date: dueDate },
          select: { start_at: true, end_at: true },
        },
      },
    });

    const dayOfWeek = this.dayOfWeek(dueDate);
    const busy: BusyMember[] = [];
    for (const user of users) {
      const slots = [
        ...user.availability_blocks
          .filter((block) => block.day_of_week === dayOfWeek)
          .map((block) => ({ start: block.start_minute, end: block.end_minute })),
        ...user.google_busy_blocks.map((block) => ({
          start: this.localDateTimeMinutes(block.start_at, dueDate),
          end: this.localDateTimeMinutes(block.end_at, dueDate),
        })),
      ].sort((a, b) => a.start - b.start);

      const slot = slots.find((s) => this.touches(startMinute, endMinute, s.start, s.end));
      if (slot) {
        busy.push({
          id: user.id,
          full_name: user.full_name,
          busy: { start: toHHmm(slot.start), end: toHHmm(slot.end) },
        });
      }
    }
    // En el mismo orden en que se eligieron
    return busy.sort((a, b) => userIds.indexOf(a.id) - userIds.indexOf(b.id));
  }

  // Los eventos de Google de un integrante solo se guardan cuando él abre la app. Antes de
  // comprobar se trae su calendario de ese día, para no asignarle algo encima de una clase
  // nueva. Si Google falla, se sigue con lo que ya hay guardado
  private async syncGoogleCalendars(userIds: string[], dueDate: Date) {
    const googleCalendar = this.googleCalendar;
    if (!googleCalendar) return;

    const from = dueDate.toISOString().slice(0, 10);
    const nextDay = new Date(dueDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const to = nextDay.toISOString().slice(0, 10);

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          await googleCalendar.sync(userId, from, to);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'error desconocido';
          this.logger.warn(`No se ha podido sincronizar Google Calendar del usuario ${userId}: ${reason}`);
        }
      }),
    );
  }

  private busyMessage(busy: BusyMember[]) {
    if (busy.length === 1) {
      const [member] = busy;
      return `${member.full_name} no está disponible en esa franja: tiene ocupado de ${member.busy.start} a ${member.busy.end}`;
    }
    const names = busy.map((member) => member.full_name);
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]} no están disponibles en esa franja`;
  }

  // Con el calendario, la franja ocupada incluye su inicio y su fin (PA-1524.03):
  // una tarea que empieza justo cuando acaba la clase también choca
  private touches(start: number, end: number, busyStart: number, busyEnd: number) {
    return start <= busyEnd && busyStart <= end;
  }

  private toMinutes(value: string) {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private assignmentStartMinute(dueTime: string | null, startMinute: number) {
    return dueTime ? this.toMinutes(dueTime) : startMinute;
  }

  private overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
    return start < otherEnd && otherStart < end;
  }

  private dayOfWeek(date: Date) {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      date.getUTCDay()
    ];
  }

  private localDateTimeMinutes(value: Date, date: Date) {
    const timeZone = process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid';
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
    const expectedDate = date.toISOString().slice(0, 10);
    if (localDate !== expectedDate) {
      return localDate < expectedDate ? 0 : 24 * 60;
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    return Number(parts.find((part) => part.type === 'hour')?.value) * 60
      + Number(parts.find((part) => part.type === 'minute')?.value);
  }

  // Mismas reglas que al crear una tarea: sin espacios sobrantes y no vacío
  private limpiarTitulo(title: string) {
    const titulo = title.trim();
    if (!titulo) {
      throw new BadRequestException('El nombre de la tarea es obligatorio');
    }
    return titulo;
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // el id no tiene formato de UUID, así que ninguna tarea puede tenerlo
      if (error.code === 'P2023') {
        throw new BadRequestException('El id de la tarea no es válido');
      }
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una tarea con este nombre en tu hogar',
        );
      }
      // la tarea se ha borrado entre la comprobación y la escritura
      if (error.code === 'P2025') {
        throw new NotFoundException('Tarea no encontrada');
      }
      if (error.code === 'P2003') {
        throw new NotFoundException('Hogar no encontrado');
      }
    }
    throw error;
  }
}
