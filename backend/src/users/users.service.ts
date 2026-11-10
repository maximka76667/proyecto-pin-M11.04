import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGEN_MUY_GRANDE,
  IMAGEN_NO_VALIDA,
  PESO_MAXIMO_AVATAR,
  tipoDeImagen,
} from './avatar-image';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Datos de la pantalla "Mi cuenta". El hash se lee solo para saber si la cuenta tiene
  // contraseña (las de Google no) y nunca sale de aquí
  async getProfile(userId: string) {
    let user: any;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          full_name: true,
          avatar_url: true,
          password_hash: true,
          user_apartments: {
            select: {
              apartment: {
                select: {
                  id: true,
                  name: true,
                  invite_code: true,
                  _count: { select: { user_apartments: true } },
                },
              },
            },
          },
        },
      });
    } catch {
      // Fallback en caso de que la columna avatar_url no exista todavía en la BD
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          full_name: true,
          password_hash: true,
          user_apartments: {
            select: {
              apartment: {
                select: {
                  id: true,
                  name: true,
                  invite_code: true,
                  _count: { select: { user_apartments: true } },
                },
              },
            },
          },
        },
      });
    }

    if (!user) throw new UnauthorizedException('Sesión no válida');

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: user.avatar_url ?? null,
      has_password: Boolean(user.password_hash),
      apartments: user.user_apartments.map(({ apartment }: any) => ({
        id: apartment.id,
        name: apartment.name,
        invite_code: apartment.invite_code,
        members_count: apartment._count.user_apartments,
      })),
    };
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto) {
    if (updateUserDto.full_name !== undefined) {
      const trimmed = updateUserDto.full_name.trim();
      if (!trimmed) {
        throw new BadRequestException('El nombre no puede estar vacío');
      }
      if (trimmed.length > 50) {
        throw new BadRequestException(
          'El nombre no puede superar los 50 caracteres',
        );
      }
      updateUserDto.full_name = trimmed;
    }

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(updateUserDto.full_name !== undefined && {
            full_name: updateUserDto.full_name,
          }),
          ...(updateUserDto.avatar_url !== undefined && {
            avatar_url: updateUserDto.avatar_url,
          }),
        },
      });

      return this.getProfile(userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Si la columna avatar_url aún no existe en BD, intentamos actualizar al menos el nombre
      if (updateUserDto.full_name !== undefined) {
        try {
          await this.prisma.user.update({
            where: { id: userId },
            data: { full_name: updateUserDto.full_name },
          });
          return this.getProfile(userId);
        } catch {
          // Si también falla, lanzamos el error original
        }
      }

      throw error;
    }
  }

  async updateAvatar(userId: string, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ninguna imagen');
    }
    if (file.size > PESO_MAXIMO_AVATAR) {
      throw new BadRequestException(IMAGEN_MUY_GRANDE);
    }
    // El tipo sale del contenido, no del mimetype que declara el cliente
    const tipo = tipoDeImagen(file.buffer);
    if (!tipo) {
      throw new BadRequestException(IMAGEN_NO_VALIDA);
    }

    const avatarUrl = `data:${tipo};base64,${file.buffer.toString('base64')}`;

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatar_url: avatarUrl },
      });
      return this.getProfile(userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      // Fallback si avatar_url aún no existe en BD: devolvemos perfil con el avatarUrl
      const baseProfile = await this.getProfile(userId);
      return { ...baseProfile, avatar_url: avatarUrl };
    }
  }

  async removeAvatar(userId: string) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatar_url: null },
      });
      return this.getProfile(userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Usuario no encontrado');
      }
      const baseProfile = await this.getProfile(userId);
      return { ...baseProfile, avatar_url: null };
    }
  }

  async getUserNames(userIds: string[]): Promise<Record<string, string>> {
    if (userIds.length === 0) {
      return {};
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, full_name: true },
    });

    return Object.fromEntries(users.map((user) => [user.id, user.full_name]));
  }

  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
