-- More than one person on the dashboard.
--
-- Everyone on the admin list can do everything in the app. The one difference is
-- that only an owner can add or remove people.

alter table public.admins
  add column role       text not null default 'admin' check (role in ('owner', 'admin')),
  add column invited_by text,
  add column created_at timestamptz not null default now();

update public.admins set role = 'owner' where email = 'elviva96@gmail.com';

create or replace function public.is_owner()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and a.role = 'owner'
  )
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- An owner is never left out: the last one cannot be removed or demoted.
create or replace function private.guard_admins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' and (select count(*) from public.admins where role = 'owner') <= 1 then
      raise exception 'The last owner cannot be removed.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner'
     and (select count(*) from public.admins where role = 'owner') <= 1 then
    raise exception 'The last owner cannot be changed to an admin.';
  end if;
  return new;
end $$;

create trigger admins_guard
before update or delete on public.admins
for each row execute function private.guard_admins();

-- Everyone with access can see who else has access; only owners can change the list.
drop policy if exists "Admin can read admins" on public.admins;
create policy "Admins can see the list" on public.admins
  for select to authenticated using ((select public.is_admin()));
create policy "Owners add people" on public.admins
  for insert to authenticated with check ((select public.is_owner()));
create policy "Owners remove people" on public.admins
  for delete to authenticated using ((select public.is_owner()));
create policy "Owners change roles" on public.admins
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

grant insert, update, delete on public.admins to authenticated;

-- Lets an invited person sign in for the first time without the owner creating
-- their login by hand. Returns only true/false for the email asked about.
create or replace function public.email_invited(p_email text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.email = lower(trim(p_email)))
$$;
revoke execute on function public.email_invited(text) from public;
grant execute on function public.email_invited(text) to anon, authenticated;
