import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  // Debe ir antes de @Get(':id'): si no, ':id' capturaría "me"
  @Get('me')
  getProfile(@CurrentUser() userId: string) {
    return this.usersService.getProfile(userId);
  }

  // Debe ir antes de @Patch(':id'): si no, ':id' capturaría "me"
  @Patch('me')
  updateProfile(
    @CurrentUser() userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(userId, updateUserDto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('image'))
  uploadAvatar(
    @CurrentUser() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.usersService.updateAvatar(userId, file);
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentUser() userId: string) {
    return this.usersService.removeAvatar(userId);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
