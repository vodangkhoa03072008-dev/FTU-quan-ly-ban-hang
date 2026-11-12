import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';
import { SmartCalculatorService } from './smart-calculator.service';
import { generateAnonymousPersona } from './utils/alias-generator.util';
import { PublicCoCartResponseDto, PublicCartMemberDto } from './dto/public-cart.dto';
import { ShippingMode } from '@prisma/client';
import { generateJoinCode, normalizeJoinCode } from './utils/join-code.util';
import { haversineMeters } from '../../common/geo';

const CART_INCLUDE = {
  hub: true,
  merchant: { include: { products: true } },
  members: { include: { items: true }, orderBy: [{ role: 'asc' }, { aliasName: 'asc' }] },
} as const;

const MAX_QTY_PER_ITEM = 20;
const DEFAULT_WINDOW_MIN = 30;
const MAX_OPEN_CARTS_AS_LEADER = 3;
/** Điểm nhận do người tạo chọn không được cách điểm nhận chuẩn quá xa (tránh ghim nhà riêng). */
const MAX_PICKUP_OFFSET_M = 1500;

export const envMaxMembers = () => Number(process.env.MAX_MEMBERS_PER_CART) || 10;

export interface CreateCartOptions {
  hubId: string;
  merchantId: string;
  shippingMode?: ShippingMode;
  isPublic?: boolean;
  maxMembers?: number;
  windowMinutes?: number;
  pickupLabel?: string;
  pickupLat?: number;
  pickupLng?: number;
  requireApproval?: boolean;
  rules?: string;
}

const clampInt = (v: unknown, min: number, max: number, def: number) =>
  Number.isInteger(v) ? Math.min(Math.max(v as number, min), max) : def;
const cleanText = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

@Injectable()
export class CoCartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: SmartCalculatorService,
  ) {}

  /** Tạo giỏ mới: người tạo là Trưởng nhóm (Proxy Leader). Sinh mã tham gia ngắn để chia sẻ. */
  async createCart(userId: string, opts: CreateCartOptions) {
    const { hubId, merchantId } = opts;
    const [user, hub, merchant, openAsLeader] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      this.prisma.pickupHub.findUnique({ where: { id: hubId } }),
      this.prisma.merchant.findUnique({ where: { id: merchantId } }),
      this.prisma.cartMember.count({ where: { userId, role: 'LEADER', cart: { status: 'OPEN' } } }),
    ]);
    if (!user) throw new ForbiddenException('Tài khoản không tồn tại.');
    if (!hub) throw new NotFoundException('Không tìm thấy điểm nhận hàng.');
    if (!merchant) throw new NotFoundException('Không tìm thấy cửa hàng.');
    if (openAsLeader >= MAX_OPEN_CARTS_AS_LEADER) {
      throw new BadRequestException(`Bạn đang mở ${openAsLeader} nhóm. Hãy chốt hoặc đóng bớt trước khi tạo nhóm mới.`);
    }

    let pickupLat = hub.latitude;
    let pickupLng = hub.longitude;
    if (Number.isFinite(opts.pickupLat) && Number.isFinite(opts.pickupLng)) {
      if (haversineMeters(hub.latitude, hub.longitude, opts.pickupLat, opts.pickupLng) > MAX_PICKUP_OFFSET_M) {
        throw new BadRequestException('Vị trí nhận hàng phải gần khu vực điểm nhận đã chọn (≤ 1,5 km).');
      }
      pickupLat = opts.pickupLat;
      pickupLng = opts.pickupLng;
    }
    const isPublic = opts.isPublic === true;
    const shippingMode = opts.shippingMode ?? 'HYBRID';
    const maxMembers = clampInt(opts.maxMembers, 2, envMaxMembers(), envMaxMembers());
    const windowMin = clampInt(opts.windowMinutes, 10, 120, DEFAULT_WINDOW_MIN);

    for (let attempt = 0; attempt < 6; attempt++) {
      const joinCode = generateJoinCode();
      try {
        return await this.prisma.$transaction(async (tx) => {
          const cart = await tx.coCart.create({
            data: {
              joinCode,
              isPublic,
              shippingMode,
              hubId,
              merchantId,
              status: 'OPEN',
              baseShippingFee: merchant.baseShippingFee,
              expiresAt: new Date(Date.now() + windowMin * 60_000),
              pickupLabel: cleanText(opts.pickupLabel, 80),
              pickupLat,
              pickupLng,
              maxMembers,
              requireApproval: isPublic && opts.requireApproval === true,
              rules: cleanText(opts.rules, 300),
            },
          });
          const persona = generateAnonymousPersona(cart.id, userId, []);
          await tx.cartMember.create({
            data: {
              cartId: cart.id,
              userId,
              role: 'LEADER',
              aliasName: persona.aliasName,
              avatarColor: persona.avatarColor,
              avatarSeed: persona.avatarSeed,
            },
          });
          return this.getCartState(tx, cart.id, userId, true);
        });
      } catch (e: any) {
        if (e?.code === 'P2002') continue; // trùng mã tham gia → thử mã khác
        throw e;
      }
    }
    throw new BadRequestException('Không tạo được mã giỏ hàng, vui lòng thử lại.');
  }

  /**
   * Khóa theo giỏ + kiểm tra điều kiện + tạo CartMember. Dùng chung cho vào bằng mã, Radar và duyệt yêu cầu,
   * nên hai người vào cùng lúc (bằng bất kỳ đường nào) không làm vượt maxMembers.
   * Người đã là thành viên thì không tạo thêm (không tham gia hai lần).
   */
  private async addMemberLocked(tx: any, cartId: string, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'join:' + cartId}))`;
    const cart = await tx.coCart.findUnique({ where: { id: cartId }, include: { members: true } });
    if (!cart) throw new NotFoundException('Không tìm thấy nhóm.');
    if (cart.members.some((m: any) => m.userId === userId)) return cart;

    if (cart.status !== 'OPEN' || cart.expiresAt <= new Date()) {
      throw new BadRequestException('Giỏ hàng đã đóng hoặc hết hạn.');
    }
    if (cart.members.length >= cart.maxMembers) throw new BadRequestException('Giỏ hàng đã đủ số thành viên.');

    const persona = generateAnonymousPersona(cart.id, userId, cart.members.map((m: any) => m.aliasName));
    await tx.cartMember.create({
      data: {
        cartId: cart.id,
        userId,
        role: 'MEMBER',
        aliasName: persona.aliasName,
        avatarColor: persona.avatarColor,
        avatarSeed: persona.avatarSeed,
      },
    });
    await tx.joinRequest.deleteMany({ where: { cartId, userId } });
    return cart;
  }

  private async assertUser(tx: any, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new ForbiddenException('Tài khoản không tồn tại.');
  }

  /** Tham gia bằng mã mời (người quen). Người đã là thành viên vào lại được (kể cả khi giỏ đã khóa). */
  async joinByCode(userId: string, rawCode: string) {
    const joinCode = normalizeJoinCode(rawCode);
    return this.prisma.$transaction(async (tx) => {
      await this.assertUser(tx, userId);
      const found = await tx.coCart.findUnique({ where: { joinCode }, select: { id: true } });
      if (!found) throw new NotFoundException('Mã giỏ hàng không đúng.');
      const cart = await this.addMemberLocked(tx, found.id, userId);
      return this.getCartState(tx, cart.id, userId, cart.status === 'OPEN');
    });
  }

  /**
   * Tham gia nhóm CÔNG KHAI từ Radar. Bắt buộc consent=true (đã đồng ý ghép đơn với người lạ).
   * Nhóm cần duyệt → tạo JoinRequest, chưa là thành viên.
   */
  async joinPublic(userId: string, cartId: string, consent: boolean) {
    if (consent !== true) {
      throw new BadRequestException('Bạn cần xác nhận đồng ý đặt hàng chung với người chưa quen biết.');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertUser(tx, userId);
      const cart = await tx.coCart.findUnique({
        where: { id: cartId },
        select: { id: true, isPublic: true, requireApproval: true, members: { select: { userId: true } } },
      });
      // Nhóm riêng tư coi như không tồn tại: không thể dò cartId để vào nhóm riêng tư.
      if (!cart || !cart.isPublic) throw new NotFoundException('Không tìm thấy nhóm công khai.');

      const isMember = cart.members.some((m) => m.userId === userId);
      if (cart.requireApproval && !isMember) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'join:' + cartId}))`;
        const fresh = await tx.coCart.findUniqueOrThrow({ where: { id: cartId }, include: { members: true } });
        if (fresh.status !== 'OPEN' || fresh.expiresAt <= new Date()) {
          throw new BadRequestException('Giỏ hàng đã đóng hoặc hết hạn.');
        }
        if (fresh.members.length >= fresh.maxMembers) throw new BadRequestException('Giỏ hàng đã đủ số thành viên.');
        const pending = await tx.joinRequest.count({ where: { cartId } });
        if (pending >= 20) throw new BadRequestException('Nhóm đang có quá nhiều yêu cầu chờ duyệt.');
        await tx.joinRequest.upsert({
          where: { cartId_userId: { cartId, userId } },
          update: {},
          create: { cartId, userId },
        });
        return { pending: true as const, cartId, state: null };
      }

      const locked = await this.addMemberLocked(tx, cartId, userId);
      return {
        pending: false as const,
        cartId,
        state: await this.getCartState(tx, cartId, userId, locked.status === 'OPEN'),
      };
    });
  }

  /** Trưởng nhóm xem yêu cầu chờ duyệt — chỉ id + thời gian, không có danh tính người xin vào. */
  async listJoinRequests(cartId: string, leaderUserId: string) {
    const me = await this.prisma.cartMember.findUnique({
      where: { cartId_userId: { cartId, userId: leaderUserId } },
    });
    if (!me || me.role !== 'LEADER') return [];
    const rows = await this.prisma.joinRequest.findMany({ where: { cartId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r, i) => ({ requestId: r.id, label: `Người dùng mới #${i + 1}`, createdAt: r.createdAt }));
  }

  async getLeaderUserId(cartId: string) {
    const leader = await this.prisma.cartMember.findFirst({
      where: { cartId, role: 'LEADER' },
      select: { userId: true },
    });
    return leader?.userId ?? null;
  }

  async reviewJoinRequest(leaderUserId: string, cartId: string, requestId: string, approve: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const me = await tx.cartMember.findUnique({ where: { cartId_userId: { cartId, userId: leaderUserId } } });
      if (!me || me.role !== 'LEADER') throw new ForbiddenException('Chỉ Trưởng nhóm mới được duyệt.');
      const req = await tx.joinRequest.findFirst({ where: { id: requestId, cartId } });
      if (!req) throw new NotFoundException('Yêu cầu không còn tồn tại.');

      if (!approve) {
        await tx.joinRequest.delete({ where: { id: req.id } });
        return { approved: false, requesterUserId: req.userId, state: null, joinCode: null };
      }
      const cart = await this.addMemberLocked(tx, cartId, req.userId);
      const state = await this.getCartState(tx, cartId, leaderUserId, true);
      return { approved: true, requesterUserId: req.userId, state, joinCode: cart.joinCode as string };
    });
  }

  /**
   * Rời nhóm trước khi chốt: chỉ khi OPEN và chưa thanh toán.
   * Trưởng nhóm rời → đôn người vào sớm nhất; không còn ai → nhóm bị hủy (COMPLETED).
   */
  async leaveCart(userId: string, cartId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'join:' + cartId}))`;
      const cart = await tx.coCart.findUnique({
        where: { id: cartId },
        include: { members: { orderBy: { joinedAt: 'asc' } } },
      });
      const me = cart?.members.find((m) => m.userId === userId);
      if (!cart || !me) throw new ForbiddenException('Bạn chưa tham gia giỏ hàng này.');
      if (cart.status !== 'OPEN') throw new BadRequestException('Nhóm đã chốt, không thể rời nhóm.');
      if (me.isPaid) throw new BadRequestException('Bạn đã thanh toán, không thể rời nhóm.');

      await tx.cartMember.delete({ where: { id: me.id } });
      const rest = cart.members.filter((m) => m.id !== me.id);
      if (rest.length === 0) {
        await tx.coCart.update({ where: { id: cartId }, data: { status: 'COMPLETED' } });
        await tx.joinRequest.deleteMany({ where: { cartId } });
        return { cancelled: true as const, isPublic: cart.isPublic, state: null };
      }
      if (me.role === 'LEADER') {
        await tx.cartMember.update({ where: { id: rest[0].id }, data: { role: 'LEADER' } });
      }
      return {
        cancelled: false as const,
        isPublic: cart.isPublic,
        state: await this.getCartState(tx, cartId, undefined, true),
      };
    });
  }

  /** Xem trước nhóm công khai trước khi đồng ý: chỉ thông tin chung, không có món/biệt danh từng người. */
  async getPublicPreview(userId: string, cartId: string) {
    const cart = await this.prisma.coCart.findUnique({
      where: { id: cartId },
      include: {
        hub: true,
        merchant: true,
        members: { select: { userId: true } },
        joinRequests: { where: { userId }, select: { id: true } },
      },
    });
    if (!cart || !cart.isPublic) throw new NotFoundException('Không tìm thấy nhóm công khai.');
    const membersCount = cart.members.length;
    return {
      cartId: cart.id,
      merchantName: cart.merchant.name,
      pickupLabel: cart.pickupLabel || cart.hub.name,
      hubName: cart.hub.name,
      membersCount,
      maxMembers: cart.maxMembers,
      seatsLeft: Math.max(0, cart.maxMembers - membersCount),
      shippingMode: cart.shippingMode,
      baseShippingFee: cart.baseShippingFee,
      estimatedShipPerPerson: Math.ceil(cart.baseShippingFee / (membersCount + 1)),
      expiresAt: cart.expiresAt,
      status: cart.status,
      joinable: cart.status === 'OPEN' && cart.expiresAt > new Date() && membersCount < cart.maxMembers,
      requireApproval: cart.requireApproval,
      rules: cart.rules,
      alreadyMember: cart.members.some((m) => m.userId === userId),
      pendingRequest: cart.joinRequests.length > 0,
    };
  }

  /** userId các thành viên hiện tại — chỉ dùng nội bộ để đuổi socket không còn quyền khỏi phòng. */
  async getMemberUserIds(cartId: string) {
    const rows = await this.prisma.cartMember.findMany({ where: { cartId }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  /** Trưởng nhóm chốt giỏ: ngừng sửa món, chuyển sang giai đoạn thanh toán. */
  async closeCart(userId: string, cartId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.coCart.findUnique({ where: { id: cartId }, include: { members: true } });
      if (!cart) throw new NotFoundException('Không tìm thấy giỏ hàng.');
      const me = cart.members.find((m) => m.userId === userId);
      if (!me || me.role !== 'LEADER') throw new ForbiddenException('Chỉ Trưởng nhóm mới được chốt giỏ.');
      if (cart.status !== 'OPEN') throw new BadRequestException('Giỏ hàng đã được chốt.');
      if (!cart.members.some((m) => m.subtotal > 0)) {
        throw new BadRequestException('Chưa có món nào trong giỏ.');
      }
      await tx.coCart.update({ where: { id: cartId }, data: { status: 'LOCKED' } });
      return this.getCartState(tx, cartId, userId, false);
    });
  }

  async upsertCartItem(
    userId: string,
    cartId: string,
    productId: string,
    quantity: number,
    note?: string,
  ) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY_PER_ITEM) {
      throw new BadRequestException(`Số lượng phải là số nguyên từ 0 đến ${MAX_QTY_PER_ITEM}.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.coCart.findUnique({ where: { id: cartId }, include: { members: true } });
      if (!cart || cart.status !== 'OPEN') {
        throw new BadRequestException('Giỏ hàng đã khóa hoặc không tồn tại.');
      }

      const member = cart.members.find((m) => m.userId === userId);
      if (!member) throw new ForbiddenException('Bạn chưa tham gia giỏ hàng này.');
      if (member.isPaid) throw new BadRequestException('Bạn đã thanh toán, không thể sửa giỏ hàng.');

      if (quantity === 0) {
        await tx.cartItem.deleteMany({ where: { memberId: member.id, productId } });
      } else {
        // Server-side price truth: đơn giá luôn lấy từ DB, không nhận từ client.
        const product = await tx.product.findFirst({
          where: { id: productId, merchantId: cart.merchantId },
        });
        if (!product) throw new NotFoundException('Món ăn không tồn tại trong thực đơn của quán.');

        const cleanNote = note?.slice(0, 150);
        await tx.cartItem.upsert({
          where: { memberId_productId: { memberId: member.id, productId: product.id } },
          update: { quantity, unitPrice: product.price, note: cleanNote },
          create: {
            memberId: member.id,
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
            quantity,
            note: cleanNote,
          },
        });
      }

      return this.getCartState(tx, cartId, userId, true);
    });
  }

  /**
   * Xác nhận thanh toán (idempotent). Từ lần thanh toán đầu tiên giỏ chuyển LOCKED:
   * không ai sửa món được nữa nên số tiền đã chốt của mọi người không đổi.
   */
  async confirmMemberPayment(userId: string, cartId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.cartMember.findUnique({
        where: { cartId_userId: { cartId, userId } },
        include: { cart: { select: { status: true } } },
      });

      if (!member) throw new ForbiddenException('Bạn chưa tham gia giỏ hàng này.');
      if (member.isPaid) return this.getCartState(tx, cartId, userId, false);
      if (member.subtotal <= 0) throw new BadRequestException('Bạn chưa có món ăn nào để thanh toán.');
      if (member.cart.status !== 'OPEN' && member.cart.status !== 'LOCKED') {
        throw new BadRequestException('Giỏ hàng không còn nhận thanh toán.');
      }

      await tx.cartMember.update({ where: { id: member.id }, data: { isPaid: true } });
      await tx.coCart.updateMany({ where: { id: cartId, status: 'OPEN' }, data: { status: 'LOCKED' } });

      const unpaid = await tx.cartMember.count({
        where: { cartId, subtotal: { gt: 0 }, isPaid: false },
      });
      if (unpaid === 0) {
        await tx.coCart.update({ where: { id: cartId }, data: { status: 'ORDERED' } });
      }

      return this.getCartState(tx, cartId, userId, false);
    });
  }

  /** Alias lấy từ DB — client không được tự khai alias (chống mạo danh trong chat). */
  async getMemberPersona(cartId: string, userId: string) {
    const member = await this.prisma.cartMember.findUnique({
      where: { cartId_userId: { cartId, userId } },
      include: { cart: { select: { status: true } } },
    });
    if (!member) throw new ForbiddenException('Bạn chưa tham gia giỏ hàng này.');
    return {
      aliasName: member.aliasName,
      avatarColor: member.avatarColor,
      cartStatus: member.cart.status,
    };
  }

  /**
   * Dựng trạng thái giỏ hàng đã lọc PII.
   * recalc=true: tính lại bảng chia tiền và ghi vào DB, nhưng KHÔNG ghi đè thành viên đã thanh toán.
   * recalc=false: dùng nguyên số liệu đã lưu.
   */
  public async getCartState(tx: any, cartId: string, requestingUserId?: string, recalc = false) {
    let cart = await tx.coCart.findUniqueOrThrow({ where: { id: cartId }, include: CART_INCLUDE });
    let summary;

    if (recalc) {
      const calculation = this.calculator.calculateCartSplit(
        cart.baseShippingFee,
        cart.discountAmount,
        cart.members.map((m: any) => ({ memberId: m.id, role: m.role, items: m.items })),
        cart.shippingMode,
      );
      const frozen = new Set<string>(cart.members.filter((m: any) => m.isPaid).map((m: any) => m.id));

      for (const calc of calculation.members) {
        if (frozen.has(calc.memberId)) continue;
        await tx.cartMember.update({
          where: { id: calc.memberId },
          data: {
            subtotal: calc.subtotal,
            shippingShare: calc.shippingShare,
            discountShare: calc.discountShare,
            finalPayable: calc.finalPayable,
          },
        });
      }
      cart = await tx.coCart.findUniqueOrThrow({ where: { id: cartId }, include: CART_INCLUDE });
    }

    summary = this.calculator.summarizeStored(cart.baseShippingFee, cart.members);

    const myMemberRecord = requestingUserId
      ? cart.members.find((m: any) => m.userId === requestingUserId)
      : null;

    return {
      cart: plainToInstance(PublicCoCartResponseDto, cart),
      hubName: cart.hub.name,
      merchantName: cart.merchant.name,
      menuProducts: cart.merchant.products.map((p: any) => ({ id: p.id, name: p.name, price: p.price })),
      summary,
      myMemberId: myMemberRecord ? myMemberRecord.id : null,
      myPersona: myMemberRecord ? plainToInstance(PublicCartMemberDto, myMemberRecord) : null,
    };
  }
}
