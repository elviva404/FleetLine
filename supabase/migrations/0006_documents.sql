-- Papers: signed agreements (per driver) and insurance / roadworthy (per car).
-- Uploaded by the owner. A driver sees only their own signed agreement and the
-- papers of the car they are driving. Expiry dates drive "expires soon" warnings.

alter table public.settings
  add column paper_warning_days int not null default 30 check (paper_warning_days between 0 and 180);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('agreement', 'insurance', 'roadworthy', 'other')),
  driver_id    uuid references public.drivers(id) on delete cascade,
  vehicle_id   uuid references public.vehicles(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete set null,
  title        text not null check (length(trim(title)) > 0),
  -- Files live at "<access_key>/<name>" in the documents bucket. Knowing the path
  -- is what grants access, exactly like a driver's link.
  access_key   text not null unique default private.random_token(),
  file_path    text not null,
  mime_type    text,
  size_bytes   integer,
  issued_on    date,
  expires_on   date,
  note         text,
  created_at   timestamptz not null default now(),
  -- Agreements belong to a driver; car papers belong to a car.
  check (kind <> 'agreement' or driver_id is not null),
  check (kind not in ('insurance', 'roadworthy') or vehicle_id is not null)
);
create index documents_driver_idx on public.documents (driver_id);
create index documents_vehicle_idx on public.documents (vehicle_id);
create index documents_expiry_idx on public.documents (expires_on) where expires_on is not null;

alter table public.documents enable row level security;
create policy "Admin full access" on public.documents
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.documents from anon;

create or replace function private.is_document_key(p_key text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select p_key is not null and exists (select 1 from public.documents d where d.access_key = p_key)
$$;
revoke execute on function private.is_document_key(text) from public;
grant execute on function private.is_document_key(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "Admin full access to documents" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()))
  with check (bucket_id = 'documents' and (select public.is_admin()));

create policy "Anyone with the document path can read it" on storage.objects
  for select to anon
  using (bucket_id = 'documents' and private.is_document_key((storage.foldername(name))[1]));

-- Expiry status per document, for the dashboard and the car page.
create view public.document_status with (security_invoker = true) as
select
  d.*,
  case
    when d.expires_on is null then 'none'
    when d.expires_on < private.today_accra() then 'expired'
    when d.expires_on <= private.today_accra() + s.paper_warning_days then 'expiring'
    else 'valid'
  end as expiry_status
from public.documents d
cross join public.settings s
where s.id = 1;

-- Deleting a driver also removes their papers; return those files too.
create or replace function public.admin_delete_driver(p_driver_id uuid)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_name text;
  v_screenshots text[];
  v_documents text[];
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

  select coalesce(array_agg(doc.file_path), '{}') into v_documents
  from public.documents doc
  where doc.driver_id = p_driver_id;

  perform set_config('fleetline.purge', 'on', true);

  delete from public.documents doc where doc.driver_id = p_driver_id;
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
    'screenshots', to_jsonb(v_screenshots || v_documents));
end $$;

revoke execute on function public.admin_delete_driver(uuid) from public, anon;
grant execute on function public.admin_delete_driver(uuid) to authenticated;

-- Driver portal: their signed agreement plus the papers of the car they drive.
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
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', doc.id, 'kind', doc.kind, 'title', doc.title, 'file_path', doc.file_path,
               'mime_type', doc.mime_type, 'issued_on', doc.issued_on, 'expires_on', doc.expires_on,
               'expiry_status', doc.expiry_status)
             order by doc.kind, doc.created_at desc)
      from public.document_status doc
      where doc.driver_id = d.id
         or (s.status = 'active' and doc.vehicle_id = s.vehicle_id
             and doc.kind in ('insurance', 'roadworthy'))), '[]'::jsonb),
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
