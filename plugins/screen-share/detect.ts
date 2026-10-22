// Pure detectors for screen-share mode. Each returns character ranges in a
// plain string; the masker turns those ranges into painted highlights.
import { FIRST_NAMES, AMBIGUOUS_FIRST_NAMES, NAME_STOPWORDS } from "./names";

export type MatchKind = "email" | "phone" | "amount" | "iban" | "vat" | "name" | "company";
export interface Match {
  start: number;
  end: number;
  kind: MatchKind;
}

export interface DetectOptions {
  /** Extra people to always hide (full names or single first names). */
  knownNames: readonly string[];
  /** Company names; hidden only when maskCompanies is true, and never mistaken for people. */
  companies: readonly string[];
  maskCompanies: boolean;
  /** Hide any pair of capitalised words that is not a known product or UI term. */
  aggressiveNames: boolean;
}

export const DEFAULT_KNOWN_NAMES: string[] = [];
export const DEFAULT_COMPANIES: string[] = [];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// +44 7700 900123, +1 415 555 0132, +49 30 5550 1923, 07700 900123,
// (415) 555-0132, 0151 1234567, +44 (0)20 7946 0958
const PHONE =
  /(?:\+\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\(?\d{1,5}\)?(?:[\s.-]?\d{2,5}){1,4}|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\b0\d{2,5}(?:[\s.-]?\d{2,8}){1,3})(?![\d])/g;

// $48,000  £1.2m  €700  $1.6  USD 5k  700 EUR  48.000 €  $22,750.50
const SYMBOL_AMOUNT = /[$£€¥]\s?\d[\d,.\s]*\d(?:\s?(?:k|m|bn|K|M|BN)\b)?|[$£€¥]\s?\d(?:\s?(?:k|m|bn|K|M)\b)?/g;
const CODE_AMOUNT =
  /\b(?:USD|EUR|GBP|CHF|US\$)\s?\d[\d,.]*(?:\s?(?:k|m|bn|K|M)\b)?|\b\d[\d,.]*\s?(?:k|m|bn|K|M)?\s?(?:USD|EUR|GBP|CHF|euros?|pounds?|dollars?)\b|\b\d[\d,.]*\s?(?:€|£)/g;

// DE89 3704 0044 0532 0130 00, GB29NWBK60161331926819
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
// DE123456789, GB123456789, Steuernummer 123/456/78901
const VAT = /\b(?:DE\d{9}|GB\d{9}(?:\d{3})?|ATU\d{8}|FR[A-Z0-9]{2}\d{9}|NL\d{9}B\d{2}|ES[A-Z0-9]\d{7}[A-Z0-9]|IT\d{11})\b|\b\d{2,3}\/\d{3}\/\d{4,5}\b/g;

const CAP_WORD = "[A-Z][a-zà-ÿ'’-]+(?:-[A-Z][a-zà-ÿ'’]+)?";
const CAP_PAIR = new RegExp(`\\b${CAP_WORD}(?:\\s+(?:van|von|de|da|del|di|le|la|Mc|Mac|O')?\\s?${CAP_WORD}){1,2}\\b`, "g");
const SINGLE_CAP = new RegExp(`\\b${CAP_WORD}\\b`, "g");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function digitsIn(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

function pushAll(out: Match[], text: string, re: RegExp, kind: MatchKind, accept?: (m: string) => boolean) {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const value = m[0].replace(/[\s,.]+$/, "");
    if (value.length === 0) {
      if (re.lastIndex === m.index) re.lastIndex++;
      continue;
    }
    if (!accept || accept(value)) out.push({ start: m.index, end: m.index + value.length, kind });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
}

function listMatcher(list: readonly string[]): RegExp | null {
  const items = list.map((s) => s.trim()).filter((s) => s.length > 1);
  if (items.length === 0) return null;
  items.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![A-Za-z])(?:${items.map(escapeRegExp).join("|")})(?![A-Za-z])`, "g");
}

const matcherCache = new Map<string, RegExp | null>();
function cachedListMatcher(list: readonly string[]): RegExp | null {
  const key = list.join("\u0000");
  if (!matcherCache.has(key)) {
    if (matcherCache.size > 20) matcherCache.clear();
    matcherCache.set(key, listMatcher(list));
  }
  return matcherCache.get(key) ?? null;
}

/** Find every sensitive span in `text`, merged and sorted, never overlapping. */
export function detect(text: string, options: DetectOptions): Match[] {
  if (text.length < 2 || !/[A-Za-z0-9$£€¥@]/.test(text)) return [];
  const raw: Match[] = [];
  pushAll(raw, text, EMAIL, "email");
  pushAll(raw, text, IBAN, "iban", (v) => /\d{6,}/.test(v.replace(/\s/g, "")) && digitsIn(v) >= 10);
  pushAll(raw, text, VAT, "vat");
  pushAll(raw, text, PHONE, "phone", (v) => {
    const d = digitsIn(v);
    if (d < 9 || d > 15) return false;
    // Avoid ISO dates (2026-10-22), times and version strings.
    if (/^\d{4}-\d{2}-\d{2}/.test(v) || /\d\.\d+\.\d/.test(v)) return false;
    return v.startsWith("+") || v.startsWith("(") || v.startsWith("0");
  });
  pushAll(raw, text, SYMBOL_AMOUNT, "amount");
  pushAll(raw, text, CODE_AMOUNT, "amount", (v) => /\d/.test(v));

  const companyRe = cachedListMatcher(options.companies);
  const companySpans: Match[] = [];
  if (companyRe) pushAll(companySpans, text, companyRe, "company");
  if (options.maskCompanies) raw.push(...companySpans);
  const insideCompany = (start: number, end: number) =>
    companySpans.some((c) => start < c.end && end > c.start);

  const knownRe = cachedListMatcher(options.knownNames);
  if (knownRe) pushAll(raw, text, knownRe, "name");

  // First Last (and First Middle Last) where the first word is a known first name,
  // or any capitalised pair in aggressive mode.
  CAP_PAIR.lastIndex = 0;
  for (let m = CAP_PAIR.exec(text); m; m = CAP_PAIR.exec(text)) {
    const words = m[0].split(/\s+/).filter((w) => /^[A-Z]/.test(w));
    let start = m.index;
    let value = m[0];
    // Drop leading stopwords ("Call Maya Lopez" -> "Maya Lopez").
    while (words.length > 0 && NAME_STOPWORDS.has(words[0]!) && !FIRST_NAMES.has(words[0]!)) {
      const w = words.shift()!;
      const idx = value.indexOf(w) + w.length;
      const rest = value.slice(idx).replace(/^\s+/, "");
      start += value.length - rest.length;
      value = rest;
    }
    if (words.length >= 2) {
      const lead = words[0]!;
      const allStop = words.every((w) => NAME_STOPWORDS.has(w));
      const isPerson = FIRST_NAMES.has(lead) || (options.aggressiveNames && !allStop && !words.some((w) => NAME_STOPWORDS.has(w)));
      if (isPerson && !insideCompany(start, start + value.length)) {
        raw.push({ start, end: start + value.length, kind: "name" });
      }
    }
  }

  // Standalone first names ("ask Priya"), skipping words that are also ordinary words.
  SINGLE_CAP.lastIndex = 0;
  for (let m = SINGLE_CAP.exec(text); m; m = SINGLE_CAP.exec(text)) {
    const w = m[0].replace(/['’]s$/, "");
    if (FIRST_NAMES.has(w) && !AMBIGUOUS_FIRST_NAMES.has(w) && !insideCompany(m.index, m.index + w.length)) {
      raw.push({ start: m.index, end: m.index + w.length, kind: "name" });
    }
  }

  return mergeMatches(raw);
}

/** Sort and merge overlapping ranges; the earliest-starting, then longest, wins its kind. */
export function mergeMatches(matches: Match[]): Match[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.start < last.end) {
      if (m.end > last.end) last.end = m.end;
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

export function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 80)
    .slice(0, 500);
}
