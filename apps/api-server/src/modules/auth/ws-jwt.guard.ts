import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from './auth.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient<Socket>();
    const token: string | undefined =
      client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];

    if (!token) throw new WsException('Thiếu token xác thực kết nối WebSocket.');

    try {
      client.data.user = this.auth.verifyToken(token);
      return true;
    } catch {
      throw new WsException('Xác thực WebSocket thất bại.');
    }
  }
}
