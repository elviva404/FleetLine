// Sample data for previewing the driver screen locally (npm run dev, open #d=demo).
// Never used in the production build.
export const demoPortal = {
  driver: { name: "Kwame Mensah" },
  vehicle: { make_model: "Toyota Vitz", plate: "GR 4821-24" },
  weekly_installment: 1000,
  agreement: {
    status: "active",
    car_price: 80000,
    extras_total: 1200,
    amount_to_own: 81200,
    paid: 21500,
    remaining: 59700,
    progress: 0.2648,
    pending_total: 1000,
    pending_count: 1,
    schedule_diff: -500,
    est_weeks_left: 60,
    start_date: "2026-04-06",
    deposit: 10000,
  },
  payments: [
    { id: "p3", amount: 1000, paid_on: "2026-09-12", reference: "71234567890", note: null, status: "pending", submitted_by: "driver" },
    { id: "p2", amount: 1000, paid_on: "2026-09-05", reference: "71234560001", note: "Week 22", status: "approved", submitted_by: "driver" },
    { id: "p1", amount: 500, paid_on: "2026-08-29", reference: "71234550420", note: null, status: "rejected", submitted_by: "driver", review_note: "Amount does not match MoMo statement" },
    { id: "p0", amount: 10000, paid_on: "2026-04-06", reference: null, note: "Deposit", status: "approved", submitted_by: "admin", kind: "deposit" },
  ],
  adjustments: [{ id: "j1", amount: 500, date: "2026-08-30", reason: "Cash paid in person" }],
  extras: [{ id: "e1", amount: 1200, date: "2026-07-14", description: "Front bumper repair" }],
  maintenance: [
    { service: "Oil change", interval_days: 30, last_performed_on: "2026-08-10", next_due_on: "2026-09-09", status: "overdue" },
    { service: "Tyre check", interval_days: 90, last_performed_on: "2026-07-01", next_due_on: "2026-09-29", status: "ok" },
  ],
};
