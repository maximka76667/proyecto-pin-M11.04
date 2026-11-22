import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';
import { TaskVerificationsService } from './task-verifications.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string | undefined) {
  if (!value || !UUID_PATTERN.test(value)) {
    throw new BadRequestException('Validation failed (uuid is expected)');
  }
}

// Verificación de tareas. Va en el módulo ANTES que TasksController para que
// GET /tasks/verifications no lo capture GET /tasks/:id
@Controller('tasks')
export class TaskVerificationsController {
  constructor(private readonly verifications: TaskVerificationsService) {}

  // Tareas que el usuario tiene que revisar
  @Get('verifications')
  listForReview(
    @Query('apartment_id') apartmentId: string,
    @CurrentUser() userId: string,
  ) {
    assertUuid(apartmentId);
    return this.verifications.listForReview(apartmentId, userId);
  }

  @Post('assignments/:id/submit')
  submit(@Param('id') id: string, @CurrentUser() userId: string) {
    assertUuid(id);
    return this.verifications.submit(id, userId);
  }

  @Post('assignments/:id/verify')
  verify(@Param('id') id: string, @CurrentUser() userId: string) {
    assertUuid(id);
    return this.verifications.verify(id, userId);
  }

  @Post('assignments/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectAssignmentDto,
    @CurrentUser() userId: string,
  ) {
    assertUuid(id);
    return this.verifications.reject(id, userId, dto.reason);
  }
}
