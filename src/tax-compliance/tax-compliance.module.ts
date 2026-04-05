import { Module } from '@nestjs/common';
import { TaxComplianceController } from './tax-compliance.controller';
import { TaxComplianceService } from './tax-compliance.service';
import { TaxObligationEngineService } from './tax-obligation-engine.service';

@Module({
  controllers: [TaxComplianceController],
  providers: [TaxComplianceService, TaxObligationEngineService],
  exports: [TaxComplianceService],
})
export class TaxComplianceModule {}
