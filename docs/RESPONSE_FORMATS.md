# API Response Formats

## Standard format (new endpoints)

All new endpoints use the wrapped format:

```json
{
  "data": { ... },
  "message": "OK",
  "statusCode": 200
}
```

## Legacy endpoints (unwrapped)

These older endpoints return raw data for backward compatibility.
Frontend consumes them directly via `res.data` (no `.data.data`).

| Endpoint | Returns |
|----------|---------|
| `POST /auth/login` | `{ token, user }` |
| `POST /auth/register` | `{ token, user }` |
| `GET /auth/me` | `{ id, name, email, role, ... }` |
| `GET /auth/me/tax-status` | `{ enabled, activatedAt, hasCredentials }` |
| `GET /bookings/mine` | `Booking[]` |
| `GET /barbers/me` | `{ id, name, services, ... }` |
| `GET /barbershops/me` | `BarbershopProfile[]` |

Do not wrap these without also updating all frontend consumers.
