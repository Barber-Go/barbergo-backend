-- AlterTable
ALTER TABLE "credit_transactions" ADD COLUMN     "remainingAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "credit_transactions_walletId_expiresAt_remainingAmount_idx" ON "credit_transactions"("walletId", "expiresAt", "remainingAmount");
