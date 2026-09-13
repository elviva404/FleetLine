const moneyFormat = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value) {
  const n = Number(value ?? 0);
  const sign = n < 0 ? "−" : "";
  return `${sign}GH₵ ${moneyFormat.format(Math.abs(n))}`;
}

// Dates from the database are plain "YYYY-MM-DD"; format without shifting timezones.
export function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function todayAccra() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Accra" });
}

export function formatPercent(fraction) {
  return `${Math.round(Number(fraction ?? 0) * 100)}%`;
}

// schedule_diff = paid − expected by now
export function scheduleStatus(diff) {
  const n = Number(diff ?? 0);
  if (n < 0) return { tone: "red", label: `Behind by ${formatMoney(-n)}` };
  if (n > 0) return { tone: "green", label: `Ahead by ${formatMoney(n)}` };
  return { tone: "green", label: "On track" };
}

export const SERVICE_STATUS = {
  ok: { tone: "green", label: "OK" },
  due_soon: { tone: "amber", label: "Due soon" },
  overdue: { tone: "red", label: "Overdue" },
  never_logged: { tone: "muted", label: "Not logged yet" },
};

export const PAYMENT_STATUS = {
  pending: { tone: "amber", label: "Pending" },
  approved: { tone: "green", label: "Approved" },
  rejected: { tone: "red", label: "Rejected" },
};

export const AGREEMENT_STATUS = {
  active: { tone: "navy", label: "Active" },
  completed: { tone: "green", label: "Owned" },
  terminated: { tone: "red", label: "Terminated" },
};
