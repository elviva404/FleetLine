-- Deleting a driver, a car, or a mistake.
--
-- Normal rules stay as they are: approved payments are locked, extras and corrections
-- are append-only, agreements can't be deleted. Those protections exist because the app
-- is the payment record.
--
-- This adds one deliberate exception: the owner can delete a driver together with
-- everything belonging to them. It is for mistakes and test data, not for tidying away
-- a driver whose history still matters.

create or replace function private.purging()
returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(current_setting('fleetline.purge', true), '') = 'on' $$;

-- The three guards now step aside during a purge.
create or replace function private.guard_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_deposit numeric;
begin
  if private.purging() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

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

create or replace function private.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.purging() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% entries cannot be changed or deleted. Add a correcting entry instead.', initcap(tg_table_name);
end $$;

create or replace function private.guard_agreements()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_remaining numeric;
begin
  if private.purging() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

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

-- Deletes a driver and every record belonging to them.
-- Returns the screenshot files to remove, and a count of what was deleted.
create or replace function public.admin_delete_driver(p_driver_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_name text;
  v_screenshots text[];
  v_payments int;
  v_agreements int;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;

  select d.name into v_name from public.drivers d where d.id = p_driver_id;
  if v_name is null then
    raise exception 'Driver not found.';
  end if;

  select coalesce(array_agg(p.screenshot_path) filter (where p.screenshot_path is not null), '{}'),
         count(*)
    into v_screenshots, v_payments
  from public.payments p
  join public.agreements a on a.id = p.agreement_id
  where a.driver_id = p_driver_id;

  perform set_config('fleetline.purge', 'on', true);

  delete from public.payments p using public.agreements a
    where p.agreement_id = a.id and a.driver_id = p_driver_id;
  delete from public.adjustments j using public.agreements a
    where j.agreement_id = a.id and a.driver_id = p_driver_id;
  delete from public.extras e using public.agreements a
    where e.agreement_id = a.id and a.driver_id = p_driver_id;
  delete from public.agreements a where a.driver_id = p_driver_id;
  get diagnostics v_agreements = row_count;
  delete from public.drivers d where d.id = p_driver_id;

  perform set_config('fleetline.purge', 'off', true);

  return jsonb_build_object(
    'name', v_name,
    'payments_deleted', v_payments,
    'agreements_deleted', v_agreements,
    'screenshots', to_jsonb(v_screenshots));
end $$;

revoke execute on function public.admin_delete_driver(uuid) from public, anon;
grant execute on function public.admin_delete_driver(uuid) to authenticated;
