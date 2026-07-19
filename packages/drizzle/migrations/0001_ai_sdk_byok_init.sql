CREATE TABLE ai_sdk_byok_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  credentials_nonce TEXT NOT NULL,
  encryption_key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ai_sdk_byok_keys_user_provider_label_unique UNIQUE (user_id, provider, label)
);

CREATE INDEX ai_sdk_byok_keys_user_updated_created_idx
  ON ai_sdk_byok_keys (user_id, updated_at DESC, created_at DESC);
