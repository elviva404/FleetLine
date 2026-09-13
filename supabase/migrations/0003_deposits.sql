-- Deposits: paid in full when the car is handed to the driver, set per agreement,
-- counts toward the car price, kept by the owner if the agreement is terminated.

alter table public.agreements
  add column deposit numeric(12,2) not null default 0 check (deposit >= 0);
alter table public.agreements
  add constraint agreements_deposit_below_price check (deposit < car_price);

alter table public.payments
  add column kind text not null default 'installment' check (kind in ('deposit', 'installment'));
create unique index payments_one_deposit_per_agreement
  on public.payments (agreement_id) where kind = 'deposit';

-- ---------------------------------------------------------------------
-- Integrity rules
-- ---------------------------------------------------------------------

create or replace function private.guard_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_deposit numeric;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'Only pending payments can be deleted. Add an adjustment instead.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'deposit' then
      select a.deposit into v_deposit from public.agreements a where a.id = new.agreement_id;
      if new.status <> 'approved' or new.submitted_by <> 'admin' or new.amount <> v_deposit then
        raise exception 'Deposits are recorded when the agreement is started.';
      end if;
    end if;
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
    if new.status <> 'pending'
       or (new.amount, new.paid_on, new.reference, new.note, new.screenshot_path, new.agreement_id)
          is distinct from
          (old.amount, old.paid_on, old.reference, old.note, old.screenshot_path, old.agreement_id) then
      raise exception 'Rejected payments can only be reopened for review.';
    end if;
  end if;

  if new.kind <> old.kind then
    raise exception 'A payment cannot be changed into a deposit.';
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
  if new.deposit <> old.deposit then
    raise exception 'The deposit cannot be changed after the agreement has started.';
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

-- ---------------------------------------------------------------------
-- Schedule now expects the deposit up front plus one installment per week.
-- (New column appended at the end so dependent views stay valid.)
-- ---------------------------------------------------------------------

create or replace view public.agreement_summary with (security_invoker = true) as
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
  end                                      as est_weeks_left,
  a.deposit
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
cross join lateral (
  select greatest(0, floor((coalesce(a.ended_on, private.today_accra()) - a.start_date) / 7.0))::int as weeks_elapsed
) w
cross join lateral (
  select least(a.deposit + w.weeks_elapsed * s.weekly_installment, c.amount_to_own) as expected_by_now
) e
where s.id = 1;

-- ---------------------------------------------------------------------
-- Start an agreement and record its deposit in one step.
-- Runs as the caller, so admin-only access rules and triggers still apply.
-- ---------------------------------------------------------------------

create or replace function public.admin_start_agreement(
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_car_price numeric,
  p_start_date date,
  p_deposit numeric default 0,
  p_deposit_paid_on date default null,
  p_deposit_reference text default null)
returns uuid
language plpgsql volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if coalesce(p_deposit, 0) >= p_car_price then
    raise exception 'The deposit must be less than the price to own.';
  end if;

  insert into public.agreements (driver_id, vehicle_id, car_price, start_date, deposit)
  values (p_driver_id, p_vehicle_id, p_car_price, p_start_date, coalesce(p_deposit, 0))
  returning id into v_id;

  if coalesce(p_deposit, 0) > 0 then
    insert into public.payments (agreement_id, amount, paid_on, reference, note, kind, status, submitted_by)
    values (v_id, p_deposit, coalesce(p_deposit_paid_on, p_start_date),
            nullif(trim(p_deposit_reference), ''), 'Deposit', 'deposit', 'approved', 'admin');
  end if;

  return v_id;
end $$;

revoke execute on function public.admin_start_agreement(uuid, uuid, numeric, date, numeric, date, text) from public, anon;
grant execute on function public.admin_start_agreement(uuid, uuid, numeric, date, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- Driver portal: include payment kind so deposits are labelled.
-- ---------------------------------------------------------------------

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
               'kind', p.kind, 'submitted_by', p.submitted_by, 'review_note', p.review_note,
               'created_at', p.created_at)
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
