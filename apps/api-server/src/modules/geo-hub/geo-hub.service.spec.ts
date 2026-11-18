import { GeoHubService, toRadarGroup } from './geo-hub.service';
import { boundingBox, coarse, fuzzDistance, haversineMeters } from '../../common/geo';

const CENTER = { lat: 10.7626, lng: 106.6602 };
const hub = { id: 'h1', name: 'Sảnh KTX khu A', zoneCode: 'KTX-A', latitude: CENTER.lat, longitude: CENTER.lng };
const merchant = { id: 'm1', name: 'Jollibee', baseShippingFee: 30000 };

const cart = (over: any = {}) => ({
  id: 'c1',
  joinCode: 'SECRET',
  isPublic: true,
  status: 'OPEN',
  merchantId: 'm1',
  merchant,
  hub,
  hubId: 'h1',
  baseShippingFee: 30000,
  maxMembers: 5,
  requireApproval: false,
  shippingMode: 'HYBRID',
  pickupLabel: null,
  pickupLat: CENTER.lat + 0.0021, // ~230 m
  pickupLng: CENTER.lng,
  expiresAt: new Date(Date.now() + 12 * 60_000),
  members: [{ userId: 'u1' }, { userId: 'u2' }],
  ...over,
});

function makeService(carts: any[], intents: any[] = [], busy: string[] = []) {
  const prisma: any = {
    coCart: { findMany: jest.fn().mockResolvedValue(carts) },
    matchIntent: {
      findMany: jest.fn().mockResolvedValue(intents),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    cartMember: { findMany: jest.fn().mockResolvedValue(busy.map((userId) => ({ userId }))) },
  };
  return { svc: new GeoHubService(prisma), prisma };
}

describe('geo utils', () => {
  it('haversine ~111 km cho 1 độ vĩ', () => {
    expect(Math.round(haversineMeters(0, 0, 1, 0) / 1000)).toBe(111);
  });
  it('bounding box chứa điểm trong bán kính', () => {
    const b = boundingBox(CENTER.lat, CENTER.lng, 1000);
    expect(b.minLat).toBeLessThan(CENTER.lat);
    expect(b.maxLng).toBeGreaterThan(CENTER.lng);
  });
  it('làm tròn khoảng cách 50 m và tọa độ 3 chữ số', () => {
    expect(fuzzDistance(201)).toBe(250);
    expect(fuzzDistance(3)).toBe(50);
    expect(coarse(10.762687)).toBe(10.763);
  });
});

describe('GeoHubService.discover', () => {
  it('chỉ truy vấn nhóm công khai, OPEN, chưa hết hạn (không trả nhóm riêng tư/hết hạn)', async () => {
    const { svc, prisma } = makeService([]);
    await svc.discover('me', CENTER.lat, CENTER.lng, 1000);
    const where = prisma.coCart.findMany.mock.calls[0][0].where;
    expect(where.isPublic).toBe(true);
    expect(where.status).toBe('OPEN');
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('tìm được nhóm gần đó theo GPS', async () => {
    const { svc } = makeService([cart()]);
    const r = await svc.discover('me', CENTER.lat, CENTER.lng, 500);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ merchantName: 'Jollibee', membersCount: 2, seatsLeft: 3, estimatedShipPerPerson: 10000 });
  });

  it('không có nhóm nào trong khu vực', async () => {
    const { svc } = makeService([cart({ pickupLat: CENTER.lat + 0.05 })]); // ~5,5 km
    const r = await svc.discover('me', CENTER.lat, CENTER.lng, 1000);
    expect(r.groups).toHaveLength(0);
    expect(r.stats).toEqual({ uniquePeople: 0, joinedPeople: 0, seekingPeople: 0, openGroups: 0 });
  });

  it('khu vực chọn thủ công (tọa độ điểm nhận) vẫn hoạt động; nhóm cũ không có pickupLat dùng tọa độ hub', async () => {
    const { svc } = makeService([cart({ pickupLat: null, pickupLng: null })]);
    const r = await svc.discover('me', hub.latitude, hub.longitude, 500);
    expect(r.groups).toHaveLength(1);
  });

  it('không hiện nhóm đã đầy', async () => {
    const { svc } = makeService([cart({ maxMembers: 2 })]);
    const r = await svc.discover('me', CENTER.lat, CENTER.lng, 1000);
    expect(r.groups).toHaveLength(0);
    expect(r.stats.joinedPeople).toBe(2);
  });

  it('không đếm trùng một người ở nhiều nhóm; tách người đã vào nhóm và người đang tìm', async () => {
    const { svc } = makeService(
      [cart(), cart({ id: 'c2', members: [{ userId: 'u2' }, { userId: 'u3' }] })],
      [
        { userId: 'u3', lat: CENTER.lat, lng: CENTER.lng }, // đã ở nhóm → không tính "đang tìm"
        { userId: 's1', lat: CENTER.lat, lng: CENTER.lng },
        { userId: 's2', lat: CENTER.lat, lng: CENTER.lng }, // đang ở nhóm riêng tư → không tính
        { userId: 'far', lat: CENTER.lat + 0.2, lng: CENTER.lng },
      ],
      ['s2'],
    );
    const r = await svc.discover('me', CENTER.lat, CENTER.lng, 1000);
    expect(r.stats).toEqual({ uniquePeople: 4, joinedPeople: 3, seekingPeople: 1, openGroups: 2 });
  });

  it('ưu tiên nhóm đúng cửa hàng và đông người', async () => {
    const { svc } = makeService([
      cart({ id: 'few', members: [{ userId: 'a' }] }),
      cart({ id: 'many', members: [{ userId: 'b' }, { userId: 'c' }, { userId: 'd' }] }),
      cart({ id: 'other', merchantId: 'm2', merchant: { ...merchant, id: 'm2', name: 'KFC' }, members: [{ userId: 'e' }] }),
    ]);
    const r = await svc.discover('me', CENTER.lat, CENTER.lng, 1000, 'm2');
    expect(r.groups.map((g) => g.cartId)).toEqual(['other', 'many', 'few']);
  });
});

describe('Radar không lộ dữ liệu cá nhân / vị trí chính xác', () => {
  it('chỉ trả trường tổng hợp', () => {
    const c = cart({
      members: [{ userId: 'u1', aliasName: 'Cáo', items: [{ productName: 'Gà' }], user: { phoneNumber: '090' } }],
    });
    const g = toRadarGroup(c, 234, c.pickupLat, c.pickupLng, 'me');
    const json = JSON.stringify(g);
    for (const leak of ['SECRET', 'u1', 'Cáo', 'Gà', '090', 'joinCode', '"members"', 'userId']) {
      expect(json).not.toContain(leak);
    }
    expect(g.approxLat).toBe(coarse(c.pickupLat));
    expect(g.distanceMeters % 50).toBe(0);
  });
});
