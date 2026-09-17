import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return '¡Conexión exitosa con el backend del proyecto PIN!';
  }
}
