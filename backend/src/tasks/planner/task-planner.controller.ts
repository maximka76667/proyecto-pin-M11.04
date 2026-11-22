import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { ApplyPlanDto, ValidatePlanDto } from './dto/plan-apartment.dto';
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
    // ?ignore_calendar=true: reparte sin mirar la disponibilidad ni Google Calendar
    @Query('ignore_calendar') ignoreCalendar?: string,
  ) {
    if (!apartmentId || !UUID_PATTERN.test(apartmentId)) {
      throw new BadRequestException('apartment_id debe ser un UUID válido');
    }
    return this.plannerService.preview(
      apartmentId,
      userId,
      undefined,
      ignoreCalendar === 'true',
    );
  }

  // Comprueba una propuesta editada: qué asignaciones tienen solapes u otros problemas
  @Post('validate')
  validate(@Body() dto: ValidatePlanDto, @CurrentUser() userId: string) {
    return this.plannerService.validate(
      dto.apartment_id,
      userId,
      dto.assignments,
      undefined,
      dto.ignore_calendar === true,
    );
  }

  // Crea las asignaciones (las editadas, o el reparto automático si no se envían).
  // El servidor las vuelve a validar antes de guardar nada
  @Post('apply')
  apply(@Body() dto: ApplyPlanDto, @CurrentUser() userId: string) {
    return this.plannerService.apply(
      dto.apartment_id,
      userId,
      dto.assignments,
      undefined,
      dto.ignore_calendar === true,
    );
  }
}
