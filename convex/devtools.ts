import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** CLI helper for verifying the mail loop: the raw mail row for a message. */
export const mailByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) =>
    ctx.db.query("mailMessages").withIndex("by_messageId", (q) => q.eq("messageId", messageId)).unique(),
});

/**
 * CLI helper: one estate and its cards, with ids, so the core loop can be
 * driven and checked from `convex run` without a browser.
 *
 *   pnpm exec convex run devtools:estate '{"slug":"demo-robert"}'
 */
export const estate = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const estate = await ctx.db.query("estates").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!estate) return null;
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_estate", (q) => q.eq("estateId", estate._id))
      .collect();
    return {
      estateId: estate._id,
      slug: estate.slug,
      caseCode: estate.caseCode,
      ownerId: estate.ownerId,
      tasks: tasks
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((t) => ({
          taskId: t._id,
          company: t.companyName,
          status: t.status,
          aiState: t.aiState ?? null,
          aiNote: t.aiNote ?? null,
          recipient: t.recipient ?? null,
          sentThreadId: t.sentThreadId ?? null,
          sentMessageId: t.sentMessageId ?? null,
          hasDraft: Boolean(t.draftBody),
          summary: t.summary ?? null,
        })),
    };
  },
});

/** CLI helper: the whole thread stored for one card, oldest first. */
export const threadFor = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const rows = await ctx.db
      .query("mailMessages")
      .withIndex("by_target", (q) => q.eq("targetId", taskId))
      .collect();
    return rows
      .sort((a, b) => a.at - b.at)
      .map((m) => ({
        direction: m.direction,
        messageId: m.messageId,
        threadId: m.threadId ?? null,
        subject: m.subject,
        classification: m.classification ?? null,
        summary: m.summary ?? null,
        deliveryStatus: m.deliveryStatus ?? null,
        text: (m.extractedText || m.fullText || "").slice(0, 200),
      }));
  },
});
