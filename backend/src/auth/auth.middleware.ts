import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from './auth.service';

declare module 'express-serve-static-core' {
  interface Request { userId?: string; }
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(request: Request, _response: Response, next: NextFunction) {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token) request.userId = (await this.auth.userIdForToken(token)) ?? undefined;
    next();
  }
}
