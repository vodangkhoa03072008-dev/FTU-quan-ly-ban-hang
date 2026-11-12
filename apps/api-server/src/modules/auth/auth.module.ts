import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WsJwtGuard } from './ws-jwt.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, WsJwtGuard],
  exports: [AuthService, JwtAuthGuard, WsJwtGuard],
})
export class AuthModule {}
