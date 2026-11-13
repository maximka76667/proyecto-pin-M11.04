import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { NotificationsService } from './notifications.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Notificaciones de tareas (UT1019). El usuario sale siempre del token (@CurrentUser), nunca
// de lo que envíe la app
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Query() query: NotificationsQueryDto,
    @CurrentUser() userId: string,
  ) {
    return this.notificationsService.list(
      query.apartment_id,
      userId,
      query.reminders !== 'false',
    );
  }

  @Get('unread-count')
  unreadCount(
    @Query() query: NotificationsQueryDto,
    @CurrentUser() userId: string,
  ) {
    return this.notificationsService.unreadCount(
      query.apartment_id,
      userId,
      query.reminders !== 'false',
    );
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser() userId: string) {
    if (!UUID_PATTERN.test(id)) {
      throw new BadRequestException('El id de la notificación no es válido');
    }
    return this.notificationsService.markAsRead(id, userId);
  }
}
