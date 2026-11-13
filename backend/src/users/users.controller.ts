import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/current-user.decorator';
import { UsersService } from './users.service';
import { ImagenDemasiadoGrandeFilter, PESO_MAXIMO_AVATAR } from './avatar-image';
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
  // Con el límite, multer corta la subida en 5 MB en vez de cargar el archivo entero en
  // memoria; el filtro convierte su 413 en el 400 que pide la PA-1016.06
  @UseFilters(ImagenDemasiadoGrandeFilter)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: PESO_MAXIMO_AVATAR, files: 1 } }),
  )
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
