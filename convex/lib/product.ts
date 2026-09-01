/**
 * Pure product helpers for After. No SDK imports, so this is safe from
 * queries, mutations and Node actions alike.
 */

export const CATEGORIES = [
  "Bank",
  "Phone",
  "Utilities",
  "Streaming",
  "Social",
  "Insurance",
  "Government",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Suggested companies per category, shown as a checklist on the board. */
export const SUGGESTIONS: Record<Category, string[]> = {
  Bank: ["Chase", "Bank of America", "Wells Fargo", "TD Bank", "Capital One"],
  Phone: ["Verizon", "AT&T", "T-Mobile", "Rogers", "Bell"],
  Utilities: ["Con Edison", "PG&E", "Hydro One", "Enbridge Gas"],
  Streaming: ["Netflix", "Spotify", "Disney+", "Amazon Prime", "Apple"],
  Social: ["Facebook", "Instagram", "Google", "LinkedIn", "X"],
  Insurance: ["State Farm", "Allstate", "Manulife", "Sun Life"],
  Government: ["Social Security Administration", "Service Canada", "IRS", "DMV"],
  Other: [],
};

export const MAX_TASKS_PER_ESTATE = 24;
export const FOLLOW_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FOLLOW_UPS = 1;

/** "T-Mobile USA, Inc." -> "tmobile" so every user shares one playbook. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|plc|corp|corporation|company|co|usa|canada)\b\.?/g, "")
    .replace(/[^a-z0-9+]/g, "")
    .trim();
}

export function displayName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 60);
}

/** Unguessable, URL-safe estate slug. */
export function newSlug(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type LetterContext = {
  personFirstName: string;
  dateOfPassing: string;
  relationship: string;
  companyName: string;
  documents: string[];
  steps: string[];
  senderName?: string;
};

/**
 * Deterministic notification letter, used when the model is unavailable so a
 * family is never left with an empty card. Calm, brief, no euphemisms.
 */
export function templateLetter(c: LetterContext): { subject: string; body: string } {
  const docs = c.documents.length
    ? `I understand you may need the following, and I can provide them: ${c.documents.join(", ")}.`
    : `Please let me know which documents you need from me, and the best way to send them.`;
  const body = [
    `Hello,`,
    ``,
    `I am writing to let you know that ${c.personFirstName}, my ${c.relationship.toLowerCase()}, died on ${formatDate(c.dateOfPassing)}. ${c.personFirstName} held an account with ${c.companyName}.`,
    ``,
    `I would like to close the account, or transfer it if that is what your process requires. ${docs}`,
    ``,
    `Please reply to this email with the next steps. I would prefer to handle this in writing where possible.`,
    ``,
    `Thank you for your help.`,
    ``,
    c.senderName ?? `${c.personFirstName}'s ${c.relationship.toLowerCase()}`,
  ].join("\n");
  return { subject: `Notice of death and account closure – ${c.personFirstName}`, body };
}

export function templateFollowUp(c: LetterContext, sentAt: number): { subject: string; body: string } {
  const days = Math.max(1, Math.round((Date.now() - sentAt) / 86_400_000));
  const body = [
    `Hello,`,
    ``,
    `I wrote to you ${days} days ago about closing the ${c.companyName} account held by ${c.personFirstName}, who died on ${formatDate(c.dateOfPassing)}. I have not yet heard back.`,
    ``,
    `Could you let me know the status, or what you still need from me?`,
    ``,
    `Thank you.`,
    ``,
    c.senderName ?? `${c.personFirstName}'s ${c.relationship.toLowerCase()}`,
  ].join("\n");
  return { subject: `Following up – account of ${c.personFirstName}`, body };
}

export function templateDocumentsReply(c: LetterContext, requested: string[]): {
  subject: string;
  body: string;
} {
  const list = requested.length ? requested.join(", ") : "the documents you asked for";
  const body = [
    `Hello,`,
    ``,
    `Thank you for your reply about ${c.personFirstName}'s ${c.companyName} account. As requested, I am sending ${list}.`,
    ``,
    `Please confirm once you have what you need, and let me know the expected timeline for closing the account.`,
    ``,
    `Thank you.`,
    ``,
    c.senderName ?? `${c.personFirstName}'s ${c.relationship.toLowerCase()}`,
  ].join("\n");
  return { subject: `Documents for the account of ${c.personFirstName}`, body };
}

/** General bereavement steps, used when a company page could not be read. */
export function genericPlaybook(companyName: string) {
  return {
    steps: [
      `Contact ${companyName}'s customer support and ask for the bereavement or estate team.`,
      `Tell them the account holder has died and that you want to close or transfer the account.`,
      `Send the documents they ask for, usually a copy of the death certificate and proof that you may act for the estate.`,
      `Ask for written confirmation once the account is closed.`,
    ],
    documents: ["Death certificate (copy)", "Your ID", "Proof of authority (will, letters of administration, or executor letter)"],
    expectedDays: 14,
  };
}

export type Classification = "closed" | "needs_documents" | "needs_call" | "auto_reply" | "other";

/**
 * Keyword fallback for classifying a company's reply when the model is
 * unavailable. Good enough to keep the board moving; the LLM is preferred.
 */
export function heuristicClassify(text: string): { classification: Classification; summary: string; requestedDocuments: string[] } {
  const t = text.toLowerCase();
  const docs: string[] = [];
  if (/death certificate/.test(t)) docs.push("Death certificate");
  if (/letters? of administration|probate|executor|grant of/.test(t)) docs.push("Proof of authority");
  if (/(your|photo|government)[- ]?id|identification|passport|driver'?s licen/.test(t)) docs.push("Your ID");
  if (/proof of address|utility bill/.test(t)) docs.push("Proof of address");

  if (/out of (the )?office|auto(matic|mated)?[- ]?repl|do not reply|this is an automated|we have received your (message|request|email)|ticket (number|#)|case (number|#).*(opened|created)/.test(t)) {
    return { classification: "auto_reply", summary: "An automatic acknowledgement. No action needed yet.", requestedDocuments: [] };
  }
  if (/(account|service|subscription|membership|line|policy)s? (has been|have been|is now|was|were) (closed|cancell?ed|terminated|deactivated|settled)|we have (now )?closed|sorry for your loss.*(closed|cancell?ed)/.test(t) && !/once|after|when we|as soon as/.test(t)) {
    return { classification: "closed", summary: "They confirmed the account is closed.", requestedDocuments: [] };
  }
  if (docs.length || /please (send|provide|upload|attach|forward)|we (will )?need|we require|required documents|documentation/.test(t)) {
    return {
      classification: "needs_documents",
      summary: docs.length ? `They asked for: ${docs.join(", ")}.` : "They asked for documents before they can proceed.",
      requestedDocuments: docs.length ? docs : ["Requested documents"],
    };
  }
  if (/(please|kindly) (call|phone|ring|contact us by phone)|call us (at|on)|by (tele)?phone|visit (a|your|the nearest) branch|in person/.test(t)) {
    return { classification: "needs_call", summary: "They asked you to call or visit in person.", requestedDocuments: [] };
  }
  return { classification: "other", summary: "They replied. Have a look when you are ready.", requestedDocuments: [] };
}

export function statusForClassification(c: Classification): "closed" | "needs_documents" | "needs_call" | "awaiting" {
  switch (c) {
    case "closed":
      return "closed";
    case "needs_documents":
      return "needs_documents";
    case "needs_call":
      return "needs_call";
    default:
      return "awaiting";
  }
}

/** Reject forum/news hits: the page must be on a domain that looks like the company. */
export function looksOfficial(url: string, companyName: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bad = /reddit|quora|facebook\.com|twitter|x\.com|youtube|medium\.com|wikipedia|forum|community\.|news|blog|linkedin|tiktok|trustpilot|complaint/;
  if (bad.test(host) && !host.includes(companyKey(companyName))) return false;
  const key = companyKey(companyName).replace(/\+/g, "");
  const compact = host.replace(/[^a-z0-9]/g, "");
  const first = key.slice(0, Math.min(key.length, 6));
  return key.length > 0 && (compact.includes(key) || (first.length >= 4 && compact.includes(first)));
}
