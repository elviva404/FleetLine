-- A history of who changed what.
--
-- Every change to money, agreements, cars, papers and access is recorded. The log
-- itself can only be read and added to: nobody, including an owner, can edit or
-- delete an entry through the app.

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  summary    text not null,
  details    jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;
create policy "Admins read the history" on public.audit_log
  for select to authenticated using ((select public.is_admin()));
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- Who is making the change: a signed-in admin, or someone using a driver link.
create or replace function private.actor()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = auth.uid();
  return coalesce(v_email, 'driver link');
exception when others then
  -- Never let working out "who" break the thing being recorded.
  return 'unknown';
end $$;

create or replace function private.money(p numeric)
returns text
language sql immutable
set search_path = ''
as $$ select 'GHS ' || to_char(coalesce(p, 0), 'FM999,999,999.00') $$;

create or replace function private.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_summary text;
  v_action text;
  v_id uuid;
  v_who text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  v_action := lower(tg_op);
  begin
    v_id := r.id;
  exception when others then
    v_id := null;
  end;

  if tg_table_name = 'payments' then
    select d.name into v_who
    from public.agreements a join public.drivers d on d.id = a.driver_id
    where a.id = r.agreement_id;

    if tg_op = 'INSERT' then
      v_summary := format('%s logged for %s (%s)', private.money(r.amount), coalesce(v_who, 'a driver'),
                          case when r.kind = 'deposit' then 'deposit' else r.status end);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := new.status;
      v_summary := format('%s from %s marked %s', private.money(new.amount), coalesce(v_who, 'a driver'), new.status);
    elsif tg_op = 'DELETE' then
      v_summary := format('%s from %s deleted', private.money(old.amount), coalesce(v_who, 'a driver'));
    else
      v_summary := format('%s from %s edited', private.money(new.amount), coalesce(v_who, 'a driver'));
    end if;

  elsif tg_table_name = 'agreements' then
    select d.name into v_who from public.drivers d where d.id = r.driver_id;
    if tg_op = 'INSERT' then
      v_summary := format('Agreement started with %s at %s', coalesce(v_who, 'a driver'), private.money(r.car_price));
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := new.status;
      v_summary := format('Agreement with %s %s', coalesce(v_who, 'a driver'),
                          case new.status when 'completed' then 'completed — car handed over' else 'ended, car taken back' end);
    elsif tg_op = 'UPDATE' and new.car_price is distinct from old.car_price then
      v_summary := format('Price for %s changed from %s to %s', coalesce(v_who, 'a driver'),
                          private.money(old.car_price), private.money(new.car_price));
    else
      v_summary := format('Agreement with %s edited', coalesce(v_who, 'a driver'));
    end if;

  elsif tg_table_name = 'extras' then
    select d.name into v_who
    from public.agreements a join public.drivers d on d.id = a.driver_id
    where a.id = r.agreement_id;
    v_summary := format('%s added to %s: %s', private.money(r.amount), coalesce(v_who, 'a driver'), r.description);

  elsif tg_table_name = 'adjustments' then
    select d.name into v_who
    from public.agreements a join public.drivers d on d.id = a.driver_id
    where a.id = r.agreement_id;
    v_summary := format('Correction of %s for %s: %s', private.money(r.amount), coalesce(v_who, 'a driver'), r.reason);

  elsif tg_table_name = 'drivers' then
    v_summary := case tg_op
      when 'INSERT' then format('Driver %s added', r.name)
      when 'DELETE' then format('Driver %s deleted', r.name)
      when 'UPDATE' then case when new.access_token is distinct from old.access_token
                              then format('New link made for %s', new.name)
                              else format('Driver %s edited', new.name) end
    end;

  elsif tg_table_name = 'vehicles' then
    v_summary := case tg_op
      when 'INSERT' then format('Car %s added', r.make_model)
      when 'DELETE' then format('Car %s deleted', r.make_model)
      else format('Car %s edited', r.make_model)
    end;

  elsif tg_table_name = 'documents' then
    v_summary := case tg_op
      when 'INSERT' then format('Paper uploaded: %s', r.title)
      when 'DELETE' then format('Paper deleted: %s', r.title)
      else format('Paper updated: %s', r.title)
    end;

  elsif tg_table_name = 'maintenance_logs' then
    select v.make_model into v_who from public.vehicles v where v.id = r.vehicle_id;
    v_summary := format('Service logged on %s', coalesce(v_who, 'a car'));

  elsif tg_table_name = 'vehicle_costs' then
    select v.make_model into v_who from public.vehicles v where v.id = r.vehicle_id;
    v_summary := format('%s %s cost on %s', private.money(r.amount), r.category, coalesce(v_who, 'a car'));

  elsif tg_table_name = 'admins' then
    v_summary := case tg_op
      when 'INSERT' then format('%s given dashboard access (%s)', r.email, r.role)
      when 'DELETE' then format('%s removed from the dashboard', r.email)
      else format('%s is now %s', r.email, r.role)
    end;
    v_id := null;

  elsif tg_table_name = 'settings' then
    v_summary := 'Settings changed';
    v_id := null;

  else
    v_summary := format('%s %s', initcap(tg_table_name), lower(tg_op));
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, summary, details)
  values (private.actor(), v_action, tg_table_name, v_id, v_summary,
          case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'payments', 'agreements', 'extras', 'adjustments', 'drivers', 'vehicles',
    'documents', 'maintenance_logs', 'vehicle_costs', 'admins', 'settings'
  ] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                      for each row execute function private.audit()', t, t);
  end loop;
end $$;
