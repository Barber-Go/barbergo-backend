import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { validateEnv } from './env.validation';

/**
 * Base válida: todas las required OK + MP coherente.
 * Las tests la clonan y mutan campos puntuales.
 */
const VALID_BASE: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/barbergo',
  JWT_SECRET: 'a'.repeat(64),
  JWT_EXPIRES_IN: '7d',
  ENCRYPTION_KEY: 'b'.repeat(64),
  MP_ENV: 'sandbox',
  MP_ACCESS_TOKEN: 'TEST-1234567890abcdef',
  TRANSBANK_ENV: 'integration',
};

describe('validateEnv', () => {
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined) as never);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((() => true) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('1. rechaza JWT_SECRET con valor default "change-me-in-production"', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_BASE,
      JWT_SECRET: 'change-me-in-production',
    };
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('JWT_SECRET');
    expect(output).toContain('forbidden');
  });

  it('2. rechaza JWT_SECRET que es placeholder <generar con: ...>', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_BASE,
      JWT_SECRET: '<generar con: openssl rand -hex 64>',
    };
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('JWT_SECRET');
  });

  it('3. rechaza JWT_SECRET demasiado corto', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_BASE, JWT_SECRET: 'short' };
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('JWT_SECRET');
    expect(output).toContain('shorter than 32');
  });

  it('4. rechaza MP_ENV=production con token TEST-', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_BASE,
      MP_ENV: 'production',
      MP_ACCESS_TOKEN: 'TEST-abcdef1234',
    };
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('MP_ACCESS_TOKEN');
    expect(output).toContain("APP_USR-");
  });

  it('5. rechaza MP_ENV=sandbox con token APP_USR-', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_BASE,
      MP_ENV: 'sandbox',
      MP_ACCESS_TOKEN: 'APP_USR-abcdef1234',
    };
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('MP_ACCESS_TOKEN');
    expect(output).toContain('TEST-');
  });

  it('6. rechaza MP_ENV con valor no permitido', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_BASE, MP_ENV: 'foo' };
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('MP_ENV');
    expect(output).toContain('not in allowed list');
  });

  it('7. rechaza DATABASE_URL ausente', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_BASE };
    delete env.DATABASE_URL;
    validateEnv(env);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('DATABASE_URL');
    expect(output).toContain('missing or empty');
  });

  it('8. acepta configuración válida completa sin abortar', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_BASE,
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      CLOUDINARY_CLOUD_NAME: 'test',
      FRONTEND_URL: 'https://app.barbergo.cl',
    };
    validateEnv(env);
    expect(exitSpy).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('[ENV VALIDATION OK]');
    expect(output).toContain('MP_ENV=sandbox');
  });

  it('9. opcionales ausentes no abortan, solo aparecen en el log como missing', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_BASE };
    // VALID_BASE ya no trae ANTHROPIC_API_KEY ni otros opcionales
    validateEnv(env);
    expect(exitSpy).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('[ENV VALIDATION OK]');
    expect(output).toContain('ANTHROPIC_API_KEY');
    expect(output).toContain('missing:');
  });

  it('enmascara MP_ACCESS_TOKEN en el log de éxito', () => {
    const env: NodeJS.ProcessEnv = {
      ...VALID_BASE,
      MP_ACCESS_TOKEN: 'TEST-superSecretFull1234',
    };
    validateEnv(env);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('TEST-...1234');
    expect(output).not.toContain('superSecretFull');
  });
});
