# Tax Module Architecture — BarberGo

## Overview
Optional premium module for barbers and barbershop owners to manage tax obligations (BHE, F29, etc.) directly from BarberGo.

## Database
- `users.taxModuleEnabled` — Boolean, default false
- `users.taxModuleActivatedAt` — DateTime, set when first enabled

## API Endpoints
- `GET /auth/me/tax-status` — returns { enabled, activatedAt, hasCredentials }
- `PATCH /auth/me/tax-module` — body { enabled: boolean }

## Activation Flow
1. User registers as BARBER_INDEPENDENT or BARBERSHOP_OWNER
2. Onboarding asks "Gestionas tus impuestos?" (optional slide)
3. User can activate/deactivate from profile at any time
4. When activated: gestion screen shows full SII module
5. When deactivated: gestion screen shows TaxModuleBanner to re-activate
6. Credentials (RUT + clave SII) persist even when module is disabled

## UI Components
- `TaxModuleBanner` — toggle card with premium Uber Black styling
- Barber profile: banner before logout section
- Barbershop profile: banner before logout section
- Barber gestion: conditional rendering based on taxModuleEnabled
- Barbershop gestion: conditional rendering based on taxModuleEnabled

## Roles
- CLIENT: no tax module (not shown)
- BARBER_EMPLOYEE: no tax module (employer handles taxes)
- BARBER_INDEPENDENT: full BHE module
- BARBERSHOP_OWNER: full BHE + future DTE module
