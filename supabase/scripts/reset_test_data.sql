-- =====================================================================
-- FleetLine — wipe test data
--
-- Deletes ALL drivers, cars, agreements, payments, deposits, extras,
-- corrections, maintenance logs and car costs. Cannot be undone.
-- Run only BEFORE real business data goes in.
--
-- Keeps: your admin login, Settings (weekly installment), service types.
-- Screenshot files are not removed by this script; empty the
-- "screenshots" bucket in Storage separately.
--
-- TRUNCATE is used on purpose: the row-by-row delete protections
-- (locked approved payments, append-only extras) don't apply to it.
-- =====================================================================

begin;

truncate table
  public.payments,
  public.adjustments,
  public.extras,
  public.maintenance_logs,
  public.vehicle_costs,
  public.vehicle_service_intervals,
  public.agreements,
  public.vehicles,
  public.drivers;

commit;

select
  (select count(*) from public.drivers)       as drivers_left,
  (select count(*) from public.vehicles)      as cars_left,
  (select count(*) from public.payments)      as payments_left,
  (select count(*) from public.service_types) as service_types_kept,
  (select weekly_installment from public.settings where id = 1) as weekly_installment_kept;
