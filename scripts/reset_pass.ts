import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$connect();
  const hash = await bcrypt.hash('Renato123!', 10);
  await prisma.user.update({
    where: { email: 'renatocontreras@gmail.com' },
    data: { password: hash }
  });
  console.log('Password reset to Renato123!');
}
main().finally(() => prisma.$disconnect());
