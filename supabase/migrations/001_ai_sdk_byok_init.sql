CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.ai_sdk_byok_keys (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id text NOT NULL,
  provider text NOT NULL,
  label text NOT NULL DEFAULT 'default',
  key_hint text NOT NULL,
  vault_secret_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, label),
  CHECK (char_length(user_id) > 0),
  CHECK (char_length(user_id) <= 256),
  CHECK (char_length(provider) > 0),
  CHECK (char_length(provider) <= 128),
  CHECK (char_length(label) > 0),
  CHECK (char_length(label) <= 128),
  CHECK (char_length(key_hint) > 0),
  CHECK (char_length(key_hint) <= 4)
);

ALTER TABLE public.ai_sdk_byok_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_sdk_byok_keys FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_sdk_byok_save_credentials(
  p_user_id text,
  p_provider text,
  p_credentials text,
  p_label text,
  p_key_hint text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_id uuid;
  v_existing_vault_id uuid;
  v_key_id uuid;
  v_new_vault_id uuid;
  v_secret_name text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_user_id || ':' || p_provider),
    pg_catalog.hashtext(p_label)
  );

  SELECT id, vault_secret_id
    INTO v_existing_id, v_existing_vault_id
    FROM public.ai_sdk_byok_keys
   WHERE user_id = p_user_id
     AND provider = p_provider
     AND label = p_label
   FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    v_secret_name := pg_catalog.format('ai-sdk-byok:%s', v_existing_id);

    PERFORM vault.update_secret(
      v_existing_vault_id,
      p_credentials,
      v_secret_name,
      'Managed by ai-sdk-byok'
    );

    UPDATE public.ai_sdk_byok_keys
       SET key_hint = p_key_hint,
            updated_at = pg_catalog.now()
      WHERE id = v_existing_id;

    RETURN (
      SELECT pg_catalog.jsonb_build_object(
        'id', id,
        'user_id', user_id,
        'provider', provider,
        'label', label,
        'key_hint', key_hint,
        'created_at', created_at,
        'updated_at', updated_at
      )
      FROM public.ai_sdk_byok_keys
      WHERE id = v_existing_id
    );
  END IF;

  v_key_id := pg_catalog.gen_random_uuid();
  v_secret_name := pg_catalog.format('ai-sdk-byok:%s', v_key_id);

  SELECT vault.create_secret(
    p_credentials,
    v_secret_name,
    'Managed by ai-sdk-byok'
  )
    INTO v_new_vault_id;

  INSERT INTO public.ai_sdk_byok_keys (
    id,
    user_id,
    provider,
    label,
    key_hint,
    vault_secret_id
  )
  VALUES (
    v_key_id,
    p_user_id,
    p_provider,
    p_label,
    p_key_hint,
    v_new_vault_id
  );

  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'provider', provider,
      'label', label,
      'key_hint', key_hint,
      'created_at', created_at,
      'updated_at', updated_at
    )
    FROM public.ai_sdk_byok_keys
    WHERE id = v_key_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_sdk_byok_get_credentials(
  p_user_id text,
  p_provider text,
  p_label text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
  v_secret text;
BEGIN
  SELECT vault_secret_id
    INTO v_secret_id
    FROM public.ai_sdk_byok_keys
   WHERE user_id = p_user_id
     AND provider = p_provider
     AND label = p_label;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_sdk_byok_delete_credentials(
  p_user_id text,
  p_key_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_id uuid;
BEGIN
  DELETE FROM public.ai_sdk_byok_keys
   WHERE id = p_key_id
     AND user_id = p_user_id
  RETURNING id INTO v_deleted_id;

  RETURN v_deleted_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_sdk_byok_cleanup_vault_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.vault_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets
     WHERE id = OLD.vault_secret_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ai_sdk_byok_keys_after_delete
ON public.ai_sdk_byok_keys;

CREATE TRIGGER ai_sdk_byok_keys_after_delete
  AFTER DELETE ON public.ai_sdk_byok_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.ai_sdk_byok_cleanup_vault_secret();

REVOKE ALL ON FUNCTION public.ai_sdk_byok_save_credentials(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ai_sdk_byok_get_credentials(text, text, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ai_sdk_byok_delete_credentials(text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_sdk_byok_save_credentials(text, text, text, text, text)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.ai_sdk_byok_get_credentials(text, text, text)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.ai_sdk_byok_delete_credentials(text, uuid)
  TO service_role;
