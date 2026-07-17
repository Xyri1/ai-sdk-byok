CREATE TABLE ai_sdk_byok_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  key_hint TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, provider, label),
  CHECK (length(user_id) BETWEEN 1 AND 256),
  CHECK (length(provider) BETWEEN 1 AND 128),
  CHECK (length(label) BETWEEN 1 AND 128),
  CHECK (length(key_hint) BETWEEN 1 AND 4)
);

CREATE INDEX ai_sdk_byok_keys_user_list_idx
  ON ai_sdk_byok_keys (user_id, updated_at DESC, created_at DESC);
