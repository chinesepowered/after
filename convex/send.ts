"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE } from "./lib/limits";
import { FOLLOW_UP_AFTER_MS } from "./lib/product";

/**
 * Send the approved letter from the app's single AgentMail inbox.
 * The subject carries [caseCode] and the message is recorded with the task id,
 * so the company's reply routes straight back to this card.
 *
 * Rate-limit tokens are taken in tasks.approveAndSend (so the UI can show the
 * quota message synchronously); mailActions.send meters usage.
 */

/** support@<registrable domain> of the page we read, e.g. help.netflix.com -> support@netflix.com. */
function guessRecipient(companyKey: string, sourceUrl?: string): string {
  try {
    if (sourceUrl) {
      const labels = new URL(sourceUrl).hostname.toLowerCase().split(".");
      const keep = labels.length >= 3 && labels[labels.length - 2].length <= 3 ? 3 : 2;
      return `support@${labels.slice(-keep).join(".")}`;
    }
  } catch {
    /* fall through */
  }
  return `support@${companyKey}.com`;
}

export const notify = internalAction({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const row = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!row || !row.estate) return;
    const { task, estate, playbook } = row;
    const subject = task.draftSubject;
    const text = task.draftBody;
    if (!subject || !text) return;

    const guessed = !task.recipient && !playbook?.contactEmail;
    const to = task.recipient || playbook?.contactEmail || guessRecipient(task.companyKey, playbook?.sourceUrl);

    try {
      assertNotPaused();
      const res = await ctx.runAction(internal.mailActions.send, {
        to,
        subject,
        text,
        caseCode: estate.caseCode,
        targetId: taskId,
      });
      await ctx.runMutation(internal.tasks.patch, {
        taskId,
        status: "awaiting",
        recipient: to,
        sentMessageId: res.messageId,
        sentAt: Date.now(),
        nextFollowUpAt: Date.now() + FOLLOW_UP_AFTER_MS,
        aiState: "idle",
        aiNote: guessed
          ? `No published email address was found, so this went to ${to}.${playbook?.contactFormUrl ? " Their web form may be the surer route." : ""}`
          : undefined,
        ...(guessed ? {} : { clearAiNote: true }),
      });
    } catch (e) {
      const note = isRateLimitError(e)
        ? QUOTA_MESSAGE
        : String(e).includes("PAUSED")
          ? "Sending is paused right now. Your letter is saved."
          : "The letter could not be sent just now. It is saved; you can try again.";
      console.warn(`send.notify(${task.companyName}) failed: ${String(e).slice(0, 200)}`);
      await ctx.runMutation(internal.tasks.patch, { taskId, status: "draft_ready", aiState: "unavailable", aiNote: note });
    }
  },
});
