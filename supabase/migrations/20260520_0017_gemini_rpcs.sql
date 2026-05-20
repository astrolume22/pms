-- =====================================================================
-- Phase 5 — Gemini API plumbing
--   • Stores the user-supplied Gemini API key in `account.gemini_api_key_encrypted`
--     using `pgp_sym_encrypt`.
--   • The encryption passphrase lives in a private `internal.app_secrets`
--     table that only the super-user owns; no `authenticated` role grant.
--     The SECURITY DEFINER RPCs below run as the function owner (postgres,
--     which has BYPASSRLS) and read the passphrase to encrypt / decrypt.
--   • `gemini_invoke` fires the actual HTTPS call via `pg_net.net.http_post`
--     and polls for the response synchronously (up to 25 s).
--
-- The frontend never sees the key in plaintext again after Save.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- Private secrets table — only the postgres role (function owner) can
-- access it. authenticated / anon get no usage on the schema.
-- ---------------------------------------------------------------------
create schema if not exists internal;
revoke all on schema internal from public;

create table if not exists internal.app_secrets (
  key   text primary key,
  value text not null
);

-- Seed the master passphrase once. Use a random 36-char uuid so the
-- value isn't predictable.  Re-runs are no-ops thanks to the conflict
-- clause.
insert into internal.app_secrets (key, value)
values ('gemini_passphrase', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- set_gemini_key — admin only.  Encrypts the supplied key with the
-- master passphrase and writes the ciphertext to account.gemini_api_key_encrypted.
-- ---------------------------------------------------------------------
create or replace function public.set_gemini_key(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare v_pass text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set the Gemini key' using errcode = '42501';
  end if;
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'Key cannot be empty' using errcode = '22023';
  end if;

  select value into v_pass from internal.app_secrets where key = 'gemini_passphrase';
  if v_pass is null then
    raise exception 'master passphrase missing — re-run migration 0017';
  end if;

  update public.account
  set gemini_api_key_encrypted = encode(pgp_sym_encrypt(p_key, v_pass), 'base64');
end;
$$;

revoke all on function public.set_gemini_key(text) from public;
grant execute on function public.set_gemini_key(text) to authenticated;

-- ---------------------------------------------------------------------
-- clear_gemini_key — admin only
-- ---------------------------------------------------------------------
create or replace function public.clear_gemini_key() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can clear the Gemini key' using errcode = '42501';
  end if;
  update public.account set gemini_api_key_encrypted = null;
end;
$$;

revoke all on function public.clear_gemini_key() from public;
grant execute on function public.clear_gemini_key() to authenticated;

-- ---------------------------------------------------------------------
-- get_gemini_status — anyone with board access; returns whether a key is set
-- ---------------------------------------------------------------------
create or replace function public.get_gemini_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'configured', exists(select 1 from public.account where gemini_api_key_encrypted is not null)
  );
$$;

revoke all on function public.get_gemini_status() from public;
grant execute on function public.get_gemini_status() to authenticated;

-- ---------------------------------------------------------------------
-- gemini_invoke — the workhorse. Decrypts the key, hits the Gemini
-- REST endpoint via pg_net, polls for the response, and returns
-- `{ ok, status, text, raw }`.
--
-- p_system is prepended to the user's prompt; pass NULL to skip.
-- p_model: 'gemini-2.5-flash' (fast/cheap, default) or 'gemini-2.5-pro' (smart).
-- ---------------------------------------------------------------------
create or replace function public.gemini_invoke(
  p_prompt text,
  p_system text default null,
  p_model  text default 'gemini-2.5-flash',
  p_feature text default 'chat'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_pass text;
  v_req_id bigint;
  v_resp record;
  v_url text;
  v_body jsonb;
  v_parts jsonb;
  v_tries int := 0;
  v_text text;
  v_actor uuid := auth.uid();
begin
  if not public.is_active_user() then
    raise exception 'Active session required' using errcode = '42501';
  end if;

  -- 1. Fetch + decrypt the key
  select value into v_pass from internal.app_secrets where key = 'gemini_passphrase';
  select pgp_sym_decrypt(decode(a.gemini_api_key_encrypted, 'base64'), v_pass)::text
    into v_key
  from public.account a
  where a.gemini_api_key_encrypted is not null
  limit 1;

  if v_key is null or length(v_key) = 0 then
    insert into public.ai_runs (user_id, feature, prompt, status, error_message)
    values (v_actor, p_feature::text, p_prompt, 'not_configured', 'No Gemini API key set');
    return jsonb_build_object('ok', false, 'reason', 'not_configured');
  end if;

  -- 2. Build request body
  v_parts := jsonb_build_array(jsonb_build_object('text', coalesce(p_system,'') || E'\n\n' || coalesce(p_prompt,'')));
  v_body  := jsonb_build_object(
    'contents', jsonb_build_array(jsonb_build_object('parts', v_parts)),
    'generationConfig', jsonb_build_object('temperature', 0.2, 'maxOutputTokens', 2048)
  );
  v_url := 'https://generativelanguage.googleapis.com/v1beta/models/' || p_model || ':generateContent?key=' || v_key;

  -- 3. Fire it
  select net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  ) into v_req_id;

  -- 4. Poll synchronously (max ~25 s).  Supabase statement timeout on
  -- the authenticated role is 8 s by default — we extend it just for
  -- this function below.
  loop
    select * into v_resp from net._http_response where id = v_req_id;
    if found and v_resp.status_code is not null then exit; end if;
    perform pg_sleep(0.5);
    v_tries := v_tries + 1;
    if v_tries > 50 then
      insert into public.ai_runs (user_id, feature, prompt, status, error_message)
      values (v_actor, p_feature::text, p_prompt, 'error', 'timeout');
      return jsonb_build_object('ok', false, 'reason', 'timeout');
    end if;
  end loop;

  -- 5. Parse response text
  begin
    v_text := (v_resp.content::jsonb #>> '{candidates,0,content,parts,0,text}');
  exception when others then
    v_text := null;
  end;

  insert into public.ai_runs (user_id, feature, prompt, response, model, status, target_type)
  values (v_actor, p_feature::text, p_prompt, v_text, p_model,
          case when v_resp.status_code = 200 then 'success' else 'error' end,
          null);

  return jsonb_build_object(
    'ok',     v_resp.status_code = 200,
    'status', v_resp.status_code,
    'text',   v_text,
    'raw',    case when v_resp.status_code <> 200 then v_resp.content::jsonb else null end
  );
end;
$$;

-- Extend statement timeout for this single function so the synchronous
-- poll loop has time to complete.
alter function public.gemini_invoke(text, text, text, text) set statement_timeout = '30s';

revoke all on function public.gemini_invoke(text, text, text, text) from public;
grant execute on function public.gemini_invoke(text, text, text, text) to authenticated;
