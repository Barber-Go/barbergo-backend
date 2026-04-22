-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "barber_invitations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "initialBarberPercent" INTEGER NOT NULL DEFAULT 60,
    "initialShopPercent" INTEGER NOT NULL DEFAULT 40,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "email" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barber_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "barber_invitations_code_key" ON "barber_invitations"("code");

-- CreateIndex
CREATE INDEX "barber_invitations_code_idx" ON "barber_invitations"("code");

-- CreateIndex
CREATE INDEX "barber_invitations_barbershopId_status_idx" ON "barber_invitations"("barbershopId", "status");

-- AddForeignKey
ALTER TABLE "barber_invitations" ADD CONSTRAINT "barber_invitations_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barbershop_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_invitations" ADD CONSTRAINT "barber_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_invitations" ADD CONSTRAINT "barber_invitations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
