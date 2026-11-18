import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SmartCalculatorService } from './smart-calculator.service';
import { DeliveryQrService } from './delivery-qr.service';
import { CoCartService } from './co-cart.service';
import { CoCartGateway } from './co-cart.gateway';
import { CoCartController } from './co-cart.controller';

@Module({
  imports: [AuthModule],
  controllers: [CoCartController],
  providers: [SmartCalculatorService, DeliveryQrService, CoCartService, CoCartGateway],
  exports: [CoCartGateway, SmartCalculatorService, CoCartService],
})
export class CoCartModule {}
