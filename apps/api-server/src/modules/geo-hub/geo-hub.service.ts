import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { boundingBox, coarse, fuzzDistance, haversineMeters } from '../../common/geo';

/** Nhóm trên Radar: chỉ số liệu tổng hợp. KHÔNG có joinCode, userId, alias, món của từng người hay tọa độ chính xác. */
export interface RadarGroup {
  cartId: string;
  merchantId: string;
  merchantName: string;
  pickupLabel: string;
  hubName: string;
  zoneCode: string;
  distanceMeters: number;
  approxLat: number;
  approxLng: number;
  membersCount: number;
  maxMembers: number;
  seatsLeft: number;
  baseShippingFee: number;
  estimatedShipPerPerson: number;
  estimatedSaving: number;
  remainingSeconds: number;
  shippingMode: string;
  requireApproval: boolean;
  isMine: boolean;
  score: number;
}

const MAX_INTENT_MINUTES = 120;

export function toRadarGroup(
  cart: any,
  distance: number,
  lat: number,
  lng: number,
  me: string,
  merchantId?: string,
): RadarGroup {
  const membersCount = cart.members.length;
  const estimatedShipPerPerson = Math.ceil(cart.baseShippingFee / (membersCount + 1));
  const remainingSeconds = Math.max(0, Math.floor((new Date(cart.expiresAt).getTime() - Date.now()) / 1000));
  // Ưu tiên: đúng cửa hàng > nhiều người > ship thấp > gần > còn đủ thời gian chọn món.
  const score =
    (merchantId && cart.merchantId === merchantId ? 1000 : 0) +
    membersCount * 20 -
    estimatedShipPerPerson / 1000 -
    distance / 50 +
    (remainingSeconds >= 300 ? 10 : remainingSeconds >= 120 ? 0 : -20);
  return {
    cartId: cart.id,
    merchantId: cart.merchantId,
    merchantName: cart.merchant.name,
    pickupLabel: cart.pickupLabel || cart.hub.name,
    hubName: cart.hub.name,
    zoneCode: cart.hub.zoneCode,
    distanceMeters: fuzzDistance(distance),
    approxLat: coarse(lat),
    approxLng: coarse(lng),
    membersCount,
    maxMembers: cart.maxMembers,
    seatsLeft: Math.max(0, cart.maxMembers - membersCount),
    baseShippingFee: cart.baseShippingFee,
    estimatedShipPerPerson,
    estimatedSaving: Math.max(0, cart.baseShippingFee - estimatedShipPerPerson),
    remainingSeconds,
    shippingMode: cart.shippingMode,
    requireApproval: cart.requireApproval,
    isMine: cart.members.some((m: any) => m.userId === me),
    score: Math.round(score * 100) / 100,
  };
}

@Injectable()
export class GeoHubService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Radar: nhóm công khai, OPEN, chưa hết hạn, chưa đầy, điểm nhận nằm trong bán kính.
   * Thống kê chỉ dựa trên người ĐÃ tham gia nhóm công khai hoặc CHỦ ĐỘNG bật chế độ tìm ghép đơn.
   */
  async discover(userId: string, lat: number, lng: number, radius: number, merchantId?: string) {
    const box = boundingBox(lat, lng, radius);
    const now = new Date();
    const latR = { gte: box.minLat, lte: box.maxLat };
    const lngR = { gte: box.minLng, lte: box.maxLng };

    const carts = await this.prisma.coCart.findMany({
      where: {
        isPublic: true,
        status: 'OPEN',
        expiresAt: { gt: now },
        OR: [
          { pickupLat: latR, pickupLng: lngR },
          { pickupLat: null, hub: { latitude: latR, longitude: lngR } },
        ],
      },
      include: { hub: true, merchant: true, members: { select: { userId: true } } },
      take: 300,
    });

    const joined = new Set<string>();
    const groups: RadarGroup[] = [];
    const merchants = new Map<string, { merchantId: string; merchantName: string; groups: number; people: Set<string> }>();

    for (const cart of carts) {
      const pLat = cart.pickupLat ?? cart.hub.latitude;
      const pLng = cart.pickupLng ?? cart.hub.longitude;
      const d = haversineMeters(lat, lng, pLat, pLng);
      if (d > radius) continue;

      const m = merchants.get(cart.merchantId) ?? {
        merchantId: cart.merchantId,
        merchantName: cart.merchant.name,
        groups: 0,
        people: new Set<string>(),
      };
      m.groups++;
      for (const mem of cart.members) {
        joined.add(mem.userId);
        m.people.add(mem.userId);
      }
      merchants.set(cart.merchantId, m);

      if (cart.members.length >= cart.maxMembers) continue; // nhóm đầy: không hiện để tham gia
      groups.push(toRadarGroup(cart, d, pLat, pLng, userId, merchantId));
    }
    groups.sort((a, b) => b.score - a.score);

    const intents = await this.prisma.matchIntent.findMany({
      where: { expiresAt: { gt: now }, lat: latR, lng: lngR },
      select: { userId: true, lat: true, lng: true },
      take: 2000,
    });
    const nearby = intents.filter((i) => haversineMeters(lat, lng, i.lat, i.lng) <= radius).map((i) => i.userId);
    const busy = nearby.length
      ? await this.prisma.cartMember.findMany({
          where: { userId: { in: nearby }, cart: { status: { in: ['OPEN', 'LOCKED'] } } },
          select: { userId: true },
          distinct: ['userId'],
        })
      : [];
    const busySet = new Set(busy.map((b) => b.userId));
    const seeking = new Set(nearby.filter((u) => !busySet.has(u) && !joined.has(u)));

    const myIntent = await this.prisma.matchIntent.findUnique({ where: { userId }, select: { expiresAt: true } });

    return {
      center: { lat: coarse(lat), lng: coarse(lng) },
      radiusMeters: radius,
      stats: {
        uniquePeople: joined.size + seeking.size, // hai tập rời nhau → không đếm trùng
        joinedPeople: joined.size,
        seekingPeople: seeking.size,
        openGroups: groups.length,
      },
      topMerchants: [...merchants.values()]
        .map((x) => ({ merchantId: x.merchantId, merchantName: x.merchantName, groups: x.groups, people: x.people.size }))
        .sort((a, b) => b.people - a.people || b.groups - a.groups)
        .slice(0, 3),
      groups,
      myIntent: myIntent && myIntent.expiresAt > now ? { active: true, expiresAt: myIntent.expiresAt } : { active: false },
    };
  }

  /** Bật chế độ "đang tìm người ghép đơn" (opt-in). Chỉ lưu tọa độ đã làm tròn ~110 m. */
  async setIntent(userId: string, lat: number, lng: number, minutes = 30, merchantId?: string) {
    if (merchantId && !(await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true } }))) {
      throw new NotFoundException('Không tìm thấy cửa hàng.');
    }
    const ttl = Math.min(Math.max(minutes, 5), MAX_INTENT_MINUTES);
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    const data = { lat: coarse(lat), lng: coarse(lng), merchantId: merchantId ?? null, expiresAt };
    await this.prisma.matchIntent.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    return { active: true, expiresAt };
  }

  async clearIntent(userId: string) {
    await this.prisma.matchIntent.deleteMany({ where: { userId } });
    return { active: false };
  }

  /** Danh mục dựng form tạo nhóm / chọn khu vực thủ công: điểm nhận CÔNG CỘNG + cửa hàng. */
  async getCatalog() {
    const [hubs, merchants] = await Promise.all([
      this.prisma.pickupHub.findMany({
        select: { id: true, name: true, zoneCode: true, latitude: true, longitude: true },
      }),
      this.prisma.merchant.findMany({ select: { id: true, name: true, baseShippingFee: true } }),
    ]);
    return { hubs, merchants };
  }
}
