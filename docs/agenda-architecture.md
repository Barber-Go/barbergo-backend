# Agenda Flexible — Architecture

## Existing Models (no changes needed)

### WeeklyAvailability (plantilla semanal)
Already exists in `availabilities` table:
- barberId, dayOfWeek (0-6), startTime, endTime, isActive
- @@unique([barberId, dayOfWeek])

### AvailabilityBlock (bloques especificos)
Already exists in `availability_blocks` table:
- barberId, type (BlockType enum), label, startAt, endAt
- BlockType: LUNCH | ERRAND | PERSONAL | VACATION | DAY_OFF | CUSTOM

### Booking (reservas por la app)
Already exists — scheduledAt, status, barberId, clientId, serviceId

## New Model: ManualBooking

```prisma
model ManualBooking {
  id            String   @id @default(cuid())
  barberId      String
  clientName    String?
  serviceName   String?
  date          DateTime @db.Date
  startTime     String   // "09:00"
  endTime       String   // "09:30"
  note          String?
  paymentMethod String   @default("CASH") // APP | CASH | EXTERNAL | NONE
  barbershopId  String?
  createdAt     DateTime @default(now())

  barber    BarberProfile     @relation(fields: [barberId], references: [id], onDelete: Cascade)
  barbershop BarbershopProfile? @relation(fields: [barbershopId], references: [id])

  @@map("manual_bookings")
}
```

## Agenda Logic

### Loading a day's schedule:
1. Get WeeklyAvailability for that dayOfWeek → base available slots
2. Get AvailabilityBlocks for that date → overrides (lunch, blocked, etc.)
3. Get Bookings where scheduledAt is that date + barberId → app bookings
4. Get ManualBookings where date = that date + barberId → manual bookings
5. Merge: available slots minus blocks minus bookings minus manual = free slots

### Slot states:
- AVAILABLE: open slot from weekly template, no conflicts
- BOOKED_APP: has a Booking (white indicator)
- BOOKED_MANUAL: has a ManualBooking (grey indicator)
- BLOCKED: has an AvailabilityBlock (dark indicator)

## Endpoints

### Existing (keep as-is)
- GET /availability/:barberId/:year/:month → bookable dates
- GET /availability/:barberId/slots?date=YYYY-MM-DD → available slots
- PATCH /availability/me → update weekly template

### New Endpoints

#### Agenda view
```
GET /availability/:barberId/agenda?date=YYYY-MM-DD
→ {
    date, dayOfWeek,
    template: { startTime, endTime }[],
    blocks: { id, type, label, startAt, endAt }[],
    bookings: { id, scheduledAt, status, client, service }[],
    manualBookings: { id, clientName, startTime, endTime, note }[],
    slots: { time: "09:00", status: "AVAILABLE"|"BOOKED_APP"|"BOOKED_MANUAL"|"BLOCKED", ref?: string }[]
  }
```

#### Manual bookings
```
POST /manual-bookings
Body: { barberId, clientName?, serviceName?, date, startTime, endTime, note?, paymentMethod }
Auth: JWT (barber or barbershop owner)

GET /manual-bookings?barberId=X&date=YYYY-MM-DD
Auth: JWT

PATCH /manual-bookings/:id
Body: { clientName?, serviceName?, startTime?, endTime?, note? }

DELETE /manual-bookings/:id
```

#### Blocks (already partially implemented)
```
POST /availability/blocks
Body: { date, startTime, endTime, type, label? }
Auth: JWT (barber)

DELETE /availability/blocks/:id
Auth: JWT (barber)
```

## Screens

### Barber Independent

| Screen | File | Purpose |
|--------|------|---------|
| Agenda | app/(barber)/agenda.tsx | Weekly view + daily detail |
| Day edit | app/(barber)/availability/[date].tsx | Edit blocks for specific date |
| Template | app/(barber)/availability/template.tsx | Edit weekly template |
| Profile | app/(barber)/profile.tsx | Add portfolio section (collapse) |

### Barbershop Owner

| Screen | File | Purpose |
|--------|------|---------|
| Staff agenda | app/(barbershop)/staff.tsx | Select barber → see their agenda |
| Gestion | app/(barbershop)/gestion.tsx | Add finances tab/section |

## Implementation Order

### Phase 1 — db-agent
- Add ManualBooking model to schema.prisma
- Add relation to BarberProfile and BarbershopProfile
- Migration: npx prisma migrate dev --name add_manual_bookings
- Generate client

### Phase 2 — backend-agent
- Create src/manual-bookings/ module (controller, service, DTOs)
- Add GET /availability/:barberId/agenda endpoint to availability service
- Register ManualBookingsModule in AppModule

### Phase 3 — frontend-barber-agent
- Create app/(barber)/agenda.tsx — weekly strip + daily slots
- Create app/(barber)/availability/[date].tsx — edit day blocks
- Create app/(barber)/availability/template.tsx — edit weekly template
- Update _layout.tsx to replace portfolio tab with agenda tab
- Move portfolio into profile.tsx as collapsible section

### Phase 4 — frontend-barbershop-agent
- Update staff.tsx — barber selector + agenda view
- Update gestion.tsx — add finances section

### Phase 5 — design-agent
- Agenda slot design: available (gold outline), booked (white), manual (grey), blocked (dark)
- Modal for adding manual booking
- Template editor UX

## Dependencies
- Phase 2 depends on Phase 1 (needs ManualBooking model)
- Phase 3 depends on Phase 2 (needs agenda endpoint)
- Phase 4 depends on Phase 3 (reuses agenda components)
- Phase 5 runs in parallel with Phase 3-4

## Checklist per agent

### db-agent
- [ ] Add ManualBooking model
- [ ] Add relations to BarberProfile, BarbershopProfile
- [ ] Run migration
- [ ] Generate Prisma client

### backend-agent
- [ ] ManualBookingsController: POST, GET, PATCH, DELETE
- [ ] ManualBookingsService: CRUD + validation
- [ ] GET /availability/:barberId/agenda endpoint
- [ ] Register module in AppModule
- [ ] JWT guards on all endpoints

### frontend-barber-agent
- [ ] agenda.tsx: week strip, day view, slot grid
- [ ] availability/[date].tsx: block editor
- [ ] availability/template.tsx: weekly template
- [ ] Update _layout.tsx: agenda tab
- [ ] Move portfolio to profile section

### frontend-barbershop-agent
- [ ] staff.tsx: barber picker + agenda
- [ ] gestion.tsx: finances integration

### design-agent
- [ ] Slot color system
- [ ] Add manual booking modal
- [ ] Template editor
- [ ] Premium animations for slot transitions
