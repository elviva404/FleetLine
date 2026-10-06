// Local-only preview of admin screens with made-up data, so layouts can be
// checked without signing in. Never part of the production build.
import OverviewTab from "../admin/OverviewTab.jsx";
import { Masthead, Page } from "../ui.jsx";

const demoOverview = {
  weekly: [
    ["21 Jul", 3000], ["28 Jul", 4000], ["4 Aug", 2000], ["11 Aug", 5000],
    ["18 Aug", 4000], ["25 Aug", 0], ["1 Sep", 6000], ["8 Sep", 3500],
    ["15 Sep", 4000], ["22 Sep", 4500], ["29 Sep", 2000], ["6 Oct", 5500],
  ].map(([label, value], index) => ({ label: `Week of ${label}`, short: index % 2 === 0 ? label.split(" ")[0] : "", value })),
  drivers: [
    { driver_id: "1", name: "Kwame Mensah", agreement_status: "active", remaining: 59700, schedule_diff: -500, pending_count: 1, overdue_services: 1, make_model: "Toyota Vitz" },
    { driver_id: "2", name: "Ama Boateng", agreement_status: "active", remaining: 41000, schedule_diff: 1500, pending_count: 0, overdue_services: 0, make_model: "Kia Picanto" },
    { driver_id: "3", name: "Yaw Darko", agreement_status: "terminated", remaining: 12000, schedule_diff: -4000, pending_count: 0, overdue_services: 0, make_model: "Honda Fit" },
  ],
  papers: [{ title: "Insurance 2026 (Toyota Vitz)", expiry_status: "expiring" }],
  cars: [
    { vehicle_id: "a", make_model: "Toyota Vitz", plate: "GR 4821-24", collected: 21500, cost_basis: 51150, net_position: -29650, remaining_to_break_even: 29650 },
    { vehicle_id: "b", make_model: "Kia Picanto", plate: "GR 1120-23", collected: 48000, cost_basis: 40000, net_position: 8000, remaining_to_break_even: 0 },
  ],
};

export default function Preview({ name }) {
  return (
    <>
      <Masthead title="Dashboard" subtitle="local preview with made-up data" />
      <Page>{name === "overview" ? <OverviewTab demo={demoOverview} /> : <p>Unknown preview: {name}</p>}</Page>
    </>
  );
}
