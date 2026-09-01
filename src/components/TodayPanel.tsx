import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Ring } from "./ui";
import { statusLabel } from "../lib/ui";
import type { Task } from "../lib/types";

export function TodayPanel({
  estateId,
  tasks,
  canEdit,
  onOpen,
}: {
  estateId: Id<"estates">;
  tasks: Task[];
  canEdit: boolean;
  onOpen: (id: Id<"tasks">) => void;
}) {
  const plan = useQuery(api.estates.todayPlan, { estateId });
  const request = useMutation(api.estates.requestTodayPlan);
  const asked = useRef(false);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "closed").length;
  const waiting = tasks.filter((t) => t.status === "awaiting" || t.status === "sent").length;

  // Ask for today's three once, when there is something to plan and no plan yet.
  useEffect(() => {
    if (plan === null && total > 0 && canEdit && !asked.current) {
      asked.current = true;
      request({ estateId }).catch(() => {});
    }
  }, [plan, total, canEdit, estateId, request]);

  const planTasks = (plan?.tasks ?? []).map((p) => tasks.find((t) => t._id === p._id) ?? null).filter(Boolean) as Task[];
  const planDone = planTasks.filter((t) => t.status === "closed" || t.status === "awaiting").length;
  const allDone = total > 0 && done === total;

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-4">
        <Ring value={done} total={Math.max(total, 1)} />
        <div>
          <h2 className="serif text-lg">Today</h2>
          <p className="text-sm text-ink-2">
            {total === 0 ? "Nothing yet." : allDone ? "Everything is closed." : `${done} of ${total} done`}
          </p>
          {waiting > 0 && !allDone && <p className="text-xs text-ink-3">{waiting} waiting on a reply</p>}
        </div>
      </div>

      {total > 0 && (
        <div className="mt-4">
          {allDone ? (
            <p className="serif text-base leading-relaxed text-ink">You've done enough. There is nothing left on this list.</p>
          ) : plan === undefined ? (
            <p className="text-sm text-ink-3">…</p>
          ) : plan === null || planTasks.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-2">
              {plan?.note ?? "Nothing needs you today. The letters are out; replies will show up here."}
            </p>
          ) : (
            <>
              {plan.note && <p className="serif text-base leading-relaxed text-ink">{plan.note}</p>}
              <ol className="mt-3 space-y-1.5">
                {planTasks.map((t) => {
                  const settled = t.status === "closed" || t.status === "awaiting";
                  return (
                    <li key={t._id}>
                      <button
                        onClick={() => onOpen(t._id)}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-paper-2"
                      >
                        <span
                          className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-500 ${
                            settled ? "border-sage bg-sage text-paper" : "border-line-2"
                          }`}
                        >
                          {settled && (
                            <svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M2 5.3 4.2 7.4 8 3" />
                            </svg>
                          )}
                        </span>
                        <span className={`flex-1 ${settled ? "text-ink-3 line-through decoration-line-2" : ""}`}>{t.companyName}</span>
                        <span className="text-xs text-ink-3">{statusLabel(t.status)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {planDone > 0 && planDone >= planTasks.length && (
                <p className="serif mt-3 text-base text-ink">That's enough for today.</p>
              )}
              {planDone > 0 && planDone < planTasks.length && (
                <p className="mt-3 text-xs text-ink-3">
                  {planDone} of {planTasks.length} done. That's enough for today, if you want it to be.
                </p>
              )}
            </>
          )}
        </div>
      )}
      <p className="mt-4 text-[11px] text-ink-3">You don't have to finish this today.</p>
    </section>
  );
}
