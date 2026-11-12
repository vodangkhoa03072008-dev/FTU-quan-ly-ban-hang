import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoHubService } from './geo-hub.service';
import { GeoHubController } from './geo-hub.controller';

@Module({
  imports: [AuthModule],
  controllers: [GeoHubController],
  providers: [GeoHubService],
  exports: [GeoHubService],
})
export class GeoHubModule {}
