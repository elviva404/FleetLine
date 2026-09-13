-- Fix: adding a driver failed with "permission denied for function random_token".
-- Column defaults run as the signed-in user, who has no access to private helpers.
-- Run the token generator with its owner's privileges instead.

create or replace function private.random_token()
returns text
language sql volatile
security definer
set search_path = ''
as $$ select encode(extensions.gen_random_bytes(20), 'hex') $$;

revoke execute on function private.random_token() from public, anon;
grant execute on function private.random_token() to authenticated;
