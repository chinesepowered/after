"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { extract } from "./lib/llm";
import { assertNotPaused, rateLimiter } from "./lib/limits";
import { FOLLOW_UP_AFTER_MS, heuristicClassify, statusForClassification, type Classification } from "./lib/product";

/**
 * Runs for every inbound email once mail.ingest has stored and routed it.
 * In After, `targetId` is a task (one company). The reply is classified —
 * closed / needs_documents / needs_call / auto_reply / other — and the card
 * moves on the board for everyone watching. The model is preferred; a keyword
 * fallback keeps the board moving when it is unavailable.
 */

const ReplySchema = z.object({
  classification: z.enum(["closed", "needs_documents", "needs_call", "auto_reply", "other"]),
  summary: z.string().max(200),
  requestedDocuments: z.array(z.string()).max(6),
});

const CLASSIFY_SYSTEM = `You read a company's reply to a bereaved family member who asked to close a deceased person's account.
Classify it:
- closed: the company confirms the account is closed, cancelled or settled.
- needs_documents: the company asks for documents (death certificate, ID, proof of authority, forms) before proceeding.
- needs_call: the company asks the family to phone, visit a branch, or use a channel other than email.
- auto_reply: an automatic acknowledgement, ticket number, or out-of-office with no substantive content.
- other: anything else (questions, partial progress, a refusal).
Write the summary as one calm sentence addressed to the family member, about the company in the third person ("They asked for a copy of the death certificate."). Plain words, no euphemisms, no exclamation marks. List requested documents as short noun phrases with a capital first letter ("Death certificate").`;

export const onInbound = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    const msg = await ctx.runQuery(internal.tasks.mailMessage, { id: mailMessageId });
    if (!msg || msg.direction !== "in" || !msg.targetId) return; // unrouted mail stays on the admin list
    const taskId = msg.targetId as Id<"tasks">;
    const row = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!row || !row.estate) return;
    const { task, estate } = row;

    const text = (msg.extractedText || msg.fullText || "").slice(0, 6000);
    let result: { classification: Classification; summary: string; requestedDocuments: string[] };
    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "userLlm", { key: String(estate.ownerId), throws: true });
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
      result = await extract(
        ReplySchema,
        `Company: ${task.companyName}\nSubject: ${msg.subject}\n\nReply:\n${text}`,
        { system: CLASSIFY_SYSTEM, maxTokens: 400 },
      );
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });
    } catch (e) {
      console.warn(`inbound.onInbound used keyword fallback: ${String(e).slice(0, 160)}`);
      result = heuristicClassify(text);
    }

    await ctx.runMutation(internal.tasks.labelMailMessage, {
      id: mailMessageId,
      classification: result.classification,
      summary: result.summary,
    });

    if (result.classification === "auto_reply") {
      // Acknowledge quietly; the card stays where it is.
      await ctx.runMutation(internal.tasks.patch, { taskId, lastInboundAt: msg.at, summary: result.summary });
      return;
    }

    const status = statusForClassification(result.classification);
    await ctx.runMutation(internal.tasks.patch, {
      taskId,
      status,
      lastInboundAt: msg.at,
      summary: result.summary,
      requestedDocuments: result.requestedDocuments,
      ...(status === "awaiting" ? { nextFollowUpAt: msg.at + FOLLOW_UP_AFTER_MS } : { clearFollowUp: true }),
      aiState: "idle",
      clearAiNote: true,
    });
  },
});
