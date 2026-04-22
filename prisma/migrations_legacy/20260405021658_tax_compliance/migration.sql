-- Tax Compliance tables (already applied via prisma db push)
-- This migration is marked as applied to align migration history with DB state.

-- CreateTable: tax_profiles
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "giro" TEXT,
    "regimenTributario" TEXT NOT NULL DEFAULT '14D3',
    "vatAffectation" BOOLEAN NOT NULL DEFAULT true,
    "issuesDte" BOOLEAN NOT NULL DEFAULT false,
    "hasEmployees" BOOLEAN NOT NULL DEFAULT false,
    "withholdsHonorarios" BOOLEAN NOT NULL DEFAULT false,
    "monthlyRevenue" TEXT,
    "siiClaveType" TEXT,
    "siiClaveEncrypted" TEXT,
    "wizardCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: tax_obligations
CREATE TABLE "tax_obligations" (
    "id" TEXT NOT NULL,
    "taxProfileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "siiFormUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: tax_declaration_logs
CREATE TABLE "tax_declaration_logs" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_declaration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique barbershopId on tax_profiles
CREATE UNIQUE INDEX "tax_profiles_barbershopId_key" ON "tax_profiles"("barbershopId");

-- CreateIndex: unique [taxProfileId, type, period] on tax_obligations
CREATE UNIQUE INDEX "tax_obligations_taxProfileId_type_period_key" ON "tax_obligations"("taxProfileId", "type", "period");

-- AddForeignKey: tax_profiles -> barbershop_profiles
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barbershop_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: tax_obligations -> tax_profiles
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: tax_declaration_logs -> tax_obligations
ALTER TABLE "tax_declaration_logs" ADD CONSTRAINT "tax_declaration_logs_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
