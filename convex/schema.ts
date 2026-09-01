import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Shared chassis tables (usage, settings, mailMessages, senderRoutes) plus the
 * product tables for After. Personal data is kept to a first name, a date and a
 * relationship — nothing else about the person who died is ever stored.
 */

export const taskStatus = v.union(
  v.literal("researching"),
  v.literal("draft_ready"),
  v.literal("sent"),
  v.literal("awaiting"),
  v.literal("needs_documents"),
  v.literal("needs_call"),
  v.literal("closed"),
  v.literal("bounced"),
);

export const draftKind = v.union(
  v.literal("notification"),
  v.literal("follow_up"),
  v.literal("documents"),
);

export default defineSchema({
  ...authTables,

  /** Daily per-provider counters so free-tier burn is visible on /admin. */
  usage: defineTable({
    day: v.string(), // YYYY-MM-DD
    provider: v.string(), // firecrawl | agentmail | llm
    count: v.number(),
  }).index("by_day_provider", ["day", "provider"]),

  /** Singleton row: the app's one AgentMail inbox. */
  settings: defineTable({
    key: v.string(), // always "singleton"
    inboxId: v.string(),
    inboxAddress: v.string(),
  }).index("by_key", ["key"]),

  /**
   * Every email in or out. Inbound is routed to a case by, in order:
   * thread id, [CASE-CODE] in the subject, then a registered sender address.
   * In After, `targetId` is the task (one company) the message belongs to.
   */
  mailMessages: defineTable({
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.array(v.string())),
    subject: v.string(),
    extractedText: v.optional(v.string()),
    fullText: v.optional(v.string()),
    caseCode: v.optional(v.string()),
    /** Product row this message belongs to, once routed. */
    targetId: v.optional(v.string()),
    routed: v.boolean(),
    classification: v.optional(v.string()),
    summary: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()), // sent | delivered | bounced
    at: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_threadId", ["threadId"])
    .index("by_caseCode", ["caseCode"])
    .index("by_target", ["targetId"])
    .index("by_routed", ["routed"]),

  /** Sender address to product row, for "forward your email here" flows. */
  senderRoutes: defineTable({
    email: v.string(),
    targetId: v.string(),
    ownerId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  // ---------------------------------------------------------------- product

  /** One estate = one person who died and the family closing their accounts. */
  estates: defineTable({
    ownerId: v.id("users"),
    /** Unguessable slug; knowing it is how a sibling joins. */
    slug: v.string(),
    personFirstName: v.string(),
    dateOfPassing: v.string(), // YYYY-MM-DD
    relationship: v.string(),
    /** Short code in every outbound subject, e.g. AFT-7F3K, for reply routing. */
    caseCode: v.string(),
    /** Agent-component thread for the "Ask After" panel, shared by members. */
    askThreadId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_slug", ["slug"])
    .index("by_caseCode", ["caseCode"]),

  estateMembers: defineTable({
    estateId: v.id("estates"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_estate", ["estateId"])
    .index("by_user", ["userId"])
    .index("by_estate_user", ["estateId", "userId"]),

  /**
   * A company's real bereavement procedure, found by Firecrawl and extracted by
   * the LLM. Shared across every user: the second family that adds "Netflix"
   * gets it instantly.
   */
  playbooks: defineTable({
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
    /** ok = extracted from the company's page; generic = AI or crawl unavailable, general guidance used. */
    quality: v.union(v.literal("ok"), v.literal("generic")),
    note: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_companyKey", ["companyKey"]),

  /** One card on the board: one company to notify for one estate. */
  tasks: defineTable({
    estateId: v.id("estates"),
    companyName: v.string(),
    companyKey: v.string(),
    category: v.string(),
    status: taskStatus,
    playbookId: v.optional(v.id("playbooks")),
    draftSubject: v.optional(v.string()),
    draftBody: v.optional(v.string()),
    draftKind: v.optional(draftKind),
    /** Where the letter goes. Defaults to the playbook's contact address. */
    recipient: v.optional(v.string()),
    sentMessageId: v.optional(v.string()),
    sentThreadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    lastInboundAt: v.optional(v.number()),
    nextFollowUpAt: v.optional(v.number()),
    followUpCount: v.number(),
    /** Latest classified reply, in one plain sentence. */
    summary: v.optional(v.string()),
    requestedDocuments: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    /** What the background pipeline is doing, so the card can say so. */
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_estate", ["estateId"])
    .index("by_estate_status", ["estateId", "status"])
    .index("by_status_followUp", ["status", "nextFollowUpAt"]),

  /** Papers the family has or still needs. Demo uses a dummy PDF only. */
  documents: defineTable({
    estateId: v.id("estates"),
    name: v.string(),
    storageId: v.optional(v.id("_storage")),
    status: v.union(v.literal("have"), v.literal("need")),
    createdAt: v.number(),
  }).index("by_estate", ["estateId"]),

  /** "Today's three things", chosen once a day per estate. */
  dailyPlan: defineTable({
    estateId: v.id("estates"),
    date: v.string(), // YYYY-MM-DD
    taskIds: v.array(v.id("tasks")),
    note: v.optional(v.string()),
    model: v.optional(v.string()),
  }).index("by_estate_date", ["estateId", "date"]),

  /** Who has the board open right now (heartbeat every ~20s). */
  presence: defineTable({
    estateId: v.id("estates"),
    userId: v.id("users"),
    label: v.string(),
    lastSeen: v.number(),
  })
    .index("by_estate", ["estateId"])
    .index("by_estate_user", ["estateId", "userId"]),
});
