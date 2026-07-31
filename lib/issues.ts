// ---------------------------------------------------------------------------
// Issue scope matcher.
//
// Backed by the "Issues Matrix" tab of the licensing workbook (200 ranked home
// issues, each classified by whether an unlicensed Early Bird technician can
// fix it). This module matches what the customer describes/selects on intake
// to the closest catalog issue and returns a scope verdict:
//
//   in_scope     — defensible unlicensed work; a technician can handle it
//   partial      — part of the fix is in scope; the rest is referred
//   grey         — plausible but unsettled; diagnose, confirm before repair
//   out_of_scope — licensed work; diagnose and refer to a licensed pro
//   emergency    — stop the damage and refer immediately
//
// Pure and dependency-free (like lib/safety.ts) so it runs live on the intake
// form and again on the server. It is ADVISORY and never blocks a booking.
//
// Scope here is Indiana / Porter County (the workbook's basis) and is a
// planning tool, NOT legal advice. Hard stops (gas, microwave HV capacitor,
// garage-door springs, refrigerant) reflect universal safety practice.
// ---------------------------------------------------------------------------

import { ISSUES_DATA } from "./issues-matrix-data";

export type IssueScope =
  | "in_scope"
  | "partial"
  | "grey"
  | "out_of_scope"
  | "emergency";

export interface MatrixIssue {
  rank: number;
  category: string;
  issue: string;
  scope: IssueScope;
  hardStop: boolean;
  license: string;
  risk: string;
  recurring: boolean;
  likelihood: number;
  symptom: string;
  notes: string;
}

// Words too generic to identify an issue on their own. df-weighting already
// down-ranks common words; this just removes pure noise/filler.
const STOPWORDS = new Set([
  "the", "a", "an", "or", "and", "to", "of", "in", "on", "at", "no", "not",
  "is", "it", "my", "with", "for", "from", "won", "t", "won't", "needs",
  "including", "device", "unit", "failure", "problem", "issue",
]);

// A few synonyms mapped onto the vocabulary the catalog actually uses, so
// everyday phrasing still matches (e.g. "leaky faucet" → "dripping faucet").
const SYNONYMS: Record<string, string> = {
  leaky: "dripping",
  leaking: "dripping",
  freon: "refrigerant",
  ac: "cooling",
  "a/c": "cooling",
  wifi: "wi-fi",
  fridge: "refrigerator",
  outlets: "outlet",
  breakers: "breaker",
};

const MORE_SEVERE: Record<IssueScope, number> = {
  in_scope: 0,
  partial: 1,
  grey: 2,
  out_of_scope: 3,
  emergency: 4,
};

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9'/\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Split into significant words. Synonyms are applied ONLY when expanding a
 *  query (never when indexing the catalog — folding "leaking"→"dripping" across
 *  many titles would wreck the document frequencies). */
function words(text: string, applySynonyms: boolean): string[] {
  return normalize(text)
    .trim()
    .split(" ")
    .map((t) => (applySynonyms ? (SYNONYMS[t] ?? t) : t))
    .filter((t) => t.length > 0);
}

function significant(ws: string[]): string[] {
  return ws.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** The catalog title with any parenthetical qualifier removed. */
function cleanTitle(issue: string): string {
  return issue.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
}

// Precompute per-issue signatures + document frequencies once (synonym-free).
interface Sig {
  issue: MatrixIssue;
  phrase: string; // normalized clean title, for contiguous phrase bonus
  tokens: string[]; // significant title tokens
  bigrams: string[]; // consecutive significant token pairs
}
const SIGS: Sig[] = [];
const DF = new Map<string, number>();
for (const issue of ISSUES_DATA) {
  const clean = cleanTitle(issue.issue);
  const tokens = significant(words(clean, false));
  const uniq = [...new Set(tokens)];
  for (const t of uniq) DF.set(t, (DF.get(t) ?? 0) + 1);
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  SIGS.push({ issue, phrase: normalize(clean).trim(), tokens: uniq, bigrams });
}
function weight(token: string): number {
  return 1 / (DF.get(token) ?? 1);
}

export interface IssueMatch {
  issue: MatrixIssue;
  score: number;
}

const THRESHOLD = 0.8;
// Safety hard-stops surface at a lower bar — over-flagging one is the safe
// error, and missing "microwave" or "gas valve" is not acceptable.
const HARDSTOP_THRESHOLD = 0.55;
const PHRASE_BONUS = 0.6;
const BIGRAM_BONUS = 0.5;
const BIGRAM_CAP = 1.0;

/** Rank catalog issues against free text; most-confident first. */
export function matchIssues(text: string): IssueMatch[] {
  const qwords = words(text, true);
  const qhay = ` ${qwords.join(" ")} `;
  const qtokens = significant(qwords);
  const present = new Set(qtokens);
  const out: IssueMatch[] = [];
  for (const sig of SIGS) {
    let score = 0;
    for (const t of sig.tokens) {
      if (present.has(t) || qhay.includes(` ${t} `)) score += weight(t);
    }
    let bigramBonus = 0;
    for (const bg of sig.bigrams) {
      if (qhay.includes(` ${bg} `)) bigramBonus += BIGRAM_BONUS;
    }
    score += Math.min(bigramBonus, BIGRAM_CAP);
    if (sig.phrase && qhay.includes(` ${sig.phrase} `)) score += PHRASE_BONUS;
    const bar = sig.issue.hardStop ? HARDSTOP_THRESHOLD : THRESHOLD;
    if (score >= bar) out.push({ issue: sig.issue, score });
  }
  // Highest score wins; break ties toward the more severe / more likely issue
  // so a hard stop is never masked by a benign same-score match.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sev = MORE_SEVERE[b.issue.scope] - MORE_SEVERE[a.issue.scope];
    if (sev !== 0) return sev;
    return a.issue.rank - b.issue.rank;
  });
  return out;
}

export interface IssueAssessment {
  issue: MatrixIssue;
  scope: IssueScope;
  hardStop: boolean;
  /** True when a licensed pro / referral is required. */
  requiresLicensedPro: boolean;
  /** Customer-facing one-liner. */
  message: string;
  /** Other, less-confident matches (for the operator). */
  alsoMatched: MatrixIssue[];
}

function messageFor(issue: MatrixIssue): string {
  const q = `“${issue.issue}”`;
  if (issue.hardStop) {
    return `${q} is a safety hard-stop — please don’t attempt it. We’ll diagnose safely and refer you to the right licensed professional immediately.`;
  }
  switch (issue.scope) {
    case "in_scope":
      return `${q} is typically something an Early Bird technician can handle on-site.`;
    case "partial":
      return `We can get started on ${q}, but part of the work may need a licensed pro — the technician will advise on-site.`;
    case "grey":
      return `We’ll diagnose ${q} on-site; the repair itself may depend on local licensing, so the technician will confirm what we can do.`;
    case "out_of_scope":
      return `${q} is licensed work${
        issue.license && issue.license !== "None"
          ? ` (${issue.license})`
          : ""
      } — we’ll diagnose it and refer you to a vetted licensed pro.`;
    case "emergency":
      return `${q} needs urgent attention — we’ll help you stop the damage and refer you to a licensed pro right away.`;
  }
}

/**
 * Assess the best-matching catalog issue for what the customer described +
 * selected. Returns null when nothing matches confidently (the category-level
 * triage + state licensing advisory still apply). Never throws.
 */
export function assessIssue(text: string): IssueAssessment | null {
  const matches = matchIssues(text || "");
  if (matches.length === 0) return null;
  const best = matches[0].issue;
  return {
    issue: best,
    scope: best.scope,
    hardStop: best.hardStop,
    requiresLicensedPro:
      best.scope === "out_of_scope" || best.scope === "emergency",
    message: messageFor(best),
    alsoMatched: matches.slice(1, 4).map((m) => m.issue),
  };
}
