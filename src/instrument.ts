import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;

if (!dsn) {
  // Fail-safe: sin DSN no inicializamos. Warning solo fuera de test.
  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn('[Sentry] SENTRY_DSN no seteado — Sentry desactivado en este proceso.');
  }
} else {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    beforeSend(event) {
      // Scrubbing de datos sensibles antes de enviar a Sentry
      if (event.request?.data && typeof event.request.data === 'object' && event.request.data !== null) {
        const data = event.request.data as Record<string, unknown>;
        delete data.password;
        delete data.token;
        delete data.claveTributaria;
        delete data.siiClave;
        delete data.pfxPassword;
      }
      if (event.request?.headers && typeof event.request.headers === 'object') {
        const headers = event.request.headers as Record<string, unknown>;
        delete headers['authorization'];
        delete headers['Authorization'];
        delete headers['cookie'];
        delete headers['Cookie'];
      }
      return event;
    },
  });
}
