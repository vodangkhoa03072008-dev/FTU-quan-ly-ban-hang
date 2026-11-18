import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { secret } from '../../common/env';

export interface AuthUser {
  id: string;
  email?: string;
}

/** JWT HS256 tối giản (không thêm phụ thuộc ngoài). */
@Injectable()
export class AuthService {
  private get key() {
    return secret('JWT_SECRET', 'dev-only-jwt-secret');
  }

  private sign(data: string) {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }

  issueToken(user: AuthUser, ttlSeconds = 12 * 3600): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
    ).toString('base64url');
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`;
  }

  verifyToken(token: string): AuthUser {
    const parts = (token || '').split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Token không hợp lệ.');
    const [h, p, s] = parts;

    const a = Buffer.from(s);
    const b = Buffer.from(this.sign(`${h}.${p}`));
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Chữ ký JWT không hợp lệ.');
    }

    let header: any, payload: any;
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Token không hợp lệ.');
    }
    if (header.alg !== 'HS256') throw new UnauthorizedException('Thuật toán JWT không được hỗ trợ.');
    if (!payload.sub || !payload.exp || Date.now() >= payload.exp * 1000) {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn.');
    }
    return { id: payload.sub, email: payload.email };
  }
}
