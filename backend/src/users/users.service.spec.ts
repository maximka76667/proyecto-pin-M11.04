import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

// Una PNG de verdad: el servicio comprueba el tipo por el contenido, no por el mimetype
const PNG = readFileSync(join(__dirname, '../../test/avatars/avatar.png'));

describe('UsersService', () => {
  let service: UsersService;

  const prisma = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getUserNames', () => {
    it('devuelve un mapa vacío si no hay ids', async () => {
      const res = await service.getUserNames([]);
      expect(res).toEqual({});
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('devuelve mapa de nombres para ids dados', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', full_name: 'Alex' },
        { id: 'u2', full_name: 'Bob' },
      ]);

      const res = await service.getUserNames(['u1', 'u2']);
      expect(res).toEqual({ u1: 'Alex', u2: 'Bob' });
    });
  });

  describe('getProfile', () => {
    it('devuelve el perfil con id, email, full_name, has_password y apartamentos con invite_code', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'alex@example.com',
        full_name: 'Alex Morgan',
        password_hash: 'hash123',
        user_apartments: [
          {
            apartment: {
              id: 'apt-1',
              name: 'Maple House',
              invite_code: 'H7K4Q',
              _count: { user_apartments: 4 },
            },
          },
        ],
      });

      const res = await service.getProfile('u1');
      expect(res).toEqual({
        id: 'u1',
        email: 'alex@example.com',
        full_name: 'Alex Morgan',
        avatar_url: null,
        has_password: true,
        apartments: [
          {
            id: 'apt-1',
            name: 'Maple House',
            invite_code: 'H7K4Q',
            members_count: 4,
          },
        ],
      });
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('non-existent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('updateProfile', () => {
    it('actualiza el nombre recortando espacios y devuelve getProfile', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'alex@example.com',
        full_name: 'Alex Updated',
        password_hash: null,
        user_apartments: [],
      });

      const res = await service.updateProfile('u1', {
        full_name: '  Alex Updated  ',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { full_name: 'Alex Updated' },
        }),
      );
      expect(res.full_name).toBe('Alex Updated');
    });

    it('lanza BadRequestException si el nombre enviado está vacío', async () => {
      await expect(
        service.updateProfile('u1', { full_name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el nombre supera los 50 caracteres', async () => {
      const nombreLargo = 'a'.repeat(51);
      await expect(
        service.updateProfile('u1', { full_name: nombreLargo }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateAvatar', () => {
    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.updateAvatar('u1', undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si el archivo no es una imagen', async () => {
      const mockPdf = {
        mimetype: 'application/pdf',
        size: 1024,
        buffer: Buffer.from('pdf data'),
      } as Express.Multer.File;

      await expect(service.updateAvatar('u1', mockPdf)).rejects.toThrow(
        'La imagen debe ser JPG, PNG o WebP',
      );
    });

    it('lanza BadRequestException si la imagen supera los 5 MB', async () => {
      const mockBigImage = {
        mimetype: 'image/jpeg',
        size: 5 * 1024 * 1024 + 1,
        buffer: Buffer.alloc(10),
      } as Express.Multer.File;

      await expect(service.updateAvatar('u1', mockBigImage)).rejects.toThrow(
        'La imagen no puede superar los 5 MB',
      );
    });

    it('guarda el avatar y devuelve el perfil si la imagen es válida', async () => {
      process.env.SUPABASE_URL = 'https://omkzblbxlobvyiwuvvkp.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ Key: 'avatars/foto.png' }), { status: 200 }),
          ),
        );

      const mockImage = {
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 2 * 1024 * 1024,
        buffer: PNG,
      } as Express.Multer.File;

      const expectedUrl =
        'https://omkzblbxlobvyiwuvvkp.supabase.co/storage/v1/object/public/avatars/u1/avatar-test.png';

      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'alex@example.com',
        full_name: 'Alex Morgan',
        avatar_url: expectedUrl,
        password_hash: null,
        user_apartments: [],
      });

      const res = await service.updateAvatar('u1', mockImage);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          avatar_url: expect.stringContaining('/storage/v1/object/public/avatars/u1/avatar-'),
        },
      });
      expect(res.avatar_url).toContain('supabase.co/storage/v1/object/public/avatars');
    });
  });

  describe('removeAvatar', () => {
    it('elimina el avatar y devuelve el perfil con avatar_url null', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'alex@example.com',
        full_name: 'Alex Morgan',
        avatar_url: null,
        password_hash: null,
        user_apartments: [],
      });

      const res = await service.removeAvatar('u1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatar_url: null },
      });
      expect(res.avatar_url).toBeNull();
    });
  });
});

