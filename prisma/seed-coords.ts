import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const coords = [
    { lat: -33.4372, lng: -70.6506 }, // Providencia
    { lat: -33.4195, lng: -70.6045 }, // Las Condes
    { lat: -33.4569, lng: -70.6483 }, // Ñuñoa
    { lat: -33.4420, lng: -70.6680 }, // Santiago Centro
    { lat: -33.4260, lng: -70.6150 }, // Vitacura
    { lat: -33.4650, lng: -70.6350 }, // Macul
  ];

  const barbers = await prisma.barberProfile.findMany({
    where: { lat: null },
    select: { id: true },
  });

  console.log(`Found ${barbers.length} barbers without coordinates`);

  for (let i = 0; i < barbers.length; i++) {
    const c = coords[i % coords.length];
    await prisma.barberProfile.update({
      where: { id: barbers[i].id },
      data: { lat: c.lat, lng: c.lng },
    });
    console.log(`  Updated ${barbers[i].id} -> ${c.lat}, ${c.lng}`);
  }

  console.log('Done');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
