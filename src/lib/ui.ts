import type { Doc } from "../../convex/_generated/dataModel";

export type TaskStatus = Doc<"tasks">["status"];

export const QUOTA_TEXT = "The demo has reached its quota for now — this app runs on free tiers. Please try again a little later.";

/** Convex rate-limit errors carry data.kind === "RateLimited". Never crash on them. */
export function friendlyError(e: unknown): string {
  const anyE = e as { data?: { kind?: string }; message?: string };
  const msg = anyE?.message ?? String(e);
  if (anyE?.data?.kind === "RateLimited" || /RateLimited|rate limit/i.test(msg)) return QUOTA_TEXT;
  if (/PAUSED/.test(msg)) return "This demo is paused for the moment. Nothing was lost.";
  const m = msg.match(/Uncaught Error: ([^\n]+)/);
  return (m ? m[1] : msg).replace(/\s+at .*$/s, "").slice(0, 200);
}

export const COLUMNS: { key: string; title: string; statuses: TaskStatus[]; hint: string }[] = [
  { key: "researching", title: "Looking into it", statuses: ["researching"], hint: "We are finding each company's real process." },
  { key: "ready", title: "Ready to send", statuses: ["draft_ready"], hint: "Read the letter, change anything, then send." },
  { key: "waiting", title: "Waiting", statuses: ["sent", "awaiting"], hint: "Sent. We will nudge them if they go quiet." },
  { key: "needs", title: "Needs something", statuses: ["needs_documents", "needs_call", "bounced"], hint: "A small thing from you." },
  { key: "done", title: "Done", statuses: ["closed"], hint: "" },
];

export function columnOf(status: TaskStatus): string {
  return COLUMNS.find((c) => c.statuses.includes(status))?.key ?? "researching";
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "researching":
      return "Looking into it";
    case "draft_ready":
      return "Ready to send";
    case "sent":
      return "Sending";
    case "awaiting":
      return "Waiting for a reply";
    case "needs_documents":
      return "Needs documents";
    case "needs_call":
      return "Needs a call";
    case "closed":
      return "Done";
    case "bounced":
      return "Could not deliver";
  }
}

export function aiStateLine(task: { aiState?: string | null; companyName: string; status: TaskStatus }): string | null {
  if (task.status !== "researching" && task.status !== "sent") return null;
  switch (task.aiState) {
    case "searching":
      return `Finding ${task.companyName}'s bereavement page`;
    case "reading":
      return "Reading their instructions";
    case "drafting":
      return "Writing the letter";
    case "sending":
      return "Sending";
    default:
      return task.status === "sent" ? "Sending" : "Getting started";
  }
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^(www|m|help|support)\./, "");
  } catch {
    return null;
  }
}

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? "yesterday" : `${d} days ago`;
  const mo = Math.round(d / 30);
  return mo === 1 ? "a month ago" : `${mo} months ago`;
}

export function longDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

export const RELATIONSHIPS = ["daughter", "son", "spouse", "partner", "sibling", "parent", "grandchild", "friend", "executor"];
