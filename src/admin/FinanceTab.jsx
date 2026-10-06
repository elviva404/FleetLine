import { useState } from "react";
import { formatMoney } from "../lib/format.js";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Badge, Card, Empty, Loading, Money, Notice, ProgressBar } from "../ui.jsx";
import CarDetail from "./CarDetail.jsx";

export default function FinanceTab() {
  const [selectedId, setSelectedId] = useState(null);
  const { data: cars, error } = useLoad(
    () => must(supabase.from("vehicle_finance").select("*").order("make_model")),
    []
  );

  if (selectedId) return <CarDetail vehicleId={selectedId} onBack={() => setSelectedId(null)} />;
  if (error && !cars) return <Notice tone="red">{error}</Notice>;
  if (!cars) return <Loading />;

  const totals = cars.reduce(
    (sum, c) => ({
      cost: sum.cost + Number(c.cost_basis),
      collected: sum.collected + Number(c.collected),
    }),
    { cost: 0, collected: 0 }
  );

  return (
    <>
      <Card title="Every car" aside={<span className="muted small">{cars.length}</span>}>
        {cars.length === 0 ? (
          <Empty>No cars yet.</Empty>
        ) : (
          <ul className="ledger">
            {cars.map((c) => {
              const brokenEven = Number(c.net_position) > 0;
              const progress = Number(c.cost_basis) > 0 ? Number(c.collected) / Number(c.cost_basis) : 1;
              return (
                <li key={c.vehicle_id} className="ledger-row clickable" onClick={() => setSelectedId(c.vehicle_id)}>
                  <div className="ledger-main stack" style={{ gap: 6 }}>
                    <div className="row">
                      <span className="ledger-title">{c.make_model}</span>
                      {brokenEven ? (
                        <Badge tone="green">In profit</Badge>
                      ) : (
                        <Badge tone="amber">Paying for itself</Badge>
                      )}
                    </div>
                    <div className="ledger-meta">
                      {c.plate || "No plate"} · cost {formatMoney(c.cost_basis)}
                    </div>
                    <ProgressBar value={progress} />
                    <div className="ledger-meta">{formatMoney(c.collected)} collected</div>
                  </div>
                  <div className="ledger-side">
                    <Money
                      value={formatMoney(brokenEven ? c.net_position : c.remaining_to_break_even)}
                      className={brokenEven ? "money-green" : ""}
                    />
                    <span className="ledger-meta">{brokenEven ? "profit" : "to break even"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {cars.length > 1 && (
        <Card title="All cars together">
          <ul className="ledger">
            <li className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">Spent on cars</div>
                <div className="ledger-meta">Purchase prices plus running costs</div>
              </div>
              <div className="ledger-side">
                <Money value={formatMoney(totals.cost)} />
              </div>
            </li>
            <li className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">Collected from drivers</div>
                <div className="ledger-meta">Approved payments and deposits</div>
              </div>
              <div className="ledger-side">
                <Money value={formatMoney(totals.collected)} />
              </div>
            </li>
            <li className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">{totals.collected >= totals.cost ? "Ahead by" : "Still to recover"}</div>
              </div>
              <div className="ledger-side">
                <Money
                  value={formatMoney(Math.abs(totals.collected - totals.cost))}
                  className={totals.collected >= totals.cost ? "money-green" : "money-red"}
                />
              </div>
            </li>
          </ul>
        </Card>
      )}
    </>
  );
}
