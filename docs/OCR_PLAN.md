# FleetLine — OCR plan (step 7)

Goal: a driver photographs or screenshots their MoMo confirmation, the app reads the
**amount, date and transaction ID** from it, and fills the payment form in for them to check.
Typing stays possible; OCR is the easy path, not the only one.

---

## 1. What runs where

OCR runs **in the driver's browser** (Tesseract.js). Nothing is sent to any outside service,
and there is no running cost.

Measured download sizes (one time per phone, then cached by the browser):

| File | Size |
|---|---|
| Recognition engine (WebAssembly) | 3.5 MB |
| English language data ("fast" model) | 2.0 MB |
| Tesseract.js library | ~0.2 MB |
| **Total first use** | **~5.7 MB** |

The full-accuracy language model is 10.9 MB instead of 2.0 MB. On mobile data that is a lot
for a small gain on clean screenshots, so the plan uses the fast model.

Nothing downloads until the driver actually picks a photo, so a driver who types their
payment never pays that cost.

---

## 2. The flow the driver sees

1. Taps **Add MoMo screenshot** and picks the image.
2. "Reading your screenshot…" with a progress bar (typically 3–8 seconds on a mid-range phone).
3. Fields fill in, each marked **read from screenshot — please check**.
4. The driver corrects anything wrong and taps **Send payment**. Never auto-submitted.
5. If reading fails, times out (25 seconds), or the phone is too old, the form simply opens
   empty with "Couldn't read it — please type the details." Nothing blocks the payment.

A **Paste MoMo message** box stays available for drivers who prefer copying the SMS text.
The same parser reads pasted text, so both paths behave the same.

---

## 3. Image handling

- OCR reads the **original image**, before the small upload copy is made. Compressing first
  would throw away the detail OCR needs.
- Before reading: scale the long edge to about 1600px, convert to grayscale, raise contrast.
- **Dark mode screenshots** are common on Android. If the image is mostly dark, invert it,
  since Tesseract expects dark text on a light background.
- The uploaded screenshot stays as today: ~720px wide JPEG.

---

## 4. Reading the values

Parsing is label-driven first, pattern-driven second.

| Field | How it is found |
|---|---|
| **Amount** | A labelled amount first ("Amount", "You have sent", "Amount Paid"). Currency forms: `GHS`, `GH¢`, `GHC`, `₵`, `GH₵`. |
| **Date** | `05/10/2026`, `05-10-26`, `5 Oct 2026`, `2026-10-05`, with optional time. Day-first when ambiguous, matching Ghanaian usage. **MTN messages carry no date at all** (confirmed from real samples), so the date falls back to today for the driver to confirm. |
| **Transaction ID** | After "Transaction ID", "Reference", "Financial Transaction Id", "Ref", "Txn ID"; else a standalone 8–15 digit number. |
| **Receiver** | MTN names the person paid ("to GEORGINA BESAVI") and gives no number, so the receiver check matches on **name first, number second**. Settings therefore stores the owner's MoMo account name(s) as well as number(s). |

**Traps to avoid:** a screenshot also shows **Fee**, **Current Balance**, **New Balance** and
sometimes **Available Balance**. Picking the balance instead of the amount would be the worst
possible error, so amounts next to balance or fee labels are explicitly rejected, never
"the biggest number on screen".

Networks covered: **MTN MoMo**, **Telecel Cash**, **AirtelTigo Money**, in both SMS and in-app
screenshot wording.

**One screenshot usually holds several messages.** The real sample held five. The app reads
them all, prefers money the driver *sent* (not received), and when more than one candidate is
found it asks the driver to tap the right one instead of guessing.

**This is the part that needs real samples.** Each network words its messages differently and
changes them over time. Until 3–5 real screenshots per network are available, the parsers are
written against published formats and tested on screenshots I generate, which proves the
pipeline works but not that the wording matches what your drivers actually receive.

---

## 5. Checks that help the owner

- **Duplicate:** the transaction ID is already unique in the database. Reading it
  automatically means the same payment can't be submitted twice by accident.
- **Mismatch:** if the driver edits the amount, date or ID away from what was read,
  the approvals screen can show both ("typed GH₵ 1,000 · screenshot said GH₵ 100").
- **Wrong receiver:** if your MoMo number is stored in Settings, a screenshot paying someone
  else can be flagged for your attention.

Both of the last two depend on decisions below.

---

## 6. Build order

1. **Parser + tests.** Pure text-in, values-out. Tested against a table of sample messages
   from all three networks, including balance/fee traps. Runs with no browser.
2. **Paste-the-message box.** Ships the parser to drivers immediately, no download.
3. **OCR engine.** Lazy loading, progress, timeout, dark-mode handling, cancel.
4. **Form integration.** Highlighted pre-filled fields, "please check" wording.
5. **Verification.** I generate realistic MoMo screenshots for each network, run them through
   the real pipeline in a browser, and report how many fields each one got right.
6. **Tuning on real samples**, once you send them.

---

## 7. Decisions (confirmed 2026-10-06)

- **Networks:** all three — MTN MoMo, Telecel Cash, AirtelTigo Money.
- **Keep what OCR read:** yes. New columns on `payments`: `ocr_amount`, `ocr_paid_on`,
  `ocr_reference`, `ocr_receiver`, `ocr_engine`. Approvals shows a warning when the driver's
  typed values differ from what was read.
- **Receiver check:** yes. `settings.momo_numbers` holds the owner's MoMo number(s). If a
  screenshot names a different receiver, the payment is flagged at approval. A number that is
  not found at all is reported as "couldn't tell", never as a mismatch.
- **Hosting:** engine files (~5.5 MB) committed to the repo and served from
  `elviva404.github.io/FleetLine/`, so nothing depends on an outside CDN.

### Still needed from the owner
- 3–5 real MoMo confirmation screenshots per network, for tuning (section 4).
- The MoMo number(s) drivers pay into, entered in Settings once built.

### Note on storing OCR text
Only the extracted fields are stored, not the whole text block. The receiver name and number
are personal data belonging to the driver and whoever they paid, so keeping the minimum is
both simpler and safer under Ghana's Data Protection Act.


---

## 8. Verified on the owner's real screenshot (2026-10-06)

The real MTN screenshot (354 x 724 px, five messages) was run through the finished pipeline
in a browser:

| Check | Result |
|---|---|
| Payments found | 5 of 5 |
| Amounts | GH₵ 25, 2,991, 230, 1,000, 60 — all correct |
| Transaction IDs | 5 of 5 correct |
| Receiver names | 5 of 5 read |
| Balances/fees mistaken for the amount | none |
| Time (engine already downloaded) | ~1.3 s |

Two fixes came out of it:
- Phone screenshots are small (354 px wide). At that size Tesseract misread one digit
  (`...722314` as `...727314`). Images under 1100 px wide are now enlarged up to 3x before
  reading, which fixed it.
- OCR turns capital I into `!`, `|` or `l` (`NII` became `Nil`). Names are now compared in a
  loose form so the receiver check still matches the owner.
