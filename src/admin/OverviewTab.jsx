import BarChart from "../components/BarChart.jsx";
import { formatMoney, todayAccra } from "../lib/format.js";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Card, Empty, Loading, Money, Notice, ProgressBar } from "../ui.jsx";

const WEEKS_SHOWN = 12;

// Monday of the week a date falls in, in plain YYYY-MM-DD.
function weekStart(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function shiftWeeks(iso, weeks) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

function weekLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

async function loadOverview() {
  const firstWeek = shiftWeeks(weekStart(todayAccra()), -(WEEKS_SHOWN - 1));
  const [payments, drivers, cars] = await Promise.all([
    must(
      supabase
        .from("payments")
        .select("amount, paid_on")
        .eq("status", "approved")
        .gte("paid_on", firstWeek)
    ),
    must(supabase.from("admin_driver_overview").select("*")),
    must(supabase.from("vehicle_finance").select("*").order("make_model")),
  ]);

  const buckets = new Map();
  for (let i = 0; i < WEEKS_SHOWN; i += 1) {
    buckets.set(shiftWeeks(firstWeek, i), 0);
  }
  for (const payment of payments) {
    const key = weekStart(payment.paid_on);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + Number(payment.amount));
  }

  return {
    weekly: [...buckets.entries()].map(([start, value], index) => ({
      label: `Week of ${weekLabel(start)}`,
      short: index % 2 === 0 ? weekLabel(start).split(" ")[0] : "",
      value,
    })),
    drivers,
    cars,
  };
}

// `demo` is only passed by the local preview route, never in the real app.
export default function OverviewTab({ demo }) {
  const { data, error } = useLoad(() => (demo ? Promise.resolve(demo) : loadOverview()), [demo]);

  if (error && !data) return <Notice tone="red">{error}</Notice>;
  if (!data) return <Loading />;

  const { weekly, drivers, cars } = data;
  const active = drivers.filter((d) => d.agreement_status === "active");
  const thisWeek = weekly[weekly.length - 1]?.value ?? 0;
  const lastWeek = weekly[weekly.length - 2]?.value ?? 0;
  const owed = active.reduce((sum, d) => sum + Math.max(0, Number(d.remaining)), 0);
  const behind = active.filter((d) => Number(d.schedule_diff) < 0);
  const pending = drivers.reduce((sum, d) => sum + Number(d.pending_count || 0), 0);
  const overdue = active.filter((d) => Number(d.overdue_services) > 0);
  const collected = cars.reduce((sum, c) => sum + Number(c.collected), 0);
  const costs = cars.reduce((sum, c) => sum + Number(c.cost_basis), 0);

  return (
    <>
      <Card className="passbook" title="This week">
        <div className="passbook-label">Collected since Monday</div>
        <div className="passbook-figure">{formatMoney(thisWeek)}</div>
        <div className="small">
          {lastWeek === 0
            ? "Nothing recorded last week."
            : thisWeek >= lastWeek
              ? `${formatMoney(thisWeek - lastWeek)} more than last week.`
              : `${formatMoney(lastWeek - thisWeek)} less than last week.`}
        </div>
        <div className="passbook-grid">
          <div>
            <div className="passbook-label">Still owed by drivers</div>
            <Money value={formatMoney(owed)} />
          </div>
          <div>
            <div className="passbook-label">Collected all time</div>
            <Money value={formatMoney(collected)} />
          </div>
        </div>
      </Card>

      <div className="tiles">
        <Tile label="Drivers" value={active.length} note={`${drivers.length} on record`} />
        <Tile label="Behind schedule" value={behind.length} alert={behind.length > 0}
              note={behind.length ? behind.map((d) => d.name).join(", ") : "Everyone on track"} />
        <Tile label="To approve" value={pending} alert={pending > 0}
              note={pending ? "Waiting for you" : "Nothing waiting"} />
        <Tile label="Service overdue" value={overdue.length} alert={overdue.length > 0}
              note={overdue.length ? overdue.map((d) => d.make_model).join(", ") : "All up to date"} />
      </div>

      <Card title="Collected each week" aside={<span className="muted small">last {WEEKS_SHOWN} weeks</span>}>
        {weekly.every((w) => w.value === 0) ? (
          <Empty>No approved payments yet.</Empty>
        ) : (
          <BarChart data={weekly} format={formatMoney} label={`Money collected each week for the last ${WEEKS_SHOWN} weeks`} />
        )}
      </Card>

      <Card title="Cars paying for themselves">
        {cars.length === 0 ? (
          <Empty>No cars yet.</Empty>
        ) : (
          <ul className="ledger">
            {cars.map((c) => {
              const progress = Number(c.cost_basis) > 0 ? Number(c.collected) / Number(c.cost_basis) : 1;
              const inProfit = Number(c.net_position) > 0;
              return (
                <li key={c.vehicle_id} className="ledger-row">
                  <div className="ledger-main stack" style={{ gap: 6 }}>
                    <div className="ledger-title">{c.make_model}</div>
                    <ProgressBar value={progress} />
                    <div className="ledger-meta">
                      {formatMoney(c.collected)} of {formatMoney(c.cost_basis)} recovered
                    </div>
                  </div>
                  <div className="ledger-side">
                    <Money
                      value={formatMoney(inProfit ? c.net_position : c.remaining_to_break_even)}
                      className={inProfit ? "money-green" : ""}
                    />
                    <span className="ledger-meta">{inProfit ? "profit" : "to go"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {cars.length > 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Spent {formatMoney(costs)} on cars, collected {formatMoney(collected)} so far.
          </p>
        )}
      </Card>
    </>
  );
}

function Tile({ label, value, note, alert = false }) {
  return (
    <div className={`tile${alert ? " tile-alert" : ""}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}
