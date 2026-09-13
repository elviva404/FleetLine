# FleetLine — Build Plan

Work-and-pay (drive-to-own) payment ledger for a small Ghana fleet.
Mobile web app on GitHub Pages, data in Supabase. All amounts in GHS, all dates in Africa/Accra time.

---

## 1. How the business works (as the app models it)

- The owner buys a car and hands it to a driver under a **work-and-pay agreement**.
- Every driver pays the **same weekly installment** (one global setting).
- Each agreement has a **deposit**, paid in full before the car is handed over. It counts toward the car price, can't be changed later, and is kept by the owner if the agreement is terminated. It is stored as a payment of kind `deposit`, created together with the agreement.
- Each agreement has its own **car price** (what the driver pays in total to own that car).
- The agreement ends when total approved payments reach **car price + extras**. Missed weeks push the finish date later; there is no fixed number of weeks.
- **Extras** (damage repairs, fines the owner paid, etc.) are added to the amount the driver must pay to own the car. They are also listed separately so both sides can see what was added and why.
- **Maintenance** is paid by the driver, except oil, which the owner buys. The owner logs every service so the app can track what is due; only the owner's spend (e.g. oil) counts as a cost.
- If a driver defaults, the owner **terminates** the agreement and takes the car back. History is kept; the car can go to a new driver under a new agreement.

---

## 2. Data model

### `settings` (single row)
| field | notes |
|---|---|
| weekly_installment | GHS, same for all drivers |
| due_soon_days | how many days before a service is due to show "due soon" (default 7) |

### `drivers`
| field | notes |
|---|---|
| id | uuid |
| name, phone | |
| access_token | long random secret used in the driver's link; admin can reset it if a phone is lost |
| created_at | |

### `vehicles`
| field | notes |
|---|---|
| id | uuid |
| make_model, plate | |
| purchase_price | GHS, owner's cost to buy |
| purchase_date | |
| notes | |

### `agreements`
| field | notes |
|---|---|
| id | uuid |
| driver_id, vehicle_id | one **active** agreement per driver and per vehicle at a time |
| car_price | GHS the driver must pay to own the car (before extras) |
| start_date | |
| status | `active` · `completed` · `terminated` |
| ended_on, end_note | set when completed or terminated |

### `extras`
| field | notes |
|---|---|
| id, agreement_id | |
| amount, date, description | e.g. "Front bumper repair" |
| owner_cost | optional: what the owner actually spent, so it also counts as a car cost |

### `payments`
| field | notes |
|---|---|
| id, agreement_id | |
| amount, paid_on | |
| reference | MoMo transaction ID (from OCR or typed); used to warn about duplicates |
| note | |
| screenshot_path | file in private storage bucket, or null |
| status | `pending` · `approved` · `rejected` |
| submitted_by | `driver` · `admin` |
| reviewed_at, review_note | |
| created_at | |

Rules: drivers may edit/delete only their own **pending** payments. Approved payments can never be edited or deleted; mistakes are fixed with an **adjustment** (below).

### `adjustments`
| field | notes |
|---|---|
| id, agreement_id | |
| amount | positive or negative, added to "paid" total |
| date, reason | required reason, shown to driver |

### `service_types`
| field | notes |
|---|---|
| id, name | defined by admin, e.g. "Oil change" |
| default_interval_days | e.g. 30 |

### `vehicle_service_intervals` (only when overriding the default)
| vehicle_id, service_type_id, interval_days |

### `maintenance_logs`
| field | notes |
|---|---|
| id, vehicle_id, service_type_id | |
| performed_on | |
| owner_cost | what the owner spent (e.g. oil), 0 if the driver paid it all |
| note | |

### `vehicle_costs`
| field | notes |
|---|---|
| id, vehicle_id | |
| category | insurance, roadworthy, registration, other |
| amount, date, note | |

---

## 3. Calculated figures (never stored)

Per agreement:
- **paid** = approved payments + adjustments
- **amount to own** = car_price + extras
- **remaining** = amount to own − paid → agreement is ready to complete when ≤ 0
- **progress** = paid ÷ amount to own
- **expected by now** = min(deposit + completed weeks since start × weekly_installment, amount to own)
- **schedule** = paid − expected by now → On track / Ahead by X / Behind by X
- **estimated weeks left** = remaining ÷ weekly_installment, rounded up
- **pending** = sum of pending payments (shown separately, not counted)

Per vehicle (finance, admin only):
- **cost basis** = purchase_price + vehicle_costs + maintenance owner_cost + extras owner_cost
- **collected** = approved payments + adjustments, across all agreements on that car
- **remaining to break even** = cost basis − collected
- **profit so far** = collected − cost basis (shown once positive)
- **profit/week (average)** = profit so far ÷ weeks since first agreement started
- **profit/week (forward)** = weekly_installment − average weekly owner costs
- **expected total profit** = amount to own (active agreement) + collected on earlier terminated agreements − cost basis

Per vehicle & service type (maintenance):
- **next due** = last performed_on + interval (override if set, else default)
- **status** = OK · Due soon (within due_soon_days) · Overdue · Never logged
- Tracking stops once the agreement is completed (car belongs to driver).

---

## 4. Access & security

- **Admin:** signs in with an emailed magic link (Supabase Auth). Only the owner's email is allowed; all tables are admin-only by default.
- **Driver:** no login. Their link is `…/#d=<access_token>`. Driver reads and writes go through database functions that check the token and only ever return that driver's own agreement, payments, extras and maintenance status. A driver link can't list or open other drivers' records.
- Opening the app without a token shows the admin sign-in page, never the dashboard.
- **Screenshots:** private storage bucket, not publicly readable; shown via short-lived signed links.
- The publishable key lives in the frontend (safe by design). The secret key is never used in the app.
- Row-level security is verified with Supabase's security advisor before real data goes in. *(Exact mechanism for driver screenshot uploads to be confirmed while building step 2.)*

---

## 5. Screens

Keep the navy / gold / cream passbook look (Space Grotesk, Inter, IBM Plex Mono).

**Driver (from link)**
1. Ownership card: progress bar, paid / remaining, schedule status, estimated weeks left
2. Log a payment: **take/upload screenshot → OCR pre-fills amount, date, reference → driver checks → submit**; "Paste MoMo message" as a fallback; manual entry always possible
3. Payment history with pending / approved / rejected badges and screenshot thumbnails
4. Extras list (what was added to the price and why)
5. Maintenance status per service type

**Admin**
1. Home: drivers list with progress, schedule status, **pending approvals count**, **overdue maintenance flag**
2. Approvals queue: screenshot beside the entered details, duplicate-reference warning, approve / reject with note
3. Driver/agreement detail: ledger, add payment (auto-approved), add extra, add adjustment, copy/reset link, complete or terminate agreement
4. Vehicles: add car, purchase price, costs, maintenance log, interval overrides
5. Finance (per car): figures from section 3
6. Settings: weekly installment, service types and default intervals, due-soon days

---

## 6. OCR details

- Tesseract.js runs in the browser, loaded only when a screenshot is picked (not on page load, to spare drivers' data).
- Image is compressed first (~720px wide) for both storage and OCR speed.
- Parsers for common MoMo formats (MTN MoMo, Telecel Cash, AirtelTigo Money): amount after "GHS"/"GH¢", date patterns, "Transaction ID"/"Ref". Same parsers used for pasted SMS text.
- Fields are pre-filled and highlighted as "read from screenshot — please check". Never auto-submits.
- Sample screenshots from real payments are needed to tune the parsers.

---

## 7. Build order

1. **Database setup script** — tables, calculations as SQL views, access rules, storage bucket. Owner runs it in the Supabase SQL Editor.
2. **App skeleton** — Vite + React, Supabase client, routing (admin vs driver link), design system, admin sign-in.
3. **Core ledger** — drivers, vehicles, agreements, payments with approvals, extras, adjustments, driver view. *Usable for real at this point.*
4. **Deploy** — GitHub repo, GitHub Actions → GitHub Pages, Supabase auth redirect URL.
5. **Maintenance tracking.**
6. **Finance dashboard.**
7. **OCR** — needs a few real MoMo screenshots.
8. **Lock down** — security advisor check, switch to production use, backup/export (CSV) of the ledger.

## 8. Open items

- Weekly installment amount (entered in Settings, not needed to build).
- Owner's admin email for sign-in.
- Contract: work-and-pay is likely closer to hire purchase than a services agreement; check Ghana's Hire-Purchase Act with whoever drafts it, and align the "terminated" rules in the app with the contract.
