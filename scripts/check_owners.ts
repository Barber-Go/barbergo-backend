import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$connect();
  const owners = await prisma.user.findMany({
    where: { role: 'BARBERSHOP_OWNER' },
    select: { id: true, email: true, name: true }
  });
  console.log(JSON.stringify(owners));
}
main().finally(() => prisma.$disconnect());
