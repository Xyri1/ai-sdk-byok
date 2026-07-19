import {
  AiSdkByokAdapterError,
  AiSdkByokValidationError,
  type ApiKeyCredentials,
  type ByokManagerOptions,
  type KeyMetadata,
  type StoredKeyCredentialRecord,
} from 'ai-sdk-byok';
import { and, desc, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { createKeyring, credentialAad, type EncryptionConfig } from './crypto.js';
import { aiSdkByokKeys } from './schema.js';

type DrizzlePostgresDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

interface KeyMetadataRow {
  id: string;
  userId: string;
  provider: string;
  label: string;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
}

interface CredentialRow extends KeyMetadataRow {
  credentialsCiphertext: string;
  credentialsNonce: string;
  encryptionKeyVersion: string;
}

export interface DrizzleAdapterOptions {
  db: DrizzlePostgresDatabase;
  dialect: 'postgres';
  encryption: EncryptionConfig;
}

function adapterError(operation: string): AiSdkByokAdapterError {
  return new AiSdkByokAdapterError(`Drizzle BYOK adapter failed during ${operation}`);
}

function toMetadata(row: KeyMetadataRow): KeyMetadata {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    label: row.label,
    keyHint: row.keyHint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseCredentials(plaintext: string): ApiKeyCredentials {
  try {
    const parsed: unknown = JSON.parse(plaintext);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      typeof (parsed as { apiKey?: unknown }).apiKey !== 'string'
    ) {
      throw new Error('invalid credential payload shape');
    }

    return { apiKey: (parsed as { apiKey: string }).apiKey };
  } catch {
    throw new AiSdkByokAdapterError('Drizzle credential payload has an invalid shape');
  }
}

export function drizzleAdapter(options: DrizzleAdapterOptions): ByokManagerOptions['storage'] {
  if (options?.dialect !== 'postgres') {
    throw new AiSdkByokValidationError('Drizzle dialect must be postgres');
  }

  const db = options.db;
  const keyring = createKeyring(options.encryption);

  return {
    async save(input) {
      const encrypted = await keyring.encrypt(
        JSON.stringify({ apiKey: input.credentials.apiKey }),
        credentialAad(input.userId, input.provider),
      );
      const now = new Date().toISOString();
      let row: KeyMetadataRow | undefined;

      try {
        [row] = await db
          .insert(aiSdkByokKeys)
          .values({
            id: crypto.randomUUID(),
            userId: input.userId,
            provider: input.provider,
            label: input.label,
            keyHint: input.keyHint,
            credentialsCiphertext: encrypted.ciphertext,
            credentialsNonce: encrypted.nonce,
            encryptionKeyVersion: encrypted.keyVersion,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aiSdkByokKeys.userId, aiSdkByokKeys.provider, aiSdkByokKeys.label],
            set: {
              keyHint: input.keyHint,
              credentialsCiphertext: encrypted.ciphertext,
              credentialsNonce: encrypted.nonce,
              encryptionKeyVersion: encrypted.keyVersion,
              updatedAt: now,
            },
          })
          .returning({
            id: aiSdkByokKeys.id,
            userId: aiSdkByokKeys.userId,
            provider: aiSdkByokKeys.provider,
            label: aiSdkByokKeys.label,
            keyHint: aiSdkByokKeys.keyHint,
            createdAt: aiSdkByokKeys.createdAt,
            updatedAt: aiSdkByokKeys.updatedAt,
          });
      } catch {
        throw adapterError('save');
      }

      if (row === undefined) {
        throw adapterError('save');
      }

      return toMetadata(row);
    },

    async list(input) {
      try {
        const rows = await db
          .select({
            id: aiSdkByokKeys.id,
            userId: aiSdkByokKeys.userId,
            provider: aiSdkByokKeys.provider,
            label: aiSdkByokKeys.label,
            keyHint: aiSdkByokKeys.keyHint,
            createdAt: aiSdkByokKeys.createdAt,
            updatedAt: aiSdkByokKeys.updatedAt,
          })
          .from(aiSdkByokKeys)
          .where(eq(aiSdkByokKeys.userId, input.userId))
          .orderBy(desc(aiSdkByokKeys.updatedAt), desc(aiSdkByokKeys.createdAt));

        return rows.map(toMetadata);
      } catch {
        throw adapterError('list');
      }
    },

    async get(input) {
      let row: Pick<CredentialRow, 'userId' | 'provider' | 'credentialsCiphertext' | 'credentialsNonce' | 'encryptionKeyVersion'> | undefined;

      try {
        [row] = await db
          .select({
            userId: aiSdkByokKeys.userId,
            provider: aiSdkByokKeys.provider,
            credentialsCiphertext: aiSdkByokKeys.credentialsCiphertext,
            credentialsNonce: aiSdkByokKeys.credentialsNonce,
            encryptionKeyVersion: aiSdkByokKeys.encryptionKeyVersion,
          })
          .from(aiSdkByokKeys)
          .where(
            and(
              eq(aiSdkByokKeys.userId, input.userId),
              eq(aiSdkByokKeys.provider, input.provider),
              eq(aiSdkByokKeys.label, input.label),
            ),
          );
      } catch {
        throw adapterError('get');
      }

      if (row === undefined) {
        return null;
      }

      const plaintext = await keyring.decrypt(
        {
          ciphertext: row.credentialsCiphertext,
          nonce: row.credentialsNonce,
          keyVersion: row.encryptionKeyVersion,
        },
        credentialAad(row.userId, row.provider),
      );
      return parseCredentials(plaintext);
    },

    async getById(input) {
      let row: CredentialRow | undefined;

      try {
        [row] = await db
          .select({
            id: aiSdkByokKeys.id,
            userId: aiSdkByokKeys.userId,
            provider: aiSdkByokKeys.provider,
            label: aiSdkByokKeys.label,
            keyHint: aiSdkByokKeys.keyHint,
            createdAt: aiSdkByokKeys.createdAt,
            updatedAt: aiSdkByokKeys.updatedAt,
            credentialsCiphertext: aiSdkByokKeys.credentialsCiphertext,
            credentialsNonce: aiSdkByokKeys.credentialsNonce,
            encryptionKeyVersion: aiSdkByokKeys.encryptionKeyVersion,
          })
          .from(aiSdkByokKeys)
          .where(and(eq(aiSdkByokKeys.userId, input.userId), eq(aiSdkByokKeys.id, input.keyId)));
      } catch {
        throw adapterError('getById');
      }

      if (row === undefined) {
        return null;
      }

      const plaintext = await keyring.decrypt(
        {
          ciphertext: row.credentialsCiphertext,
          nonce: row.credentialsNonce,
          keyVersion: row.encryptionKeyVersion,
        },
        credentialAad(row.userId, row.provider),
      );
      return { ...toMetadata(row), credentials: parseCredentials(plaintext) } satisfies StoredKeyCredentialRecord;
    },

    async delete(input) {
      try {
        await db
          .delete(aiSdkByokKeys)
          .where(and(eq(aiSdkByokKeys.userId, input.userId), eq(aiSdkByokKeys.id, input.keyId)));
      } catch {
        throw adapterError('delete');
      }
    },
  };
}
