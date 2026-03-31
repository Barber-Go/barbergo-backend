import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { MediaStorageService } from './media-storage.service';

@Module({
  controllers: [PortfolioController],
  providers: [PortfolioService, MediaStorageService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
