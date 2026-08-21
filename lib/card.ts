// ---------------------------------------------------------------------------
// Card entry helpers for the checkout form.
//
// These run in the BROWSER. The card number is validated here and then thrown
// away: only the brand, last four digits and expiry are ever sent to the
// server (see lib/checkout). Pure functions with no browser or network
// dependency, so they are unit-testable and safe to import anywhere.
//
// This is entry-side validation, not authorization — a real processor still
// decides whether the card works.
// ---------------------------------------------------------------------------

export type CardBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "diners"
  | "jcb"
  | "unknown";

const BRAND_PATTERNS: Array<{ brand: CardBrand; test: RegExp }> = [
  { brand: "visa", test: /^4/ },
  { brand: "mastercard", test: /^(5[1-5]|2[2-7])/ },
  { brand: "amex", test: /^3[47]/ },
  { brand: "discover", test: /^(6011|65|64[4-9])/ },
  { brand: "diners", test: /^3(0[0-5]|[68])/ },
  { brand: "jcb", test: /^35/ },
];

/** Digits only, capped at the longest PAN length in circulation. */
export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "").slice(0, 19);
}

export function detectBrand(value: string): CardBrand {
  const digits = digitsOnly(value);
  return BRAND_PATTERNS.find((p) => p.test.test(digits))?.brand ?? "unknown";
}

export function brandLabel(brand: CardBrand): string {
  switch (brand) {
    case "visa":
      return "Visa";
    case "mastercard":
      return "Mastercard";
    case "amex":
      return "American Express";
    case "discover":
      return "Discover";
    case "diners":
      return "Diners Club";
    case "jcb":
      return "JCB";
    default:
      return "Card";
  }
}

/** Luhn checksum — catches transposed and mistyped digits. */
export function luhnValid(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Group digits for display: 4-4-4-4, or 4-6-5 for Amex. */
export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value);
  const groups =
    detectBrand(digits) === "amex" ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const out: string[] = [];
  let i = 0;
  for (const size of groups) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + size));
    i += size;
  }
  return out.join(" ");
}

export function expectedCvcLength(brand: CardBrand): number {
  return brand === "amex" ? 4 : 3;
}

export interface Expiry {
  month: number;
  /** Four-digit year, expanded from a two-digit entry. */
  year: number;
}

/** Parse "MM/YY", "MM / YYYY" or "MMYY". Returns null when unparseable. */
export function parseExpiry(value: string): Expiry | null {
  const digits = value.replace(/\D+/g, "");
  if (digits.length !== 4 && digits.length !== 6) return null;
  const month = Number(digits.slice(0, 2));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const rest = digits.slice(2);
  const year = rest.length === 2 ? 2000 + Number(rest) : Number(rest);
  if (!Number.isInteger(year)) return null;
  return { month, year };
}

/** Format expiry input as the customer types: "1226" → "12/26". */
export function formatExpiry(value: string): string {
  const digits = value.replace(/\D+/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** True when the expiry month has already passed. */
export function isExpired(exp: Expiry, now: Date = new Date()): boolean {
  // Expiry means "good through the end of that month".
  return new Date(exp.year, exp.month, 1).getTime() <= now.getTime();
}

export interface CardFormValues {
  name: string;
  number: string;
  expiry: string;
  cvc: string;
  postalCode: string;
}

/** Field-level errors for the checkout form, keyed by field name. */
export function validateCardForm(
  values: CardFormValues,
  now: Date = new Date(),
): Record<string, string> {
  const errors: Record<string, string> = {};
  const brand = detectBrand(values.number);

  if (!values.name.trim()) errors.name = "Enter the name on the card.";
  if (!luhnValid(values.number)) errors.number = "Check that card number.";

  const exp = parseExpiry(values.expiry);
  if (!exp) errors.expiry = "Use MM/YY.";
  else if (isExpired(exp, now)) errors.expiry = "That card has expired.";

  const cvcDigits = values.cvc.replace(/\D+/g, "");
  if (cvcDigits.length !== expectedCvcLength(brand)) {
    errors.cvc = `${expectedCvcLength(brand)} digits.`;
  }
  if (values.postalCode.trim().length < 3) {
    errors.postalCode = "Enter your billing ZIP.";
  }
  return errors;
}
