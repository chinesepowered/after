import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { companyKey } from "./lib/product";

/**
 * Demo estate, in two phases so the playbooks are real:
 *
 *   pnpm exec convex run seed:prepare        creates "Robert" with 8 companies
 *                                            and runs the real Firecrawl + LLM
 *                                            research for each (shared cache)
 *   pnpm exec convex run seed:status         wait until every card has a letter
 *   pnpm exec convex run seed:stage          arranges the cards into mixed
 *                                            states with realistic threads
 *
 * Fixed slug `demo-robert`; re-running replaces the estate but keeps the
 * playbook cache. Nothing here is a real person.
 */

export const DEMO_SLUG = "demo-robert";

const COMPANIES: { name: string; category: string }[] = [
  { name: "Netflix", category: "Streaming" },
  { name: "Spotify", category: "Streaming" },
  { name: "Verizon", category: "Phone" },
  { name: "Chase", category: "Bank" },
  { name: "Facebook", category: "Social" },
  { name: "Con Edison", category: "Utilities" },
  { name: "State Farm", category: "Insurance" },
  { name: "Social Security Administration", category: "Government" },
];

async function wipeDemo(ctx: { db: any }, estateId: Id<"estates">) {
  const tasks = await ctx.db.query("tasks").withIndex("by_estate", (q: any) => q.eq("estateId", estateId)).collect();
  for (const t of tasks) {
    const msgs = await ctx.db.query("mailMessages").withIndex("by_target", (q: any) => q.eq("targetId", t._id)).collect();
    for (const m of msgs) await ctx.db.delete(m._id);
    await ctx.db.delete(t._id);
  }
  for (const table of ["documents", "dailyPlan", "presence", "estateMembers"] as const) {
    const rows = await ctx.db.query(table).withIndex("by_estate", (q: any) => q.eq("estateId", estateId)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
  const plans = await ctx.db.query("dailyPlan").withIndex("by_estate_date", (q: any) => q.eq("estateId", estateId)).collect();
  for (const p of plans) await ctx.db.delete(p._id);
  await ctx.db.delete(estateId);
}

export const prepare = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG)).unique();
    let ownerId = existing?.ownerId;
    if (existing) await wipeDemo(ctx, existing._id);
    if (!ownerId) ownerId = await ctx.db.insert("users", { name: "After demo" });

    const now = Date.now();
    const estateId = await ctx.db.insert("estates", {
      ownerId,
      slug: DEMO_SLUG,
      personFirstName: "Robert",
      dateOfPassing: "2026-03-14",
      relationship: "daughter",
      caseCode: "AFT-DEMO",
      createdAt: now - 12 * 86_400_000,
    });
    await ctx.db.insert("estateMembers", { estateId, userId: ownerId, role: "owner", joinedAt: now });
    for (const [name, status] of [
      ["Death certificate (copy)", "have"],
      ["Your ID", "have"],
      ["Proof of authority (executor letter)", "need"],
    ] as const) {
      await ctx.db.insert("documents", { estateId, name, status, createdAt: now });
    }

    let i = 0;
    for (const c of COMPANIES) {
      const key = companyKey(c.name);
      const cached = await ctx.db.query("playbooks").withIndex("by_companyKey", (q) => q.eq("companyKey", key)).first();
      const taskId = await ctx.db.insert("tasks", {
        estateId,
        companyName: c.name,
        companyKey: key,
        category: c.category,
        status: "researching",
        playbookId: cached && cached.quality === "ok" ? cached._id : undefined,
        followUpCount: 0,
        aiState: "searching",
        createdAt: now - (COMPANIES.length - i) * 3_600_000,
        updatedAt: now,
      });
      // Real pipeline, staggered so Firecrawl's two-at-a-time limit is respected.
      await ctx.scheduler.runAfter(i * 12_000, internal.research.lookup, { taskId, seed: true });
      i++;
    }
    return { estateId, slug: DEMO_SLUG, tasks: COMPANIES.length };
  },
});

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const estate = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG)).unique();
    if (!estate) return null;
    const tasks = await ctx.db.query("tasks").withIndex("by_estate", (q) => q.eq("estateId", estate._id)).collect();
    const out = [];
    for (const t of tasks) {
      const pb = t.playbookId ? await ctx.db.get(t.playbookId) : null;
      out.push({
        company: t.companyName,
        status: t.status,
        aiState: t.aiState,
        note: t.aiNote,
        playbook: pb ? `${pb.quality} ${pb.sourceUrl ?? ""}` : "none",
        hasDraft: Boolean(t.draftBody),
      });
    }
    return out;
  },
});

export const stage = internalMutation({
  args: {},
  handler: async (ctx) => {
    const estate = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG)).unique();
    if (!estate) throw new Error("run seed:prepare first");
    const tasks = await ctx.db.query("tasks").withIndex("by_estate", (q) => q.eq("estateId", estate._id)).collect();
    const byKey = new Map(tasks.map((t) => [t.companyKey, t]));
    const day = 86_400_000;
    const now = Date.now();

    const out = async (t: (typeof tasks)[number], sentAt: number) => {
      const threadId = `seed-thread-${t.companyKey}`;
      const messageId = `seed-${t.companyKey}-out-${sentAt}`;
      const pb = t.playbookId ? await ctx.db.get(t.playbookId) : null;
      const to = pb?.contactEmail ?? `support@${t.companyKey}.com`;
      await ctx.db.insert("mailMessages", {
        direction: "out",
        messageId,
        threadId,
        to: [to],
        subject: `[${estate.caseCode}] ${t.draftSubject ?? `Notice of death and account closure – ${estate.personFirstName}`}`,
        fullText: t.draftBody ?? "",
        caseCode: estate.caseCode,
        targetId: t._id,
        routed: true,
        deliveryStatus: "delivered",
        at: sentAt,
      });
      return { threadId, messageId, to };
    };
    const inbound = async (
      t: (typeof tasks)[number],
      threadId: string,
      at: number,
      text: string,
      classification: string,
      summary: string,
    ) => {
      await ctx.db.insert("mailMessages", {
        direction: "in",
        messageId: `seed-${t.companyKey}-in-${at}`,
        threadId,
        from: `${t.companyName} <bereavement@example.com>`,
        to: [],
        subject: `Re: [${estate.caseCode}] ${t.draftSubject ?? "Account closure"}`,
        extractedText: text,
        fullText: text,
        caseCode: estate.caseCode,
        targetId: t._id,
        routed: true,
        classification,
        summary,
        at,
      });
    };

    // Netflix: done.
    const netflix = byKey.get("netflix");
    if (netflix) {
      const sentAt = now - 6 * day;
      const { threadId, messageId, to } = await out(netflix, sentAt);
      await inbound(
        netflix,
        threadId,
        now - 4 * day,
        "Hello,\n\nThank you for letting us know. We have cancelled the membership and closed the account as of today. No further charges will be made to the payment method on file.\n\nIf there is anything else we can help with, please reply to this email.\n\nNetflix Customer Service",
        "closed",
        "They confirmed the account is closed and no further charges will be made.",
      );
      await ctx.db.patch(netflix._id, {
        status: "closed",
        recipient: to,
        sentMessageId: messageId,
        sentThreadId: threadId,
        sentAt,
        lastInboundAt: now - 4 * day,
        summary: "They confirmed the account is closed and no further charges will be made.",
        aiState: "idle",
        aiNote: undefined,
        updatedAt: now - 4 * day,
      });
    }

    // Spotify: waiting.
    const spotify = byKey.get("spotify");
    if (spotify) {
      const sentAt = now - 3 * day;
      const { threadId, messageId, to } = await out(spotify, sentAt);
      await ctx.db.patch(spotify._id, {
        status: "awaiting",
        recipient: to,
        sentMessageId: messageId,
        sentThreadId: threadId,
        sentAt,
        nextFollowUpAt: sentAt + 7 * day,
        aiState: "idle",
        aiNote: undefined,
        updatedAt: sentAt,
      });
    }

    // Verizon: needs the death certificate.
    const verizon = byKey.get("verizon");
    if (verizon) {
      const sentAt = now - 5 * day;
      const { threadId, messageId, to } = await out(verizon, sentAt);
      const summary = "They asked for a copy of the death certificate and your photo ID before they can close the account.";
      await inbound(
        verizon,
        threadId,
        now - 2 * day,
        "Thank you for contacting Verizon.\n\nWe are sorry to hear about your loss. To close the account of a deceased customer we need a copy of the death certificate and a valid photo ID for the person handling the account. Please reply to this email with both attached.\n\nOnce we have received them, the account will be closed within 5 to 7 business days and a final statement will be issued.\n\nVerizon Customer Care",
        "needs_documents",
        summary,
      );
      await ctx.db.patch(verizon._id, {
        status: "needs_documents",
        recipient: to,
        sentMessageId: messageId,
        sentThreadId: threadId,
        sentAt,
        lastInboundAt: now - 2 * day,
        summary,
        requestedDocuments: ["Death certificate (copy)", "Your ID"],
        aiState: "idle",
        aiNote: undefined,
        updatedAt: now - 2 * day,
      });
    }

    // Chase: wants a phone call.
    const chase = byKey.get("chase");
    if (chase) {
      const sentAt = now - 4 * day;
      const { threadId, messageId, to } = await out(chase, sentAt);
      const summary = "They asked you to call their Estate Services team; email is not enough for a bank account.";
      await inbound(
        chase,
        threadId,
        now - 1 * day,
        "Thank you for notifying us.\n\nEstate matters are handled by our Estate Services team, who can be reached Monday to Friday, 8 a.m. to 9 p.m. ET. For security reasons we are not able to close accounts by email. Please have the account holder's full name and date of birth available when you call.\n\nChase Customer Service",
        "needs_call",
        summary,
      );
      await ctx.db.patch(chase._id, {
        status: "needs_call",
        recipient: to,
        sentMessageId: messageId,
        sentThreadId: threadId,
        sentAt,
        lastInboundAt: now - 1 * day,
        summary,
        aiState: "idle",
        aiNote: undefined,
        updatedAt: now - 1 * day,
      });
    }

    // Con Edison: silent for nine days -> follow-up drafted by the sweep.
    const coned = byKey.get("conedison");
    if (coned) {
      const sentAt = now - 9 * day;
      const { threadId, messageId, to } = await out(coned, sentAt);
      await ctx.db.patch(coned._id, {
        status: "awaiting",
        recipient: to,
        sentMessageId: messageId,
        sentThreadId: threadId,
        sentAt,
        nextFollowUpAt: sentAt + 7 * day,
        aiState: "idle",
        aiNote: undefined,
        updatedAt: sentAt,
      });
    }

    // Social Security: waiting, sent two days ago.
    const ssa = byKey.get("socialsecurityadministration");
    if (ssa) {
      const sentAt = now - 2 * day;
      const { threadId, messageId, to } = await out(ssa, sentAt);
      await ctx.db.patch(ssa._id, {
        status: "awaiting",
        recipient: to,
        sentMessageId: messageId,
        sentThreadId: threadId,
        sentAt,
        nextFollowUpAt: sentAt + 7 * day,
        aiState: "idle",
        aiNote: undefined,
        updatedAt: sentAt,
      });
    }

    // Facebook and State Farm stay in "Ready to send" with their drafted letters.

    // The sweep drafts Con Edison's follow-up; the plan picks today's three.
    await ctx.scheduler.runAfter(0, internal.ai.followUpSweep, {});
    await ctx.scheduler.runAfter(2_000, internal.ai.buildDailyPlan, { estateId: estate._id });
    return { staged: tasks.length, slug: DEMO_SLUG };
  },
});
