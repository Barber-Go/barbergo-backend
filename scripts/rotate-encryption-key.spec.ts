/**
 * Unit tests (T2) for scripts/rotate-encryption-key.ts
 *
 * Covers:
 *  1. Round-trip basic
 *  2. Different key fails decrypt (GCM auth fail)
 *  3. tryDecryptWith behaviour (null vs string)
 *  4. Tampering detected
 *  5. Idempotency (already-NEW row → skip, no update())
 *  6. Normal migration (OLD → NEW path calls update())
 *  7. Post-write verification failure → throws
 *  8. Env validation: OLD missing / OLD==NEW / short key / bad MODE
 *  9. Bad packed format → throws
 * 10. Short key (non-32 bytes) → throws
 *
 * No Prisma network calls — delegates are injected as jest.fn() mocks.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  DryRunRollback,
  MisconfigError,
  encryptWith,
  decryptWith,
  tryDecryptWith,
  parseEnv,
  rotateRows,
  type Mode,
} from './rotate-encryption-key';

// Fixed 32-byte keys (64 hex chars) for deterministic tests.
const KEY_A_HEX = 'a'.repeat(64);
const KEY_B_HEX = 'b'.repeat(64);
const KEY_C_HEX = 'c'.repeat(64);

const KEY_A = Buffer.from(KEY_A_HEX, 'hex');
const KEY_B = Buffer.from(KEY_B_HEX, 'hex');
const KEY_C = Buffer.from(KEY_C_HEX, 'hex');

// Baseline ENV required for parseEnv to succeed — individual tests mutate.
const VALID_ENV: NodeJS.ProcessEnv = {
  ENCRYPTION_KEY_OLD: KEY_A_HEX,
  ENCRYPTION_KEY_NEW: KEY_B_HEX,
  MODE: 'dry-run',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/barbergo',
};

describe('crypto helpers', () => {
  it('1. round-trip: encryptWith then decryptWith returns original plaintext', () => {
    const plaintext = 'hola mundo';
    const packed = encryptWith(KEY_A, plaintext);
    expect(packed.split(':')).toHaveLength(3);
    const recovered = decryptWith(KEY_A, packed);
    expect(recovered).toBe(plaintext);
  });

  it('2. decryptWith with a different key throws (GCM auth tag mismatch)', () => {
    const packed = encryptWith(KEY_A, 'x');
    expect(() => decryptWith(KEY_B, packed)).toThrow();
  });

  it('3. tryDecryptWith returns string for correct key and null for wrong key', () => {
    const packed = encryptWith(KEY_A, 'payload');
    expect(tryDecryptWith(KEY_A, packed)).toBe('payload');
    expect(tryDecryptWith(KEY_B, packed)).toBeNull();
  });

  it('4. tampering with ciphertext is detected (auth fail)', () => {
    const packed = encryptWith(KEY_A, 'sensitive');
    const [iv, authTag, ct] = packed.split(':');
    // Flip first hex char of ciphertext deterministically.
    const firstChar = ct.charAt(0);
    const flipped = (firstChar === '0' ? '1' : '0') + ct.slice(1);
    const tampered = [iv, authTag, flipped].join(':');
    expect(() => decryptWith(KEY_A, tampered)).toThrow();
  });

  it('9a. decryptWith rejects packed without 3 segments', () => {
    expect(() => decryptWith(KEY_A, 'no-colons')).toThrow(/3 segments/);
    expect(() => decryptWith(KEY_A, 'a:b')).toThrow(/3 segments/);
  });

  it('9b. decryptWith rejects packed with non-hex segments', () => {
    expect(() => decryptWith(KEY_A, 'xx:yy:zz')).toThrow(/non-hex/);
  });

  it('10. encryptWith rejects keys not exactly 32 bytes', () => {
    const shortKey = Buffer.alloc(16);
    expect(() => encryptWith(shortKey, 'x')).toThrow(/invalid key/);
  });
});

describe('parseEnv', () => {
  it('8a. throws MisconfigError when ENCRYPTION_KEY_OLD is missing', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete env.ENCRYPTION_KEY_OLD;
    expect(() => parseEnv(env)).toThrow(MisconfigError);
  });

  it('8b. throws MisconfigError when OLD === NEW', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_ENV,
      ENCRYPTION_KEY_OLD: KEY_A_HEX,
      ENCRYPTION_KEY_NEW: KEY_A_HEX,
    };
    expect(() => parseEnv(env)).toThrow(/must be different/);
  });

  it('8c. throws MisconfigError when key is too short (not 64 hex)', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV, ENCRYPTION_KEY_NEW: 'b'.repeat(32) };
    expect(() => parseEnv(env)).toThrow(/64 hex/);
  });

  it('8d. throws MisconfigError when MODE is invalid', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV, MODE: 'wipe' };
    expect(() => parseEnv(env)).toThrow(/MODE/);
  });

  it('8e. throws MisconfigError when DATABASE_URL is missing', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete env.DATABASE_URL;
    expect(() => parseEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('8f. accepts valid env and returns parsed buffers with default mode dry-run', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete env.MODE;
    const cfg = parseEnv(env);
    const mode: Mode = cfg.mode;
    expect(mode).toBe('dry-run');
    expect(cfg.oldKey.length).toBe(32);
    expect(cfg.newKey.length).toBe(32);
    expect(cfg.forceLocal).toBe(false);
  });

  it('8g. FORCE_LOCAL=true is honoured', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV, FORCE_LOCAL: 'true' };
    const cfg = parseEnv(env);
    expect(cfg.forceLocal).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// rotateRows() — the core per-table logic, exercised with mocks
// ────────────────────────────────────────────────────────────────────────────

function makeRow(id: string, cipher: string) {
  return { id, cipher };
}

describe('rotateRows', () => {
  const logs: string[] = [];
  const log = (m: string): void => {
    logs.push(m);
  };

  beforeEach(() => {
    logs.length = 0;
  });

  it('5. idempotency: row already encrypted with NEW key is skipped, update is NOT called', async () => {
    // Row cipher was produced with KEY_B (i.e. the NEW key), simulating a re-run.
    const cipherNew = encryptWith(KEY_B, 'plaintext-value');

    const updateRow = jest.fn(async (_id: string, _c: string): Promise<void> => {});
    const reReadCipher = jest.fn(async (_id: string): Promise<string | null> => null);

    const result = await rotateRows({
      tableLabel: 'test.field',
      fieldName: 'field',
      rows: [makeRow('row-00000001', cipherNew)],
      oldKey: KEY_A,
      newKey: KEY_B,
      mode: 'apply',
      updateRow,
      reReadCipher,
      log,
      isAborted: () => false,
    });

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(updateRow).not.toHaveBeenCalled();
    expect(reReadCipher).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('already NEW'))).toBe(true);
  });

  it('6. normal migration: OLD-encrypted row is decrypted, re-encrypted with NEW, update+reread called', async () => {
    const plaintext = 'super-secret-sii-password';
    const cipherOld = encryptWith(KEY_A, plaintext);

    // The mock "database" holds the current cipher value; updateRow mutates it.
    let stored = cipherOld;

    const updateRow = jest.fn(async (_id: string, c: string): Promise<void> => {
      stored = c;
    });
    const reReadCipher = jest.fn(async (_id: string): Promise<string | null> => stored);

    const result = await rotateRows({
      tableLabel: 'test.field',
      fieldName: 'field',
      rows: [makeRow('row-aaaa0001', cipherOld)],
      oldKey: KEY_A,
      newKey: KEY_B,
      mode: 'apply',
      updateRow,
      reReadCipher,
      log,
      isAborted: () => false,
    });

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(updateRow).toHaveBeenCalledTimes(1);
    expect(reReadCipher).toHaveBeenCalledTimes(1);

    // After rotation, `stored` must decrypt with NEW (KEY_B) back to plaintext.
    expect(decryptWith(KEY_B, stored)).toBe(plaintext);
    // And it must NOT be decryptable with OLD anymore (different cipher).
    expect(tryDecryptWith(KEY_A, stored)).toBeNull();
  });

  it('6b. dry-run mode does NOT call updateRow or reReadCipher but still counts migrated', async () => {
    const cipherOld = encryptWith(KEY_A, 'pw');
    const updateRow = jest.fn(async (_id: string, _c: string): Promise<void> => {});
    const reReadCipher = jest.fn(async (_id: string): Promise<string | null> => null);

    const result = await rotateRows({
      tableLabel: 'test.field',
      fieldName: 'field',
      rows: [makeRow('row-dddddddd', cipherOld)],
      oldKey: KEY_A,
      newKey: KEY_B,
      mode: 'dry-run',
      updateRow,
      reReadCipher,
      log,
      isAborted: () => false,
    });

    expect(result.migrated).toBe(1);
    expect(updateRow).not.toHaveBeenCalled();
    expect(reReadCipher).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('would be re-encrypted'))).toBe(true);
  });

  it('7. post-write verification failure: re-read returns a cipher that does NOT round-trip → throws', async () => {
    const plaintext = 'expected-plaintext';
    const cipherOld = encryptWith(KEY_A, plaintext);

    // reReadCipher lies: returns a cipher encrypted with an UNRELATED key (KEY_C),
    // which decrypts successfully but to a DIFFERENT plaintext, forcing the
    // "verified !== plaintext" branch.
    const bogusCipherWithDifferentPlaintext = encryptWith(KEY_C, 'something-else');

    const updateRow = jest.fn(async (_id: string, _c: string): Promise<void> => {
      /* no-op, simulating a silent corruption */
    });
    const reReadCipher = jest.fn(async (_id: string): Promise<string | null> =>
      // Return a cipher encrypted with KEY_B to a DIFFERENT plaintext —
      // decrypt succeeds but verified !== original plaintext.
      encryptWith(KEY_B, 'wrong-plaintext'),
    );
    // Silence unused-var lint for the helper variable above.
    void bogusCipherWithDifferentPlaintext;

    await expect(
      rotateRows({
        tableLabel: 'test.field',
        fieldName: 'field',
        rows: [makeRow('row-badbad01', cipherOld)],
        oldKey: KEY_A,
        newKey: KEY_B,
        mode: 'apply',
        updateRow,
        reReadCipher,
        log,
        isAborted: () => false,
      }),
    ).rejects.toThrow(/verification failed/);
  });

  it('7b. decrypt-with-OLD failure on non-idempotent row is wrapped and thrown', async () => {
    // Cipher is garbage relative to both KEY_A and KEY_B.
    const garbage = encryptWith(KEY_C, 'x'); // encrypted with key we do not own

    const updateRow = jest.fn(async (_id: string, _c: string): Promise<void> => {});
    const reReadCipher = jest.fn(async (_id: string): Promise<string | null> => null);

    await expect(
      rotateRows({
        tableLabel: 'test.field',
        fieldName: 'field',
        rows: [makeRow('row-ffffffff', garbage)],
        oldKey: KEY_A,
        newKey: KEY_B,
        mode: 'apply',
        updateRow,
        reReadCipher,
        log,
        isAborted: () => false,
      }),
    ).rejects.toThrow(/decrypt-with-OLD failed/);

    expect(updateRow).not.toHaveBeenCalled();
  });

  it('cooperative abort: isAborted=true between rows throws immediately', async () => {
    const cipherOld = encryptWith(KEY_A, 'x');
    const updateRow = jest.fn(async (_id: string, _c: string): Promise<void> => {});
    const reReadCipher = jest.fn(async (_id: string): Promise<string | null> => null);

    await expect(
      rotateRows({
        tableLabel: 'test.field',
        fieldName: 'field',
        rows: [makeRow('row-01', cipherOld)],
        oldKey: KEY_A,
        newKey: KEY_B,
        mode: 'apply',
        updateRow,
        reReadCipher,
        log,
        isAborted: () => true,
      }),
    ).rejects.toThrow(/aborted by user/);
  });
});

describe('DryRunRollback sentinel', () => {
  it('is an Error subclass with a stable name', () => {
    const e = new DryRunRollback();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DryRunRollback');
    expect(e.message).toBe('DRY_RUN_ROLLBACK');
  });
});
