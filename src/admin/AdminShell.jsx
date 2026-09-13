import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { Button, Card, Empty, Masthead, Page } from "../ui.jsx";
import ApprovalsTab from "./ApprovalsTab.jsx";
import CarsTab from "./CarsTab.jsx";
import DriversTab from "./DriversTab.jsx";
import SettingsTab from "./SettingsTab.jsx";

const TABS = [
  { id: "drivers", label: "Drivers" },
  { id: "approvals", label: "Approvals" },
  { id: "cars", label: "Cars" },
  { id: "finance", label: "Finance" },
  { id: "settings", label: "Settings" },
];

export default function AdminShell({ session }) {
  const [tab, setTab] = useState("drivers");
  const [pendingCount, setPendingCount] = useState(0);
  const [countVersion, setCountVersion] = useState(0);
  const refreshCount = () => setCountVersion((v) => v + 1);

  useEffect(() => {
    supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => setPendingCount(count ?? 0));
  }, [tab, countVersion]);

  return (
    <>
      <Masthead
        title="Dashboard"
        subtitle={session.user.email}
        action={
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        }
      />
      <Page>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "approvals" && pendingCount > 0 && <span className="tab-count">{pendingCount}</span>}
            </button>
          ))}
        </nav>

        {tab === "drivers" && <DriversTab onChanged={refreshCount} />}
        {tab === "approvals" && <ApprovalsTab onChanged={refreshCount} />}
        {tab === "cars" && <CarsTab />}
        {tab === "finance" && (
          <Card title="Finance">
            <Empty>Not built yet.</Empty>
          </Card>
        )}
        {tab === "settings" && <SettingsTab />}
      </Page>
    </>
  );
}
