import { describe, expect, it } from 'vitest';
import { AiSdkByokAdapterError, AiSdkByokValidationError } from 'ai-sdk-byok';
import { createKeyring, credentialAad } from './crypto.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
const PLAINTEXT = JSON.stringify({ apiKey: 'sk-test-1234' });
const AAD = credentialAad('user_1', 'openai');

function tamper(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

describe('credentialAad', () => {
  it('joins parts with NUL separators', () => {
    expect(credentialAad('user_1', 'openai')).toBe('user_1\0openai');
  });
});

describe('createKeyring', () => {
  it('round-trips plaintext with the current key', async () => {
    const keyring = createKeyring({ current: { version: 'v1', key: TEST_KEY } });

    const encrypted = await keyring.encrypt(PLAINTEXT, AAD);

    expect(encrypted.keyVersion).toBe('v1');
    expect(encrypted.ciphertext).not.toContain('sk-test-1234');
    expect(encrypted.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encrypted.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(keyring.decrypt(encrypted, AAD)).resolves.toBe(PLAINTEXT);
  });

  it('uses current for new writes', async () => {
    const keyring = createKeyring({
      current: { version: 'v2', key: OTHER_KEY },
      previous: [{ version: 'v1', key: TEST_KEY }],
    });

    await expect(keyring.encrypt(PLAINTEXT, AAD)).resolves.toMatchObject({ keyVersion: 'v2' });
  });

  it('decrypts payloads encrypted with a previous key', async () => {
    const oldKeyring = createKeyring({ current: { version: 'v1', key: TEST_KEY } });
    const newKeyring = createKeyring({
      current: { version: 'v2', key: OTHER_KEY },
      previous: [{ version: 'v1', key: TEST_KEY }],
    });

    const encrypted = await oldKeyring.encrypt(PLAINTEXT, AAD);

    await expect(newKeyring.decrypt(encrypted, AAD)).resolves.toBe(PLAINTEXT);
  });

  it('rejects an unknown key version without exposing encrypted values', async () => {
    const keyring = createKeyring({ current: { version: 'v1', key: TEST_KEY } });
    const encrypted = await keyring.encrypt(PLAINTEXT, AAD);
    const unknownVersion = 'missing-version';

    let failure: unknown;
    try {
      await keyring.decrypt({ ...encrypted, keyVersion: unknownVersion }, AAD);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AiSdkByokAdapterError);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).not.toContain(unknownVersion);
    expect(message).not.toContain(encrypted.ciphertext);
    expect(message).not.toContain(encrypted.nonce);
    expect(message).not.toContain(TEST_KEY);
    expect(message).not.toContain(PLAINTEXT);
  });

  it.each([
    ['tampered ciphertext', (encrypted: Awaited<ReturnType<typeof keyringEncrypt>>) => ({ ...encrypted, ciphertext: tamper(encrypted.ciphertext) })],
    ['tampered nonce', (encrypted: Awaited<ReturnType<typeof keyringEncrypt>>) => ({ ...encrypted, nonce: tamper(encrypted.nonce) })],
    ['mismatched AAD', (encrypted: Awaited<ReturnType<typeof keyringEncrypt>>) => encrypted],
  ])('rejects %s', async (_name, transform) => {
    const keyring = createKeyring({ current: { version: 'v1', key: TEST_KEY } });
    const encrypted = await keyringEncrypt(keyring);
    const aad = _name === 'mismatched AAD' ? 'user_2\0openai' : AAD;

    await expect(keyring.decrypt(transform(encrypted), aad)).rejects.toBeInstanceOf(AiSdkByokAdapterError);
  });

  it('rejects duplicate key versions', () => {
    expect(() =>
      createKeyring({
        current: { version: 'v1', key: TEST_KEY },
        previous: [{ version: 'v1', key: OTHER_KEY }],
      }),
    ).toThrow(AiSdkByokValidationError);
  });

  it('rejects empty or whitespace-only key versions', () => {
    expect(() => createKeyring({ current: { version: ' ', key: TEST_KEY } })).toThrow(AiSdkByokValidationError);
  });

  it.each([
    ['wrong-length string', Buffer.from('short').toString('base64')],
    ['non-base64 string', '!!!not-base64!!!'],
    ['wrong-length bytes', new Uint8Array(31)],
  ])('rejects %s key material', (_name, key) => {
    expect(() => createKeyring({ current: { version: 'v1', key } })).toThrow(AiSdkByokValidationError);
  });

  it('accepts an AES-GCM CryptoKey usable for encryption and decryption', async () => {
    const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const keyring = createKeyring({ current: { version: 'v1', key } });

    await expect(keyring.decrypt(await keyring.encrypt(PLAINTEXT, AAD), AAD)).resolves.toBe(PLAINTEXT);
  });

  it('redacts invalid key material from validation errors', () => {
    const secretMaterial = Buffer.from(new Uint8Array(31).fill(11)).toString('base64');

    try {
      createKeyring({ current: { version: 'v1', key: secretMaterial } });
      throw new Error('expected createKeyring to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AiSdkByokValidationError);
      expect((error as Error).message).not.toContain(secretMaterial);
    }
  });
});

async function keyringEncrypt(keyring: ReturnType<typeof createKeyring>) {
  return keyring.encrypt(PLAINTEXT, AAD);
}

type keyringEncrypt = ReturnType<typeof keyringEncrypt>;
