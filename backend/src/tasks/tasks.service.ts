import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) { }

  findAll(apartmentId?: string) {
    return this.prisma.task.findMany({
      where: apartmentId ? { apartment_id: apartmentId } : undefined,
      include: {
        assignments: {
          include: { user: { select: { id: true, full_name: true } } },
          orderBy: { due_date: 'asc' },
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
          orderBy: { due_date: 'asc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }

    return task;
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una tarea con este nombre en tu hogar',
        );
      }
      if (error.code === 'P2003') {
        throw new NotFoundException('Hogar no encontrado');
      }
    }
    throw error;
  }
}
