import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
<<<<<<< HEAD
      providers: [UsersService, { provide: PrismaService, useValue: {} }],
=======
      providers: [
        UsersService,
        { provide: PrismaService, useValue: {} },
      ],
>>>>>>> 7c8f3c6 (UET: Comprobado test generados, cambios pendientes)
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
