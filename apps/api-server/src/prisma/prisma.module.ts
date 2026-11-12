import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global: chỉ một kết nối Prisma duy nhất cho toàn app (bản gốc tạo mỗi module một instance). */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
