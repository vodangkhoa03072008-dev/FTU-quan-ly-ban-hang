import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { GeoHubService } from './geo-hub.service';
import { JwtAuthGuard, CurrentUser } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth.service';
import { RedisService } from '../../redis/redis.service';
import { enforceRate } from '../../common/rate-limit';

class LocationDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat: number;

  @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng: number;

  @IsOptional() @IsString() @MaxLength(64)
  merchantId?: string;
}

export class DiscoverQueryDto extends LocationDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(100) @Max(5000)
  radius?: number;
}

export class IntentDto extends LocationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(120)
  minutes?: number;
}

@Controller('api/geo-hub')
export class GeoHubController {
  constructor(
    private readonly geoHubService: GeoHubService,
    private readonly redis: RedisService,
  ) {}

  @Get('catalog')
  catalog() {
    return this.geoHubService.getCatalog();
  }

  /** Radar. Vị trí do client gửi (GPS hoặc chọn thủ công) — không có tọa độ mặc định cứng. */
  @UseGuards(JwtAuthGuard)
  @Get('discover')
  async discover(@CurrentUser() user: AuthUser, @Query() q: DiscoverQueryDto) {
    await enforceRate(this.redis, `discover:${user.id}`, 30, 60);
    return this.geoHubService.discover(user.id, q.lat, q.lng, q.radius ?? 1000, q.merchantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('intent')
  async setIntent(@CurrentUser() user: AuthUser, @Body() body: IntentDto) {
    await enforceRate(this.redis, `intent:${user.id}`, 10, 60);
    return this.geoHubService.setIntent(user.id, body.lat, body.lng, body.minutes, body.merchantId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('intent')
  clearIntent(@CurrentUser() user: AuthUser) {
    return this.geoHubService.clearIntent(user.id);
  }
}
