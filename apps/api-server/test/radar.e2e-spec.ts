/**
 * E2E: cần PostgreSQL + Redis đang chạy (docker compose up -d), đã `prisma db push` và seed.
 * Chạy: npm run test:e2e
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

process.env.ALLOW_DEMO_PAYMENT = 'true';
const HUB = { id: 'hub-ktx-khu-b', lat: 10.8825, lng: 106.7825 };
const MERCHANT = 'merchant-tap-hoa-01';

describe('Radar & ghép đơn công khai (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  const sockets: Socket[] = [];

  const login = async (userId: string) => {
    const r = await fetch(`${base}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return (await r.json()).token as string;
  };
  const connect = async (userId: string) => {
    const s = io(`${base}/co-cart`, { transports: ['websocket'], auth: { token: await login(userId) } });
    sockets.push(s);
    await new Promise((res) => s.on('connect', () => res(null)));
    return s;
  };
  const emit = (s: Socket, ev: string, payload: any) => new Promise<any>((res) => s.emit(ev, payload, res));
  const get = async (path: string, token: string) => {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json() };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
    base = base.replace('[::1]', 'localhost');
    prisma = app.get(PrismaService);
    // Dọn nhóm cũ của user seed để không vướng giới hạn nhóm mở / rate limit.
    await prisma.coCart.updateMany({ where: { status: 'OPEN' }, data: { status: 'COMPLETED' } });
    const redis: any = app.get(require('../src/redis/redis.service').RedisService);
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  });

  it('nhóm công khai xuất hiện trên Radar, nhóm riêng tư thì không; Radar không lộ PII/mã mời', async () => {
    const leader = await connect('user-sv-1');
    const pub = await emit(leader, 'cart:create', { hubId: HUB.id, merchantId: MERCHANT, isPublic: true, pickupLabel: 'Sảnh A' });
    const priv = await emit(leader, 'cart:create', { hubId: HUB.id, merchantId: MERCHANT, isPublic: false });
    expect(pub.error).toBeUndefined();

    const token = await login('user-sv-2');
    const { body } = await get(`/api/geo-hub/discover?lat=${HUB.lat}&lng=${HUB.lng}&radius=1000`, token);
    const ids = body.groups.map((g: any) => g.cartId);
    expect(ids).toContain(pub.cart.id);
    expect(ids).not.toContain(priv.cart.id);
    const raw = JSON.stringify(body);
    for (const leak of [pub.cart.joinCode, 'user-sv-1', 'phoneNumber', 'roomAddress', 'aliasName', 'items']) {
      expect(raw).not.toContain(leak);
    }
    expect((await get(`/api/co-cart/public/${priv.cart.id}`, token)).status).toBe(404);
  });

  it('thiếu tọa độ → 400 (không có tọa độ mặc định cứng); thiếu JWT → 401', async () => {
    const token = await login('user-sv-2');
    expect((await get('/api/geo-hub/discover', token)).status).toBe(400);
    expect((await fetch(`${base}/api/geo-hub/discover?lat=1&lng=1`)).status).toBe(401);
  });

  it('hai người cùng tham gia không vượt maxMembers; thành viên nhận cập nhật WebSocket', async () => {
    await prisma.coCart.updateMany({ where: { status: 'OPEN' }, data: { status: 'COMPLETED' } });
    const leader = await connect('user-sv-1');
    const created = await emit(leader, 'cart:create', { hubId: HUB.id, merchantId: MERCHANT, isPublic: true, maxMembers: 2 });
    const cartId = created.cart.id;

    const updated = new Promise<any>((res) => leader.on('cart:state_updated', (d) => d.cart.members.length === 2 && res(d)));
    const [a, b] = await Promise.all([connect('user-sv-2'), connect('user-sv-3')]);
    const results = await Promise.all([
      emit(a, 'cart:join_public', { cartId, consent: true }),
      emit(b, 'cart:join_public', { cartId, consent: true }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(await prisma.cartMember.count({ where: { cartId } })).toBe(2);
    expect((await updated).cart.members).toHaveLength(2);

    // Tham gia lại không tạo bản ghi thứ hai.
    const winner = results[0].error ? b : a;
    await emit(winner, 'cart:join_public', { cartId, consent: true });
    expect(await prisma.cartMember.count({ where: { cartId } })).toBe(2);
  });

  it('không có consent → bị từ chối; người ngoài nhóm không sửa món/đọc chat được', async () => {
    await prisma.coCart.updateMany({ where: { status: 'OPEN' }, data: { status: 'COMPLETED' } });
    const leader = await connect('user-sv-1');
    const created = await emit(leader, 'cart:create', { hubId: HUB.id, merchantId: MERCHANT, isPublic: true });
    const outsider = await connect('user-sv-2');
    expect((await emit(outsider, 'cart:join_public', { cartId: created.cart.id })).error).toBeTruthy();
    expect((await emit(outsider, 'cart:update_item', { cartId: created.cart.id, productId: 'tp-1', quantity: 1 })).error).toBeTruthy();
    expect((await emit(outsider, 'chat:send', { cartId: created.cart.id, text: 'hi' })).error).toBeTruthy();
  });

  it('vào bằng mã mời cũ vẫn hoạt động', async () => {
    await prisma.coCart.updateMany({ where: { status: 'OPEN' }, data: { status: 'COMPLETED' } });
    const leader = await connect('user-sv-1');
    const created = await emit(leader, 'cart:create', { hubId: HUB.id, merchantId: MERCHANT, isPublic: false });
    const friend = await connect('user-sv-3');
    const joined = await emit(friend, 'cart:join_room', { code: created.cart.joinCode.toLowerCase() });
    expect(joined.error).toBeUndefined();
    expect(joined.cart.members).toHaveLength(2);
  });
});
