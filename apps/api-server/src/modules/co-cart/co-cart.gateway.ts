import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { HttpException, Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { CoCartService } from './co-cart.service';
import { WsJwtGuard } from '../auth/ws-jwt.guard';
import { RedisService } from '../../redis/redis.service';
import { demoEnabled, frontendUrl } from '../../common/env';
import { enforceRate } from '../../common/rate-limit';

const chatKey = (cartId: string) => `ephemeral_chat:${cartId}`;
const userRoom = (userId: string) => `user:${userId}`;
const lockKey = (cartId: string) => `lock:cart:${cartId}`;
const isStr = (v: unknown, max = 64): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  namespace: '/co-cart',
  cors: { origin: frontendUrl(), credentials: true },
})
export class CoCartGateway {
  private readonly logger = new Logger(CoCartGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly coCartService: CoCartService,
    private readonly redis: RedisService,
  ) {}

  /** Danh tính luôn lấy từ JWT đã được WsJwtGuard xác thực, không đọc từ payload. */
  private uid(client: Socket): string {
    return client.data.user.id;
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof HttpException) {
        const msg = (e.getResponse() as any)?.message ?? e.message;
        return { error: Array.isArray(msg) ? msg.join(', ') : msg };
      }
      this.logger.error(e?.stack || e);
      return { error: 'Lỗi hệ thống, vui lòng thử lại.' };
    }
  }

  /** Gom logic vào phòng + trả trạng thái ban đầu kèm lịch sử chat (chỉ thành viên mới có quyền xem). */
  private async enterRoom(client: Socket, state: { cart: any; summary: any }) {
    await client.join(`cart:${state.cart.id}`);
    await client.join(userRoom(this.uid(client)));
    const [rawMessages, pendingRequests] = await Promise.all([
      this.redis.lrange(chatKey(state.cart.id), 0, -1),
      this.coCartService.listJoinRequests(state.cart.id, this.uid(client)),
    ]);
    this.broadcastCartState(state.cart.id, state);
    return { ...state, chatHistory: rawMessages.map((m) => JSON.parse(m)), pendingRequests };
  }

  @SubscribeMessage('cart:create')
  async handleCreate(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    return this.safe(async () => {
      if (!isStr(payload?.hubId) || !isStr(payload?.merchantId)) return { error: 'Dữ liệu không hợp lệ.' };
      await enforceRate(this.redis, `create:${this.uid(client)}`, 5, 600);
      const mode = ['EQUAL', 'PROPORTIONAL', 'HYBRID'].includes(payload.shippingMode)
        ? (payload.shippingMode as any)
        : 'HYBRID';
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      const lat = num(payload.pickupLat);
      const lng = num(payload.pickupLng);
      if ((lat !== undefined && Math.abs(lat) > 90) || (lng !== undefined && Math.abs(lng) > 180)) {
        return { error: 'Tọa độ không hợp lệ.' };
      }
      const state = await this.coCartService.createCart(this.uid(client), {
        hubId: payload.hubId,
        merchantId: payload.merchantId,
        shippingMode: mode,
        isPublic: payload.isPublic === true,
        maxMembers: num(payload.maxMembers),
        windowMinutes: num(payload.windowMinutes),
        pickupLabel: typeof payload.pickupLabel === 'string' ? payload.pickupLabel : undefined,
        pickupLat: lat,
        pickupLng: lng,
        requireApproval: payload.requireApproval === true,
        rules: typeof payload.rules === 'string' ? payload.rules : undefined,
      });
      return this.enterRoom(client, state);
    });
  }

  /** Vào bằng mã mời (người quen) — giữ nguyên hành vi cũ. */
  @SubscribeMessage('cart:join_room')
  async handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: { code: string }) {
    return this.safe(async () => {
      if (!isStr(payload?.code, 16)) return { error: 'Vui lòng nhập mã giỏ hàng.' };
      await enforceRate(this.redis, `code:${this.uid(client)}`, 30, 60); // chống dò mã
      const state = await this.coCartService.joinByCode(this.uid(client), payload.code);
      return this.enterRoom(client, state);
    });
  }

  /** Tham gia nhóm công khai từ Radar. consent=true là bắt buộc (modal xác nhận ghép đơn với người lạ). */
  @SubscribeMessage('cart:join_public')
  async handleJoinPublic(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cartId: string; consent: boolean },
  ) {
    return this.safe(async () => {
      if (!isStr(payload?.cartId)) return { error: 'Dữ liệu không hợp lệ.' };
      await enforceRate(this.redis, `joinpub:${this.uid(client)}`, 10, 60);
      const res = await this.coCartService.joinPublic(this.uid(client), payload.cartId, payload.consent === true);
      if (res.pending) {
        await client.join(userRoom(this.uid(client))); // để nhận kết quả duyệt
        await this.notifyLeaderRequests(payload.cartId);
        return { pending: true };
      }
      return { pending: false, joinCode: res.state.cart.joinCode, ...(await this.enterRoom(client, res.state)) };
    });
  }

  @SubscribeMessage('cart:review_request')
  async handleReview(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cartId: string; requestId: string; approve: boolean },
  ) {
    return this.safe(async () => {
      if (!isStr(payload?.cartId) || !isStr(payload?.requestId)) return { error: 'Dữ liệu không hợp lệ.' };
      const res = await this.coCartService.reviewJoinRequest(
        this.uid(client),
        payload.cartId,
        payload.requestId,
        payload.approve === true,
      );
      this.server.to(userRoom(res.requesterUserId)).emit('cart:join_reviewed', {
        cartId: payload.cartId,
        approved: res.approved,
        joinCode: res.joinCode,
      });
      if (res.state) this.broadcastCartState(payload.cartId, res.state);
      await this.notifyLeaderRequests(payload.cartId);
      return { status: 'ok' };
    });
  }

  /** Rời nhóm trước khi chốt. */
  @SubscribeMessage('cart:leave')
  async handleLeave(@ConnectedSocket() client: Socket, @MessageBody() payload: { cartId: string }) {
    return this.safe(async () => {
      if (!isStr(payload?.cartId)) return { error: 'Dữ liệu không hợp lệ.' };
      const result = await this.redis.withLock(lockKey(payload.cartId), 3000, async () => {
        const res = await this.coCartService.leaveCart(this.uid(client), payload.cartId);
        await this.evictNonMembers(payload.cartId);
        if (res.state) this.broadcastCartState(payload.cartId, res.state);
        else if (res.isPublic) this.server.emit('radar:updated', { cartId: payload.cartId, status: 'COMPLETED', membersCount: 0, seatsLeft: 0 });
        return { status: 'left' };
      });
      return result ?? { error: 'Giỏ hàng đang đồng bộ, vui lòng thử lại sau 1 giây.' };
    });
  }

  @SubscribeMessage('cart:close')
  async handleClose(@ConnectedSocket() client: Socket, @MessageBody() payload: { cartId: string }) {
    return this.safe(async () => {
      if (!isStr(payload?.cartId)) return { error: 'Dữ liệu không hợp lệ.' };
      const result = await this.redis.withLock(lockKey(payload.cartId), 3000, async () => {
        const state = await this.coCartService.closeCart(this.uid(client), payload.cartId);
        this.broadcastCartState(payload.cartId, state);
        return { status: 'closed' };
      });
      return result ?? { error: 'Giỏ hàng đang đồng bộ, vui lòng thử lại sau 1 giây.' };
    });
  }

  @SubscribeMessage('cart:update_item')
  async handleUpdateItem(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cartId: string; productId: string; quantity: number; note?: string },
  ) {
    return this.safe(async () => {
      if (!isStr(payload?.cartId) || !isStr(payload?.productId)) return { error: 'Dữ liệu không hợp lệ.' };

      const result = await this.redis.withLock(lockKey(payload.cartId), 3000, async () => {
        const state = await this.coCartService.upsertCartItem(
          this.uid(client),
          payload.cartId,
          payload.productId,
          payload.quantity,
          typeof payload.note === 'string' ? payload.note : undefined,
        );
        this.broadcastCartState(payload.cartId, state);
        return { status: 'ok', myPersona: state.myPersona };
      });

      return result ?? { error: 'Giỏ hàng đang đồng bộ, vui lòng thao tác lại sau 1 giây.' };
    });
  }

  /** Thanh toán nhanh (không qua ngân hàng) — chỉ bật khi demo, luôn tắt ở production. */
  @SubscribeMessage('cart:pay')
  async handlePayment(@ConnectedSocket() client: Socket, @MessageBody() payload: { cartId: string }) {
    return this.safe(async () => {
      if (!demoEnabled()) {
        return { error: 'Thanh toán nhanh đã tắt. Vui lòng thanh toán bằng VietQR.' };
      }
      if (!isStr(payload?.cartId)) return { error: 'Dữ liệu không hợp lệ.' };

      const result = await this.redis.withLock(lockKey(payload.cartId), 3000, async () => {
        const state = await this.coCartService.confirmMemberPayment(this.uid(client), payload.cartId);
        await this.afterStateChange(payload.cartId, state);
        return { status: 'paid' };
      });
      return result ?? { error: 'Giỏ hàng đang đồng bộ, vui lòng thử lại sau 1 giây.' };
    });
  }

  @SubscribeMessage('chat:send')
  async handleSendChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { cartId: string; text: string },
  ) {
    return this.safe(async () => {
      if (!isStr(payload?.cartId) || typeof payload?.text !== 'string') return { error: 'Dữ liệu không hợp lệ.' };
      const cleanText = payload.text.trim().slice(0, 250);
      if (!cleanText) return { status: 'ignored' };

      const persona = await this.coCartService.getMemberPersona(payload.cartId, this.uid(client));
      if (persona.cartStatus !== 'OPEN' && persona.cartStatus !== 'LOCKED') {
        return { error: 'Phòng chat đã đóng.' };
      }

      const msgObj = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        aliasName: persona.aliasName,
        avatarColor: persona.avatarColor,
        text: cleanText,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      };

      const key = chatKey(payload.cartId);
      await this.redis.rpush(key, JSON.stringify(msgObj));
      await this.redis.ltrim(key, -200, -1);
      await this.redis.expire(key, 3600);

      this.server.to(`cart:${payload.cartId}`).emit('chat:message', msgObj);
      return { status: 'ok' };
    });
  }

  public broadcastCartState(cartId: string, state: { cart: any; summary: any }) {
    this.server.to(`cart:${cartId}`).emit('cart:state_updated', {
      cart: state.cart,
      summary: state.summary,
    });
    // Radar: chỉ phát số liệu tổng hợp của nhóm công khai (không món, không alias, không mã mời).
    if (state.cart.isPublic) {
      const membersCount = state.cart.members?.length ?? 0;
      this.server.emit('radar:updated', {
        cartId,
        status: state.cart.status,
        membersCount,
        seatsLeft: Math.max(0, (state.cart.maxMembers ?? 0) - membersCount),
      });
    }
  }

  /** Gửi danh sách yêu cầu chờ duyệt (ẩn danh) tới Trưởng nhóm. */
  private async notifyLeaderRequests(cartId: string) {
    const leader = await this.coCartService.getLeaderUserId(cartId);
    if (!leader) return;
    const requests = await this.coCartService.listJoinRequests(cartId, leader);
    this.server.to(userRoom(leader)).emit('cart:join_requests', { cartId, requests });
  }

  /** Socket của người không còn là thành viên (rời nhóm / bị loại khi hết hạn) bị đưa ra khỏi phòng. */
  public async evictNonMembers(cartId: string) {
    const members = await this.coCartService.getMemberUserIds(cartId);
    const sockets = await this.server.in(`cart:${cartId}`).fetchSockets();
    for (const s of sockets) {
      if (!members.has(s.data?.user?.id)) {
        s.leave(`cart:${cartId}`);
        s.emit('cart:removed', { cartId });
      }
    }
  }

  /** Broadcast + tự hủy chat nếu đơn vừa được chốt. Dùng chung cho cart:pay, Webhook và cronjob. */
  public async afterStateChange(cartId: string, state: { cart: any; summary: any }) {
    if (state.cart.status === 'ORDERED') await this.evictNonMembers(cartId);
    this.broadcastCartState(cartId, state);
    if (state.cart.status === 'ORDERED') await this.purgeEphemeralChat(cartId);
  }

  public async purgeEphemeralChat(cartId: string): Promise<void> {
    await this.redis.del(chatKey(cartId));
    this.server.to(`cart:${cartId}`).emit('chat:auto_destructed', {
      message: 'Đơn hàng đã chốt! Toàn bộ tin nhắn ẩn danh đã được tự động tiêu hủy khỏi bộ nhớ RAM.',
    });
  }
}
