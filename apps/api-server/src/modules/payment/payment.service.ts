import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CoCartService } from '../co-cart/co-cart.service';
import { CoCartGateway } from '../co-cart/co-cart.gateway';
import { secret } from '../../common/env';

export const buildPaymentRef = (memberId: string) =>
  `COCART_${memberId.replace(/-/g, '').substring(0, 12).toUpperCase()}`;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly coCartService: CoCartService,
    private readonly gateway: CoCartGateway,
  ) {}

  async createDynamicVietQrForMember(cartId: string, userId: string) {
    const member = await this.prisma.cartMember.findUnique({
      where: { cartId_userId: { cartId, userId } },
      include: { cart: { select: { status: true } } },
    });

    if (!member || member.finalPayable <= 0) {
      throw new BadRequestException('Bạn chưa chọn món hoặc số tiền thanh toán bằng 0.');
    }
    if (member.isPaid) throw new BadRequestException('Phần giỏ hàng của bạn đã được thanh toán.');
    if (member.cart.status !== 'OPEN' && member.cart.status !== 'LOCKED') {
      throw new BadRequestException('Giỏ hàng không còn nhận thanh toán.');
    }

    const paymentRef = buildPaymentRef(member.id);
    const bankId = process.env.BANK_BIN || '970422';
    const accountNo = process.env.BANK_ACCOUNT_NO || '090123456789';
    const accountName = encodeURIComponent('QUY TAM GIU CO CART ESCROW');

    const vietQrImageUrl =
      `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png` +
      `?amount=${member.finalPayable}&addInfo=${paymentRef}&accountName=${accountName}`;

    return {
      memberId: member.id,
      aliasName: member.aliasName,
      amount: member.finalPayable,
      paymentRef,
      vietQrImageUrl,
    };
  }

  /** Webhook ngân hàng: chữ ký HMAC-SHA256 tính trên đúng byte thô của request body. */
  async handlePaymentWebhook(
    signatureHeader: string,
    rawBody: Buffer,
    payload: { paymentRef: string; amount: number; memberId: string },
  ) {
    if (!rawBody) throw new BadRequestException('Thiếu nội dung request.');
    const expectedSig = createHmac('sha256', secret('PAYMENT_WEBHOOK_SECRET', 'dev-only-webhook-secret'))
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signatureHeader || '', 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new ForbiddenException('Chữ ký Webhook thanh toán không hợp lệ.');
    }

    const member = await this.prisma.cartMember.findUnique({ where: { id: payload.memberId } });
    if (!member) throw new BadRequestException('Không tìm thấy thành viên tương ứng.');
    if (payload.paymentRef !== buildPaymentRef(member.id)) {
      throw new BadRequestException('Mã tham chiếu thanh toán không khớp.');
    }
    if (!Number.isFinite(payload.amount) || payload.amount < member.finalPayable) {
      throw new BadRequestException('Số tiền chuyển khoản chưa đủ so với số tiền cần thanh toán.');
    }

    const state = await this.redis.withLock(`lock:cart:${member.cartId}`, 3000, () =>
      this.coCartService.confirmMemberPayment(member.userId, member.cartId),
    );
    if (!state) throw new BadRequestException('Giỏ hàng đang đồng bộ, vui lòng gửi lại webhook.');

    await this.gateway.afterStateChange(member.cartId, state);
    return { success: true, cartId: member.cartId };
  }

  /**
   * Cronjob 30 giây chống "bùng đơn": giỏ hết hạn (OPEN hoặc LOCKED) → loại thành viên chưa trả,
   * đôn Trưởng nhóm mới nếu cần, chốt đơn cho người đã trả.
   * Số tiền của người đã trả được GIỮ NGUYÊN (không tính lại) để không phát sinh thêm tiền sau khi họ đã chuyển khoản.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepExpiredCartsAndRemoveGhostMembers() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const expired = await this.prisma.coCart.findMany({
        where: { status: { in: ['OPEN', 'LOCKED'] }, expiresAt: { lte: new Date() } },
        select: { id: true },
      });
      for (const { id } of expired) {
        try {
          await this.redis.withLock(`lock:cart:${id}`, 10000, () => this.closeExpiredCart(id));
        } catch (e: any) {
          this.logger.error(`Lỗi khi đóng giỏ ${id}: ${e?.message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async closeExpiredCart(cartId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const cart = await tx.coCart.findUnique({ where: { id: cartId }, include: { members: true } });
      if (!cart || (cart.status !== 'OPEN' && cart.status !== 'LOCKED')) return null;

      const paid = cart.members.filter((m) => m.isPaid && m.subtotal > 0);
      if (paid.length === 0) {
        await tx.coCart.update({ where: { id: cartId }, data: { status: 'COMPLETED' } });
        return { empty: true as const };
      }

      await tx.cartMember.deleteMany({
        where: { cartId, OR: [{ isPaid: false }, { subtotal: { lte: 0 } }] },
      });
      if (!paid.some((m) => m.role === 'LEADER')) {
        await tx.cartMember.update({ where: { id: paid[0].id }, data: { role: 'LEADER' } });
      }
      await tx.coCart.update({ where: { id: cartId }, data: { status: 'ORDERED' } });

      const uncollectedShipping =
        cart.baseShippingFee - paid.reduce((s, m) => s + m.shippingShare, 0);
      const state = await this.coCartService.getCartState(tx, cartId, undefined, false);
      return { empty: false as const, state, paidCount: paid.length, uncollectedShipping };
    });

    if (!outcome) return;
    if (outcome.empty) {
      await this.gateway.purgeEphemeralChat(cartId);
      this.logger.log(`Đã đóng giỏ hàng quá hạn không ai thanh toán: ${cartId}`);
      return;
    }

    await this.gateway.afterStateChange(cartId, outcome.state);
    this.logger.log(
      `Giỏ ${cartId} tự động chốt đơn cho ${outcome.paidCount} thành viên đã thanh toán` +
        (outcome.uncollectedShipping > 0
          ? ` (phí ship chưa thu đủ: ${outcome.uncollectedShipping}đ do thành viên bị loại)`
          : ''),
    );
  }
}
