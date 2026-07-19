import { AiSdkByokAdapterError, AiSdkByokValidationError } from 'ai-sdk-byok';

export type EncryptionKey = {
  version: string;
  key: string | Uint8Array | CryptoKey;
};

export type EncryptionConfig = {
  current: EncryptionKey;
  previous?: EncryptionKey[];
};

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  keyVersion: string;
}

interface NormalizedEncryptionKey {
  version: string;
  material: Uint8Array<ArrayBuffer> | CryptoKey;
  keyPromise: Promise<CryptoKey> | null;
}

const NONCE_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function credentialAad(...parts: string[]): string {
  return parts.join('\0');
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  return decodeBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function decodeKeyMaterial(value: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(value.trim());
  } catch {
    throw new AiSdkByokValidationError('encryption key must be a base64-encoded string');
  }

  if (bytes.length !== KEY_LENGTH_BYTES) {
    throw new AiSdkByokValidationError('encryption key must decode to exactly 32 bytes');
  }

  return bytes;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey;
}

function normalizeKey(value: unknown): NormalizedEncryptionKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiSdkByokValidationError('encryption key must be an object');
  }

  const input = value as Partial<EncryptionKey>;
  if (typeof input.version !== 'string' || input.version.trim().length === 0) {
    throw new AiSdkByokValidationError('encryption key version must be a non-empty string');
  }

  let material: Uint8Array<ArrayBuffer> | CryptoKey;
  if (typeof input.key === 'string') {
    material = decodeKeyMaterial(input.key);
  } else if (input.key instanceof Uint8Array) {
    if (input.key.byteLength !== KEY_LENGTH_BYTES) {
      throw new AiSdkByokValidationError('encryption key must be exactly 32 bytes');
    }
    material = new Uint8Array(input.key);
  } else if (isCryptoKey(input.key)) {
    const algorithm = input.key.algorithm;
    if (
      input.key.type !== 'secret' ||
      algorithm.name !== 'AES-GCM' ||
      !('length' in algorithm) ||
      algorithm.length !== 256 ||
      !input.key.usages.includes('encrypt') ||
      !input.key.usages.includes('decrypt')
    ) {
      throw new AiSdkByokValidationError('encryption key must be an AES-GCM key usable for encrypt and decrypt');
    }
    material = input.key;
  } else {
    throw new AiSdkByokValidationError('encryption key must be a string, Uint8Array, or CryptoKey');
  }

  return { version: input.version, material, keyPromise: null };
}

function normalizeConfig(config: unknown): { current: NormalizedEncryptionKey; keys: Map<string, NormalizedEncryptionKey> } {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new AiSdkByokValidationError('encryption config must be an object');
  }

  const input = config as { current?: unknown; previous?: unknown };
  const previous = input.previous === undefined ? [] : input.previous;
  if (!Array.isArray(previous)) {
    throw new AiSdkByokValidationError('encryption config previous keys must be an array');
  }

  const current = normalizeKey(input.current);
  const keys = new Map<string, NormalizedEncryptionKey>();
  for (const key of [current, ...previous.map(normalizeKey)]) {
    if (keys.has(key.version)) {
      throw new AiSdkByokValidationError('encryption key versions must be unique');
    }
    keys.set(key.version, key);
  }

  return { current, keys };
}

function importKey(key: NormalizedEncryptionKey): Promise<CryptoKey> {
  if (isCryptoKey(key.material)) {
    return Promise.resolve(key.material);
  }

  key.keyPromise ??= globalThis.crypto.subtle
    .importKey('raw', key.material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    .catch((error: unknown) => {
      key.keyPromise = null;
      throw error;
    });
  return key.keyPromise;
}

export function createKeyring(config: EncryptionConfig) {
  const { current, keys } = normalizeConfig(config);

  return {
    async encrypt(plaintext: string, aad: string): Promise<EncryptedPayload> {
      try {
        const key = await importKey(current);
        const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_LENGTH_BYTES));
        const ciphertext = await globalThis.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(aad) },
          key,
          encoder.encode(plaintext),
        );

        return {
          ciphertext: toBase64Url(new Uint8Array(ciphertext)),
          nonce: toBase64Url(nonce),
          keyVersion: current.version,
        };
      } catch {
        throw new AiSdkByokAdapterError('Drizzle encryption failed');
      }
    },

    async decrypt(payload: EncryptedPayload, aad: string): Promise<string> {
      const key = keys.get(payload.keyVersion);
      if (key === undefined) {
        throw new AiSdkByokAdapterError('Drizzle credential payload uses an unconfigured encryption key');
      }

      try {
        const plaintext = await globalThis.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64Url(payload.nonce), additionalData: encoder.encode(aad) },
          await importKey(key),
          fromBase64Url(payload.ciphertext),
        );
        return decoder.decode(plaintext);
      } catch {
        throw new AiSdkByokAdapterError('Drizzle credential payload failed to decrypt');
      }
    },
  };
}
