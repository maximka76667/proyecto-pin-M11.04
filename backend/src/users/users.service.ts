import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Datos de la pantalla "Mi cuenta". El hash se lee solo para saber si la cuenta tiene
  // contraseña (las de Google no) y nunca sale de aquí
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
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
                _count: { select: { user_apartments: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('Sesión no válida');

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      has_password: Boolean(user.password_hash),
      apartments: user.user_apartments.map(({ apartment }) => ({
        id: apartment.id,
        name: apartment.name,
        members_count: apartment._count.user_apartments,
      })),
    };
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
