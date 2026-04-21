import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Starting credits seed...');

  const client = await prisma.user.findUnique({
    where: { email: 'cliente@test.com' },
  });

  if (!client) {
    console.error('cliente@test.com not found. Run main seed first.');
    process.exit(1);
  }

  // Clean existing credit data for this user
  await prisma.creditTransaction.deleteMany({ where: { userId: client.id } });
  await prisma.creditWallet.deleteMany({ where: { userId: client.id } });

  // Create wallet
  const wallet = await prisma.creditWallet.create({
    data: {
      userId: client.id,
      balance: 15000,
      totalEarned: 25000,
      totalSpent: 10000,
    },
  });
  console.log(`Wallet created (id: ${wallet.id})`);

  const now = new Date();

  // +$10.000 ADMIN_GRANT (2 weeks ago)
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const expiresAdminGrant = new Date(twoWeeksAgo);
  expiresAdminGrant.setMonth(expiresAdminGrant.getMonth() + 12);

  await prisma.creditTransaction.create({
    data: {
      walletId: wallet.id,
      userId: client.id,
      type: 'ADMIN_GRANT',
      amount: 10000,
      balanceAfter: 10000,
      description: 'Compensacion por servicio no realizado',
      expiresAt: expiresAdminGrant,
      createdAt: twoWeeksAgo,
    },
  });

  // +$15.000 REFUND (1 week ago)
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const expiresRefund = new Date(oneWeekAgo);
  expiresRefund.setMonth(expiresRefund.getMonth() + 12);

  await prisma.creditTransaction.create({
    data: {
      walletId: wallet.id,
      userId: client.id,
      type: 'REFUND',
      amount: 15000,
      balanceAfter: 25000,
      description: 'Reembolso por cancelación de reserva',
      expiresAt: expiresRefund,
      createdAt: oneWeekAgo,
    },
  });

  // -$5.000 BOOKING_PAYMENT (3 days ago)
  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  await prisma.creditTransaction.create({
    data: {
      walletId: wallet.id,
      userId: client.id,
      type: 'BOOKING_PAYMENT',
      amount: -5000,
      balanceAfter: 20000,
      description: 'Pago de reserva con créditos',
      createdAt: threeDaysAgo,
    },
  });

  // -$5.000 BOOKING_PAYMENT (yesterday)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  await prisma.creditTransaction.create({
    data: {
      walletId: wallet.id,
      userId: client.id,
      type: 'BOOKING_PAYMENT',
      amount: -5000,
      balanceAfter: 15000,
      description: 'Pago de reserva con créditos',
      createdAt: yesterday,
    },
  });

  console.log('4 demo transactions created');
  console.log('Final balance: $15.000');
  console.log('\nCredits seed completed!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
