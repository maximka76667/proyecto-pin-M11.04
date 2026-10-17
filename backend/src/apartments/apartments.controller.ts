import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApartmentsService } from './apartments.service';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';
import { JoinApartmentDto } from './dto/join-apartment.dto';

@Controller('apartments')
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Post()
  create(@Body() createApartmentDto: CreateApartmentDto) {
    return this.apartmentsService.create(createApartmentDto);
  }

  @Post('join')
  join(@Body() joinApartmentDto: JoinApartmentDto) {
    return this.apartmentsService.join(joinApartmentDto);
  }

  @Post(':id/invitation')
  generateInvitation(@Param('id', ParseUUIDPipe) id: string) {
    return this.apartmentsService.generateInvitation(id);
  }

  @Get()
  findAll() {
    return this.apartmentsService.findAll();
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateApartmentDto: UpdateApartmentDto,
  ) {
    return this.apartmentsService.update(id, updateApartmentDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.apartmentsService.remove(id);
  }
}
