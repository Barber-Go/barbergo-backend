/**
 * Env validation — BarberGo backend
 *
 * Util puro (sin dependencias de NestJS) que corre ANTES del contenedor Nest,
 * como primera línea ejecutable en bootstrap(). Aborta el proceso (exit 1)
 * si falta alguna env requerida o si hay incoherencia entre MP_ENV y el
 * prefijo de MP_ACCESS_TOKEN.
 *
 * NO loggea valores completos de secretos: solo presencia, y para tokens
 * conocidos (MP_ACCESS_TOKEN) el prefijo + últimos 4 chars.
 */

export type EnvRule = {
  name: string;
  required?: boolean;
  minLength?: number;
  allowed?: readonly string[];
  forbidden?: readonly (string | RegExp)[];
  pattern?: RegExp;
  errorHint?: string;
};

type Violation = {
  name: string;
  reason: string;
  hint?: string;
};

const REQUIRED_RULES: readonly EnvRule[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    errorHint:
      'set a valid postgres connection string (e.g. postgresql://user:pass@host:5432/db)',
  },
  {
    name: 'JWT_SECRET',
    required: true,
    minLength: 32,
    forbidden: [
      'change-me-in-production',
      'change-me-generate-with-openssl',
      /^<.*>$/,
    ],
    errorHint: 'generate with `openssl rand -hex 64`',
  },
  {
    name: 'JWT_EXPIRES_IN',
    required: true,
    errorHint: 'set a duration like "7d", "24h" or "3600s"',
  },
  {
    name: 'ENCRYPTION_KEY',
    required: true,
    minLength: 32,
    forbidden: ['change-me-generate-with-openssl', /^<.*>$/],
    errorHint: 'generate with `openssl rand -hex 32`',
  },
  {
    name: 'MP_ENV',
    required: true,
    allowed: ['sandbox', 'production'],
    errorHint: 'set to "sandbox" or "production"',
  },
  {
    name: 'TRANSBANK_ENV',
    required: true,
    allowed: ['integration', 'production'],
    errorHint: 'set to "integration" or "production"',
  },
];

const OPTIONAL_NAMES: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_AI_API_KEY',
  'SII_API_BASE_URL',
  'SII_API_TOKEN',
  'SII_CLAVE',
  'SII_EMISOR_RUT',
  'SII_RUT',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'FRONTEND_URL',
  'TRANSBANK_COMMERCE_CODE',
  'TRANSBANK_API_KEY',
  'SENTRY_DSN',
];

/**
 * Reglas opcionales que, si están presentes, deben cumplir un formato.
 * Si están ausentes o vacías, se ignoran (pasan).
 */
const OPTIONAL_RULES: readonly EnvRule[] = [
  {
    name: 'SENTRY_DSN',
    required: false,
    pattern: /^https:\/\/[^@]+@[^/]+\.ingest\.(us|de)\.sentry\.io\/\d+$/,
    errorHint:
      'expected https://<publicKey>@o<orgId>.ingest.<us|de>.sentry.io/<projectId>',
  },
];

/**
 * Aplica una regla individual. Devuelve un Violation si falla, null si pasa.
 * Exportado para testing.
 */
export function applyRule(
  rule: EnvRule,
  env: NodeJS.ProcessEnv,
): Violation | null {
  const raw = env[rule.name];
  const value = raw === undefined ? '' : raw;

  if (rule.required && value.length === 0) {
    return {
      name: rule.name,
      reason: 'missing or empty (required)',
      hint: rule.errorHint,
    };
  }

  // Si la regla es opcional y el valor está vacío, no corremos validaciones
  // de forma/contenido: ausencia = "no configurado" y pasa.
  if (!rule.required && value.length === 0) {
    return null;
  }

  // Chequeamos forbidden antes que minLength: un valor default/placeholder
  // como "change-me-in-production" suele ser corto, pero el mensaje
  // "forbidden literal" es más útil para el dev que "shorter than 32".
  if (rule.forbidden !== undefined) {
    for (const pattern of rule.forbidden) {
      if (typeof pattern === 'string') {
        if (value === pattern) {
          return {
            name: rule.name,
            reason: `value matches forbidden literal "${pattern}"`,
            hint: rule.errorHint,
          };
        }
      } else {
        if (pattern.test(value)) {
          return {
            name: rule.name,
            reason: `value matches forbidden pattern ${pattern.toString()}`,
            hint: rule.errorHint,
          };
        }
      }
    }
  }

  if (rule.minLength !== undefined && value.length < rule.minLength) {
    return {
      name: rule.name,
      reason: `value is shorter than ${rule.minLength} characters (found: ${value.length})`,
      hint: rule.errorHint,
    };
  }

  if (rule.allowed !== undefined && !rule.allowed.includes(value)) {
    return {
      name: rule.name,
      reason: `value "${value}" is not in allowed list [${rule.allowed.join(', ')}]`,
      hint: rule.errorHint,
    };
  }

  if (rule.pattern !== undefined && !rule.pattern.test(value)) {
    return {
      name: rule.name,
      reason: `value does not match expected pattern ${rule.pattern.toString()}`,
      hint: rule.errorHint,
    };
  }

  return null;
}

/**
 * Valida coherencia cruzada entre MP_ENV y MP_ACCESS_TOKEN.
 * Exportado para testing.
 */
export function checkCoherence(env: NodeJS.ProcessEnv): Violation[] {
  const violations: Violation[] = [];

  const mpEnv = env.MP_ENV ?? '';
  const mpToken = env.MP_ACCESS_TOKEN ?? '';

  if (mpEnv === 'production') {
    if (!mpToken.startsWith('APP_USR-')) {
      const gotPrefix = mpToken.length > 0 ? mpToken.split('-')[0] : '(empty)';
      violations.push({
        name: 'MP_ACCESS_TOKEN',
        reason: `MP_ENV=production requires token starting with 'APP_USR-', got prefix '${gotPrefix}-'`,
        hint: "use APP_USR-... token for production or switch MP_ENV=sandbox",
      });
    }
  } else if (mpEnv === 'sandbox') {
    if (!mpToken.startsWith('TEST-')) {
      const gotPrefix = mpToken.length > 0 ? mpToken.split('-')[0] : '(empty)';
      violations.push({
        name: 'MP_ACCESS_TOKEN',
        reason: `MP_ENV=sandbox requires token starting with 'TEST-', got prefix '${gotPrefix}-'`,
        hint: 'use TEST-... token for sandbox or switch MP_ENV=production',
      });
    }
  }

  return violations;
}

/**
 * Enmascara un token para logging. Muestra prefijo hasta el primer '-' +
 * últimos 4 chars. No debe loggearse el valor completo nunca.
 */
function maskToken(token: string): string {
  if (token.length === 0) return '(empty)';
  const dashIdx = token.indexOf('-');
  const prefix = dashIdx >= 0 ? token.slice(0, dashIdx) : token.slice(0, 4);
  const last4 = token.slice(-4);
  return `${prefix}-...${last4}`;
}

function printFailure(violations: readonly Violation[]): void {
  const lines: string[] = [];
  lines.push('[ENV VALIDATION FAILED]');
  for (const v of violations) {
    lines.push(`  x ${v.name}: ${v.reason}`);
  }
  const hints = violations.filter((v) => v.hint !== undefined);
  if (hints.length > 0) {
    lines.push('');
    lines.push('How to fix:');
    for (const v of hints) {
      lines.push(`  - ${v.name}: ${v.hint}`);
    }
  }
  lines.push('');
  lines.push('Aborting startup.');
  process.stderr.write(lines.join('\n') + '\n');
}

function printSuccess(env: NodeJS.ProcessEnv): void {
  const requiredCount = REQUIRED_RULES.length;
  const optionalPresent = OPTIONAL_NAMES.filter((name) => {
    const v = env[name];
    return v !== undefined && v.length > 0;
  });
  const optionalMissing = OPTIONAL_NAMES.filter((name) => {
    const v = env[name];
    return v === undefined || v.length === 0;
  });

  const lines: string[] = [];
  lines.push('[ENV VALIDATION OK]');
  lines.push(`  required: ${requiredCount}/${requiredCount} set`);
  lines.push(
    `  optional: ${optionalPresent.length}/${OPTIONAL_NAMES.length} set` +
      (optionalMissing.length > 0
        ? ` (missing: ${optionalMissing.join(', ')})`
        : ''),
  );
  lines.push(`  MP_ENV=${env.MP_ENV ?? ''}`);
  lines.push(`  TRANSBANK_ENV=${env.TRANSBANK_ENV ?? ''}`);
  const mpToken = env.MP_ACCESS_TOKEN ?? '';
  if (mpToken.length > 0) {
    lines.push(`  MP_ACCESS_TOKEN=${maskToken(mpToken)}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Valida las env vars requeridas y la coherencia cruzada.
 * En caso de error, imprime a stderr y termina el proceso con exit(1).
 * En caso de éxito, imprime un resumen a stdout.
 */
export function validateEnv(env: NodeJS.ProcessEnv): void {
  const violations: Violation[] = [];

  for (const rule of REQUIRED_RULES) {
    const violation = applyRule(rule, env);
    if (violation !== null) {
      violations.push(violation);
    }
  }

  // Opcionales con validación de formato: si ausentes, pasan; si presentes,
  // deben cumplir el pattern.
  for (const rule of OPTIONAL_RULES) {
    const violation = applyRule(rule, env);
    if (violation !== null) {
      violations.push(violation);
    }
  }

  // Coherencia cruzada se chequea siempre que MP_ENV sea un valor válido;
  // si MP_ENV ya falló la regla de allowed, no tiene sentido sumar ruido.
  const mpEnvValue = env.MP_ENV ?? '';
  const mpEnvValid = mpEnvValue === 'sandbox' || mpEnvValue === 'production';
  if (mpEnvValid) {
    violations.push(...checkCoherence(env));
  }

  if (violations.length > 0) {
    printFailure(violations);
    process.exit(1);
  }

  printSuccess(env);
}
