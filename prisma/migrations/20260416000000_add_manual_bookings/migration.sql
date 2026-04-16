CREATE TABLE IF NOT EXISTS "manual_bookings" (
    "id" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "clientName" TEXT,
    "serviceName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "note" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_bookings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "manual_bookings" ADD CONSTRAINT "manual_bookings_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
