import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { newCaseCode } from "./lib/mailUtil";
import { CASE_PREFIX } from "./lib/app";
import { newSlug, todayKey } from "./lib/product";
import { rateLimiter } from "./lib/limits";

/** Throws unless the signed-in user is a member of the estate. */
export async function requireMember(ctx: QueryCtx | MutationCtx, estateId: Id<"estates">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const member = await ctx.db
    .query("estateMembers")
    .withIndex("by_estate_user", (q) => q.eq("estateId", estateId).eq("userId", userId))
    .unique();
  if (!member) throw new Error("You are not a member of this estate");
  return { userId, member };
}

async function uniqueSlug(ctx: MutationCtx) {
  for (let i = 0; i < 5; i++) {
    const slug = newSlug();
    const hit = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!hit) return slug;
  }
  throw new Error("Could not allocate a slug");
}

async function uniqueCaseCode(ctx: MutationCtx) {
  for (let i = 0; i < 5; i++) {
    const code = newCaseCode(CASE_PREFIX);
    const hit = await ctx.db.query("estates").withIndex("by_caseCode", (q) => q.eq("caseCode", code)).unique();
    if (!hit) return code;
  }
  throw new Error("Could not allocate a case code");
}

/** /start: three fields, one button. Minimal personal data by design. */
export const create = mutation({
  args: {
    personFirstName: v.string(),
    dateOfPassing: v.string(),
    relationship: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await rateLimiter.limit(ctx, "createCase", { key: userId, throws: true });

    const personFirstName = args.personFirstName.trim().slice(0, 40);
    const relationship = args.relationship.trim().slice(0, 40) || "family member";
    if (!personFirstName) throw new Error("Please add a first name");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateOfPassing)) throw new Error("Please add a date");

    const slug = await uniqueSlug(ctx);
    const caseCode = await uniqueCaseCode(ctx);
    const estateId = await ctx.db.insert("estates", {
      ownerId: userId,
      slug,
      personFirstName,
      dateOfPassing: args.dateOfPassing,
      relationship,
      caseCode,
      createdAt: Date.now(),
    });
    await ctx.db.insert("estateMembers", { estateId, userId, role: "owner", joinedAt: Date.now() });
    for (const name of ["Death certificate (copy)", "Your ID"]) {
      await ctx.db.insert("documents", { estateId, name, status: "need", createdAt: Date.now() });
    }
    return { estateId, slug };
  },
});

/** Estates the signed-in user belongs to (owner or invited). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("estateMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const rows = await Promise.all(memberships.map((m) => ctx.db.get(m.estateId)));
    return rows
      .filter((e): e is Doc<"estates"> => Boolean(e))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({
        _id: e._id,
        slug: e.slug,
        personFirstName: e.personFirstName,
        dateOfPassing: e.dateOfPassing,
        relationship: e.relationship,
        createdAt: e.createdAt,
      }));
  },
});

/**
 * The board. Knowing the unguessable slug is the invitation: anyone with the
 * link can read; `join` makes them a member so they can act.
 */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const estate = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!estate) return null;
    const userId = await getAuthUserId(ctx);
    const member = userId
      ? await ctx.db
          .query("estateMembers")
          .withIndex("by_estate_user", (q) => q.eq("estateId", estate._id).eq("userId", userId))
          .unique()
      : null;
    const members = await ctx.db
      .query("estateMembers")
      .withIndex("by_estate", (q) => q.eq("estateId", estate._id))
      .collect();
    return {
      _id: estate._id,
      slug: estate.slug,
      personFirstName: estate.personFirstName,
      dateOfPassing: estate.dateOfPassing,
      relationship: estate.relationship,
      caseCode: estate.caseCode,
      createdAt: estate.createdAt,
      isMember: Boolean(member),
      role: member?.role ?? null,
      memberCount: members.length,
      hasAskThread: Boolean(estate.askThreadId),
    };
  },
});

/** Accept a share link. Idempotent. */
export const join = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const estate = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!estate) throw new Error("This link does not point to an estate");
    const existing = await ctx.db
      .query("estateMembers")
      .withIndex("by_estate_user", (q) => q.eq("estateId", estate._id).eq("userId", userId))
      .unique();
    if (!existing) {
      await ctx.db.insert("estateMembers", { estateId: estate._id, userId, role: "member", joinedAt: Date.now() });
    }
    return { estateId: estate._id, slug: estate.slug };
  },
});

// ---------------------------------------------------------------- presence

const PRESENCE_TTL_MS = 45_000;

export const heartbeat = mutation({
  args: { estateId: v.id("estates"), label: v.string() },
  handler: async (ctx, { estateId, label }) => {
    const { userId } = await requireMember(ctx, estateId);
    const row = await ctx.db
      .query("presence")
      .withIndex("by_estate_user", (q) => q.eq("estateId", estateId).eq("userId", userId))
      .unique();
    const clean = label.trim().slice(0, 24) || "Someone";
    if (row) await ctx.db.patch(row._id, { lastSeen: Date.now(), label: clean });
    else await ctx.db.insert("presence", { estateId, userId, label: clean, lastSeen: Date.now() });
  },
});

export const viewers = query({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    const userId = await getAuthUserId(ctx);
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_estate", (q) => q.eq("estateId", estateId))
      .collect();
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    return rows
      .filter((r) => r.lastSeen > cutoff)
      .map((r) => ({ label: r.label, me: r.userId === userId, lastSeen: r.lastSeen }));
  },
});

// ---------------------------------------------------------------- documents

export const documents = query({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_estate", (q) => q.eq("estateId", estateId))
      .collect();
    return Promise.all(
      rows.map(async (d) => ({
        _id: d._id,
        name: d.name,
        status: d.status,
        hasFile: Boolean(d.storageId),
        url: d.storageId ? await ctx.storage.getUrl(d.storageId) : null,
      })),
    );
  },
});

export const addDocument = mutation({
  args: { estateId: v.id("estates"), name: v.string() },
  handler: async (ctx, { estateId, name }) => {
    await requireMember(ctx, estateId);
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    await ctx.db.insert("documents", { estateId, name: clean, status: "need", createdAt: Date.now() });
  },
});

export const setDocumentStatus = mutation({
  args: { documentId: v.id("documents"), status: v.union(v.literal("have"), v.literal("need")) },
  handler: async (ctx, { documentId, status }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return;
    await requireMember(ctx, doc.estateId);
    await ctx.db.patch(documentId, { status });
  },
});

/** File storage via upload URL; the demo only ever uploads a dummy PDF. */
export const documentUploadUrl = mutation({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    await requireMember(ctx, estateId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachDocumentFile = mutation({
  args: { documentId: v.id("documents"), storageId: v.id("_storage") },
  handler: async (ctx, { documentId, storageId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return;
    await requireMember(ctx, doc.estateId);
    await ctx.db.patch(documentId, { storageId, status: "have" });
  },
});

// ---------------------------------------------------------------- today

export const todayPlan = query({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    const plan = await ctx.db
      .query("dailyPlan")
      .withIndex("by_estate_date", (q) => q.eq("estateId", estateId).eq("date", todayKey()))
      .unique();
    if (!plan) return null;
    const tasks = await Promise.all(plan.taskIds.map((id) => ctx.db.get(id)));
    return {
      date: plan.date,
      note: plan.note ?? null,
      tasks: tasks
        .filter((t): t is Doc<"tasks"> => Boolean(t))
        .map((t) => ({ _id: t._id, companyName: t.companyName, status: t.status, summary: t.summary ?? null })),
    };
  },
});

/** Members can ask for today's plan to be (re)built, e.g. right after adding companies. */
export const requestTodayPlan = mutation({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    const { userId } = await requireMember(ctx, estateId);
    await rateLimiter.limit(ctx, "userLlm", { key: userId, throws: true });
    await ctx.scheduler.runAfter(0, internal.ai.buildDailyPlan, { estateId });
  },
});

// ---------------------------------------------------------------- internal

export const getInternal = internalQuery({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => ctx.db.get(estateId),
});

export const allInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("estates").collect(),
});

export const setAskThread = internalMutation({
  args: { estateId: v.id("estates"), threadId: v.string() },
  handler: async (ctx, { estateId, threadId }) => {
    await ctx.db.patch(estateId, { askThreadId: threadId });
  },
});

export const savePlan = internalMutation({
  args: {
    estateId: v.id("estates"),
    taskIds: v.array(v.id("tasks")),
    note: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { estateId, taskIds, note, model }) => {
    const date = todayKey();
    const existing = await ctx.db
      .query("dailyPlan")
      .withIndex("by_estate_date", (q) => q.eq("estateId", estateId).eq("date", date))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { taskIds, note, model });
    else await ctx.db.insert("dailyPlan", { estateId, date, taskIds, note, model });
  },
});

/** Membership check usable from actions. */
export const membership = internalQuery({
  args: { estateId: v.id("estates"), userId: v.id("users") },
  handler: async (ctx, { estateId, userId }) => {
    const m = await ctx.db
      .query("estateMembers")
      .withIndex("by_estate_user", (q) => q.eq("estateId", estateId).eq("userId", userId))
      .unique();
    return m ? { role: m.role } : null;
  },
});
