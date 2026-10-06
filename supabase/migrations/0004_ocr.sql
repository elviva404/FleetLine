-- Keeps what the app read from a payment screenshot, so the owner can see when a
-- driver's typed details don't match the screenshot they attached.
-- Also stores the owner's MoMo account name(s) and number(s) for the receiver check.

alter table public.settings
  add column momo_accounts text[] not null default '{}';

alter table public.payments
  add column ocr_amount    numeric(12,2),
  add column ocr_reference text,
  add column ocr_receiver  text,
  add column ocr_source    text check (ocr_source in ('screenshot', 'pasted'));

-- Drivers submit what was read alongside what they typed.
create or replace function public.driver_submit_payment(
  p_token text,
  p_amount numeric,
  p_paid_on date,
  p_reference text default null,
  p_note text default null,
  p_screenshot_path text default null,
  p_ocr_amount numeric default null,
  p_ocr_reference text default null,
  p_ocr_receiver text default null,
  p_ocr_source text default null)
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

  insert into public.payments (
    agreement_id, amount, paid_on, reference, note, screenshot_path, status, submitted_by,
    ocr_amount, ocr_reference, ocr_receiver, ocr_source)
  values (
    v_agreement_id, p_amount, p_paid_on,
    nullif(trim(p_reference), ''), nullif(trim(p_note), ''), p_screenshot_path,
    'pending', 'driver',
    p_ocr_amount, nullif(trim(p_ocr_reference), ''), nullif(trim(p_ocr_receiver), ''),
    case when p_ocr_source in ('screenshot', 'pasted') then p_ocr_source end)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'A payment with this transaction ID has already been recorded.';
end $$;

revoke execute on function public.driver_submit_payment(text, numeric, date, text, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.driver_submit_payment(text, numeric, date, text, text, text, numeric, text, text, text) to anon, authenticated;

-- The old 6-argument version is replaced by the one above.
drop function if exists public.driver_submit_payment(text, numeric, date, text, text, text);

-- Driver portal: include what was read, so an edited payment still shows its origin.
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
