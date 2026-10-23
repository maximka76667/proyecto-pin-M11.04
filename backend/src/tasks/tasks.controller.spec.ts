import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

describe('TasksController', () => {
  let controller: TasksController;

  const tasksService = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: tasksService }],
    }).compile();

    controller = module.get<TasksController>(TasksController);
  });

  it('accepts existing task identifiers with UUID shape', async () => {
    const task = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' };
    tasksService.findOne.mockResolvedValue(task);

    await expect(controller.findOne(task.id)).resolves.toBe(task);
    expect(tasksService.findOne).toHaveBeenCalledWith(task.id);
  });

  it('rejects malformed task identifiers', async () => {
    expect(() => controller.findOne('not-an-id')).toThrow(
      'Validation failed (uuid is expected)',
    );
    expect(tasksService.findOne).not.toHaveBeenCalled();
  });
});
