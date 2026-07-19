import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const aiSdkByokKeys = pgTable(
  'ai_sdk_byok_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    label: text('label').notNull(),
    keyHint: text('key_hint').notNull(),
    credentialsCiphertext: text('credentials_ciphertext').notNull(),
    credentialsNonce: text('credentials_nonce').notNull(),
    encryptionKeyVersion: text('encryption_key_version').notNull(),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (table) => [
    unique('ai_sdk_byok_keys_user_provider_label_unique').on(table.userId, table.provider, table.label),
    index('ai_sdk_byok_keys_user_updated_created_idx').on(
      table.userId,
      table.updatedAt.desc(),
      table.createdAt.desc(),
    ),
  ],
);
