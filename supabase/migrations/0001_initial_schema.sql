-- =====================================================================
-- Fleet Ledger — initial database setup
-- Run once, in a fresh Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- Access model
--   * Admin: signs in (magic link). Must be listed in public.admins with a
--     confirmed email. Has full access to every table through RLS.
--   * Driver: no login. Uses the secret access_token from their link and only
--     reaches data through the driver_* functions below, which return that
--     driver's own records. Anonymous users cannot read any table directly.
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function private.today_accra()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Africa/Accra')::date $$;

create or replace function private.random_token()
returns text
language sql volatile
set search_path = ''
as $$ select encode(extensions.gen_random_bytes(20), 'hex') $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.admins (
  email text primary key check (email = lower(email))
);

create table public.settings (
  id                 int primary key default 1 check (id = 1),
  weekly_installment numeric(12,2) not null default 0 check (weekly_installment >= 0),
  due_soon_days      int not null default 7 check (due_soon_days between 0 and 60),
  updated_at         timestamptz not null default now()
);

create table public.drivers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  phone        text,
  access_token text not null unique default private.random_token(),
  storage_key  text not null unique default private.random_token(),
  created_at   timestamptz not null default now()
);

create table public.vehicles (
  id             uuid primary key default gen_random_uuid(),
  make_model     text not null check (length(trim(make_model)) > 0),
  plate          text unique,
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  purchase_date  date,
  notes          text,
  created_at     timestamptz not null default now()
);

create table public.agreements (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references public.drivers(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  car_price  numeric(12,2) not null check (car_price > 0),
  start_date date not null,
  status     text not null default 'active' check (status in ('active', 'completed', 'terminated')),
  ended_on   date,
  end_note   text,
  created_at timestamptz not null default now(),
  check ((status = 'active') = (ended_on is null)),
  check (ended_on is null or ended_on >= start_date)
);

-- One active agreement per driver and per vehicle.
create unique index agreements_one_active_per_driver  on public.agreements (driver_id)  where status = 'active';
create unique index agreements_one_active_per_vehicle on public.agreements (vehicle_id) where status = 'active';
create index agreements_vehicle_idx on public.agreements (vehicle_id);

-- Extras change the amount the driver must pay to own the car.
-- Negative amounts are credits (e.g. reversing an extra entered by mistake).
create table public.extras (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete restrict,
  amount       numeric(12,2) not null check (amount <> 0),
  date         date not null,
  description  text not null check (length(trim(description)) > 0),
  owner_cost   numeric(12,2) not null default 0 check (owner_cost >= 0),
  created_at   timestamptz not null default now()
);
create index extras_agreement_idx on public.extras (agreement_id);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  agreement_id    uuid not null references public.agreements(id) on delete restrict,
  amount          numeric(12,2) not null check (amount > 0),
  paid_on         date not null,
  reference       text,
  note            text,
  screenshot_path text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by    text not null check (submitted_by in ('driver', 'admin')),
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payments_agreement_idx on public.payments (agreement_id);
create index payments_pending_idx   on public.payments (status) where status = 'pending';
-- The same MoMo transaction cannot be recorded twice (rejected ones excluded).
create unique index payments_unique_reference
  on public.payments (lower(reference))
  where reference is not null and status <> 'rejected';

-- Corrections to the amount paid, with a reason. Positive or negative.
create table public.adjustments (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete restrict,
  amount       numeric(12,2) not null check (amount <> 0),
  date         date not null,
  reason       text not null check (length(trim(reason)) > 0),
  created_at   timestamptz not null default now()
);
create index adjustments_agreement_idx on public.adjustments (agreement_id);

create table public.service_types (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique check (length(trim(name)) > 0),
  default_interval_days int not null check (default_interval_days > 0),
  archived              boolean not null default false,
  created_at            timestamptz not null default now()
);

create table public.vehicle_service_intervals (
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  interval_days   int not null check (interval_days > 0),
  primary key (vehicle_id, service_type_id)
);

create table public.maintenance_logs (
  id              uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references public.vehicles(id) on delete restrict,
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  performed_on    date not null,
  owner_cost      numeric(12,2) not null default 0 check (owner_cost >= 0),
  note            text,
  created_at      timestamptz not null default now()
);
create index maintenance_logs_vehicle_type_idx on public.maintenance_logs (vehicle_id, service_type_id, performed_on desc);

create table public.vehicle_costs (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  category   text not null check (category in ('insurance', 'roadworthy', 'registration', 'repair', 'other')),
  amount     numeric(12,2) not null check (amount > 0),
  date       date not null,
  note       text,
  created_at timestamptz not null default now()
);
create index vehicle_costs_vehicle_idx on public.vehicle_costs (vehicle_id);

-- ---------------------------------------------------------------------
-- Calculated views (security_invoker: callers only see what RLS allows)
-- ---------------------------------------------------------------------

create view public.agreement_summary with (security_invoker = true) as
select
  a.id as agreement_id,
  a.driver_id,
  a.vehicle_id,
  a.status,
  a.start_date,
  a.ended_on,
  a.car_price,
  coalesce(x.total, 0)                     as extras_total,
  c.amount_to_own,
  c.paid,
  c.amount_to_own - c.paid                 as remaining,
  round(least(1, greatest(0, c.paid / c.amount_to_own)), 4) as progress,
  coalesce(p.pending_total, 0)             as pending_total,
  coalesce(p.pending_count, 0)::int        as pending_count,
  p.last_paid_on,
  w.weeks_elapsed,
  e.expected_by_now,
  c.paid - e.expected_by_now               as schedule_diff,
  case
    when c.amount_to_own - c.paid <= 0 then 0
    when s.weekly_installment > 0 then ceil((c.amount_to_own - c.paid) / s.weekly_installment)::int
  end                                      as est_weeks_left
from public.agreements a
cross join public.settings s
left join (
  select agreement_id, sum(amount) as total
  from public.extras group by agreement_id
) x on x.agreement_id = a.id
left join (
  select agreement_id,
         sum(amount) filter (where status = 'approved') as approved_total,
         sum(amount) filter (where status = 'pending')  as pending_total,
         count(*)    filter (where status = 'pending')  as pending_count,
         max(paid_on) filter (where status = 'approved') as last_paid_on
  from public.payments group by agreement_id
) p on p.agreement_id = a.id
left join (
  select agreement_id, sum(amount) as total
  from public.adjustments group by agreement_id
) j on j.agreement_id = a.id
cross join lateral (
  select a.car_price + coalesce(x.total, 0)                   as amount_to_own,
         coalesce(p.approved_total, 0) + coalesce(j.total, 0) as paid
) c
-- An installment is expected at the end of each completed week since start.
cross join lateral (
  select greatest(0, floor((coalesce(a.ended_on, private.today_accra()) - a.start_date) / 7.0))::int as weeks_elapsed
) w
cross join lateral (
  select least(w.weeks_elapsed * s.weekly_installment, c.amount_to_own) as expected_by_now
) e
where s.id = 1;

create view public.vehicle_service_status with (security_invoker = true) as
select
  v.id  as vehicle_id,
  st.id as service_type_id,
  st.name as service_name,
  i.interval_days,
  last.performed_on as last_performed_on,
  last.performed_on + i.interval_days as next_due_on,
  case
    when last.performed_on is null                                            then 'never_logged'
    when last.performed_on + i.interval_days <  private.today_accra()        then 'overdue'
    when last.performed_on + i.interval_days <= private.today_accra() + s.due_soon_days then 'due_soon'
    else 'ok'
  end as status
from public.vehicles v
cross join public.service_types st
cross join public.settings s
left join public.vehicle_service_intervals vsi
  on vsi.vehicle_id = v.id and vsi.service_type_id = st.id
cross join lateral (
  select coalesce(vsi.interval_days, st.default_interval_days) as interval_days
) i
left join lateral (
  select max(m.performed_on) as performed_on
  from public.maintenance_logs m
  where m.vehicle_id = v.id and m.service_type_id = st.id
) last on true
where s.id = 1
  and not st.archived
  -- Once a car has been handed over to its driver, it is no longer tracked.
  and not exists (
    select 1 from public.agreements a
    where a.vehicle_id = v.id and a.status = 'completed'
  );

create view public.vehicle_finance with (security_invoker = true) as
select
  v.id as vehicle_id,
  v.make_model,
  v.plate,
  v.purchase_price,
  k.other_costs,
  k.maintenance_costs,
  k.extras_costs,
  r.running_costs,
  r.cost_basis,
  coalesce(ag.collected, 0)                          as collected,
  greatest(r.cost_basis - coalesce(ag.collected, 0), 0) as remaining_to_break_even,
  coalesce(ag.collected, 0) - r.cost_basis           as net_position,
  ag.first_start,
  coalesce(ag.has_active, false)                     as has_active_agreement,
  coalesce(ag.handed_over, false)                    as handed_over,
  ag.handed_over_on,
  round(t.weeks_active, 1)                           as weeks_active,
  case
    when coalesce(ag.collected, 0) > r.cost_basis and t.weeks_active is not null
      then round((ag.collected - r.cost_basis) / t.weeks_active, 2)
  end                                                as profit_per_week_avg,
  case
    when coalesce(ag.has_active, false)
      then round(s.weekly_installment - r.running_costs / t.weeks_active, 2)
  end                                                as profit_per_week_forward,
  case
    when coalesce(ag.has_active, false) or coalesce(ag.handed_over, false)
      then ag.expected_collected - r.cost_basis
  end                                                as expected_total_profit
from public.vehicles v
cross join public.settings s
cross join lateral (
  select
    coalesce((select sum(c.amount)     from public.vehicle_costs c    where c.vehicle_id = v.id), 0) as other_costs,
    coalesce((select sum(m.owner_cost) from public.maintenance_logs m where m.vehicle_id = v.id), 0) as maintenance_costs,
    coalesce((select sum(e.owner_cost)
              from public.extras e join public.agreements a on a.id = e.agreement_id
              where a.vehicle_id = v.id), 0)                                                         as extras_costs
) k
cross join lateral (
  select k.other_costs + k.maintenance_costs + k.extras_costs                    as running_costs,
         v.purchase_price + k.other_costs + k.maintenance_costs + k.extras_costs as cost_basis
) r
left join (
  select vehicle_id,
         sum(paid)       as collected,
         min(start_date) as first_start,
         -- Active agreements are expected to collect the full amount to own.
         sum(case when status = 'active' then greatest(amount_to_own, paid) else paid end) as expected_collected,
         bool_or(status = 'active')    as has_active,
         bool_or(status = 'completed') as handed_over,
         max(ended_on) filter (where status = 'completed') as handed_over_on
  from public.agreement_summary
  group by vehicle_id
) ag on ag.vehicle_id = v.id
cross join lateral (
  select case when ag.first_start is not null
    then greatest(1, (coalesce(ag.handed_over_on, private.today_accra()) - ag.first_start) / 7.0)
  end as weeks_active
) t
where s.id = 1;

create view public.admin_driver_overview with (security_invoker = true) as
select
  d.id as driver_id,
  d.name,
  d.phone,
  d.created_at,
  sm.agreement_id,
  sm.status as agreement_status,
  v.id as vehicle_id,
  v.make_model,
  v.plate,
  sm.amount_to_own,
  sm.paid,
  sm.remaining,
  sm.progress,
  sm.schedule_diff,
  sm.est_weeks_left,
  sm.last_paid_on,
  coalesce(sm.pending_count, 0) as pending_count,
  coalesce(ms.overdue_count, 0)::int  as overdue_services,
  coalesce(ms.due_soon_count, 0)::int as due_soon_services
from public.drivers d
left join lateral (
  select * from public.agreement_summary a
  where a.driver_id = d.id
  order by (a.status = 'active') desc, a.start_date desc
  limit 1
) sm on true
left join public.vehicles v on v.id = sm.vehicle_id
left join lateral (
  select count(*) filter (where vs.status = 'overdue')  as overdue_count,
         count(*) filter (where vs.status = 'due_soon') as due_soon_count
  from public.vehicle_service_status vs
  where vs.vehicle_id = sm.vehicle_id and sm.status = 'active'
) ms on true;

-- ---------------------------------------------------------------------
-- Integrity rules (apply to everyone, admin included)
-- ---------------------------------------------------------------------

create or replace function private.guard_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'Only pending payments can be deleted. Add an adjustment instead.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      new.reviewed_at := now();
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'approved' then
    raise exception 'Approved payments are locked. Add an adjustment instead.';
  end if;

  if old.status = 'rejected' then
    -- The only allowed change is reopening it for review.
    if new.status <> 'pending'
       or (new.amount, new.paid_on, new.reference, new.note, new.screenshot_path, new.agreement_id)
          is distinct from
          (old.amount, old.paid_on, old.reference, old.note, old.screenshot_path, old.agreement_id) then
      raise exception 'Rejected payments can only be reopened for review.';
    end if;
  end if;

  if new.status is distinct from old.status then
    new.reviewed_at := case when new.status = 'pending' then null else now() end;
  end if;

  if new.agreement_id <> old.agreement_id or new.submitted_by <> old.submitted_by then
    raise exception 'A payment cannot be moved to another agreement.';
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger payments_guard
before insert or update or delete on public.payments
for each row execute function private.guard_payments();

create or replace function private.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% entries cannot be changed or deleted. Add a correcting entry instead.', initcap(tg_table_name);
end $$;

create trigger extras_append_only
before update or delete on public.extras
for each row execute function private.append_only();

create trigger adjustments_append_only
before update or delete on public.adjustments
for each row execute function private.append_only();

create or replace function private.guard_agreements()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_remaining numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'Agreements cannot be deleted. Terminate it instead.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception 'New agreements must start as active.';
    end if;
    if exists (select 1 from public.agreements a
               where a.vehicle_id = new.vehicle_id and a.status = 'completed') then
      raise exception 'This car has already been handed over to its owner.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'active' then
    raise exception 'This agreement has ended and can no longer be changed.';
  end if;
  if new.driver_id <> old.driver_id or new.vehicle_id <> old.vehicle_id then
    raise exception 'Driver and car cannot be changed on an agreement. Terminate it and start a new one.';
  end if;

  if new.status <> 'active' and new.ended_on is null then
    new.ended_on := private.today_accra();
  end if;

  if new.status = 'completed' then
    select s.amount_to_own - s.paid into v_remaining
    from public.agreement_summary s where s.agreement_id = new.id;
    if v_remaining > 0 then
      raise exception 'Cannot complete: GHS % is still owed.', v_remaining;
    end if;
  end if;

  return new;
end $$;

create trigger agreements_guard
before insert or update or delete on public.agreements
for each row execute function private.guard_agreements();

create or replace function private.touch_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger settings_touch
before update on public.settings
for each row execute function private.touch_settings();

-- ---------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
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
  )
$$;

create or replace function private.is_driver_storage_key(p_key text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select p_key is not null and exists (select 1 from public.drivers d where d.storage_key = p_key)
$$;

-- Row-level security: admin-only on every table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'drivers', 'vehicles', 'agreements', 'extras', 'payments', 'adjustments',
    'service_types', 'vehicle_service_intervals', 'maintenance_logs', 'vehicle_costs', 'settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Admin full access" on public.%I for all to authenticated
         using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

alter table public.admins enable row level security;
create policy "Admin can read admins" on public.admins
  for select to authenticated using ((select public.is_admin()));

-- Nothing is readable anonymously, even by accident.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.admins from authenticated;
revoke insert, delete on public.settings from authenticated;

-- ---------------------------------------------------------------------
-- Driver functions (called with the secret token from the driver's link)
-- ---------------------------------------------------------------------

create or replace function private.driver_from_token(p_token text)
returns public.drivers
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  d public.drivers;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link is not valid. Ask for a new one.';
  end if;
  select * into d from public.drivers where access_token = p_token;
  if not found then
    raise exception 'This link is not valid. Ask for a new one.';
  end if;
  return d;
end $$;

create or replace function private.check_driver_payment(
  p_driver public.drivers, p_amount numeric, p_paid_on date, p_screenshot_path text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'Enter a valid amount.';
  end if;
  if p_paid_on is null
     or p_paid_on > private.today_accra() + 1
     or p_paid_on < private.today_accra() - 180 then
    raise exception 'Enter a valid payment date.';
  end if;
  if p_screenshot_path is not null
     and (p_screenshot_path not like p_driver.storage_key || '/%' or p_screenshot_path like '%..%') then
    raise exception 'Invalid screenshot.';
  end if;
end $$;

create or replace function public.driver_portal(p_token text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  d public.drivers;
  s public.agreement_summary;
begin
  d := private.driver_from_token(p_token);

  select * into s
  from public.agreement_summary a
  where a.driver_id = d.id
  order by (a.status = 'active') desc, a.start_date desc
  limit 1;

  return jsonb_build_object(
    'driver', jsonb_build_object('name', d.name),
    'storage_key', d.storage_key,
    'weekly_installment', (select weekly_installment from public.settings where id = 1),
    'agreement', case when s.agreement_id is null then null
                      else to_jsonb(s) - 'driver_id' - 'vehicle_id' end,
    'vehicle', (select jsonb_build_object('make_model', v.make_model, 'plate', v.plate)
                from public.vehicles v where v.id = s.vehicle_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'amount', p.amount, 'paid_on', p.paid_on, 'reference', p.reference,
               'note', p.note, 'screenshot_path', p.screenshot_path, 'status', p.status,
               'submitted_by', p.submitted_by, 'review_note', p.review_note, 'created_at', p.created_at)
             order by p.paid_on desc, p.created_at desc)
      from public.payments p where p.agreement_id = s.agreement_id), '[]'::jsonb),
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'amount', e.amount, 'date', e.date, 'description', e.description)
             order by e.date desc, e.created_at desc)
      from public.extras e where e.agreement_id = s.agreement_id), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'amount', j.amount, 'date', j.date, 'reason', j.reason)
             order by j.date desc, j.created_at desc)
      from public.adjustments j where j.agreement_id = s.agreement_id), '[]'::jsonb),
    'maintenance', case when s.status = 'active' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'service', vs.service_name, 'interval_days', vs.interval_days,
               'last_performed_on', vs.last_performed_on, 'next_due_on', vs.next_due_on,
               'status', vs.status)
             order by vs.service_name)
      from public.vehicle_service_status vs where vs.vehicle_id = s.vehicle_id), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;

create or replace function public.driver_submit_payment(
  p_token text,
  p_amount numeric,
  p_paid_on date,
  p_reference text default null,
  p_note text default null,
  p_screenshot_path text default null)
returns uuid
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  d public.drivers;
  v_agreement_id uuid;
  v_id uuid;
begin
  d := private.driver_from_token(p_token);

  select a.id into v_agreement_id
  from public.agreements a
  where a.driver_id = d.id and a.status = 'active';
  if v_agreement_id is null then
    raise exception 'You have no active agreement.';
  end if;

  perform private.check_driver_payment(d, p_amount, p_paid_on, p_screenshot_path);

  insert into public.payments (agreement_id, amount, paid_on, reference, note, screenshot_path, status, submitted_by)
  values (v_agreement_id, p_amount, p_paid_on,
          nullif(trim(p_reference), ''), nullif(trim(p_note), ''), p_screenshot_path,
          'pending', 'driver')
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'A payment with this transaction ID has already been recorded.';
end $$;

create or replace function public.driver_update_payment(
  p_token text,
  p_payment_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_reference text default null,
  p_note text default null,
  p_screenshot_path text default null)
returns void
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  d public.drivers;
begin
  d := private.driver_from_token(p_token);
  perform private.check_driver_payment(d, p_amount, p_paid_on, p_screenshot_path);

  update public.payments p
  set amount = p_amount,
      paid_on = p_paid_on,
      reference = nullif(trim(p_reference), ''),
      note = nullif(trim(p_note), ''),
      screenshot_path = p_screenshot_path
  from public.agreements a
  where p.id = p_payment_id
    and p.agreement_id = a.id
    and a.driver_id = d.id
    and p.status = 'pending'
    and p.submitted_by = 'driver';

  if not found then
    raise exception 'Only your own pending payments can be edited.';
  end if;
exception
  when unique_violation then
    raise exception 'A payment with this transaction ID has already been recorded.';
end $$;

create or replace function public.driver_delete_payment(p_token text, p_payment_id uuid)
returns void
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  d public.drivers;
begin
  d := private.driver_from_token(p_token);

  delete from public.payments p
  using public.agreements a
  where p.id = p_payment_id
    and p.agreement_id = a.id
    and a.driver_id = d.id
    and p.status = 'pending'
    and p.submitted_by = 'driver';

  if not found then
    raise exception 'Only your own pending payments can be deleted.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------

-- Issue a new driver link (e.g. lost phone). The old link stops working.
create or replace function public.admin_reset_driver_link(p_driver_id uuid)
returns text
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  update public.drivers
  set access_token = private.random_token()
  where id = p_driver_id
  returning access_token into v_token;
  if v_token is null then
    raise exception 'Driver not found.';
  end if;
  return v_token;
end $$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
-- Needed by views and storage policies, which run as the calling role.
grant execute on function private.today_accra() to authenticated;
grant execute on function private.is_driver_storage_key(text) to anon;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_reset_driver_link(uuid) to authenticated;
grant execute on function public.driver_portal(text) to anon, authenticated;
grant execute on function public.driver_submit_payment(text, numeric, date, text, text, text) to anon, authenticated;
grant execute on function public.driver_update_payment(text, uuid, numeric, date, text, text, text) to anon, authenticated;
grant execute on function public.driver_delete_payment(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Screenshot storage (private bucket)
--   Driver files live under <storage_key>/..., admin can read everything.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Admin full access to screenshots" on storage.objects
  for all to authenticated
  using (bucket_id = 'screenshots' and (select public.is_admin()))
  with check (bucket_id = 'screenshots' and (select public.is_admin()));

create policy "Drivers upload to their folder" on storage.objects
  for insert to anon
  with check (bucket_id = 'screenshots'
              and private.is_driver_storage_key((storage.foldername(name))[1]));

create policy "Drivers read their folder" on storage.objects
  for select to anon
  using (bucket_id = 'screenshots'
         and private.is_driver_storage_key((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------

insert into public.admins (email) values ('elviva96@gmail.com');
insert into public.settings (id) values (1);
insert into public.service_types (name, default_interval_days) values ('Oil change', 30);
