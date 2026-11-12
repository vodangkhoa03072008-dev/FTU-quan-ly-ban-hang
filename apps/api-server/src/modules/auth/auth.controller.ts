import { Body, Controller, ForbiddenException, NotFoundException, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { demoEnabled } from '../../common/env';

class DemoLoginDto {
  @IsString()
  @MaxLength(64)
  userId: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Chỉ dùng demo/sandbox: đổi userId của dữ liệu seed lấy JWT. Tự tắt ở production. */
  @Post('demo-login')
  async demoLogin(@Body() body: DemoLoginDto) {
    if (!demoEnabled()) throw new ForbiddenException('Đăng nhập demo đã bị vô hiệu hóa.');

    const user = await this.prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');

    return { token: this.auth.issueToken({ id: user.id, email: user.email }) };
  }
}
