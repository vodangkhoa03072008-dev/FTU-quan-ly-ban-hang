import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { DeliveryQrService } from './delivery-qr.service';
import { CoCartService } from './co-cart.service';
import { JwtAuthGuard, CurrentUser } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth.service';
import { CartIdDto, VerifyClaimDto } from './dto/co-cart.dto';
import { RedisService } from '../../redis/redis.service';
import { enforceRate } from '../../common/rate-limit';
import { CoCartGateway } from './co-cart.gateway';
import { PrismaService } from '../../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('api/co-cart')
export class CoCartController {
  constructor(
    private readonly qrService: DeliveryQrService,
    private readonly coCartService: CoCartService,
    private readonly redis: RedisService,
    private readonly gateway: CoCartGateway,
    private readonly prisma: PrismaService,
  ) {}

  /** Lịch sử đơn ghép đã COMPLETED của chính người gọi + số liệu tiết kiệm (chỉ số tổng hợp, không PII). */
  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.coCartService.getHistory(user.id);
  }

  /** Xem trước nhóm công khai (trước khi đồng ý tham gia). Nhóm riêng tư trả 404. */
  @Get('public/:cartId')
  async preview(@CurrentUser() user: AuthUser, @Param() params: CartIdDto) {
    await enforceRate(this.redis, `preview:${user.id}`, 60, 60);
    return this.coCartService.getPublicPreview(user.id, params.cartId);
  }

  @Post('qr/generate')
  generateQr(@CurrentUser() user: AuthUser, @Body() body: CartIdDto) {
    return this.qrService.issueMemberPickupToken(body.cartId, user.id);
  }

  @Post('qr/verify-claim')
  async verifyAndClaim(@CurrentUser() user: AuthUser, @Body() body: VerifyClaimDto) {
    const res = await this.qrService.verifyAndHandOverOrder(user.id, body.qrToken);
    // Phát trạng thái mới cho cả phòng → mọi thành viên thấy "Đã nhận hàng" / Biên lai COMPLETED ngay.
    this.gateway.broadcastCartState(res.cartId, await this.coCartService.getCartState(this.prisma, res.cartId));
    return res;
  }
}
