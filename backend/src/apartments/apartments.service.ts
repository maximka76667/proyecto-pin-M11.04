import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';
import { JoinApartmentDto } from './dto/join-apartment.dto';

@Injectable()
export class ApartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createApartmentDto: CreateApartmentDto) {
    const { name, address, landlord_id } = createApartmentDto;

    if (landlord_id) {
      await this.assertIsLandlord(landlord_id);
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const apartment = await transaction.apartment.create({
          data: {
            name,
            address,
            landlord_id,
          },
        });

        if (landlord_id) {
          await transaction.userApartment.create({
            data: { user_id: landlord_id, apartment_id: apartment.id },
          });
        }

        return apartment;
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async generateInvitation(id: string) {
    try {
      return await this.prisma.apartment.update({
        where: { id },
        data: { invite_code: randomUUID() } as unknown as Prisma.ApartmentUpdateInput,
        select: { id: true, invite_code: true },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async join({ invite_code, full_name }: JoinApartmentDto) {
    if (typeof full_name !== 'string' || !full_name.trim()) {
      throw new BadRequestException('Your name is required');
    }

    if (typeof invite_code !== 'string') {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const normalizedCode = invite_code.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        normalizedCode,
      )
    ) {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const apartment = await this.prisma.apartment.findUnique({
      where: { invite_code: normalizedCode },
      select: { id: true, name: true, address: true },
    });

    if (!apartment) {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const guest = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          full_name: full_name.trim(),
          email: null,
          is_landlord: false,
        },
        select: { id: true, full_name: true },
      });
      await transaction.userApartment.create({
        data: { user_id: user.id, apartment_id: apartment.id },
      });
      return user;
    });

    return { apartment, user: guest };
  }

  async findMembers(id: string) {
          const apartment = await this.prisma.apartment.findUnique({
            where: { id },
              select: {
                landlord: { select: { id: true, full_name: true } },
                user_apartments: {
                    select: { user: { select: { id: true, full_name: true } } },
                },
              },
          });

      if (!apartment) {
          throw new NotFoundException('Apartment not found');
        }

      const members = new Map<string, { id: string; full_name: string }>();
    if (apartment.landlord) {
        members.set(apartment.landlord.id, apartment.landlord);
      }
    for (const { user } of apartment.user_apartments) {
        members.set(user.id, user);
      }

      return [...members.values()].sort((a, b) =>
          a.full_name.localeCompare(b.full_name),
        );
  }

  findAll() {
    return this.prisma.apartment.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findMembers(id: string, currentUserId?: string) {
    const apartment = await this.prisma.apartment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!apartment) {
      throw new NotFoundException('Apartment not found');
    }

    const members = await this.prisma.user.findMany({
      where: {
        OR: [
          { user_apartments: { some: { apartment_id: id } } },
          { landlord_apartments: { some: { id } } },
        ],
      },
      select: { id: true, full_name: true },
      orderBy: { full_name: 'asc' },
    });

    return members.map((member) => ({
      ...member,
      isCurrentUser: member.id === currentUserId,
    }));
  }

  async update(id: string, updateApartmentDto: UpdateApartmentDto) {
    if (updateApartmentDto.landlord_id) {
      await this.assertIsLandlord(updateApartmentDto.landlord_id);
    }

    try {
      return await this.prisma.apartment.update({
        where: { id },
        data: updateApartmentDto,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.apartment.delete({
        where: { id },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private async assertIsLandlord(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Landlord not found');
    }

    if (!user.is_landlord) {
      throw new BadRequestException('User is not a landlord');
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'This landlord already has an apartment with that name',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Apartment not found');
      }
      if (error.code === 'P2003') {
        throw new ConflictException(
          'Apartment has transactions or tasks and cannot be deleted',
        );
      }
    }
    throw error;
  }
}
