import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { PlanApartmentDto } from './dto/plan-apartment.dto';
import { TaskPlannerService } from './task-planner.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('tasks/plan')
export class TaskPlannerController {
  constructor(private readonly plannerService: TaskPlannerService) {}

  // Propuesta de reparto de la semana siguiente. No guarda nada
  @Get('preview')
  preview(
    @Query('apartment_id') apartmentId: string,
    @CurrentUser() userId: string,
  ) {
    if (!apartmentId || !UUID_PATTERN.test(apartmentId)) {
      throw new BadRequestException('apartment_id debe ser un UUID válido');
    }
    return this.plannerService.preview(apartmentId, userId);
  }

  // Calcula el reparto con los datos de ahora y crea las asignaciones
  @Post('apply')
  apply(@Body() dto: PlanApartmentDto, @CurrentUser() userId: string) {
    return this.plannerService.apply(dto.apartment_id, userId);
  }
}
