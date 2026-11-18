import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';

const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.quit();
  }

  /** Fixed-window rate limit. true = còn quota, false = vượt giới hạn. */
  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const n = await this.incr(`rl:${key}`);
    if (n === 1) await this.expire(`rl:${key}`, windowSec);
    return n <= limit;
  }

  /**
   * Distributed lock: SET key token NX PX ttl, giải phóng bằng Lua kiểm tra đúng chủ sở hữu
   * (tránh xóa nhầm khóa của request khác khi khóa của mình đã hết hạn).
   * Trả về null nếu không giành được khóa.
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = randomBytes(12).toString('hex');
    const ok = await this.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    try {
      return await fn();
    } finally {
      await this.eval(RELEASE_LUA, 1, key, token);
    }
  }
}
