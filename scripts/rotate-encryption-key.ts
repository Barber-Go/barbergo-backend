/* eslint-disable no-console */
/**
 * scripts/rotate-encryption-key.ts
 *
 * One-shot script to rotate `ENCRYPTION_KEY` by decrypting all AES-256-GCM
 * payloads currently stored with the OLD key and re-encrypting them with the
 * NEW key — inside a single Postgres transaction with post-write verification
 * and hard rollback on any failure.
 *
 * Target columns (see plan 0.4-part2-encryption-rotation.md §3):
 *   - barbers.claveTributaria        (BarberProfile.claveTributaria)
 *   - tax_profiles.siiClaveEncrypted (TaxProfile.siiClaveEncrypted)
 *   - tax_profiles.pfxPassword       (TaxProfile.pfxPassword)
 *
 * IMPORTANT: the crypto helpers are DELIBERATELY duplicated from
 * `src/shared/crypto.utils.ts` (not imported). Rationale documented in §2
 * of the plan: the runtime helper reads `process.env.ENCRYPTION_KEY`; passing
 * the key as an explicit Buffer argument rules out any possibility of the
 * script operating with the wrong key due to a shell/env bug.
 *
 * This script is NEVER included in the Railway build:
 *   - `nest-cli.json` has `sourceRoot: src`, so `nest build` ignores `scripts/`.
 *   - `tsconfig.build.json` only compiles files reachable from `src/`.
 *
 * Exit codes:
 *   0  → OK (apply success, or dry-run completed with expected rollback)
 *   10 → ROLLED_BACK (real error inside the tx forced a rollback in apply mode)
 *   20 → MISCONFIG (invalid env vars, equal keys, unsafe DB, etc.)
 *   30 → ABORTED_BY_USER (SIGINT captured cleanly)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type EncryptedPacked = string; // "ivHex:authTagHex:ciphertextHex"

export type Mode = 'dry-run' | 'apply';

export interface RotationCounts {
  barbers_claveTributaria: number;
  tax_profiles_siiClaveEncrypted: number;
  tax_profiles_pfxPassword: number;
}

export interface RotationSummary {
  mode: Mode;
  rowsMigrated: number;
  rowsSkipped: number;
  rowsFailed: number;
  elapsedMs: number;
  preCounts: RotationCounts;
  postCounts: RotationCounts;
}

// Sentinel to force rollback at end of a dry-run transaction.
export class DryRunRollback extends Error {
  constructor() {
    super('DRY_RUN_ROLLBACK');
    this.name = 'DryRunRollback';
  }
}

// Cooperative cancellation flag: set by SIGINT handler once the tx is running.
// The loop inside the tx checks it between rows and throws to trigger rollback.
let aborted = false;
let txStarted = false;

// ────────────────────────────────────────────────────────────────────────────
// Crypto helpers (duplicated, key passed explicitly as Buffer)
// ────────────────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(
      `invalid key: expected 32-byte Buffer, got length=${
        Buffer.isBuffer(key) ? key.length : 'not-a-buffer'
      }`,
    );
  }
}

function assertPackedShape(packed: string): [string, string, string] {
  if (typeof packed !== 'string' || packed.length === 0) {
    throw new Error('invalid packed ciphertext: empty or not a string');
  }
  const parts = packed.split(':');
  if (parts.length !== 3) {
    throw new Error(
      `invalid packed ciphertext: expected 3 segments separated by ":", got ${parts.length}`,
    );
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(authTagHex) || !/^[0-9a-f]*$/i.test(ciphertextHex)) {
    throw new Error('invalid packed ciphertext: non-hex segment');
  }
  return [ivHex, authTagHex, ciphertextHex];
}

export function encryptWith(key: Buffer, plaintext: string): EncryptedPacked {
  assertKey(key);
  if (typeof plaintext !== 'string') {
    throw new Error('encryptWith: plaintext must be a string');
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptWith(key: Buffer, packed: EncryptedPacked): string {
  assertKey(key);
  const [ivHex, authTagHex, ciphertextHex] = assertPackedShape(packed);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function tryDecryptWith(key: Buffer, packed: EncryptedPacked): string | null {
  try {
    return decryptWith(key, packed);
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Env var parsing (isolated for testability)
// ────────────────────────────────────────────────────────────────────────────

export interface ParsedConfig {
  oldKey: Buffer;
  newKey: Buffer;
  mode: Mode;
  forceLocal: boolean;
}

export class MisconfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MisconfigError';
  }
}

function isHex64(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function parseEnv(env: NodeJS.ProcessEnv): ParsedConfig {
  const oldHex = env.ENCRYPTION_KEY_OLD;
  const newHex = env.ENCRYPTION_KEY_NEW;
  const rawMode = env.MODE ?? 'dry-run';
  const forceLocal = env.FORCE_LOCAL === 'true';

  if (!isHex64(oldHex)) {
    throw new MisconfigError(
      'ENCRYPTION_KEY_OLD must be exactly 64 hex chars (32 bytes)',
    );
  }
  if (!isHex64(newHex)) {
    throw new MisconfigError(
      'ENCRYPTION_KEY_NEW must be exactly 64 hex chars (32 bytes)',
    );
  }
  if (oldHex.toLowerCase() === newHex.toLowerCase()) {
    throw new MisconfigError(
      'ENCRYPTION_KEY_OLD and ENCRYPTION_KEY_NEW must be different',
    );
  }
  if (rawMode !== 'dry-run' && rawMode !== 'apply') {
    throw new MisconfigError(
      `MODE must be "dry-run" or "apply" (got "${rawMode}")`,
    );
  }
  if (!env.DATABASE_URL || env.DATABASE_URL.length === 0) {
    throw new MisconfigError('DATABASE_URL is required');
  }

  return {
    oldKey: Buffer.from(oldHex, 'hex'),
    newKey: Buffer.from(newHex, 'hex'),
    mode: rawMode,
    forceLocal,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Prisma transactional client type
// ────────────────────────────────────────────────────────────────────────────

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ────────────────────────────────────────────────────────────────────────────
// Row processing — exported so unit tests can exercise it with mocks
// ────────────────────────────────────────────────────────────────────────────

export interface RowDelegate {
  findMany(args: unknown): Promise<Array<{ id: string } & Record<string, unknown>>>;
  findUnique(args: unknown): Promise<(Record<string, unknown> & { id?: string }) | null>;
  update(args: unknown): Promise<unknown>;
}

export interface RotateRowsInput {
  tableLabel: string;
  fieldName: string;
  rows: Array<{ id: string; cipher: string }>;
  oldKey: Buffer;
  newKey: Buffer;
  mode: Mode;
  // update + re-read are delegated because Prisma's typed delegates are not
  // trivially mockable with a single shared signature. The caller passes
  // adapters that match the specific delegate (barberProfile, taxProfile).
  updateRow: (id: string, newCipher: string) => Promise<void>;
  reReadCipher: (id: string) => Promise<string | null>;
  log: (msg: string) => void;
  isAborted: () => boolean;
}

export interface RotateRowsResult {
  migrated: number;
  skipped: number;
}

/**
 * Core per-table rotation logic. Pure enough to unit-test with fixtures and
 * mocks — does no Prisma calls directly, everything is injected.
 *
 * Throws on:
 *   - decrypt failure with OLD key on a row not already re-encrypted
 *   - verification mismatch after update
 *   - cooperative abort flag
 */
export async function rotateRows(input: RotateRowsInput): Promise<RotateRowsResult> {
  let migrated = 0;
  let skipped = 0;

  for (const row of input.rows) {
    if (input.isAborted()) {
      throw new Error('aborted by user (SIGINT)');
    }

    const idShort = row.id.slice(0, 8);

    // A. Idempotency guard
    const alreadyNew = tryDecryptWith(input.newKey, row.cipher);
    if (alreadyNew !== null) {
      skipped += 1;
      input.log(`${input.tableLabel} id=${idShort} already NEW, skip`);
      continue;
    }

    // B. Decrypt with OLD
    let plaintext: string;
    try {
      plaintext = decryptWith(input.oldKey, row.cipher);
    } catch (err) {
      throw new Error(
        `decrypt-with-OLD failed for ${input.tableLabel} id=${idShort}: ${(err as Error).message}`,
      );
    }

    // C. Encrypt with NEW
    const newCipher = encryptWith(input.newKey, plaintext);

    if (input.mode === 'apply') {
      // D. Update
      await input.updateRow(row.id, newCipher);

      // E. Re-read inside tx
      const reread = await input.reReadCipher(row.id);
      if (reread === null) {
        throw new Error(
          `re-read returned null for ${input.tableLabel} id=${idShort}`,
        );
      }

      // F. Verify decrypt with NEW equals original plaintext
      let verified: string;
      try {
        verified = decryptWith(input.newKey, reread);
      } catch (err) {
        throw new Error(
          `post-write decrypt failed for ${input.tableLabel} id=${idShort}: ${(err as Error).message}`,
        );
      }
      if (verified !== plaintext) {
        throw new Error(
          `verification failed for ${input.tableLabel} id=${idShort}: re-read cipher does not round-trip to original plaintext`,
        );
      }

      input.log(`${input.tableLabel} id=${idShort} re-encrypted OK`);
    } else {
      input.log(`${input.tableLabel} id=${idShort} would be re-encrypted`);
    }

    migrated += 1;
  }

  return { migrated, skipped };
}

// ────────────────────────────────────────────────────────────────────────────
// Pre/post count queries
// ────────────────────────────────────────────────────────────────────────────

async function countNotNulls(tx: TxClient): Promise<RotationCounts> {
  const [b, t1, t2] = await Promise.all([
    tx.barberProfile.count({ where: { claveTributaria: { not: null } } }),
    tx.taxProfile.count({ where: { siiClaveEncrypted: { not: null } } }),
    tx.taxProfile.count({ where: { pfxPassword: { not: null } } }),
  ]);
  return {
    barbers_claveTributaria: b,
    tax_profiles_siiClaveEncrypted: t1,
    tax_profiles_pfxPassword: t2,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ────────────────────────────────────────────────────────────────────────────

function safeLog(msg: string): void {
  // Stdout only. Never include plaintext or ciphertext payloads here.
  console.log(`[rotate-key] ${msg}`);
}

function safeErr(msg: string): void {
  console.error(`[rotate-key] ${msg}`);
}

export interface MainResult {
  exitCode: 0 | 10 | 20 | 30;
  summary?: RotationSummary;
}

export async function runRotation(
  prisma: PrismaClient,
  cfg: ParsedConfig,
): Promise<RotationSummary> {
  // Pre-check DB name
  const dbRows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() as db`;
  const dbName = dbRows[0]?.db ?? '<unknown>';
  safeLog(`connected to DB: "${dbName}"`);

  const looksLocal =
    dbName.toLowerCase().includes('test') || dbName.toLowerCase().includes('local');
  if (looksLocal && !cfg.forceLocal) {
    throw new MisconfigError(
      `SAFETY: refusing to run against DB "${dbName}" without FORCE_LOCAL=true`,
    );
  }

  // Pre-counts (outside tx — cheap, informational).
  const preCounts = await countNotNulls(prisma as unknown as TxClient);
  safeLog(`pre-counts: ${JSON.stringify(preCounts)}`);

  const start = Date.now();
  let migrated = 0;
  let skipped = 0;

  const runInsideTx = async (tx: TxClient): Promise<void> => {
    txStarted = true;

    // ── barbers.claveTributaria ──
    const barberRows = await tx.barberProfile.findMany({
      where: { claveTributaria: { not: null } },
      select: { id: true, claveTributaria: true },
    });
    const barberInput: Array<{ id: string; cipher: string }> = barberRows
      .filter((r): r is { id: string; claveTributaria: string } => typeof r.claveTributaria === 'string')
      .map((r) => ({ id: r.id, cipher: r.claveTributaria }));

    const r1 = await rotateRows({
      tableLabel: 'barbers.claveTributaria',
      fieldName: 'claveTributaria',
      rows: barberInput,
      oldKey: cfg.oldKey,
      newKey: cfg.newKey,
      mode: cfg.mode,
      log: safeLog,
      isAborted: () => aborted,
      updateRow: async (id, newCipher) => {
        await tx.barberProfile.update({
          where: { id },
          data: { claveTributaria: newCipher },
        });
      },
      reReadCipher: async (id) => {
        const row = await tx.barberProfile.findUnique({
          where: { id },
          select: { claveTributaria: true },
        });
        return row?.claveTributaria ?? null;
      },
    });
    migrated += r1.migrated;
    skipped += r1.skipped;

    // ── tax_profiles.siiClaveEncrypted ──
    const siiRows = await tx.taxProfile.findMany({
      where: { siiClaveEncrypted: { not: null } },
      select: { id: true, siiClaveEncrypted: true },
    });
    const siiInput: Array<{ id: string; cipher: string }> = siiRows
      .filter((r): r is { id: string; siiClaveEncrypted: string } => typeof r.siiClaveEncrypted === 'string')
      .map((r) => ({ id: r.id, cipher: r.siiClaveEncrypted }));

    const r2 = await rotateRows({
      tableLabel: 'tax_profiles.siiClaveEncrypted',
      fieldName: 'siiClaveEncrypted',
      rows: siiInput,
      oldKey: cfg.oldKey,
      newKey: cfg.newKey,
      mode: cfg.mode,
      log: safeLog,
      isAborted: () => aborted,
      updateRow: async (id, newCipher) => {
        await tx.taxProfile.update({
          where: { id },
          data: { siiClaveEncrypted: newCipher },
        });
      },
      reReadCipher: async (id) => {
        const row = await tx.taxProfile.findUnique({
          where: { id },
          select: { siiClaveEncrypted: true },
        });
        return row?.siiClaveEncrypted ?? null;
      },
    });
    migrated += r2.migrated;
    skipped += r2.skipped;

    // ── tax_profiles.pfxPassword ──
    const pfxRows = await tx.taxProfile.findMany({
      where: { pfxPassword: { not: null } },
      select: { id: true, pfxPassword: true },
    });
    const pfxInput: Array<{ id: string; cipher: string }> = pfxRows
      .filter((r): r is { id: string; pfxPassword: string } => typeof r.pfxPassword === 'string')
      .map((r) => ({ id: r.id, cipher: r.pfxPassword }));

    const r3 = await rotateRows({
      tableLabel: 'tax_profiles.pfxPassword',
      fieldName: 'pfxPassword',
      rows: pfxInput,
      oldKey: cfg.oldKey,
      newKey: cfg.newKey,
      mode: cfg.mode,
      log: safeLog,
      isAborted: () => aborted,
      updateRow: async (id, newCipher) => {
        await tx.taxProfile.update({
          where: { id },
          data: { pfxPassword: newCipher },
        });
      },
      reReadCipher: async (id) => {
        const row = await tx.taxProfile.findUnique({
          where: { id },
          select: { pfxPassword: true },
        });
        return row?.pfxPassword ?? null;
      },
    });
    migrated += r3.migrated;
    skipped += r3.skipped;

    // Force rollback in dry-run after processing all 3 tables cleanly.
    if (cfg.mode === 'dry-run') {
      throw new DryRunRollback();
    }
  };

  try {
    await prisma.$transaction(runInsideTx, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 45_000,
      maxWait: 10_000,
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      safeLog('DRY RUN: rollback forced as expected');
    } else {
      throw err;
    }
  }

  // Post-counts (outside tx, after commit/rollback).
  const postCounts = await countNotNulls(prisma as unknown as TxClient);
  const elapsedMs = Date.now() - start;

  return {
    mode: cfg.mode,
    rowsMigrated: migrated,
    rowsSkipped: skipped,
    rowsFailed: 0,
    elapsedMs,
    preCounts,
    postCounts,
  };
}

async function main(): Promise<MainResult> {
  // Parse env first — exit 20 if invalid
  let cfg: ParsedConfig;
  try {
    cfg = parseEnv(process.env);
  } catch (err) {
    if (err instanceof MisconfigError) {
      safeErr(`MISCONFIG: ${err.message}`);
      return { exitCode: 20 };
    }
    throw err;
  }

  safeLog(`mode=${cfg.mode} forceLocal=${cfg.forceLocal}`);

  // SIGINT handler (registered before we open any tx)
  const sigintHandler = (): void => {
    if (!txStarted) {
      safeErr('aborted by user before tx start');
      process.exit(30);
    }
    aborted = true;
    safeErr('SIGINT received — will trigger rollback at next row boundary');
  };
  process.on('SIGINT', sigintHandler);

  const connectionString = process.env.DATABASE_URL;
  // parseEnv already validated DATABASE_URL is non-empty.
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter, log: ['warn', 'error'] });

  try {
    const summary = await runRotation(prisma, cfg);
    safeLog(`summary: ${JSON.stringify(summary)}`);

    if (cfg.mode === 'apply') {
      safeLog(
        `ROTATION COMPLETED: ${summary.rowsMigrated} rotated, ${summary.rowsSkipped} skipped, elapsed=${summary.elapsedMs}ms`,
      );
    } else {
      safeLog(
        `DRY RUN: ${summary.rowsMigrated} would be rotated, ${summary.rowsSkipped} skipped, elapsed=${summary.elapsedMs}ms`,
      );
    }
    return { exitCode: 0, summary };
  } catch (err) {
    if (aborted) {
      safeErr(`aborted by user mid-tx — transaction rolled back`);
      return { exitCode: 30 };
    }
    if (err instanceof MisconfigError) {
      safeErr(`MISCONFIG: ${err.message}`);
      return { exitCode: 20 };
    }
    safeErr(`ROLLED BACK: ${(err as Error).message}`);
    return { exitCode: 10 };
  } finally {
    process.off('SIGINT', sigintHandler);
    await prisma.$disconnect().catch(() => {
      /* ignore disconnect errors post-failure */
    });
  }
}

// Only auto-run when invoked as a script; tests import the module safely.
if (require.main === module) {
  main()
    .then((res) => {
      process.exit(res.exitCode);
    })
    .catch((err) => {
      safeErr(`unhandled: ${(err as Error).message}`);
      process.exit(10);
    });
}
