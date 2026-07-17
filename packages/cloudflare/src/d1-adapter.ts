import {
  AiSdkByokAdapterError,
  type ApiKeyCredentials,
  type ByokManagerOptions,
  type KeyMetadata,
} from 'ai-sdk-byok';
import { createSealer, credentialAad, type EncryptionKeyInput } from './crypto.js';

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface D1AdapterOptions {
  database: unknown;
  encryptionKey: EncryptionKeyInput;
}

interface KeyMetadataRow {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

interface CredentialRow extends KeyMetadataRow {
  credentials_ciphertext: string;
}

const METADATA_COLUMNS = 'id, user_id, provider, label, key_hint, created_at, updated_at';

const SAVE_SQL = `
INSERT INTO ai_sdk_byok_keys (id, user_id, provider, label, key_hint, credentials_ciphertext, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, provider, label) DO UPDATE SET
  key_hint = excluded.key_hint,
  credentials_ciphertext = excluded.credentials_ciphertext,
  updated_at = excluded.updated_at
RETURNING ${METADATA_COLUMNS};
`;

const LIST_SQL = `
SELECT ${METADATA_COLUMNS}
FROM ai_sdk_byok_keys
WHERE user_id = ?
ORDER BY updated_at DESC, created_at DESC;
`;

const GET_SQL = `
SELECT credentials_ciphertext
FROM ai_sdk_byok_keys
WHERE user_id = ? AND provider = ? AND label = ?;
`;

const GET_BY_ID_SQL = `
SELECT ${METADATA_COLUMNS}, credentials_ciphertext
FROM ai_sdk_byok_keys
WHERE id = ? AND user_id = ?;
`;

const DELETE_SQL = `
DELETE FROM ai_sdk_byok_keys
WHERE id = ? AND user_id = ?;
`;

function adapterError(operation: string, cause: unknown): AiSdkByokAdapterError {
  return new AiSdkByokAdapterError(`Cloudflare D1 BYOK adapter failed during ${operation}`, { cause });
}

function toMetadata(row: KeyMetadataRow): KeyMetadata {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    keyHint: row.key_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCredentials(plaintext: string): ApiKeyCredentials {
  const parsed: unknown = JSON.parse(plaintext);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    typeof (parsed as { apiKey?: unknown }).apiKey !== 'string'
  ) {
    throw new Error('Sealed credential payload has an invalid shape');
  }

  return { apiKey: (parsed as { apiKey: string }).apiKey };
}

export function d1Adapter(options: D1AdapterOptions): ByokManagerOptions['storage'] {
  const database = options.database as D1DatabaseLike;
  const sealer = createSealer(options.encryptionKey);

  return {
    async save(input) {
      try {
        const sealed = await sealer.seal(
          JSON.stringify(input.credentials),
          credentialAad(input.userId, input.provider, input.label),
        );
        const now = new Date().toISOString();
        const row = await database
          .prepare(SAVE_SQL)
          .bind(crypto.randomUUID(), input.userId, input.provider, input.label, input.keyHint, sealed, now, now)
          .first<KeyMetadataRow>();

        if (row === null) {
          throw new Error('Save did not return a metadata row');
        }

        return toMetadata(row);
      } catch (error) {
        throw adapterError('save', error);
      }
    },

    async list(input) {
      try {
        const { results } = await database.prepare(LIST_SQL).bind(input.userId).all<KeyMetadataRow>();
        return results.map(toMetadata);
      } catch (error) {
        throw adapterError('list', error);
      }
    },

    async get(input) {
      try {
        const row = await database
          .prepare(GET_SQL)
          .bind(input.userId, input.provider, input.label)
          .first<Pick<CredentialRow, 'credentials_ciphertext'>>();

        if (row === null) {
          return null;
        }

        const plaintext = await sealer.unseal(
          row.credentials_ciphertext,
          credentialAad(input.userId, input.provider, input.label),
        );
        return parseCredentials(plaintext);
      } catch (error) {
        throw adapterError('get', error);
      }
    },

    async getById(input) {
      try {
        const row = await database.prepare(GET_BY_ID_SQL).bind(input.keyId, input.userId).first<CredentialRow>();

        if (row === null) {
          return null;
        }

        const plaintext = await sealer.unseal(
          row.credentials_ciphertext,
          credentialAad(row.user_id, row.provider, row.label),
        );
        return { ...toMetadata(row), credentials: parseCredentials(plaintext) };
      } catch (error) {
        throw adapterError('getById', error);
      }
    },

    async delete(input) {
      try {
        await database.prepare(DELETE_SQL).bind(input.keyId, input.userId).run();
      } catch (error) {
        throw adapterError('delete', error);
      }
    },
  };
}
