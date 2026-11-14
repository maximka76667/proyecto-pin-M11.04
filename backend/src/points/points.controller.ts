import { BadRequestException, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { PointsService } from './points.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('points')
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  // La persona asignada marca su tarea como hecha y gana los puntos
  @Patch('assignments/:id/complete')
  completeAssignment(
    @Param('id') assignmentId: string,
    @CurrentUser() userId: string,
  ) {
    if (!UUID_PATTERN.test(assignmentId)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }
    return this.pointsService.completeAssignment(assignmentId, userId);
  }

  // Ranking de la casa en un mes (AAAA-MM, por defecto el actual)
  @Get('ranking')
  ranking(
    @Query('apartment_id') apartmentId: string,
    @Query('month') month: string | undefined,
    @CurrentUser() userId: string,
  ) {
    if (!apartmentId || !UUID_PATTERN.test(apartmentId)) {
      throw new BadRequestException('apartment_id debe ser un UUID válido');
    }
    return this.pointsService.getRanking(apartmentId, userId, month);
  }
}
