import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Two quiet background jobs:
 *  - the follow-up sweep: companies silent for a week get a drafted nudge,
 *    waiting for one-click approval (never auto-sent);
 *  - the daily plan: three small things per estate, chosen each morning.
 * Both are idempotent and cheap; the sweep only touches cards past their date.
 */
const crons = cronJobs();

crons.daily(
  "follow-up sweep",
  { hourUTC: 13, minuteUTC: 0 }, // morning in North America
  internal.ai.followUpSweep,
  {},
);

crons.daily(
  "daily plan",
  { hourUTC: 12, minuteUTC: 30 },
  internal.ai.buildAllDailyPlans,
  {},
);

export default crons;
