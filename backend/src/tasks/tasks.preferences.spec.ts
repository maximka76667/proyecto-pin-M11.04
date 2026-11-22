import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSwapsService } from './task-swaps.service';
import {
  SetTaskPreferencesDto,
  TaskPreferenceItemDto,
  TaskPreferenceType,
} from './dto/set-task-preferences.dto';

describe('TasksPreferences (UT1020)', () => {
  let controller: TasksController;

  const tasksService = {
    create: jest.fn(),
    createAssignment: jest.fn(),
    removeAssignment: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getUserPreferences: jest.fn(),
    setUserPreferences: jest.fn(),
    removeUserPreference: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: tasksService },
        { provide: TaskSwapsService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TasksController>(TasksController);
  });

  describe('Controlador: Rutas de preferencias', () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const apartmentId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('GET /tasks/preferences consulta las preferencias del usuario', async () => {
      const mockResult = [
        { id: 't1', title: 'Cocinar', preference: 'prefer' },
      ];
      tasksService.getUserPreferences.mockResolvedValue(mockResult);

      const res = await controller.getPreferences(userId, apartmentId);

      expect(tasksService.getUserPreferences).toHaveBeenCalledWith(
        apartmentId,
        userId,
      );
      expect(res).toBe(mockResult);
    });

    it('PUT /tasks/preferences guarda las preferencias del usuario', async () => {
      const dto: SetTaskPreferencesDto = {
        apartment_id: apartmentId,
        preferences: [
          {
            task_id: '22222222-2222-2222-2222-222222222222',
            preference: TaskPreferenceType.prefer,
          },
        ],
      };
      const mockResult = { message: 'Preferencias guardadas correctamente' };
      tasksService.setUserPreferences.mockResolvedValue(mockResult);

      const res = await controller.setPreferences(dto, userId);

      expect(tasksService.setUserPreferences).toHaveBeenCalledWith(dto, userId);
      expect(res).toBe(mockResult);
    });

    it('POST /tasks/preferences permite guardar preferencias como alias', async () => {
      const dto: SetTaskPreferencesDto = {
        apartment_id: apartmentId,
        preferences: [
          {
            task_id: '22222222-2222-2222-2222-222222222222',
            preference: TaskPreferenceType.avoid,
          },
        ],
      };
      const mockResult = { message: 'Preferencias guardadas correctamente' };
      tasksService.setUserPreferences.mockResolvedValue(mockResult);

      const res = await controller.createPreferences(dto, userId);

      expect(tasksService.setUserPreferences).toHaveBeenCalledWith(dto, userId);
      expect(res).toBe(mockResult);
    });

    it('DELETE /tasks/preferences/:taskId elimina una preferencia', async () => {
      const taskId = '33333333-3333-3333-3333-333333333333';
      const mockResult = { id: 'pref-1' };
      tasksService.removeUserPreference.mockResolvedValue(mockResult);

      const res = await controller.removePreference(taskId, userId);

      expect(tasksService.removeUserPreference).toHaveBeenCalledWith(
        taskId,
        userId,
      );
      expect(res).toBe(mockResult);
    });
  });

  describe('Validación de DTOs', () => {
    it('valida correctamente un SetTaskPreferencesDto válido', async () => {
      const plain = {
        apartment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        preferences: [
          {
            task_id: '11111111-1111-1111-1111-111111111111',
            preference: 'prefer',
          },
          {
            task_id: '22222222-2222-2222-2222-222222222222',
            preference: 'avoid',
          },
          {
            task_id: '33333333-3333-3333-3333-333333333333',
            preference: 'indifferent',
          },
        ],
      };

      const dto = plainToInstance(SetTaskPreferencesDto, plain);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rechaza un apartment_id que no es UUID', async () => {
      const plain = {
        apartment_id: 'no-es-uuid',
        preferences: [
          {
            task_id: '11111111-1111-1111-1111-111111111111',
            preference: 'prefer',
          },
        ],
      };

      const dto = plainToInstance(SetTaskPreferencesDto, plain);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'apartment_id')).toBe(true);
    });

    it('rechaza una preferencia con valor no permitido', async () => {
      const plain = {
        task_id: '11111111-1111-1111-1111-111111111111',
        preference: 'me_da_igual',
      };

      const itemDto = plainToInstance(TaskPreferenceItemDto, plain);
      const errors = await validate(itemDto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'preference')).toBe(true);
    });
  });
});
