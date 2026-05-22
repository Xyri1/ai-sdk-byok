CREATE OR REPLACE FUNCTION public.ai_sdk_byok_get_credentials_by_id(
  p_user_id text,
  p_key_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key public.ai_sdk_byok_keys%ROWTYPE;
  v_secret text;
BEGIN
  SELECT *
    INTO v_key
    FROM public.ai_sdk_byok_keys
   WHERE id = p_key_id
     AND user_id = p_user_id;

  IF v_key.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE id = v_key.vault_secret_id;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_key.id,
    'user_id', v_key.user_id,
    'provider', v_key.provider,
    'label', v_key.label,
    'key_hint', v_key.key_hint,
    'created_at', v_key.created_at,
    'updated_at', v_key.updated_at,
    'credentials', v_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_sdk_byok_get_credentials_by_id(text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_sdk_byok_get_credentials_by_id(text, uuid)
  TO service_role;
