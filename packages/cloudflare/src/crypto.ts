import { AiSdkByokValidationError } from 'ai-sdk-byok';

export type EncryptionKeyInput = string | (() => string | Promise<string>);

export interface CredentialSealer {
  seal(plaintext: string, aad: string): Promise<string>;
  unseal(sealed: string, aad: string): Promise<string>;
}

const FORMAT_VERSION = 'v1';
const IV_LENGTH_BYTES = 12;
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
    throw new AiSdkByokValidationError('encryptionKey must be a base64-encoded string');
  }

  if (bytes.length !== KEY_LENGTH_BYTES) {
    throw new AiSdkByokValidationError('encryptionKey must decode to exactly 32 bytes');
  }

  return bytes;
}

export function createSealer(encryptionKey: EncryptionKeyInput): CredentialSealer {
  if (typeof encryptionKey === 'string') {
    decodeKeyMaterial(encryptionKey);
  }

  let keyPromise: Promise<CryptoKey> | null = null;

  function importKey(): Promise<CryptoKey> {
    keyPromise ??= (async () => {
      const material = typeof encryptionKey === 'string' ? encryptionKey : await encryptionKey();
      return crypto.subtle.importKey('raw', decodeKeyMaterial(material), { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ]);
    })().catch((error: unknown) => {
      keyPromise = null;
      throw error;
    });
    return keyPromise;
  }

  return {
    async seal(plaintext, aad) {
      const key = await importKey();
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
        key,
        encoder.encode(plaintext),
      );

      return `${FORMAT_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
    },

    async unseal(sealed, aad) {
      const [version, ivSegment, dataSegment, ...rest] = sealed.split('.');

      if (version !== FORMAT_VERSION || ivSegment === undefined || dataSegment === undefined || rest.length > 0) {
        throw new Error('Sealed credential payload has an unsupported format');
      }

      const key = await importKey();

      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64Url(ivSegment), additionalData: encoder.encode(aad) },
          key,
          fromBase64Url(dataSegment),
        );
        return decoder.decode(plaintext);
      } catch {
        throw new Error('Sealed credential payload failed to decrypt');
      }
    },
  };
}
