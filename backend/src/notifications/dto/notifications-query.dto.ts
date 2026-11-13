import { IsIn, IsOptional, Matches } from 'class-validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /notifications y GET /notifications/unread-count
export class NotificationsQueryDto {
  // Piso activo: los avisos son siempre de un usuario dentro de un piso
  @Matches(UUID_REGEX, { message: 'apartment_id must be a UUID' })
  apartment_id: string;

  // "false" cuando el usuario tiene apagados los «Recordatorios de tareas» de su perfil:
  // los avisos de vencimiento ni se crean ni se devuelven
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'reminders must be true or false' })
  reminders?: string;
}
