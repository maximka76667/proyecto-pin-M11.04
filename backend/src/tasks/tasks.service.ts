import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
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

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) { }

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
    const users = typeof this.prisma.user?.findMany === 'function'
      ? await this.prisma.user.findMany({
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

    const dayOfWeek = this.dayOfWeek(dueDate);
    for (const user of users) {
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
