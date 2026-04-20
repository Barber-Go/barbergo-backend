import { Module } from '@nestjs/common';
import { TaxComplianceController } from './tax-compliance.controller';
import { TaxComplianceService } from './tax-compliance.service';
import { TaxObligationEngineService } from './tax-obligation-engine.service';
import { TaxDocumentService } from './tax-document.service';

@Module({
  controllers: [TaxComplianceController],
  providers: [TaxComplianceService, TaxObligationEngineService, TaxDocumentService],
  exports: [TaxComplianceService, TaxDocumentService],
})
export class TaxComplianceModule {}
