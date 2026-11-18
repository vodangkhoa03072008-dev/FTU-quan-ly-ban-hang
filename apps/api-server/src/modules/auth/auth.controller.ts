import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Exclude, Expose, plainToInstance } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthService, AuthUser } from './auth.service';
import { CurrentUser, JwtAuthGuard } from './jwt-auth.guard';
import { demoEnabled } from '../../common/env';
import { enforceRate } from '../../common/rate-limit';

/** Hash giả để so sánh khi email không tồn tại → thời gian phản hồi như nhau (chống dò email). */
const DUMMY_HASH = '$2a$12$uliK.XDQXQJqr1TACYXtk.EvAhRC3kSPFWOAnaxEwEVuWAnVFtJS2';

class DemoLoginDto {
  @IsString()
  @MaxLength(64)
  userId: string;
}

export class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(80) fullName: string;
  @Matches(/^0\d{9,10}$/, { message: 'Số điện thoại không hợp lệ.' }) phone: string;
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsOptional() @IsString() @MaxLength(64) defaultHubId?: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @MaxLength(72) password: string;
}

/** Hồ sơ RIÊNG của chủ tài khoản. passwordHash/roomAddress luôn bị loại. Không bao giờ dùng trong API giỏ chung. */
@Exclude()
export class MyProfileDto {
  @Expose() id: string;
  @Expose() fullName: string;
  @Expose() phoneNumber: string;
  @Expose() email: string;
  @Expose() defaultHubId?: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}

  private session(user: { id: string; email: string }) {
    return {
      token: this.auth.issueToken({ id: user.id, email: user.email }),
      profile: plainToInstance(MyProfileDto, user),
    };
  }

  @Post('register')
  async register(@Body() body: RegisterDto) {
    const email = body.email.trim().toLowerCase();
    await enforceRate(this.redis, `register:${email}`, 5, 600);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('Email đã được đăng ký.');
    }
    if (body.defaultHubId && !(await this.prisma.pickupHub.findUnique({ where: { id: body.defaultHubId } }))) {
      throw new NotFoundException('Không tìm thấy điểm nhận hàng.');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: body.fullName.trim(),
        phoneNumber: body.phone,
        passwordHash: await hash(body.password, 12),
        defaultHubId: body.defaultHubId || null,
      },
    });
    return this.session(user);
  }

  @Post('login')
  async login(@Body() body: LoginDto) {
    const email = body.email.trim().toLowerCase();
    await enforceRate(this.redis, `login:${email}`, 10, 300);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await compare(body.password, user?.passwordHash || DUMMY_HASH);
    if (!user?.passwordHash || !ok) throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    return this.session(user);
  }

  /** Chỉ trả hồ sơ của CHÍNH người gọi (id lấy từ JWT). */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: current.id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    return plainToInstance(MyProfileDto, user);
  }

  /** Chỉ dùng demo/sandbox: đổi userId của dữ liệu seed lấy JWT. Tự tắt ở production. */
  @Post('demo-login')
  async demoLogin(@Body() body: DemoLoginDto) {
    if (!demoEnabled()) throw new ForbiddenException('Đăng nhập demo đã bị vô hiệu hóa.');

    const user = await this.prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');

    return { token: this.auth.issueToken({ id: user.id, email: user.email }) };
  }
}
