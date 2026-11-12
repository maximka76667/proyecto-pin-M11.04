import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updateAvatar: jest.fn(),
    removeAvatar: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });
  it('getProfile llama a usersService.getProfile', async () => {
    const mock = { id: 'u1', full_name: 'Alex' };
    usersService.getProfile.mockResolvedValue(mock);

    const res = await controller.getProfile('u1');
    expect(usersService.getProfile).toHaveBeenCalledWith('u1');
    expect(res).toBe(mock);
  });

  it('updateProfile llama a usersService.updateProfile con el dto', async () => {
    const mock = { id: 'u1', full_name: 'Alex New' };
    usersService.updateProfile.mockResolvedValue(mock);

    const res = await controller.updateProfile('u1', { full_name: 'Alex New' });
    expect(usersService.updateProfile).toHaveBeenCalledWith('u1', {
      full_name: 'Alex New',
    });
    expect(res).toBe(mock);
  });

  it('uploadAvatar llama a usersService.updateAvatar con el archivo', async () => {
    const mockFile = { originalname: 'avatar.png' } as Express.Multer.File;
    const mock = { id: 'u1', avatar_url: 'data:...' };
    usersService.updateAvatar.mockResolvedValue(mock);

    const res = await controller.uploadAvatar('u1', mockFile);
    expect(usersService.updateAvatar).toHaveBeenCalledWith('u1', mockFile);
    expect(res).toBe(mock);
  });

  it('removeAvatar delega en usersService.removeAvatar', async () => {
    const mock = { id: 'u1', avatar_url: null };
    usersService.removeAvatar.mockResolvedValue(mock);

    const res = await controller.removeAvatar('u1');
    expect(usersService.removeAvatar).toHaveBeenCalledWith('u1');
    expect(res).toBe(mock);
  });
});
