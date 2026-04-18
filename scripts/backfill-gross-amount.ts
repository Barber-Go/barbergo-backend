import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function backfill() {
  const bookings = await prisma.booking.findMany({
    where: { grossAmount: 0, barberNet: { gt: 0 } },
    select: { id: true, barberNet: true, platformFee: true },
  });

  console.log(`Bookings a actualizar: ${bookings.length}`);

  for (const b of bookings) {
    const gross = Number(b.barberNet) + Number(b.platformFee);
    await prisma.booking.update({
      where: { id: b.id },
      data: { grossAmount: gross },
    });
    console.log(`  ${b.id}: grossAmount = ${gross}`);
  }

  console.log('Backfill completado');
}

backfill().finally(() => prisma.$disconnect());
