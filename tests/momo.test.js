import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReceiver, parseMomoText, pickBestTransaction } from "../src/lib/momo.js";

// Real MTN MoMo messages supplied by the owner (names kept as received).
const MTN_SCREENSHOT = `
Payment made for GHS 25.00 to JEFFREY CHRISTOPHER NII LAATE LARTEY Current Balance: GHS 26.27 . Available Balance: GHS 26.27. Reference: suitDeposit. Transaction ID: 90943722314. Fee charged: GHS0.38 Tax charged: 0. Download the MoMo App for a Faster & Easier Experience. Click here: https://mtnmymomo.onelink.me/XJOt/MoMo
Cash In received for GHS 2991.00 from ADOFO DIGITAL ENTERPRISE. Current Balance GHS 3017.27 Available Balance GHS 3017.27. Transaction ID: 90944592901, Fee charged: GHS 0. Cash in (Deposit) is a free transaction on MTN Mobile Money. Please do not pay any fees for it.
Payment received for GHS 230.00 from ELIKEM YAO VIVA SAVIE Current Balance: GHS 3247.27 . Available Balance: GHS 3247.27. Reference: ELIKEM YAO VIVA SAVIE ,233209387205,winnerPay from VODAFONE. Transaction ID: 90944637014. TRANSACTION FEE: 0.00
Payment made for GHS 1000.00 to GEORGINA BESAVI Current Balance: GHS 2239.77 . Available Balance: GHS 2239.77. Reference: Salary. Transaction ID: 90944742547. Fee charged: GHS7.50 Tax charged: 0. Download the MoMo App for a Faster & Easier Experience. Click here: https://mtnmymomo.onelink.me/XJOt/MoMo
Payment made for GHS 60.00 to MOHAMMED FANKIBE Current Balance: GHS 2179.32 . Available Balance: GHS 2179.32. Reference: deliveryVitz. Transaction ID: 90945758310. Fee charged: GHS0.45 Tax charged: 0. Download the MoMo App for a Faster & Easier Experience. Click here: https://mtnmymomo.onelink.me/XJOt/MoMo
`;

test("reads every message in a screenshot of five", () => {
  const found = parseMomoText(MTN_SCREENSHOT);
  assert.equal(found.length, 5);
  assert.deepEqual(
    found.map((t) => t.amount),
    [25, 2991, 230, 1000, 60]
  );
  assert.deepEqual(
    found.map((t) => t.reference),
    ["90943722314", "90944592901", "90944637014", "90944742547", "90945758310"]
  );
  assert.deepEqual(
    found.map((t) => t.direction),
    ["sent", "received", "received", "sent", "sent"]
  );
});

test("never mistakes a balance or a fee for the amount", () => {
  for (const t of parseMomoText(MTN_SCREENSHOT)) {
    assert.ok(![26.27, 3017.27, 3247.27, 2239.77, 2179.32].includes(t.amount), `balance read as amount: ${t.amount}`);
    assert.ok(![0.38, 7.5, 0.45].includes(t.amount), `fee read as amount: ${t.amount}`);
  }
});

test("reads who was paid, the reference and the fee", () => {
  const [first] = parseMomoText(MTN_SCREENSHOT);
  assert.equal(first.counterparty, "JEFFREY CHRISTOPHER NII LAATE LARTEY");
  assert.equal(first.note, "suitDeposit");
  assert.equal(first.fee, 0.38);
  assert.equal(first.network, "MTN MoMo");
});

test("MTN messages carry no date, so none is invented", () => {
  for (const t of parseMomoText(MTN_SCREENSHOT)) assert.equal(t.paid_on, null);
});

test("picks the largest payment the driver sent, not one they received", () => {
  const best = pickBestTransaction(parseMomoText(MTN_SCREENSHOT));
  assert.equal(best.amount, 1000);
  assert.equal(best.direction, "sent");
  assert.equal(best.counterparty, "GEORGINA BESAVI");
});

test("one message on its own still parses", () => {
  const [only] = parseMomoText(
    "Payment made for GHS 1,250.50 to KOFI MENSAH Current Balance: GHS 80.00 . Reference: week 12. Transaction ID: 90945111222. Fee charged: GHS1.25"
  );
  assert.equal(only.amount, 1250.5);
  assert.equal(only.reference, "90945111222");
  assert.equal(only.note, "week 12");
});

test("reads other networks' wording", () => {
  const telecel = parseMomoText(
    "You have sent GHS 500.00 to KWAME OWUSU 0201234567 on 05/10/2026. Transaction ID: 7788991122. Your new balance is GHS 112.40. Telecel Cash"
  )[0];
  assert.equal(telecel.amount, 500);
  assert.equal(telecel.paid_on, "2026-10-05");
  assert.equal(telecel.reference, "7788991122");
  assert.equal(telecel.network, "Telecel Cash");
  assert.deepEqual(telecel.phones, ["233201234567"]);

  const airtel = parseMomoText(
    "Transfer of GHS 300.00 to AMA SERWAA on 5 Oct 2026 was successful. Reference No: 556677889900. Fee: GHS 2.00. Balance: GHS 45.00. AirtelTigo Money"
  )[0];
  assert.equal(airtel.amount, 300);
  assert.equal(airtel.paid_on, "2026-10-05");
  assert.equal(airtel.reference, "556677889900");
  assert.equal(airtel.network, "AirtelTigo Money");
});

test("survives the letter-for-digit mistakes OCR makes", () => {
  const [t] = parseMomoText(
    "Payment made for GHS 6O.00 to MOHAMMED FANKIBE Current Balance: GHS 2179.32 . Transaction ID: 9O9457583lO. Fee charged: GHS0.45"
  );
  assert.equal(t.reference, "90945758310");
});

test("flags a payment sent to someone other than the owner", () => {
  const [toOwner] = parseMomoText(
    "Payment made for GHS 1000.00 to ELIKEM SAVIE Current Balance: GHS 50.00 . Transaction ID: 90944742547. Fee charged: GHS7.50"
  );
  const [toStranger] = parseMomoText(
    "Payment made for GHS 1000.00 to GEORGINA BESAVI Current Balance: GHS 50.00 . Transaction ID: 90944742548. Fee charged: GHS7.50"
  );
  assert.equal(checkReceiver(toOwner, ["Elikem Savie", "0249409007"]), "match");
  assert.equal(checkReceiver(toStranger, ["Elikem Savie", "0249409007"]), "mismatch");
  assert.equal(checkReceiver(toOwner, []), "unknown");
});

test("matches the owner by number however it is written", () => {
  const [t] = parseMomoText(
    "You have sent GHS 250.00 to +233 24 940 9007 on 05/10/2026. Transaction ID: 7788991123. Balance: GHS 10.00"
  );
  assert.equal(checkReceiver(t, ["0249409007"]), "match");
});

test("ignores empty or unrelated text", () => {
  assert.deepEqual(parseMomoText(""), []);
  assert.deepEqual(parseMomoText("Hello, are you coming today?"), []);
});
