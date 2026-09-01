"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { search, scrape, excerpt, type SearchHit } from "./lib/firecrawl";
import { extract, modelId } from "./lib/llm";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE, rateLimiter } from "./lib/limits";
import { genericPlaybook, looksOfficial } from "./lib/product";

/**
 * Find a company's real bereavement procedure.
 *
 *   Firecrawl search  ->  keep official-domain hits  ->  LLM picks the page
 *   ->  (scrape if the search result had no content)  ->  LLM extracts the
 *   playbook  ->  cached in `playbooks` for every future family  ->  letter.
 *
 * Every failure path still produces a usable card: a general playbook, marked
 * as such, and a template letter. The family is never left with nothing.
 */

export const PlaybookSchema = z.object({
  steps: z.array(z.string()).min(1).max(8),
  documents: z.array(z.string()).max(8),
  contactEmail: z.string().nullable().optional(),
  contactFormUrl: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  expectedDays: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
  isOfficialBereavementPage: z.boolean(),
});

const ChoiceSchema = z.object({
  index: z.number().int().nullable(),
  reason: z.string(),
});

const EXTRACT_SYSTEM = `You read a company's support page and extract the exact procedure a family member must follow after an account holder has died.
Write for a grieving person: plain words, short steps, no marketing language, no euphemisms ("died", not "passed away").
Only use what the page actually says. If the page is not really about deceased account holders, set isOfficialBereavementPage to false and confidence low.
Steps are imperative sentences ("Call the estate team at ..."). Documents are short noun phrases ("Death certificate (copy)").
Use null for anything the page does not state. Never invent an email address or phone number.`;

async function chooseHit(companyName: string, hits: SearchHit[]): Promise<{ hit: SearchHit; reason: string } | null> {
  if (hits.length === 0) return null;
  if (hits.length === 1) return { hit: hits[0], reason: "only official result" };
  try {
    const listing = hits
      .map((h, i) => `[${i}] ${h.title ?? ""} — ${h.url}\n${(h.description ?? h.markdown ?? "").slice(0, 300)}`)
      .join("\n\n");
    const choice = await extract(
      ChoiceSchema,
      `Company: ${companyName}\nWhich result is the company's own page explaining what to do when an account holder has died (closing or transferring the account, required documents)? Prefer official help/support pages. Answer with the index, or null if none fit.\n\n${listing}`,
      { system: "You pick the single most relevant official support page.", maxTokens: 300 },
    );
    if (choice.index !== null && hits[choice.index]) return { hit: hits[choice.index], reason: choice.reason };
    return null;
  } catch {
    return { hit: hits[0], reason: "first official result" };
  }
}

export const lookup = internalAction({
  args: { taskId: v.id("tasks"), userId: v.optional(v.id("users")), force: v.optional(v.boolean()) },
  handler: async (ctx, { taskId, userId, force }) => {
    const row = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!row || !row.estate) return;
    const { task, estate } = row;
    const limitKey = String(userId ?? estate.ownerId);

    // 1. Shared cache: another family may already have looked this company up.
    if (!force) {
      const cached = await ctx.runQuery(internal.tasks.playbookByKey, { companyKey: task.companyKey });
      if (cached && cached.quality === "ok") {
        await ctx.runMutation(internal.tasks.patch, {
          taskId,
          playbookId: cached._id,
          aiState: "drafting",
          clearAiNote: true,
        });
        await ctx.scheduler.runAfter(0, internal.ai.draftLetter, { taskId, kind: "notification" });
        return;
      }
    }

    let playbookId: Id<"playbooks"> | null = null;
    let note: string | undefined;

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "userCrawl", { key: limitKey, throws: true });
      await rateLimiter.limit(ctx, "globalCrawl", { throws: true });
      await rateLimiter.limit(ctx, "globalBurst", { throws: true });

      await ctx.runMutation(internal.tasks.patch, { taskId, aiState: "searching" });

      // 2. Firecrawl search, with page content included in the results.
      const hits = await search(`${task.companyName} deceased account holder bereavement close account`, 5);
      await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
      const official = hits.filter((h) => h.url && looksOfficial(h.url, task.companyName));

      // 3. Let the model choose the page (or the first official hit if it cannot).
      await rateLimiter.limit(ctx, "userLlm", { key: limitKey, throws: true });
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
      const chosen = await chooseHit(task.companyName, official.length ? official : hits.slice(0, 3));
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });
      if (!chosen) throw new Error("no relevant page found");

      // 4. Read the page.
      await ctx.runMutation(internal.tasks.patch, { taskId, aiState: "reading" });
      let markdown = chosen.hit.markdown ?? "";
      let title = chosen.hit.title;
      if (markdown.length < 400) {
        const page = await scrape(chosen.hit.url);
        await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
        markdown = page.markdown;
        title = page.title ?? title;
      }
      if (markdown.length < 200) throw new Error("page had no readable content");

      // 5. Extract the playbook.
      const pb = await extract(
        PlaybookSchema,
        `Company: ${task.companyName}\nPage: ${chosen.hit.url}\n\nPage content (markdown):\n${markdown.slice(0, 14_000)}`,
        { system: EXTRACT_SYSTEM, maxTokens: 1500 },
      );
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });

      const usable = pb.isOfficialBereavementPage && pb.confidence >= 0.4;
      playbookId = await ctx.runMutation(internal.tasks.upsertPlaybook, {
        companyKey: task.companyKey,
        companyName: task.companyName,
        sourceUrl: chosen.hit.url,
        sourceTitle: title,
        steps: pb.steps,
        documents: pb.documents,
        contactEmail: pb.contactEmail ?? undefined,
        contactFormUrl: pb.contactFormUrl ?? undefined,
        phone: pb.phone ?? undefined,
        expectedDays: pb.expectedDays ?? undefined,
        confidence: pb.confidence,
        rawExcerpt: excerpt(markdown, 1500),
        model: modelId(),
        quality: usable ? "ok" : "generic",
        note: usable ? undefined : "The page we found was not clearly about deceased account holders, so these are general steps.",
      });
    } catch (e) {
      note = isRateLimitError(e)
        ? QUOTA_MESSAGE
        : String(e).includes("PAUSED")
          ? "Lookups are paused right now. These are general steps."
          : `We could not read ${task.companyName}'s bereavement page just now, so these are general steps.`;
      console.warn(`research.lookup(${task.companyName}) fell back: ${String(e).slice(0, 200)}`);
    }

    if (!playbookId) {
      const g = genericPlaybook(task.companyName);
      playbookId = await ctx.runMutation(internal.tasks.upsertPlaybook, {
        companyKey: task.companyKey,
        companyName: task.companyName,
        steps: g.steps,
        documents: g.documents,
        expectedDays: g.expectedDays,
        model: "none",
        quality: "generic",
        note,
      });
    }

    await ctx.runMutation(internal.tasks.patch, {
      taskId,
      playbookId,
      aiState: "drafting",
      aiNote: note,
    });
    await ctx.scheduler.runAfter(0, internal.ai.draftLetter, { taskId, kind: "notification" });
  },
});
