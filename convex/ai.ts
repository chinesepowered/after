"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { draft, extract, modelId } from "./lib/llm";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE, rateLimiter } from "./lib/limits";
import {
  formatDate,
  MAX_FOLLOW_UPS,
  templateDocumentsReply,
  templateFollowUp,
  templateLetter,
  type LetterContext,
} from "./lib/product";

/**
 * Everything the model writes for a family. Each function has a deterministic
 * fallback, so the board keeps moving when the model is slow or unavailable;
 * the card then says so plainly instead of pretending.
 */

const LETTER_SYSTEM = `You write short letters on behalf of a bereaved family member to a company, to close or transfer the account of someone who has died.
Voice: calm, plain, factual, unhurried. No euphemisms — say "died", not "passed away". No exclamation marks, no apologies for writing, no legal bluster, no flattery.
Length: 90 to 160 words. Use short paragraphs. Do not invent account numbers, addresses or dates; use only the facts given. Do not include placeholder brackets.
If the company's procedure lists documents, say which ones you can provide. Ask for written next steps and a timeline.
Sign off with the relationship only (e.g. "Robert's daughter"), never a full name.
Output exactly this format:
Subject: <one line>

<letter body>`;

function letterContext(estate: Doc<"estates">, task: Doc<"tasks">, playbook: Doc<"playbooks"> | null): LetterContext {
  return {
    personFirstName: estate.personFirstName,
    dateOfPassing: estate.dateOfPassing,
    relationship: estate.relationship,
    companyName: task.companyName,
    documents: playbook?.documents ?? [],
    steps: playbook?.steps ?? [],
  };
}

function splitLetter(raw: string): { subject: string; body: string } | null {
  const text = raw.trim().replace(/^```[a-z]*\n?|```$/g, "").trim();
  const m = text.match(/^\s*\*{0,2}Subject:?\*{0,2}\s*(.+?)\s*\n+([\s\S]+)$/i);
  if (!m) return null;
  const subject = m[1].replace(/^\*+|\*+$/g, "").trim().slice(0, 150);
  const body = m[2].trim();
  if (!subject || body.length < 40) return null;
  return { subject, body };
}

async function takeLlmTokens(ctx: ActionCtx, key: string) {
  assertNotPaused();
  await rateLimiter.limit(ctx, "userLlm", { key, throws: true });
  await rateLimiter.limit(ctx, "globalLlm", { throws: true });
}

function fallbackNote(e: unknown): string {
  if (isRateLimitError(e)) return QUOTA_MESSAGE;
  if (String(e).includes("PAUSED")) return "The writing assistant is paused. This is a plain template you can edit.";
  return "The writing assistant was unavailable, so this is a plain template. You can edit it or ask for a rewrite.";
}

export const draftLetter = internalAction({
  args: {
    taskId: v.id("tasks"),
    kind: v.union(v.literal("notification"), v.literal("follow_up"), v.literal("documents")),
  },
  handler: async (ctx, { taskId, kind }): Promise<void> => {
    const row = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!row || !row.estate) return;
    const { task, estate, playbook } = row;
    const c = letterContext(estate, task, playbook);

    let letter: { subject: string; body: string } | null = null;
    let note: string | undefined;
    let usedModel = "template";

    try {
      await takeLlmTokens(ctx, String(estate.ownerId));
      const facts = [
        `Person who died: ${estate.personFirstName} (first name only).`,
        `Date of death: ${formatDate(estate.dateOfPassing)}.`,
        `Writer's relationship: ${estate.relationship}.`,
        `Company: ${task.companyName}.`,
        playbook ? `Company procedure (from ${playbook.sourceUrl ?? "general guidance"}):\n- ${playbook.steps.join("\n- ")}` : "",
        playbook?.documents.length ? `Documents the company needs: ${playbook.documents.join(", ")}.` : "",
        playbook?.expectedDays ? `Their stated timeline: about ${playbook.expectedDays} days.` : "",
        kind === "follow_up" && task.sentAt
          ? `This is a follow-up: the first letter was sent on ${new Date(task.sentAt).toDateString()} and there has been no reply. Be brief and ask for a status.`
          : "",
        kind === "documents"
          ? `This is a reply to their request for documents. They asked for: ${(task.requestedDocuments ?? []).join(", ") || "documents"}. Say they are attached/enclosed and ask them to confirm receipt and timeline.`
          : "",
        task.summary && kind !== "notification" ? `Their last reply, summarised: ${task.summary}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const raw = await draft(`Write the ${kind === "notification" ? "notification" : kind === "follow_up" ? "follow-up" : "documents"} letter.\n\n${facts}`, {
        system: LETTER_SYSTEM,
        maxTokens: 1200,
        temperature: 0.5,
      });
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });
      letter = splitLetter(raw);
      if (!letter) throw new Error("model output had no Subject line");
      usedModel = modelId();
    } catch (e) {
      note = fallbackNote(e);
      console.warn(`ai.draftLetter(${task.companyName}) used template: ${String(e).slice(0, 200)}`);
    }

    if (!letter) {
      letter =
        kind === "follow_up"
          ? templateFollowUp(c, task.sentAt ?? Date.now())
          : kind === "documents"
            ? templateDocumentsReply(c, task.requestedDocuments ?? [])
            : templateLetter(c);
    }

    await ctx.runMutation(internal.tasks.patch, {
      taskId,
      status: "draft_ready",
      draftKind: kind,
      draftSubject: letter.subject,
      draftBody: letter.body,
      recipient: task.recipient ?? playbook?.contactEmail ?? undefined,
      aiState: note ? "unavailable" : "idle",
      aiNote: note,
      ...(note ? {} : { clearAiNote: true }),
    });
    console.log(`draft ready for ${task.companyName} (${usedModel})`);
  },
});

// ---------------------------------------------------------------- follow-ups

/** Cron: companies silent for a week get a gentle follow-up, ready to approve. */
export const followUpSweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ drafted: number }> => {
    const due: Doc<"tasks">[] = await ctx.runQuery(internal.tasks.dueForFollowUp, { now: Date.now() });
    for (const task of due) {
      if (task.followUpCount >= MAX_FOLLOW_UPS) {
        // One nudge per company, by design. Leave it waiting, stop rescheduling.
        await ctx.runMutation(internal.tasks.patch, { taskId: task._id, clearFollowUp: true });
        continue;
      }
      await ctx.runMutation(internal.tasks.patch, {
        taskId: task._id,
        followUpCount: task.followUpCount + 1,
        clearFollowUp: true,
        aiState: "drafting",
      });
      await ctx.runAction(internal.ai.draftLetter, { taskId: task._id, kind: "follow_up" });
    }
    return { drafted: due.length };
  },
});

// ---------------------------------------------------------------- daily plan

const PlanSchema = z.object({
  taskIndexes: z.array(z.number().int()).max(3),
  note: z.string().max(160),
});

const OPEN = new Set(["draft_ready", "needs_documents", "needs_call", "bounced", "awaiting", "researching", "sent"]);

function heuristicPlan(tasks: Doc<"tasks">[]) {
  const weight = (t: Doc<"tasks">) =>
    t.status === "needs_documents" || t.status === "needs_call" || t.status === "bounced"
      ? 0
      : t.status === "draft_ready"
        ? 1
        : t.status === "awaiting"
          ? 3
          : 2;
  const picked = [...tasks].filter((t) => OPEN.has(t.status) && t.status !== "awaiting").sort((a, b) => weight(a) - weight(b) || a.createdAt - b.createdAt).slice(0, 3);
  const open = tasks.filter((t) => t.status !== "closed").length;
  const note =
    picked.length === 0
      ? open === 0
        ? "Everything is done. There is nothing you need to do today."
        : "Nothing needs you today. The letters are out; replies will show up here."
      : "Three small things. You don't have to finish this today.";
  return { picked, note };
}

export const buildDailyPlan = internalAction({
  args: { estateId: v.id("estates") },
  handler: async (ctx, { estateId }): Promise<void> => {
    const estate: Doc<"estates"> | null = await ctx.runQuery(internal.estates.getInternal, { estateId });
    if (!estate) return;
    const tasks: Doc<"tasks">[] = await ctx.runQuery(internal.tasks.listForEstate, { estateId });
    const h = heuristicPlan(tasks);
    let taskIds = h.picked.map((t) => t._id);
    let note = h.note;
    let model: string | undefined;

    const candidates = tasks.filter((t) => OPEN.has(t.status));
    if (candidates.length > 3) {
      try {
        await takeLlmTokens(ctx, String(estate.ownerId));
        const listing = candidates
          .map((t, i) => `[${i}] ${t.companyName} — status: ${t.status}${t.summary ? ` — last reply: ${t.summary}` : ""}`)
          .join("\n");
        const plan = await extract(
          PlanSchema,
          `A grieving family member is closing the accounts of ${estate.personFirstName}, who died on ${formatDate(estate.dateOfPassing)}. Choose at most three tasks for them to do today: prefer tasks that need something from them (needs_documents, needs_call, bounced), then letters ready to send (draft_ready). Skip tasks that are just waiting for a company. Then write one calm sentence (max 20 words) for the top of their day — no exclamation marks, no urgency, no euphemisms.\n\nTasks:\n${listing}`,
          { system: "You help someone pace a hard week gently.", maxTokens: 300 },
        );
        await ctx.runMutation(internal.usage.bump, { provider: "llm" });
        const chosen = plan.taskIndexes.map((i) => candidates[i]).filter(Boolean).slice(0, 3);
        if (chosen.length) {
          taskIds = chosen.map((t) => t._id);
          note = plan.note;
          model = modelId();
        }
      } catch (e) {
        console.warn(`ai.buildDailyPlan used heuristic: ${String(e).slice(0, 160)}`);
      }
    }
    await ctx.runMutation(internal.estates.savePlan, { estateId, taskIds, note, model });
  },
});

/** Cron: one plan per estate per day. Cheap: only estates with open work call the model. */
export const buildAllDailyPlans = internalAction({
  args: {},
  handler: async (ctx): Promise<{ estates: number }> => {
    const estates: Doc<"estates">[] = await ctx.runQuery(internal.estates.allInternal, {});
    for (const e of estates) {
      await ctx.runAction(internal.ai.buildDailyPlan, { estateId: e._id });
    }
    return { estates: estates.length };
  },
});

