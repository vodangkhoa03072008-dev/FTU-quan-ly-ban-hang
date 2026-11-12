import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { DeliveryQrService } from './delivery-qr.service';
import { CoCartService } from './co-cart.service';
import { JwtAuthGuard, CurrentUser } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth.service';
import { CartIdDto, VerifyClaimDto } from './dto/co-cart.dto';
import { RedisService } from '../../redis/redis.service';
import { enforceRate } from '../../common/rate-limit';

@UseGuards(JwtAuthGuard)
@Controller('api/co-cart')
export class CoCartController {
  constructor(
    private readonly qrService: DeliveryQrService,
    private readonly coCartService: CoCartService,
    private readonly redis: RedisService,
  ) {}

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
  verifyAndClaim(@CurrentUser() user: AuthUser, @Body() body: VerifyClaimDto) {
    return this.qrService.verifyAndHandOverOrder(user.id, body.qrToken);
  }
}
