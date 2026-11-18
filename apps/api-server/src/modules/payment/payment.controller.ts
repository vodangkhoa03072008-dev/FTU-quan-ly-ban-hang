import { Controller, Post, Body, Headers, Req, UseGuards, BadRequestException, RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { JwtAuthGuard, CurrentUser } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth.service';
import { CartIdDto } from '../co-cart/dto/co-cart.dto';

@Controller('api/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtAuthGuard)
  @Post('vietqr')
  generateVietQr(@CurrentUser() user: AuthUser, @Body() body: CartIdDto) {
    return this.paymentService.createDynamicVietQrForMember(body.cartId, user.id);
  }

  /** Không dùng JWT: được xác thực bằng chữ ký HMAC trong header x-signature. */
  @Post('webhook')
  handleWebhook(
    @Headers('x-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const payload = req.body;
    if (
      typeof payload?.paymentRef !== 'string' ||
      typeof payload?.memberId !== 'string' ||
      typeof payload?.amount !== 'number'
    ) {
      throw new BadRequestException('Payload webhook không hợp lệ.');
    }
    return this.paymentService.handlePaymentWebhook(signature, req.rawBody, payload);
  }
}
