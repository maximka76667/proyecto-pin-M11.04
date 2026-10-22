import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
<<<<<<< HEAD
      providers: [UsersService, { provide: PrismaService, useValue: {} }],
=======
      providers: [
        UsersService,
        { provide: PrismaService, useValue: {} },
      ],
>>>>>>> 7c8f3c6 (UET: Comprobado test generados, cambios pendientes)
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
