import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const BCRYPT_ROUNDS = 10;

async function main() {
  console.log('🌱 Starting seed...');

  // ── Clean existing seed data (idempotent) ─────────────────────────────
  await prisma.service.deleteMany({
    where: { barber: { user: { email: { in: ['barbero@test.com'] } } } },
  });
  await prisma.barber.deleteMany({
    where: { user: { email: { in: ['cliente@test.com', 'barbero@test.com'] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: ['cliente@test.com', 'barbero@test.com'] } },
  });

  // ── Client user ───────────────────────────────────────────────────────
  const clientPassword = await bcrypt.hash('12345678', BCRYPT_ROUNDS);
  const client = await prisma.user.create({
    data: {
      name: 'Juan Cliente',
      email: 'cliente@test.com',
      password: clientPassword,
      role: 'CLIENT',
    },
  });
  console.log(`✅ Client created: ${client.email} (id: ${client.id})`);

  // ── Barber user + profile + services ─────────────────────────────────
  const barberPassword = await bcrypt.hash('12345678', BCRYPT_ROUNDS);
  const barberUser = await prisma.user.create({
    data: {
      name: 'Pedro Barbero',
      email: 'barbero@test.com',
      password: barberPassword,
      role: 'BARBER',
    },
  });
  console.log(`✅ Barber user created: ${barberUser.email} (id: ${barberUser.id})`);

  const barberProfile = await prisma.barber.create({
    data: {
      userId: barberUser.id,
      bio: 'Barbero profesional con 5 años de experiencia',
      lat: -33.4489,
      lng: -70.6693,
    },
  });
  console.log(`✅ Barber profile created (id: ${barberProfile.id})`);

  const [corteClasico, corteBarba] = await Promise.all([
    prisma.service.create({
      data: {
        barberId: barberProfile.id,
        name: 'Corte clásico',
        price: 8000,
        durationMin: 30,
      },
    }),
    prisma.service.create({
      data: {
        barberId: barberProfile.id,
        name: 'Corte + barba',
        price: 12000,
        durationMin: 45,
      },
    }),
  ]);
  console.log(`✅ Services created: "${corteClasico.name}", "${corteBarba.name}"`);

  console.log('\n🎉 Seed completed successfully!');
  console.log('\nTest credentials:');
  console.log('  Cliente  → cliente@test.com  / 12345678');
  console.log('  Barbero  → barbero@test.com  / 12345678');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
