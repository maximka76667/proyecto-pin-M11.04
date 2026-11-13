import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
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
              joined_at: true,
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
              joined_at: true,
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
      apartments: user.user_apartments.map(({ joined_at, apartment }: any) => ({
        id: apartment.id,
        name: apartment.name,
        invite_code: apartment.invite_code,
        members_count: apartment._count.user_apartments,
        ...(joined_at !== undefined && { joined_at }),
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

  private async uploadToSupabaseStorage(
    userId: string,
    file: Express.Multer.File,
    tipo?: string,
  ): Promise<string> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new InternalServerErrorException(
        'Falta la configuración de Supabase Storage',
      );
    }

    const extension =
      tipo === 'image/png'
        ? 'png'
        : tipo === 'image/webp'
        ? 'webp'
        : file.originalname?.split('.').pop() || 'jpeg';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = `${userId}/avatar-${unique}.${extension}`;

    const uploadUrl = `${supabaseUrl}/storage/v1/object/avatars/${filename}`;
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': tipo || file.mimetype || 'image/jpeg',
          'x-upsert': 'true',
        },
        body: new Uint8Array(file.buffer),
      });
    } catch {
      throw new BadGatewayException('No se ha podido conectar con Storage');
    }

    if (!res.ok) {
      throw new BadGatewayException('Error al subir la imagen a Storage');
    }

    return `${supabaseUrl}/storage/v1/object/public/avatars/${filename}`;
  }

  private async deleteFromSupabaseStorage(
    avatarUrl: string | null | undefined,
  ): Promise<void> {
    if (!avatarUrl) return;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (
      !supabaseUrl ||
      !supabaseKey ||
      !avatarUrl.includes('/storage/v1/object/public/avatars/')
    ) {
      return;
    }

    try {
      const path = avatarUrl.split('/storage/v1/object/public/avatars/')[1];
      if (!path) return;
      await fetch(`${supabaseUrl}/storage/v1/object/avatars/${path}`, {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
    } catch (err) {
      console.error('Failed to delete avatar from Supabase Storage:', err);
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

    const avatarUrl = await this.uploadToSupabaseStorage(userId, file, tipo);

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
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { avatar_url: true },
      });
      if (existingUser?.avatar_url) {
        await this.deleteFromSupabaseStorage(existingUser.avatar_url);
      }

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
