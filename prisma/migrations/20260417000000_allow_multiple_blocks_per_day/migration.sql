-- DropIndex
DROP INDEX IF EXISTS "availabilities_barberId_dayOfWeek_key";

-- CreateIndex
CREATE INDEX "availabilities_barberId_dayOfWeek_idx" ON "availabilities"("barberId", "dayOfWeek");
