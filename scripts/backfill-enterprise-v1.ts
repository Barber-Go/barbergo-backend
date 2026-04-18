import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { BarbershopStatus } from '../src/generated/prisma/enums';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function backfill() {
  console.log('=== BACKFILL 1: barbershopId en Bookings ===');

  const bookings = await prisma.booking.findMany({
    where: { barbershopId: null },
    include: {
      barber: { select: { barbershopId: true } },
    },
  });

  console.log(`Bookings sin barbershopId: ${bookings.length}`);

  let updated = 0;
  for (const b of bookings) {
    const shopId = b.barber?.barbershopId;
    if (shopId) {
      await prisma.booking.update({
        where: { id: b.id },
        data: { barbershopId: shopId },
      });
      updated++;
    }
  }
  console.log(`Actualizados: ${updated}`);

  console.log('=== BACKFILL 2: Activar barberías DRAFT existentes ===');

  const shops = await prisma.barbershopProfile.findMany();
  console.log(`Total barbershops: ${shops.length}`);
  let activated = 0;
  for (const s of shops) {
    if (s.status === BarbershopStatus.DRAFT) {
      await prisma.barbershopProfile.update({
        where: { id: s.id },
        data: { status: BarbershopStatus.ACTIVE },
      });
      activated++;
    }
  }
  console.log(`Barbershops activadas: ${activated}`);

  console.log('=== VERIFICACIÓN FINAL ===');
  const withShop = await prisma.booking.count({ where: { barbershopId: { not: null } } });
  const withoutShop = await prisma.booking.count({ where: { barbershopId: null } });
  console.log(`Bookings CON barbershopId: ${withShop}`);
  console.log(`Bookings SIN barbershopId: ${withoutShop}`);
}

backfill().finally(() => prisma.$disconnect());
