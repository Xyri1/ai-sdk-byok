import { describe, expect, it, vi } from 'vitest';
import { AiSdkByokValidationError } from 'ai-sdk-byok';
import { createSealer, credentialAad } from './crypto.js';

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');

describe('credentialAad', () => {
  it('joins parts with NUL separators', () => {
    expect(credentialAad('user_1', 'openai', 'default')).toBe('user_1\0openai\0default');
  });
});

describe('createSealer', () => {
  it('round-trips plaintext with matching aad', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('{"apiKey":"sk-test-1234"}', 'aad-1');

    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('sk-test-1234');
    await expect(sealer.unseal(sealed, 'aad-1')).resolves.toBe('{"apiKey":"sk-test-1234"}');
  });

  it('produces distinct ciphertexts for identical plaintext (fresh IV)', async () => {
    const sealer = createSealer(TEST_KEY);
    const first = await sealer.seal('same', 'aad');
    const second = await sealer.seal('same', 'aad');

    expect(first).not.toBe(second);
  });

  it('rejects unsealing with a different key', async () => {
    const sealed = await createSealer(TEST_KEY).seal('secret', 'aad');

    await expect(createSealer(OTHER_KEY).unseal(sealed, 'aad')).rejects.toThrow(
      'Sealed credential payload failed to decrypt',
    );
  });

  it('rejects unsealing with mismatched aad', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('secret', 'user_a\0openai\0default');

    await expect(sealer.unseal(sealed, 'user_b\0openai\0default')).rejects.toThrow(
      'Sealed credential payload failed to decrypt',
    );
  });

  it('rejects tampered payloads', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('secret', 'aad');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');

    await expect(sealer.unseal(tampered, 'aad')).rejects.toThrow();
  });

  it('rejects unsupported format versions', async () => {
    const sealer = createSealer(TEST_KEY);
    const sealed = await sealer.seal('secret', 'aad');

    await expect(sealer.unseal(sealed.replace(/^v1\./, 'v9.'), 'aad')).rejects.toThrow(
      'Sealed credential payload has an unsupported format',
    );
  });

  it('rejects a string key of the wrong length at construction', () => {
    expect(() => createSealer(Buffer.from('short').toString('base64'))).toThrow(AiSdkByokValidationError);
  });

  it('rejects a non-base64 string key at construction', () => {
    expect(() => createSealer('!!!not-base64!!!')).toThrow(AiSdkByokValidationError);
  });

  it('resolves a getter key lazily, validates it, and memoizes it', async () => {
    const getter = vi.fn(async () => TEST_KEY);
    const sealer = createSealer(getter);

    expect(getter).not.toHaveBeenCalled();
    await sealer.seal('one', 'aad');
    await sealer.seal('two', 'aad');
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it('rejects a getter that returns a wrong-length key', async () => {
    const sealer = createSealer(async () => Buffer.from('short').toString('base64'));

    await expect(sealer.seal('x', 'aad')).rejects.toThrow(AiSdkByokValidationError);
  });
});
