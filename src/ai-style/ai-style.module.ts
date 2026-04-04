import { Module } from '@nestjs/common';
import { AiStyleController } from './ai-style.controller';
import { AiStyleService } from './ai-style.service';

@Module({
  controllers: [AiStyleController],
  providers: [AiStyleService],
})
export class AiStyleModule {}
