# BarberGo — Backend (NestJS)

## Contexto del proyecto

BarberGo es una plataforma chilena de reservas de barberos y barberías con gestión tributaria integrada. Este repositorio contiene el backend NestJS + Prisma + PostgreSQL que deploya en Railway.

- **Documentación maestra:** ver los 4 archivos de la "Biblia de BarberGo" que contienen visión completa, arquitectura, plan de ejecución y runbooks.
- **Repositorio hermano:** mobile en `~/Desktop/barbergo-mobile/` (React Native + Expo).
- **Admin web (futuro):** `~/Desktop/barbergo-admin/` (Next.js + shadcn/ui).

## Stack

- NestJS 10 + TypeScript 5
- Prisma v7 + PostgreSQL (Railway)
- JWT + Passport + Guards
- Pino para logs estructurados
- Sentry para error tracking
- Redis para cache y rate limiting

## Comandos importantes

```bash
# Development
npm run start:dev

# Build check
npx tsc --noEmit

# Prisma
npx prisma migrate dev --name descriptive_name
npx prisma generate
npx prisma migrate status
npx prisma studio

# Deploy
railway up

# Logs
railway logs --tail 100
```

## URL producción

`https://barbergo-backend-production.up.railway.app/api/v1`

## Los 5 roles del sistema

1. **CLIENT** — cliente que reserva
2. **BARBER_INDEPENDENT** — barbero por cuenta propia
3. **BARBER_EMPLOYEE** — barbero dentro de una barbería
4. **BARBERSHOP_OWNER** — dueño de barbería
5. **ADMIN** — personal BarberGo (único rol admin en el schema actual)

## Reglas absolutas no negociables

- **NUNCA** `any` en TypeScript. Si es desconocido, usar `unknown` + narrowing.
- **NUNCA** hardcodear credenciales. Todo via `process.env` + `ConfigService`.
- **SIEMPRE** guards en endpoints autenticados: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
- **SIEMPRE** DTOs con class-validator para todos los inputs.
- **SIEMPRE** validar ownership (no basta con el rol, verificar que el usuario sea dueño del recurso).
- **SIEMPRE** transacciones atómicas para operaciones multi-tabla.
- **SIEMPRE** formato respuesta estándar: `{ data, message, statusCode }`.
- **SIEMPRE** logs estructurados con `event:` como key principal.
- **SIEMPRE** actualizar `.env.example` cuando agregas env var nueva.
- **NUNCA** ejecutar `prisma migrate reset` en producción.
- **NUNCA** hacer `prisma db push` sin generar migración.
- Snapshots financieros en bookings son **inmutables** — nunca recalcular retroactivamente.

## Sistema de agentes

El repo tiene agentes en `.claude/agents/`. Se invocan explícitamente en los prompts.

**Agentes disponibles:**
- `architect.md` — planificación arquitectural (features grandes)
- `design-agent.md` — sistema de diseño visual
- `db-schema.md` — cambios de schema Prisma y migraciones
- `backend-feature.md` — módulos NestJS y endpoints
- `ops.md` — deploys, secretos, observabilidad, CI/CD

**Cómo invocar un agente:**
```
Usa el agente [nombre]. Lee .claude/agents/[nombre].md antes de empezar.
```

**Regla:** un agente por tarea. Si la tarea abarca varios dominios (schema + endpoint + pantalla), se divide en tareas secuenciales, cada una con su agente.

## Credenciales de prueba

- Cliente: `cliente@test.com` / `12345678`
- Barbero independiente: `barbero@test.com` / `12345678`
- Barbero 2: `barbero2@test.com` / `12345678`
- Dueño barbería: `renacontrerasmadriaga@gmail.com` / (real)

## Módulos existentes (no recrear)

auth, barbers, barbershops, bookings, commissions, cancellations, credits, availability, portfolio, reviews, notifications, chat, tips, reports, ai-style, sii, tax-compliance, discovery, finances, billing, communities, follows, settings, points, payments, manual-bookings, storage, push, barber-employee.

Para un módulo nuevo, usar el agente `backend-feature`.

## Integraciones externas

**Activas y en uso:**
- apigateway.cl (SII BHE) — folios reales emitidos
- Claude API (Anthropic) — AI Estilos
- Webpay (Transbank) — sandbox
- Mercado Pago — flow principal actual
- Cloudinary — configurado, poco uso real

**Por configurar:**
- Sentry (observabilidad)
- Resend (email transaccional)
- Twilio (SMS)
- WhatsApp Business Cloud API
- Meta Pixel + CAPI
- Mixpanel (analytics)

## Zona y timezone

- Zona inicial: Santiago, sector oriente (Las Condes, Vitacura, Lo Barnechea, Providencia, Ñuñoa, La Reina)
- Timezone: `America/Santiago`
- Moneda: `CLP`
- País default: `CL`

## Deploy checklist

Antes de cada `railway up`:
- [ ] `npx tsc --noEmit` pasa sin errores
- [ ] No hay secretos hardcodeados
- [ ] `.env.example` actualizado si hubo vars nuevas
- [ ] `prisma migrate status` limpio si hubo cambios de schema
- [ ] Commits con mensaje descriptivo (Conventional Commits)

Después de deploy:
- [ ] `railway logs --tail 100` revisado
- [ ] Health check con curl
- [ ] Sentry no reporta errores nuevos

## Cuando pierdas este chat

Los 4 archivos de la Biblia + las 3 auditorías de Claude Code (backend, mobile, integraciones) te permiten continuar en cualquier chat nuevo. Ver Parte 0, sección 0.4 de la Biblia Archivo 1.
