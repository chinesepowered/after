import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { taskStatus, draftKind } from "./schema";
import { requireMember } from "./estates";
import { rateLimiter } from "./lib/limits";
import {
  companyKey,
  displayName,
  FOLLOW_UP_AFTER_MS,
  MAX_TASKS_PER_ESTATE,
  templateDocumentsReply,
} from "./lib/product";

function publicPlaybook(p: Doc<"playbooks"> | null) {
  if (!p) return null;
  return {
    _id: p._id,
    companyName: p.companyName,
    sourceUrl: p.sourceUrl ?? null,
    sourceTitle: p.sourceTitle ?? null,
    steps: p.steps,
    documents: p.documents,
    contactEmail: p.contactEmail ?? null,
    contactFormUrl: p.contactFormUrl ?? null,
    phone: p.phone ?? null,
    expectedDays: p.expectedDays ?? null,
    confidence: p.confidence ?? null,
    quality: p.quality,
    note: p.note ?? null,
    fetchedAt: p.fetchedAt,
    model: p.model,
  };
}

/** Every card on the board, with its playbook. One live subscription. */
export const list = query({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_estate", (q) => q.eq("estateId", estateId))
      .collect();
    const playbookIds = [...new Set(tasks.map((t) => t.playbookId).filter(Boolean))] as Id<"playbooks">[];
    const playbooks = new Map(
      (await Promise.all(playbookIds.map((id) => ctx.db.get(id)))).filter(Boolean).map((p) => [p!._id, p!]),
    );
    return tasks
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => ({
        ...t,
        playbook: publicPlaybook(t.playbookId ? (playbooks.get(t.playbookId) ?? null) : null),
      }));
  },
});

/** The email thread behind one card (chassis mailMessages, targetId = task). */
export const thread = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const rows = await ctx.db
      .query("mailMessages")
      .withIndex("by_target", (q) => q.eq("targetId", taskId))
      .collect();
    return rows
      .sort((a, b) => a.at - b.at)
      .map((m) => ({
        _id: m._id,
        direction: m.direction,
        subject: m.subject,
        text: m.direction === "in" ? (m.extractedText || m.fullText || "") : (m.fullText ?? ""),
        classification: m.classification ?? null,
        summary: m.summary ?? null,
        deliveryStatus: m.deliveryStatus ?? null,
        at: m.at,
      }));
  },
});

/** Cached playbooks for the "we already know this company" hint. */
export const knownCompanies = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("playbooks").take(200);
    return rows.filter((p) => p.quality === "ok").map((p) => ({ companyKey: p.companyKey, companyName: p.companyName, fetchedAt: p.fetchedAt }));
  },
});

/** Add companies from the checklist or free text; research starts immediately. */
export const addMany = mutation({
  args: {
    estateId: v.id("estates"),
    companies: v.array(v.object({ name: v.string(), category: v.string() })),
  },
  handler: async (ctx, { estateId, companies }) => {
    const { userId } = await requireMember(ctx, estateId);
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_estate", (q) => q.eq("estateId", estateId))
      .collect();
    const have = new Set(existing.map((t) => t.companyKey));
    let room = MAX_TASKS_PER_ESTATE - existing.length;
    const added: Id<"tasks">[] = [];
    for (const c of companies) {
      const name = displayName(c.name);
      const key = companyKey(name);
      if (!name || !key || have.has(key)) continue;
      if (room <= 0) break;
      room--;
      have.add(key);
      const now = Date.now();
      const cached = await ctx.db.query("playbooks").withIndex("by_companyKey", (q) => q.eq("companyKey", key)).first();
      const taskId = await ctx.db.insert("tasks", {
        estateId,
        companyName: cached?.companyName ?? name,
        companyKey: key,
        category: c.category,
        status: "researching",
        playbookId: cached?._id,
        followUpCount: 0,
        aiState: cached ? "drafting" : "searching",
        createdAt: now,
        updatedAt: now,
      });
      added.push(taskId);
      // Cached company: skip the crawl and go straight to the letter.
      if (cached) await ctx.scheduler.runAfter(0, internal.ai.draftLetter, { taskId, kind: "notification" });
      else await ctx.scheduler.runAfter(0, internal.research.lookup, { taskId, userId });
    }
    return { added: added.length };
  },
});

export const updateDraft = mutation({
  args: { taskId: v.id("tasks"), subject: v.string(), body: v.string(), recipient: v.optional(v.string()) },
  handler: async (ctx, { taskId, subject, body, recipient }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    await requireMember(ctx, task.estateId);
    await ctx.db.patch(taskId, {
      draftSubject: subject.slice(0, 200),
      draftBody: body.slice(0, 8000),
      ...(recipient !== undefined ? { recipient: recipient.trim().slice(0, 200) || undefined } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Human-in-the-loop: the letter only leaves when a person presses Send. */
export const approveAndSend = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    const { userId } = await requireMember(ctx, task.estateId);
    if (!task.draftBody || !task.draftSubject) throw new Error("There is no letter to send yet");
    await rateLimiter.limit(ctx, "userSend", { key: userId, throws: true });
    await rateLimiter.limit(ctx, "globalSend", { throws: true });
    await ctx.db.patch(taskId, { status: "sent", aiState: "sending", aiNote: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.send.notify, { taskId });
  },
});

/** Manual moves: "I called them", "this is done", "put it back". */
export const setStatus = mutation({
  args: { taskId: v.id("tasks"), status: taskStatus },
  handler: async (ctx, { taskId, status }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    await requireMember(ctx, task.estateId);
    await ctx.db.patch(taskId, {
      status,
      nextFollowUpAt: status === "awaiting" ? Date.now() + FOLLOW_UP_AFTER_MS : undefined,
      updatedAt: Date.now(),
    });
  },
});

export const setNotes = mutation({
  args: { taskId: v.id("tasks"), notes: v.string() },
  handler: async (ctx, { taskId, notes }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    await requireMember(ctx, task.estateId);
    await ctx.db.patch(taskId, { notes: notes.slice(0, 2000), updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    await requireMember(ctx, task.estateId);
    await ctx.db.delete(taskId);
  },
});

/** Look the company up again (fresh crawl) and redraft. */
export const retryResearch = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    const { userId } = await requireMember(ctx, task.estateId);
    await ctx.db.patch(taskId, { status: "researching", aiState: "searching", aiNote: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.research.lookup, { taskId, userId, force: true });
  },
});

/** Ask the model to write (or rewrite) the letter for this card. */
export const redraft = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    const { userId } = await requireMember(ctx, task.estateId);
    await rateLimiter.limit(ctx, "userLlm", { key: userId, throws: true });
    const kind =
      task.status === "needs_documents" || task.draftKind === "documents"
        ? "documents"
        : task.status === "awaiting" || task.draftKind === "follow_up"
          ? "follow_up"
          : "notification";
    await ctx.db.patch(taskId, { aiState: "drafting", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.ai.draftLetter, { taskId, kind });
  },
});

/**
 * "Needs something" -> prepare the reply that sends the requested papers.
 * Instant, template-based; the model can polish it via `redraft`.
 */
export const prepareDocumentsReply = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    await requireMember(ctx, task.estateId);
    const estate = await ctx.db.get(task.estateId);
    if (!estate) throw new Error("Estate not found");
    const letter = templateDocumentsReply(
      {
        personFirstName: estate.personFirstName,
        dateOfPassing: estate.dateOfPassing,
        relationship: estate.relationship,
        companyName: task.companyName,
        documents: [],
        steps: [],
      },
      task.requestedDocuments ?? [],
    );
    await ctx.db.patch(taskId, {
      status: "draft_ready",
      draftKind: "documents",
      draftSubject: letter.subject,
      draftBody: letter.body,
      aiState: "idle",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Demo helper: lets a judge play the company without a phone. The text goes
 * through exactly the same path as a real reply (mail.ingest -> inbound ->
 * classification -> board), so what moves on screen is the real pipeline.
 */
export const simulateReply = mutation({
  args: { taskId: v.id("tasks"), text: v.string() },
  handler: async (ctx, { taskId, text }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");
    await requireMember(ctx, task.estateId);
    const estate = await ctx.db.get(task.estateId);
    if (!estate) throw new Error("Estate not found");
    // Route by the real outbound thread, exactly as AgentMail would.
    let threadId = task.sentThreadId ?? "";
    if (!threadId && task.sentMessageId) {
      const sentRow = await ctx.db
        .query("mailMessages")
        .withIndex("by_messageId", (q) => q.eq("messageId", task.sentMessageId!))
        .unique();
      threadId = sentRow?.threadId ?? "";
    }
    const id = `sim-${taskId}-${Date.now()}`;
    await ctx.runMutation(internal.mail.ingest, {
      messageId: id,
      threadId,
      from: `${task.companyName} <bereavement@example.com>`,
      to: [],
      subject: `Re: [${estate.caseCode}] ${task.draftSubject ?? "Account of " + estate.personFirstName}`,
      extractedText: text.slice(0, 4000),
      fullText: text.slice(0, 4000),
      receivedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------- internal

export const getInternal = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    const estate = await ctx.db.get(task.estateId);
    const playbook = task.playbookId ? await ctx.db.get(task.playbookId) : null;
    return { task, estate, playbook };
  },
});

export const listForEstate = internalQuery({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) =>
    ctx.db.query("tasks").withIndex("by_estate", (q) => q.eq("estateId", estateId)).collect(),
});

export const playbookByKey = internalQuery({
  args: { companyKey: v.string() },
  handler: async (ctx, { companyKey }) =>
    ctx.db.query("playbooks").withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey)).first(),
});

export const upsertPlaybook = internalMutation({
  args: {
    companyKey: v.string(),
    companyName: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    steps: v.array(v.string()),
    documents: v.array(v.string()),
    contactEmail: v.optional(v.string()),
    contactFormUrl: v.optional(v.string()),
    phone: v.optional(v.string()),
    expectedDays: v.optional(v.number()),
    confidence: v.optional(v.number()),
    rawExcerpt: v.optional(v.string()),
    model: v.string(),
    quality: v.union(v.literal("ok"), v.literal("generic")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("playbooks")
      .withIndex("by_companyKey", (q) => q.eq("companyKey", args.companyKey))
      .first();
    // Never overwrite a real playbook with a generic one.
    if (existing && existing.quality === "ok" && args.quality === "generic") return existing._id;
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, fetchedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("playbooks", { ...args, fetchedAt: Date.now() });
  },
});

export const patch = internalMutation({
  args: {
    taskId: v.id("tasks"),
    status: v.optional(taskStatus),
    playbookId: v.optional(v.id("playbooks")),
    draftSubject: v.optional(v.string()),
    draftBody: v.optional(v.string()),
    draftKind: v.optional(draftKind),
    recipient: v.optional(v.string()),
    sentMessageId: v.optional(v.string()),
    sentThreadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    lastInboundAt: v.optional(v.number()),
    nextFollowUpAt: v.optional(v.number()),
    clearFollowUp: v.optional(v.boolean()),
    followUpCount: v.optional(v.number()),
    summary: v.optional(v.string()),
    requestedDocuments: v.optional(v.array(v.string())),
    aiState: v.optional(
      v.union(
        v.literal("searching"),
        v.literal("reading"),
        v.literal("drafting"),
        v.literal("sending"),
        v.literal("idle"),
        v.literal("unavailable"),
      ),
    ),
    aiNote: v.optional(v.string()),
    clearAiNote: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskId, clearFollowUp, clearAiNote, ...fields }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    const defined = Object.fromEntries(Object.entries(fields).filter(([, val]) => val !== undefined));
    await ctx.db.patch(taskId, {
      ...defined,
      ...(clearFollowUp ? { nextFollowUpAt: undefined } : {}),
      ...(clearAiNote ? { aiNote: undefined } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Cards in "Waiting" whose follow-up date has passed. */
export const dueForFollowUp = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) =>
    ctx.db
      .query("tasks")
      .withIndex("by_status_followUp", (q) => q.eq("status", "awaiting").lt("nextFollowUpAt", now))
      .take(25),
});

export const mailMessage = internalQuery({
  args: { id: v.id("mailMessages") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const labelMailMessage = internalMutation({
  args: { id: v.id("mailMessages"), classification: v.string(), summary: v.string() },
  handler: async (ctx, { id, classification, summary }) => {
    await ctx.db.patch(id, { classification, summary });
  },
});

/** Who owns the estate — the key for per-user limits in background work. */
export const ownerOf = internalQuery({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => (await ctx.db.get(estateId))?.ownerId ?? null,
});

/** The signed-in user id, for actions that need a rate-limit key. */
export const me = internalQuery({
  args: {},
  handler: async (ctx) => getAuthUserId(ctx),
});
