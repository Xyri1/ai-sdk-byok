DROP FUNCTION IF EXISTS public.ai_sdk_byok_save_credentials(text, text, text, text, text);

CREATE FUNCTION public.ai_sdk_byok_save_credentials(
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

REVOKE ALL ON FUNCTION public.ai_sdk_byok_save_credentials(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_sdk_byok_save_credentials(text, text, text, text, text)
  TO service_role;
