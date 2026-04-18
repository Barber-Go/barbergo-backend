import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  BarbershopStatus,
  Role,
  BookingStatus,
  PaymentMethod,
  BarberEmploymentType,
} from '../src/generated/prisma/enums';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function seed() {
  const ownerEmail = 'renatocontreras@gmail.com';
  const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });

  if (!owner) {
    console.log(`Owner ${ownerEmail} no encontrado`);
    return;
  }

  console.log(`Owner: ${owner.email} (${owner.id})`);

  // ========================================
  // 1. ASEGURAR 2 BARBERÍAS
  // ========================================
  const existingShops = await prisma.barbershopProfile.findMany({
    where: { userId: owner.id },
  });

  console.log(`Barberías actuales: ${existingShops.length}`);

  let shop1: { id: string; name: string };
  let shop2: { id: string; name: string };

  // Shop 1: usar la primera existente y renombrar a Las Condes
  if (existingShops.length > 0) {
    shop1 = await prisma.barbershopProfile.update({
      where: { id: existingShops[0].id },
      data: {
        name: 'BarberGo Las Condes',
        address: 'Av. Apoquindo 4100, Las Condes',
        description: 'Sucursal Las Condes',
        phone: '+56 9 1234 5678',
        lat: -33.4103,
        lng: -70.5765,
        status: BarbershopStatus.ACTIVE,
      },
    });
    console.log(`Renombrada existente → BarberGo Las Condes (${shop1.id})`);
  } else {
    shop1 = await prisma.barbershopProfile.create({
      data: {
        userId: owner.id,
        name: 'BarberGo Las Condes',
        address: 'Av. Apoquindo 4100, Las Condes',
        description: 'Sucursal Las Condes',
        phone: '+56 9 1234 5678',
        lat: -33.4103,
        lng: -70.5765,
        status: BarbershopStatus.ACTIVE,
      },
    });
    console.log(`Creada: BarberGo Las Condes (${shop1.id})`);
  }

  // Shop 2: Peñaflor — crear si no existe ya una segunda
  const penaflor = existingShops.find((s) => s.name.includes('Peñaflor'));

  if (penaflor) {
    shop2 = penaflor;
    console.log(`Peñaflor ya existe (${shop2.id})`);
  } else {
    shop2 = await prisma.barbershopProfile.create({
      data: {
        userId: owner.id,
        name: 'BarberGo Peñaflor',
        address: 'Calle Principal 450, Peñaflor',
        description: 'Sucursal Peñaflor',
        phone: '+56 9 8765 4321',
        lat: -33.6103,
        lng: -70.8765,
        status: BarbershopStatus.ACTIVE,
      },
    });
    console.log(`Creada: BarberGo Peñaflor (${shop2.id})`);
  }

  // ========================================
  // 2. CREAR BARBEROS EMPLEADOS DE PRUEBA
  // ========================================
  const password = await bcrypt.hash('12345678', 10);

  const barberosData = [
    { email: 'carlos.lascondes@test.com', name: 'Carlos Martínez', shopId: shop1.id, split: 60 },
    { email: 'juan.lascondes@test.com', name: 'Juan Pérez', shopId: shop1.id, split: 60 },
    { email: 'diego.lascondes@test.com', name: 'Diego Rojas', shopId: shop1.id, split: 55 },
    { email: 'andres.penaflor@test.com', name: 'Andrés López', shopId: shop2.id, split: 60 },
    { email: 'pedro.penaflor@test.com', name: 'Pedro Silva', shopId: shop2.id, split: 65 },
  ];

  interface BarberInfo {
    email: string;
    name: string;
    shopId: string;
    split: number;
    userId: string;
    profileId: string;
    serviceId: string;
  }

  const createdBarbers: BarberInfo[] = [];

  for (const b of barberosData) {
    let user = await prisma.user.findUnique({ where: { email: b.email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: b.email,
          password,
          name: b.name,
          role: Role.BARBER_EMPLOYEE,
        },
      });
      console.log(`  Creado usuario: ${b.name}`);
    } else {
      console.log(`  Ya existe: ${b.name}`);
    }

    let profile = await prisma.barberProfile.findUnique({ where: { userId: user.id } });

    if (!profile) {
      profile = await prisma.barberProfile.create({
        data: {
          userId: user.id,
          barbershopId: b.shopId,
          employmentType: BarberEmploymentType.EMPLOYEE,
          bio: `Barbero profesional - ${b.shopId === shop1.id ? 'Las Condes' : 'Peñaflor'}`,
          commissionRate: b.split / 100,
        },
      });
      console.log(`  Creado perfil barbero: ${b.name}`);
    } else if (!profile.barbershopId) {
      await prisma.barberProfile.update({
        where: { id: profile.id },
        data: { barbershopId: b.shopId },
      });
    }

    // Create staff membership if not exists
    const existingMembership = await prisma.barbershopStaffMembership.findUnique({
      where: { barbershopId_barberProfileId: { barbershopId: b.shopId, barberProfileId: profile.id } },
    });
    if (!existingMembership) {
      const membership = await prisma.barbershopStaffMembership.create({
        data: {
          barbershopId: b.shopId,
          barberProfileId: profile.id,
          role: 'BARBER',
          isActive: true,
        },
      });
      await prisma.staffCompensationRule.create({
        data: {
          membershipId: membership.id,
          label: 'Comisión barbero',
          percentage: b.split,
          isActive: true,
        },
      });
      console.log(`  Membership creado: ${b.name} → ${b.shopId === shop1.id ? 'Las Condes' : 'Peñaflor'} (${b.split}%)`);
    }

    // Ensure at least one ServiceItem per barber (required FK for bookings)
    let service = await prisma.serviceItem.findFirst({
      where: { barberId: profile.id, isActive: true },
    });
    if (!service) {
      const services = [
        { name: 'Corte Clásico', price: 12000, duration: 30 },
        { name: 'Corte + Barba', price: 18000, duration: 45 },
        { name: 'Barba Completa', price: 8000, duration: 20 },
      ];
      for (const svc of services) {
        await prisma.serviceItem.create({
          data: {
            barberId: profile.id,
            name: svc.name,
            price: svc.price,
            durationMin: svc.duration,
          },
        });
      }
      service = await prisma.serviceItem.findFirst({
        where: { barberId: profile.id, isActive: true },
      });
      console.log(`  Servicios creados para ${b.name}`);
    }

    createdBarbers.push({
      ...b,
      userId: user.id,
      profileId: profile.id,
      serviceId: service!.id,
    });
  }

  // ========================================
  // 3. CREAR CLIENTE DE PRUEBA
  // ========================================
  let testClient = await prisma.user.findFirst({
    where: { role: Role.CLIENT },
  });

  if (!testClient) {
    testClient = await prisma.user.create({
      data: {
        email: 'cliente.seed@test.com',
        password,
        name: 'Cliente de Prueba',
        role: Role.CLIENT,
      },
    });
    await prisma.clientProfile.create({
      data: { userId: testClient.id },
    });
    console.log('  Creado cliente de prueba');
  }

  // ========================================
  // 4. CREAR BOOKINGS COMPLETADOS
  // ========================================
  const existingBookingsCount = await prisma.booking.count({
    where: { barbershopId: { in: [shop1.id, shop2.id] } },
  });

  console.log(`\nBookings existentes en las 2 barberías: ${existingBookingsCount}`);

  if (existingBookingsCount < 20) {
    console.log('Creando bookings de prueba (abril 2026)...');

    const today = new Date();
    const daysToSeed = today.getDate(); // days elapsed this month
    const serviceNames = ['Corte Clásico', 'Corte + Barba', 'Barba Completa'];
    const prices = [12000, 18000, 8000];

    let createdBookings = 0;

    for (let day = 1; day <= daysToSeed; day++) {
      // 2-4 bookings per day
      const bookingsThisDay = Math.floor(Math.random() * 3) + 2;

      for (let i = 0; i < bookingsThisDay; i++) {
        const barber = createdBarbers[Math.floor(Math.random() * createdBarbers.length)];
        const isInApp = Math.random() > 0.5;
        const priceIdx = Math.floor(Math.random() * prices.length);
        const grossAmount = prices[priceIdx];
        const platformFeePercent = isInApp ? 0.10 : 0;
        const platformFeeAmount = Math.round(grossAmount * platformFeePercent);
        const distributable = grossAmount - platformFeeAmount;
        const barberAmount = Math.round(distributable * (barber.split / 100));
        const shopAmt = distributable - barberAmount;

        const hour = 9 + Math.floor(Math.random() * 10); // 9-18
        const scheduledAt = new Date(today.getFullYear(), today.getMonth(), day, hour, 0);

        // Pick a random service from this barber
        const allServices = await prisma.serviceItem.findMany({
          where: { barberId: barber.profileId, isActive: true },
        });
        const svc = allServices[Math.floor(Math.random() * allServices.length)] || allServices[0];

        await prisma.booking.create({
          data: {
            clientId: testClient!.id,
            barberId: barber.profileId,
            serviceId: svc.id,
            barbershopId: barber.shopId,
            scheduledAt,
            status: BookingStatus.COMPLETED,
            paymentMethod: isInApp ? PaymentMethod.IN_APP : PaymentMethod.CASH,
            currency: 'CLP',
            // V1 fields (required)
            totalAmount: grossAmount,
            platformFee: platformFeeAmount,
            barberNet: barberAmount,
            // V2 snapshot
            grossAmount,
            platformFeePercent,
            distributableAmount: distributable,
            barberAmount,
            shopAmount: shopAmt,
            netPayoutToBarber: barberAmount,
            serviceSnapshot: {
              name: svc.name,
              price: Number(svc.price),
              durationMin: svc.durationMin,
            },
          },
        });
        createdBookings++;
      }
    }

    console.log(`Bookings creados: ${createdBookings}`);
  } else {
    console.log('Ya hay suficientes bookings, saltando creación');
  }

  // ========================================
  // 5. REPORTE FINAL
  // ========================================
  console.log('\n═══════════════════════════════════════');
  console.log('         RESUMEN FINAL');
  console.log('═══════════════════════════════════════');

  const finalShops = await prisma.barbershopProfile.findMany({
    where: { userId: owner.id },
  });

  console.log(`\nBarberías del owner: ${finalShops.length}`);

  for (const s of finalShops) {
    const staffCount = await prisma.barberProfile.count({
      where: { barbershopId: s.id },
    });
    const bookingsCount = await prisma.booking.count({
      where: { barbershopId: s.id, status: BookingStatus.COMPLETED },
    });
    const totalGross = await prisma.booking.aggregate({
      where: { barbershopId: s.id, status: BookingStatus.COMPLETED },
      _sum: { grossAmount: true },
    });
    const totalShopAmount = await prisma.booking.aggregate({
      where: { barbershopId: s.id, status: BookingStatus.COMPLETED },
      _sum: { shopAmount: true },
    });
    const byPayment = await prisma.booking.groupBy({
      by: ['paymentMethod'],
      where: { barbershopId: s.id, status: BookingStatus.COMPLETED },
      _count: true,
      _sum: { grossAmount: true },
    });

    console.log(`\n  📍 ${s.name}`);
    console.log(`     ID: ${s.id}`);
    console.log(`     Status: ${s.status}`);
    console.log(`     Barberos: ${staffCount}`);
    console.log(`     Bookings COMPLETED: ${bookingsCount}`);
    console.log(`     Total bruto: $${Number(totalGross._sum.grossAmount || 0).toLocaleString('es-CL')} CLP`);
    console.log(`     Ganancia barbería: $${Number(totalShopAmount._sum.shopAmount || 0).toLocaleString('es-CL')} CLP`);
    console.log(`     Por método de pago:`);
    for (const pm of byPayment) {
      console.log(`       ${pm.paymentMethod}: ${pm._count} bookings — $${Number(pm._sum.grossAmount || 0).toLocaleString('es-CL')}`);
    }
  }
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
