import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** CLI helper for verifying the mail loop: the raw mail row for a message. */
export const mailByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) =>
    ctx.db.query("mailMessages").withIndex("by_messageId", (q) => q.eq("messageId", messageId)).unique(),
});
