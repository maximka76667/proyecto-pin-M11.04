import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { PushTokenDto } from './dto/push-token.dto';
import { PushService } from './push.service';

// Tokens de los móviles para las notificaciones push. La app registra el suyo al iniciar sesión
// y lo quita al cerrarla. El usuario sale siempre del token de sesión (@CurrentUser)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('tokens')
  @HttpCode(204)
  async registrar(@Body() dto: PushTokenDto, @CurrentUser() userId: string) {
    await this.push.registrar(userId, dto.token);
  }

  @Delete('tokens')
  @HttpCode(204)
  async quitar(@Body() dto: PushTokenDto, @CurrentUser() userId: string) {
    await this.push.quitar(userId, dto.token);
  }
}
