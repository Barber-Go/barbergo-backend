# Barbershop Agenda — Architecture

## Business Rules

1. Barber employee inherits barbershop base schedule as default
2. Owner can override schedule per barber individually
3. App booking → slot auto-marked BOOKED
4. External booking → owner or barber creates ManualBooking
5. Cancel booking → slot returns to AVAILABLE
6. Employee can view their agenda + add manual bookings, but cannot change base schedule

## Schedule Resolution Order

For a given barber employee on a given day:
1. Check if barber has individual WeeklyAvailability → use it
2. If not → fall back to barbershop base schedule
3. Apply AvailabilityBlocks for that date (lunch, blocked, etc.)
4. Apply Bookings (app) for that date
5. Apply ManualBookings for that date
6. Remaining = AVAILABLE

## Existing Endpoints (no changes)

| Method | Route | Auth | Status |
|--------|-------|------|--------|
| GET | /agenda/:barberId/day?date= | Public | Done |
| GET | /agenda/:barberId/week?startDate= | Public | Done |
| POST | /manual-bookings | JWT | Done |
| GET | /manual-bookings/my?date= | JWT | Done |
| PATCH | /manual-bookings/:id | JWT | Done |
| DELETE | /manual-bookings/:id | JWT | Done |
| PATCH | /availability/me | JWT (barber) | Done |
| PATCH | /bookings/:id/status | JWT | Done |

## New Endpoints

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | /barbershops/me/schedule | JWT (owner) | Get barbershop base weekly schedule |
| PATCH | /barbershops/me/schedule | JWT (owner) | Update barbershop base schedule |
| PATCH | /barbershops/staff/:barberId/availability | JWT (owner) | Override individual barber schedule |

## Screens

### Barbershop Owner

| Screen | File | Status | Purpose |
|--------|------|--------|---------|
| Staff agenda | staff-agenda/[barberId].tsx | Exists | View/manage barber daily schedule |
| Barbershop schedule | availability/template.tsx | New | Base schedule for all barbers |

#### staff-agenda/[barberId].tsx — Enhancements
- Add "Configurar horario" button → modal with weekly blocks per day
- Slot tap → action sheet: Mark busy / Cancel / View detail
- Cancel booking → PATCH /bookings/:id/status { status: CANCELLED }
- Cancel manual → DELETE /manual-bookings/:id

#### availability/template.tsx — New
- 7 days listed with time blocks
- Each day: add/remove blocks (startTime — endTime)
- Save → PATCH /barbershops/me/schedule
- Applied to all barbers without individual override

### Barber Employee

| Screen | File | Status | Purpose |
|--------|------|--------|---------|
| My agenda | app/(barber-employee)/agenda.tsx | New | Read-only schedule + add manual bookings |

#### agenda.tsx — New
- Same week strip + daily slots as barber/agenda.tsx
- Fetches GET /agenda/:barberId/day?date=
- Can POST /manual-bookings (mark slots busy)
- Cannot modify weekly template (owner only)
- Cannot delete app bookings (owner only)

### Layout Changes

| File | Change |
|------|--------|
| app/(barber-employee)/_layout.tsx | Add agenda tab (replace or add) |
| app/(barbershop)/_layout.tsx | Add availability/template.tsx as hidden route |

## Implementation Phases

### Phase 1 — Backend: barbershop schedule endpoints
- GET/PATCH /barbershops/me/schedule in BarbershopsController
- Store as WeeklyAvailability rows with a barbershopId field
- OR store in BarbershopProfile as JSON scheduleBlocks
- PATCH /barbershops/staff/:barberId/availability in BarbershopsController

### Phase 2 — Backend: agenda resolution with fallback
- Update ManualBookingsService.getDayAgenda to check barbershop schedule
  when barber has no individual WeeklyAvailability AND has a barbershopId

### Phase 3 — Frontend: barber-employee agenda
- Create app/(barber-employee)/agenda.tsx (read-only + manual bookings)
- Update _layout.tsx to add agenda tab

### Phase 4 — Frontend: barbershop schedule editor
- Create app/(barbershop)/availability/template.tsx
- Add "Configurar horario" in staff-agenda/[barberId].tsx

### Phase 5 — Frontend: slot actions
- Slot tap → action sheet in staff-agenda
- Cancel booking / delete manual booking
- View booking detail modal

## Dependencies

- Phase 2 depends on Phase 1
- Phase 3 depends on Phase 2 (needs fallback logic)
- Phase 4 depends on Phase 1 (needs schedule endpoints)
- Phase 5 independent (uses existing endpoints)

## Checklist

### backend-agent
- [ ] GET /barbershops/me/schedule
- [ ] PATCH /barbershops/me/schedule
- [ ] PATCH /barbershops/staff/:barberId/availability
- [ ] getDayAgenda fallback to barbershop schedule

### frontend-barbershop-agent
- [ ] availability/template.tsx (barbershop schedule editor)
- [ ] staff-agenda enhancements (configure schedule, slot actions)

### frontend-barber-employee-agent
- [ ] agenda.tsx (read-only + manual bookings)
- [ ] _layout.tsx tab update
