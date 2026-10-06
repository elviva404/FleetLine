// Reads Ghanaian mobile money confirmation messages (typed, pasted or read by OCR)
// and pulls out the amount, transaction ID, who was paid and the reference.
//
// One screenshot often holds several messages, so this always returns a list.

const CURRENCY = "(?:GH[S¢₵C]|₵|GHS)";
const NUMBER = "(?:\\d{1,3}(?:[, ]\\d{3})+|\\d+)(?:\\.\\d{1,2})?";

// Where a new message starts inside a block of text.
const MESSAGE_START =
  /(?=Payment\s+(?:made|received)\s+for|Cash\s*In\s+received\s+for|You\s+have\s+(?:sent|received)|Transfer\s+of|Cash\s*Out)/gi;

const AMOUNT_PATTERNS = [
  new RegExp(`Payment\\s+made\\s+for\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"),
  new RegExp(`Payment\\s+received\\s+for\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"),
  new RegExp(`Cash\\s*In\\s+received\\s+for\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"),
  new RegExp(`You\\s+have\\s+(?:sent|received)\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"),
  new RegExp(`Transfer\\s+of\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"),
  new RegExp(`Amount\\s*(?:paid|sent)?\\s*[:\\-]?\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"),
];

// Never read these as the amount paid.
const TRAP_LABEL = /(balance|fee|tax|charge|charged|bal\b)/i;

const DATE_PATTERNS = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/,                                   // 2026-10-05
  /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/,                   // 05/10/2026, day first
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})\b/, // 5 Oct 2026
  /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/, // Oct 5, 2026
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// OCR commonly confuses these inside digit runs.
const DIGIT_FIXES = { O: "0", o: "0", D: "0", l: "1", I: "1", i: "1", S: "5", s: "5", B: "8", Z: "2", g: "9" };

function cleanText(text) {
  return String(text || "")
    .replace(/ /g, " ")
    .replace(/[|]/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toDigits(value) {
  return value.replace(/[A-Za-z]/g, (c) => DIGIT_FIXES[c] ?? "").replace(/\D/g, "");
}

function toAmount(value) {
  const n = Number(String(value).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findAmount(text) {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const before = text.slice(Math.max(0, match.index - 28), match.index);
    if (TRAP_LABEL.test(before)) continue;
    const amount = toAmount(match[1]);
    if (amount !== null && amount > 0) return amount;
  }

  // Last resort: the first currency amount that isn't a balance, fee or tax.
  const loose = new RegExp(`${CURRENCY}\\s*(${NUMBER})`, "gi");
  for (const match of text.matchAll(loose)) {
    const before = text.slice(Math.max(0, match.index - 28), match.index);
    if (TRAP_LABEL.test(before)) continue;
    const amount = toAmount(match[1]);
    if (amount !== null && amount > 0) return amount;
  }
  return null;
}

function findDate(text) {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    let year, month, day;
    if (pattern === DATE_PATTERNS[0]) {
      [, year, month, day] = match.map(Number);
    } else if (pattern === DATE_PATTERNS[1]) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
      if (year < 100) year += 2000;
      if (month > 12) return null; // ambiguous or misread
    } else if (pattern === DATE_PATTERNS[2]) {
      day = Number(match[1]);
      month = MONTHS[match[2].slice(0, 3).toLowerCase()];
      year = Number(match[3]);
      if (year < 100) year += 2000;
    } else {
      month = MONTHS[match[1].slice(0, 3).toLowerCase()];
      day = Number(match[2]);
      year = Number(match[3]);
    }
    if (!month || !day || !year || month > 12 || day > 31 || year < 2000 || year > 2100) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function findTransactionId(text) {
  const labelled = text.match(
    /(?:Transaction\s*(?:ID|Id|No|Number)|Financial\s*Transaction\s*Id|Txn\s*ID|Trans\s*ID|Receipt\s*(?:No|Number)|Ref(?:erence)?\s*(?:No|Number))\s*[:#.]?\s*([0-9A-Za-z]{6,20})/i
  );
  if (labelled) {
    const digits = toDigits(labelled[1]);
    if (digits.length >= 6) return digits;
  }
  const standalone = text.match(/\b(\d{8,15})\b/);
  return standalone ? standalone[1] : null;
}

function findReference(text) {
  const match = text.match(/Reference\s*[:\-]?\s*(.+?)(?=\s*(?:\.\s|Transaction\s*ID|Fee\s|TRANSACTION\s*FEE|$))/i);
  if (!match) return null;
  const value = match[1].trim().replace(/[\s.,;'’‘`"|!]+$/, "");
  return value.length ? value.slice(0, 120) : null;
}

// OCR turns capital I into ! or |, and NII into Nil. Names are compared loosely.
function tidyName(name) {
  return name.replace(/[!|]/g, "I").replace(/\s{2,}/g, " ").replace(/[.,;:\-]+$/, "").trim();
}

export function normaliseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[1!|l]/g, "i")
    .replace(/0/g, "o")
    .replace(/[^a-z ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findCounterparty(text) {
  const match = text.match(
    /(?:Payment\s+made\s+for|Payment\s+received\s+for|Cash\s*In\s+received\s+for|You\s+have\s+sent|Transfer\s+of)\s+[^\n]{0,24}?\s(?:to|from)\s+([A-Za-z+0-9][A-Za-z'’\-+ 0-9!|]{2,60}?)(?=\s*(?:Current\s*Balance|Available\s*Balance|\bon\b|[.,]|$))/i
  );
  if (!match) return null;
  return tidyName(match[1]);
}

function findPhones(text) {
  const found = new Set();
  for (const match of text.matchAll(/\b(?:\+?233|0)\s?\d{2}\s?\d{3}\s?\d{4}\b/g)) {
    found.add(normalisePhone(match[0]));
  }
  return [...found];
}

function findFee(text) {
  const match = text.match(new RegExp(`(?:Fee\\s*charged|TRANSACTION\\s*FEE|Fee)\\s*[:\\-]?\\s*${CURRENCY}?\\s*(${NUMBER})`, "i"));
  return match ? toAmount(match[1]) : null;
}

function findDirection(text) {
  if (/Payment\s+made|You\s+have\s+sent|Cash\s*Out/i.test(text)) return "sent";
  if (/Payment\s+received|Cash\s*In\s+received|You\s+have\s+received/i.test(text)) return "received";
  return null;
}

function findNetwork(text) {
  if (/MTN|MoMo/i.test(text)) return "MTN MoMo";
  if (/Telecel|Vodafone\s*Cash/i.test(text)) return "Telecel Cash";
  if (/AirtelTigo|Airtel\s*Money|Tigo\s*Cash/i.test(text)) return "AirtelTigo Money";
  return null;
}

// Ghanaian numbers compare the same whether written 024…, 23324… or +23324…
export function normalisePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

export function parseMomoText(rawText) {
  const text = cleanText(rawText);
  if (!text) return [];

  const blocks = text
    .split(MESSAGE_START)
    .map((block) => block.trim())
    .filter((block) => block.length > 10);
  const candidates = blocks.length ? blocks : [text];

  return candidates
    .map((block) => ({
      amount: findAmount(block),
      paid_on: findDate(block),
      reference: findTransactionId(block),
      note: findReference(block),
      counterparty: findCounterparty(block),
      phones: findPhones(block),
      fee: findFee(block),
      direction: findDirection(block),
      network: findNetwork(block),
      text: block,
    }))
    .filter((parsed) => parsed.amount !== null || parsed.reference !== null);
}

// Picks the transaction a driver most likely means: money they sent, biggest first.
export function pickBestTransaction(transactions) {
  if (!transactions.length) return null;
  const sent = transactions.filter((t) => t.direction === "sent");
  const pool = sent.length ? sent : transactions;
  return [...pool].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
}

// Did this payment reach one of the owner's MoMo accounts?
// Returns "match", "mismatch" or "unknown" — never guesses.
export function checkReceiver(transaction, ownerAccounts = []) {
  const accounts = ownerAccounts.map((a) => String(a).trim()).filter(Boolean);
  if (!accounts.length || !transaction) return "unknown";
  if (transaction.direction === "received") return "unknown";

  const names = accounts.filter((a) => /[A-Za-z]{2}/.test(a)).map(normaliseName).filter(Boolean);
  const numbers = accounts.map(normalisePhone).filter((n) => n.length >= 9);

  const party = normaliseName(transaction.counterparty);
  if (party && names.some((name) => party.includes(name) || name.includes(party))) return "match";
  if (numbers.length && transaction.phones.some((p) => numbers.includes(p))) return "match";
  if (!party && !transaction.phones.length) return "unknown";
  return "mismatch";
}

// Compares what a driver typed with what was read from their screenshot.
// Returns a list of plain-language warnings for the approvals screen.
export function reviewPayment(payment, ownerAccounts = []) {
  const warnings = [];
  if (!payment.ocr_source) return warnings;

  const typedAmount = Number(payment.amount);
  const readAmount = payment.ocr_amount == null ? null : Number(payment.ocr_amount);
  if (readAmount != null && Math.abs(readAmount - typedAmount) >= 0.01) {
    warnings.push({
      tone: "red",
      text: `Screenshot says GH₵ ${readAmount.toFixed(2)}, driver entered GH₵ ${typedAmount.toFixed(2)}.`,
    });
  }

  const typedRef = (payment.reference || "").trim();
  const readRef = (payment.ocr_reference || "").trim();
  if (readRef && typedRef && readRef !== typedRef) {
    warnings.push({ tone: "red", text: `Screenshot's transaction ID is ${readRef}, driver entered ${typedRef}.` });
  }

  const verdict = checkReceiver(
    { counterparty: payment.ocr_receiver, phones: [], direction: "sent" },
    ownerAccounts
  );
  if (verdict === "mismatch") {
    warnings.push({ tone: "red", text: `Paid to ${payment.ocr_receiver}, not one of your MoMo accounts.` });
  } else if (verdict === "unknown" && ownerAccounts.length) {
    warnings.push({ tone: "amber", text: "Couldn't tell who was paid from this screenshot." });
  }

  return warnings;
}
