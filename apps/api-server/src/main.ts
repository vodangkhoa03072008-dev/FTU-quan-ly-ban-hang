import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { frontendUrl } from './common/env';

async function bootstrap() {
  // rawBody: cần để kiểm tra chữ ký HMAC của Webhook thanh toán trên đúng byte gốc.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: frontendUrl(), credentials: true });

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 Co-Cart API & Real-time Server đang chạy tại: http://localhost:${port}`);
}
bootstrap();
