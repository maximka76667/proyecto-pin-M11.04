import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';

@Injectable()
export class ApartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createApartmentDto: CreateApartmentDto) {
    const { name, address, landlord_id } = createApartmentDto;

    if (landlord_id) {
      await this.assertIsLandlord(landlord_id);
    }

    try {
      return await this.prisma.apartment.create({
        data: {
          name,
          address,
          landlord_id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAll() {
    return this.prisma.apartment.findMany({
      orderBy: { name: 'asc' },
    });
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
