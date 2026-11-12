import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { secret } from '../../common/env';

export interface SignedQrPayload {
  c: string;
  m: string;
  n: string;
  /** Thời điểm hết hạn (epoch ms) — nằm trong phần được ký. */
  e: number;
  s: string;
}

@Injectable()
export class DeliveryQrService {
  constructor(private readonly prisma: PrismaService) {}

  private get secret() {
    return secret('QR_HMAC_SECRET', 'dev-only-qr-hmac-secret');
  }

  private sign(raw: string) {
    return createHmac('sha256', this.secret).update(raw).digest('hex');
  }

  async issueMemberPickupToken(cartId: string, userId: string) {
    const member = await this.prisma.cartMember.findUnique({
      where: { cartId_userId: { cartId, userId } },
      include: { items: true, cart: { select: { status: true } } },
    });

    if (!member) throw new ForbiddenException('Bạn không thuộc giỏ hàng này.');
    if (!member.isPaid) throw new ForbiddenException('Vui lòng hoàn tất thanh toán trước khi nhận mã QR.');
    if (member.cart.status !== 'ORDERED') {
      throw new BadRequestException('Đơn hàng chưa được chốt hoặc đã hoàn tất.');
    }
    if (member.pickedUpAt) throw new BadRequestException('Bạn đã nhận đơn hàng này rồi.');

    const nonce = randomBytes(16).toString('hex');
    const ttlMin = Number(process.env.QR_TTL_MINUTES) || 120;
    const exp = Date.now() + ttlMin * 60 * 1000;
    const payload: SignedQrPayload = {
      c: cartId,
      m: member.id,
      n: nonce,
      e: exp,
      s: this.sign(`${cartId}:${member.id}:${nonce}:${exp}`),
    };

    const qrToken = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tokenHash = createHash('sha256').update(qrToken).digest('hex');

    // Cấp token mới sẽ vô hiệu token cũ (hash cũ bị ghi đè).
    await this.prisma.cartMember.update({
      where: { id: member.id },
      data: { pickupTokenHash: tokenHash },
    });

    return {
      qrToken,
      expiresAt: new Date(exp),
      aliasName: member.aliasName,
      avatarColor: member.avatarColor,
      finalPayable: member.finalPayable,
      itemCount: member.items.reduce((sum, i) => sum + i.quantity, 0),
    };
  }

  async verifyAndHandOverOrder(leaderUserId: string, qrToken: string) {
    let payload: SignedQrPayload;
    try {
      payload = JSON.parse(Buffer.from(qrToken, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Định dạng mã QR không hợp lệ.');
    }
    if (
      !payload ||
      typeof payload.c !== 'string' ||
      typeof payload.m !== 'string' ||
      typeof payload.n !== 'string' ||
      typeof payload.e !== 'number' ||
      typeof payload.s !== 'string'
    ) {
      throw new BadRequestException('Định dạng mã QR không hợp lệ.');
    }

    const actualBuf = Buffer.from(payload.s, 'hex');
    const expectedBuf = Buffer.from(this.sign(`${payload.c}:${payload.m}:${payload.n}:${payload.e}`), 'hex');
    if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
      throw new ForbiddenException('Chữ ký bảo mật QR không hợp lệ hoặc bị giả mạo.');
    }

    if (Date.now() > payload.e) {
      throw new BadRequestException('Mã QR đã hết hạn, hãy tạo mã mới.');
    }

    const tokenHash = createHash('sha256').update(qrToken).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const leader = await tx.cartMember.findUnique({
        where: { cartId_userId: { cartId: payload.c, userId: leaderUserId } },
      });
      if (!leader || leader.role !== 'LEADER') {
        throw new ForbiddenException('Chỉ Trưởng nhóm đại diện mới có quyền xác thực mã QR.');
      }

      // Atomic check-and-set: chỉ một request duy nhất thắng.
      const updateResult = await tx.cartMember.updateMany({
        where: { id: payload.m, cartId: payload.c, pickupTokenHash: tokenHash, pickedUpAt: null },
        data: { pickedUpAt: new Date(), pickupTokenHash: null },
      });
      if (updateResult.count === 0) {
        throw new ConflictException('Mã QR này đã được sử dụng trước đó hoặc không còn hiệu lực.');
      }

      const verifiedMember = await tx.cartMember.findUniqueOrThrow({
        where: { id: payload.m },
        include: { items: true },
      });

      const remainingUnclaimed = await tx.cartMember.count({
        where: { cartId: payload.c, subtotal: { gt: 0 }, pickedUpAt: null },
      });
      if (remainingUnclaimed === 0) {
        await tx.coCart.update({ where: { id: payload.c }, data: { status: 'COMPLETED' } });
      }

      return {
        verified: true,
        pickedUpAt: verifiedMember.pickedUpAt,
        memberPersona: {
          aliasName: verifiedMember.aliasName,
          avatarColor: verifiedMember.avatarColor,
        },
        itemsToDeliver: verifiedMember.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          note: item.note,
        })),
      };
    });
  }
}
