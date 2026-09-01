import { v } from "convex/values";
import { listMessages } from "@convex-dev/agent";
import { query } from "./_generated/server";
import { components } from "./_generated/api";

/**
 * Live view of the "Ask After" thread, stored by the Agent component.
 * Default runtime: this file only reads.
 */
export const messages = query({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }) => {
    const estate = await ctx.db.get(estateId);
    if (!estate?.askThreadId) return [];
    const page = await listMessages(ctx, components.agent, {
      threadId: estate.askThreadId,
      paginationOpts: { numItems: 60, cursor: null },
      excludeToolMessages: true,
    });
    return page.page
      .filter((m) => m.message?.role === "user" || m.message?.role === "assistant")
      .sort((a, b) => a.order - b.order || a.stepOrder - b.stepOrder)
      .map((m) => ({
        _id: m._id,
        role: m.message!.role as "user" | "assistant",
        text: m.text ?? "",
        status: m.status,
        at: m._creationTime,
      }));
  },
});
