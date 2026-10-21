import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async update(id: string, updateTaskDto: UpdateTaskDto, userId: string) {
    const task = await this.buscarTarea(id);
    await this.asegurarMiembro(task.apartment_id, userId);

    // Con @IsOptional un null pasa la validación igual que un campo no enviado:
    // se trata como "sin cambios" para no intentar guardar null en columnas obligatorias
    const { title, frequency, category } = updateTaskDto;
    const data: Prisma.TaskUpdateInput = {};
    if (frequency != null) data.frequency = frequency;
    if (category != null) data.category = category;
    if (title != null) {
      data.title = this.limpiarTitulo(title);
    }

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

  private async buscarTarea(id: string) {
    try {
      const task = await this.prisma.task.findUnique({
        where: { id },
        select: { apartment_id: true },
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
      // el índice único de la base de datos rechaza un nombre que ya usa otra tarea del piso
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una tarea con este nombre en tu hogar',
        );
      }
      // la tarea se ha borrado entre la comprobación y la escritura
      if (error.code === 'P2025') {
        throw new NotFoundException('Tarea no encontrada');
      }
    }
    throw error;
  }
}
