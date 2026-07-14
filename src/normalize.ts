/**
 * Header normalization: the shared canonical form both rule matching and
 * fuzzy scoring operate on. Two headers that normalize identically are
 * considered the same name, so this is where "Email Address", "EMAIL_ADDRESS"
 * and " e-mail  address " all collapse to "email address".
 */

/**
 * Normalize a raw header:
 *  - Unicode NFKC (full-width forms, ligatures)
 *  - lower-case
 *  - camelCase / PascalCase boundaries become spaces ("firstName" -> "first name")
 *  - digit/letter boundaries become spaces ("address1" -> "address 1")
 *  - every run of non-alphanumeric characters becomes one space
 *  - whitespace collapsed and trimmed
 */
export function normalizeHeader(raw: string): string {
  let s = raw.normalize("NFKC");
  // Split camelCase before lower-casing destroys the case signal.
  s = s.replace(/([a-z\d])([A-Z])/g, "$1 $2");
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  s = s.toLowerCase();
  s = s.replace(/([a-z])(\d)/g, "$1 $2");
  s = s.replace(/(\d)([a-z])/g, "$1 $2");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Normalized tokens of a header ("Email Address (work)" -> ["email","address","work"]). */
export function tokens(raw: string): string[] {
  const n = normalizeHeader(raw);
  return n === "" ? [] : n.split(" ");
}

/**
 * Common English/business abbreviations expanded during *fuzzy* scoring
 * only — rule stages always compare literally so a schema stays fully
 * predictable. Kept deliberately small and unambiguous.
 */
const ABBREVIATIONS: Record<string, string> = {
  no: "number",
  num: "number",
  nbr: "number",
  qty: "quantity",
  amt: "amount",
  addr: "address",
  tel: "telephone",
  ph: "phone",
  dob: "date of birth",
  fname: "first name",
  lname: "last name",
  org: "organization",
  dept: "department",
  desc: "description",
  st: "state",
  zip: "zip code",
  postcode: "postal code",
  id: "identifier",
  ref: "reference",
  acct: "account",
  cust: "customer",
};

/** Expand known abbreviations in a normalized token list. */
export function expandTokens(toks: string[]): string[] {
  const out: string[] = [];
  for (const t of toks) {
    const exp = ABBREVIATIONS[t];
    if (exp !== undefined) out.push(...exp.split(" "));
    else out.push(t);
  }
  return out;
}

/** Convenience: normalized, abbreviation-expanded string for fuzzy scoring. */
export function fuzzyForm(raw: string): string {
  return expandTokens(tokens(raw)).join(" ");
}
