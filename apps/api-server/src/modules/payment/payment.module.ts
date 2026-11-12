import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoCartModule } from '../co-cart/co-cart.module';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

@Module({
  imports: [AuthModule, CoCartModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
