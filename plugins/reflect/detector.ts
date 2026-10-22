// Reflect rule detector. Pure, deterministic, no network and no model calls.
//
// Finds a lasting rule ("never use hashtags", "from now on always reply in
// plain English", "no emojis in my LinkedIn posts") in a message the user
// typed, and tidies it into one or more short sentences. Precision matters
// more than recall: a false card is noise, a missed rule can be typed again.

export type RuleTopic = "writing" | "general";

export interface DetectedRule {
  /** Tidied rule text, sentence case, each clause ending with a full stop. */
  rule: string;
  /** "writing" when the rule is about wording, tone or formatting. */
  topic: RuleTopic;
  /** The raw clauses the rule came from, for display and debugging. */
  clauses: string[];
}

const MAX_CLAUSE_WORDS = 28;
const MAX_RULE_CLAUSES = 3;

const LEADING_FILLER =
  /^(?:(?:and|but|so|also|oh|ok|okay|right|look|plus|then|just|actually|honestly|basically|remember|note|please|guys|mate|listen|one more thing|another thing|and also|oh and|by the way|btw)\b[\s,:;-]*)+/i;

const TRAILING_FILLER =
  /(?:[\s,;-]*\b(?:please|thanks|thank you|cheers|ok|okay|right|yeah|mate|alright|ever|at all|whatsoever|going forward|from now on|thank u)\b)+[\s.!]*$/i;

// Verbs that make "never X" / "always X" an instruction rather than a description.
const RULE_VERBS =
  "use|say|write|put|start|begin|end|finish|include|add|mention|call|refer|make|send|sign|open|reply|respond|answer|bring|commit|push|delete|remove|create|check|ask|run|spell|format|keep|leave|cite|quote|show|give|list|name|link|attach|copy|cc|email|post|publish|deploy|merge|install|overwrite|edit|touch|change|rename|book|schedule|charge|price|invoice|translate|summarise|summarize|capitalise|capitalize|abbreviate|bold|number|title|label|tag|lead|close|end|hedge|apologise|apologize|pad|stack|chain|default|go|assume|guess|invent|promise|skip|drop|let|trust|read|treat|talk|speak|refer|address|greet|thank|sign";

const RULE_STARTERS: RegExp[] = [
  // "From now on ...", "Going forward ...", "In future ..."
  /^(?:from now on|from here on(?: in| out)?|going forward|in (?:the )?future|moving forward|for future reference|from today)\b/i,
  // "Never use ...", "Always reply ..." (optionally "you should/must never")
  new RegExp(`^(?:you (?:should|must|need to|have to) )?(?:never|always|never ever)\\s+(?:ever\\s+)?(?:${RULE_VERBS})\\b`, "i"),
  // "Don't ever ...", "Do not ever ...", "Don't you ever ..."
  /^(?:don't|do not|dont)\s+(?:you\s+)?ever\b/i,
  // "I don't want you to ever ...", "I never want you to ..."
  /^i\s+(?:don't|do not|dont)\s+want\s+you\s+(?:to\s+)?ever\b/i,
  /^i\s+never\s+want\s+(?:you|to\s+see)\b/i,
  // "Make sure you always/never ..."
  /^(?:make sure|ensure|remember)\s+(?:that\s+)?you\s+(?:always|never)\b/i,
  // "Stop using ...", "Stop saying ..."
  /^stop\s+(?:using|saying|writing|adding|putting|starting|ending|calling|doing|sending|making)\b/i,
  // "No more X", "No X in my Y"
  /^no more\s+[\w'’ -]{2,40}$/i,
  /^no\s+[\w'’ -]{2,40}\s+in\s+(?:my|our|the|any)\s+[\w'’ -]{2,40}$/i,
  // "Every time you X, Y"
  /^(?:every time|whenever|each time)\s+(?:you|we)\b/i,
  // "Always" / "Never" as a standalone instruction with a noun ("Always British English.")
  /^(?:always|never)\s+(?:british|american|uk|us)\s+(?:english|spelling)\b/i,
];

// Clauses that look like rules but are not.
const NOT_A_RULE: RegExp[] = [
  /^never\s*mind\b/i,
  /^(?:as|almost|nearly|not)\s+always\b/i,
  /\?\s*$/,
  /^(?:why|how|what|when|where|who|which|should|can|could|would|will|do(?!\s+not\b)|does|did|is|are|was|were|have|has|shall|may|might)\b.*\b(?:you|we|i|it|this|that)\b/i,
  /\b(?:i|we|he|she|they|it|you)\s+(?:have|has|had|'ve|'d)\s+never\b/i,
];

const WRITING_HINTS =
  /\b(?:dash|dashes|em dash|en dash|emoji|emojis|word|words|phrase|phrases|say|saying|write|writing|written|tone|voice|wording|sentence|sentences|hook|hooks|post|posts|linkedin|email|emails|newsletter|copy|british|american|spelling|spell|jargon|comma|commas|exclamation|capital|capitals|headline|headlines|caption|captions|bullet|bullets|paragraph|paragraphs|language|grammar|punctuation|quotation|quotations|quote marks|metaphor|metaphors|cliche|cliches|title|titles|subject line|sign off|sign-off|greeting|formal|informal|casual|apologise|apologize|hedge|hedging|staccato|fragments|draft|drafts|reply|replies|message|messages|dm|dms|caption|blog|article|script|deck|slide|slides|bold|italic|font)\b/i;

/** Remove fenced code, inline code and quoted lines; they are content, not instructions. */
export function stripNonInstructions(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

/** Split text into candidate clauses: sentences, then long sentences on "and"/"but"/";" joins. */
export function splitClauses(text: string): string[] {
  const sentences = text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clauses: string[] = [];
  for (const sentence of sentences) {
    // A short sentence that is a rule as a whole stays whole ("never use em dashes and emojis").
    if (isRuleClause(sentence)) {
      clauses.push(sentence);
      continue;
    }
    const parts = sentence.split(/\s*(?:;|,?\s+\band\b\s+(?:then\s+)?|,?\s+\bbut\b\s+|\s+-\s+|\s+—\s+)\s*/i);
    for (const part of parts) {
      const trimmed = part.trim().replace(/^[,;:\-—\s]+/, "");
      if (trimmed) clauses.push(trimmed);
    }
  }
  return clauses;
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function stripLeading(clause: string): string {
  let prev = "";
  let out = clause.trim();
  while (prev !== out) {
    prev = out;
    out = out.replace(LEADING_FILLER, "").trim();
  }
  return out;
}

/** True when a clause (already stripped of fillers) reads as a lasting rule. */
export function isRuleClause(raw: string): boolean {
  const clause = stripLeading(raw).replace(/[.!]+$/, "").replace(TRAILING_FILLER, "").trim();
  if (!clause) return false;
  if (words(clause) > MAX_CLAUSE_WORDS || words(clause) < 2) return false;
  if (/\?/.test(raw)) return false;
  if (NOT_A_RULE.some((re) => re.test(clause))) return false;
  return RULE_STARTERS.some((re) => re.test(clause));
}

function sentenceCase(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Deterministic tidy: drop filler, normalise "no X in my Y" to "Y: no X.", sentence case, full stop. */
export function tidyClause(raw: string): string {
  let c = stripLeading(raw).replace(/[.!\s]+$/, "").trim();
  c = c.replace(TRAILING_FILLER, "").trim();
  c = c.replace(/^(?:from now on|from here on(?: in| out)?|going forward|in (?:the )?future|moving forward|for future reference|from today)\b[\s,:]*/i, "").trim();
  c = c.replace(/^(?:you (?:should|must|need to|have to) )/i, "").trim();
  c = c.replace(/^(?:make sure|ensure|remember)\s+(?:that\s+)?you\s+/i, "").trim();
  c = c.replace(/^i\s+(?:don't|do not|dont)\s+want\s+you\s+(?:to\s+)?ever\s+/i, "never ").trim();
  c = c.replace(/^i\s+never\s+want\s+you\s+to\s+/i, "never ").trim();
  c = c.replace(/^(?:don't|do not|dont)\s+(?:you\s+)?ever\s+/i, "never ").trim();
  c = c.replace(/^never ever\s+/i, "never ").replace(/^never\s+ever\s+/i, "never ").trim();
  // "never say X" -> "Never use the word X" when X is a single word
  c = c.replace(/^never\s+say\s+([A-Za-z'’-]+)$/i, "never use the word $1");
  // "No X in my Y" -> "Y: no X"
  const scoped = /^no\s+(.+?)\s+in\s+(?:my|our|the|any)\s+(.+)$/i.exec(c);
  if (scoped) c = `${sentenceCase(scoped[2].trim())}: no ${scoped[1].trim()}`;
  c = c.replace(/\s+/g, " ").replace(/[,;:\s]+$/, "").trim();
  if (!c) return "";
  return sentenceCase(c) + ".";
}

/** Detect a lasting rule in a user message. Returns null when there is none. */
export function detectRule(text: string): DetectedRule | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const cleaned = stripNonInstructions(text);
  const clauses = splitClauses(cleaned);
  const hits: string[] = [];
  for (const clause of clauses) {
    if (isRuleClause(clause)) {
      hits.push(clause);
      if (hits.length >= MAX_RULE_CLAUSES) break;
    }
  }
  if (hits.length === 0) return null;
  const tidied = Array.from(new Set(hits.map(tidyClause).filter((s) => s.length > 3)));
  if (tidied.length === 0) return null;
  const rule = tidied.join(" ");
  const topic: RuleTopic = WRITING_HINTS.test(hits.join(" ")) ? "writing" : "general";
  return { rule, topic, clauses: hits };
}

/** Normalised form used for idempotency checks. */
export function normaliseRule(rule: string): string {
  return rule.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
