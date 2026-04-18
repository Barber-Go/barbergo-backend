import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$connect();
  const user = await prisma.user.findUnique({
    where: { email: 'renatocontreras@gmail.com' },
    select: { id: true, password: true, name: true }
  });
  if (!user) { console.log('Not found'); return; }
  const match = await bcrypt.compare('Renato123!', user.password);
  console.log('Password match:', match);
  console.log('Hash starts with:', user.password.substring(0, 10));
}
main().finally(() => prisma.$disconnect());
