# BarberGo — Backend

## Stack
NestJS + TypeScript + Prisma v7 + PostgreSQL
Host: Railway — barbergo-backend-production.up.railway.app/api/v1
Path: ~/Desktop/barbergo-backend

## Deploy
cd ~/Desktop/barbergo-backend && railway up
Para ver logs: railway logs --tail 40
Shutdown al cerrar sesión: railway down -y

## Integraciones
SII BHE vía apigateway.cl
Token actual: dcdbd58d8932ae1f7afe67ef9e369c09a73dd99d
Proxy Railway: http://interchange.proxy.rlwy.net:44770
Formato body BHE: PascalCase SII (Encabezado, IdDoc, Emisor, Receptor, Detalle)
RUT sin puntos: 21387505-1 (NO 21.387.505-1)
TipoRetencion: 1 como integer

## 5 roles (enum UserRole)
CLIENT, BARBER_INDEPENDENT, BARBER_EMPLOYEE, BARBERSHOP_OWNER, ADMIN

## Reglas de comisiones
Independiente + IN_APP = 15% / Independiente + CASH = 0%
Barbería + IN_APP = 10% / Barbería + CASH = 0%
Snapshot financiero inmutable una vez creado

## Retención honorarios 2026
15.25% sobre monto bruto (vigente desde enero 2026)

## Reglas absolutas
- NUNCA any en TypeScript
- NUNCA endpoints sin guard (excepto auth/*)
- SIEMPRE validar DTOs con class-validator
- Formato respuesta: { data, message, statusCode }
- Cliente solo accede a SUS datos: where: { clientId: req.user.id }
- Credenciales SII cifradas con AES-256 antes de persistir

## Módulos activos
auth, barbers, barbershops, bookings, availability, portfolio,
commissions, finances, discovery, communities, follows,
notifications, reviews, settings, payments, sii, chat, ai-hairstyle
