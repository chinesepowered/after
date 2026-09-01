"use node";

import { v } from "convex/values";
import { Agent, saveMessage } from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { agentModel } from "./lib/agentModel";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE, rateLimiter } from "./lib/limits";
import { formatDate } from "./lib/product";

/**
 * "Ask After": a small assistant that answers "what does the bank need from
 * me?" using the estate's own playbooks and cards. Built on the Convex Agent
 * component, so the thread and messages live in Convex and every member of the
 * estate sees the same conversation update live.
 */

const INSTRUCTIONS = `You are After, a quiet assistant for someone closing the accounts of a person who has died.
Answer only from the context you are given about their companies, playbooks and letters. If the context does not say, say so plainly and suggest what they could check.
Tone: calm, brief, plain. No euphemisms, no exclamation marks, no cheerleading, no "I'm sorry for your loss" boilerplate. Short paragraphs or a short list. Never invent phone numbers, emails or policies.`;

function agent() {
  return new Agent(components.agent, {
    name: "After",
    languageModel: agentModel(),
    instructions: INSTRUCTIONS,
    maxSteps: 1,
  });
}

export const send = action({
  args: { estateId: v.id("estates"), text: v.string() },
  handler: async (ctx, { estateId, text }): Promise<{ ok: boolean; message?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const member = await ctx.runQuery(internal.estates.membership, { estateId, userId });
    if (!member) throw new Error("You are not a member of this estate");
    const prompt = text.trim().slice(0, 1000);
    if (!prompt) return { ok: false, message: "Write a question first." };

    const estate = await ctx.runQuery(internal.estates.getInternal, { estateId });
    if (!estate) throw new Error("Estate not found");
    const a = agent();

    let threadId = estate.askThreadId;
    if (!threadId) {
      const created = await a.createThread(ctx, { userId, title: `Ask After – ${estate.personFirstName}` });
      threadId = created.threadId;
      await ctx.runMutation(internal.estates.setAskThread, { estateId, threadId });
    }

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "userLlm", { key: userId, throws: true });
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
    } catch (e) {
      const message = isRateLimitError(e) ? QUOTA_MESSAGE : "The assistant is paused right now.";
      return { ok: false, message };
    }

    const tasks = await ctx.runQuery(internal.tasks.listForEstate, { estateId });
    const playbooks = await Promise.all(
      tasks.map(async (t) => (t.playbookId ? await ctx.runQuery(internal.tasks.getInternal, { taskId: t._id }) : null)),
    );
    const context = tasks
      .map((t, i) => {
        const pb = playbooks[i]?.playbook;
        return [
          `## ${t.companyName} (${t.category}) — status: ${t.status}`,
          t.summary ? `Last reply: ${t.summary}` : "",
          t.requestedDocuments?.length ? `They asked for: ${t.requestedDocuments.join(", ")}` : "",
          pb ? `Procedure (${pb.quality === "ok" ? `from ${pb.sourceUrl}` : "general guidance"}):\n- ${pb.steps.join("\n- ")}` : "",
          pb?.documents.length ? `Documents: ${pb.documents.join(", ")}` : "",
          pb?.contactEmail ? `Email: ${pb.contactEmail}` : "",
          pb?.phone ? `Phone: ${pb.phone}` : "",
          pb?.contactFormUrl ? `Web form: ${pb.contactFormUrl}` : "",
          pb?.expectedDays ? `Expected time: about ${pb.expectedDays} days` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const system = `${INSTRUCTIONS}\n\nContext for this estate — ${estate.personFirstName}, who died on ${formatDate(estate.dateOfPassing)}; the user is their ${estate.relationship}.\n\n${context || "No companies have been added yet."}`;

    try {
      await a.generateText(ctx, { threadId, userId }, { prompt, system }, { contextOptions: { recentMessages: 12 } });
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });
      return { ok: true };
    } catch (e) {
      console.warn(`ask.send failed: ${String(e).slice(0, 200)}`);
      await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: "assistant", content: "I could not reach the assistant just now. Your question is saved; try again in a little while." },
        agentName: "After",
      });
      return { ok: false, message: "The assistant was unavailable." };
    }
  },
});
