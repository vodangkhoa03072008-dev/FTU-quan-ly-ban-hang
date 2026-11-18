import { HttpException, HttpStatus } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** Chống spam: vượt quota thì ném 429. */
export async function enforceRate(redis: RedisService, key: string, limit: number, windowSec: number) {
  if (!(await redis.hit(key, limit, windowSec))) {
    throw new HttpException('Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
