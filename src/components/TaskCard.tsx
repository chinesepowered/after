import { Chip } from "./ui";
import { aiStateLine, domainOf, timeAgo } from "../lib/ui";
import type { Task } from "../lib/types";

export function TaskCard({ task, selected, onOpen }: { task: Task; selected: boolean; onOpen: () => void }) {
  const working = aiStateLine(task);
  const source = domainOf(task.playbook?.sourceUrl);
  const isFollowUp = task.status === "draft_ready" && task.draftKind === "follow_up";
  const isDocsReply = task.status === "draft_ready" && task.draftKind === "documents";

  return (
    <button
      onClick={onOpen}
      className={`animate-settle block w-full rounded-2xl border bg-card p-3 text-left transition-[border-color,box-shadow] duration-300 hover:border-line-2 ${
        selected ? "border-sand shadow-[0_0_0_3px_var(--color-sand-2)]" : "border-line"
      } ${task.status === "closed" ? "opacity-80" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="serif text-[16px] leading-tight">{task.companyName}</span>
        <span className="text-[11px] text-ink-3">{task.category}</span>
      </div>

      {working && (
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-2">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-sand" />
          {working}
        </p>
      )}

      {task.status === "draft_ready" && (
        <p className="mt-2 text-xs text-ink-2">
          {isFollowUp ? "A gentle follow-up is ready." : isDocsReply ? "Reply with the papers is ready." : "Letter is ready to read."}
        </p>
      )}

      {task.status === "awaiting" && (
        <p className="mt-2 text-xs text-ink-2">
          Sent {timeAgo(task.sentAt)}.{task.followUpCount > 0 ? " Followed up once." : ""}
        </p>
      )}

      {task.summary && task.status !== "draft_ready" && task.status !== "awaiting" && (
        <p className="mt-2 text-xs leading-snug text-ink-2">{task.summary}</p>
      )}

      {task.status === "bounced" && <p className="mt-2 text-xs text-ink-2">The email could not be delivered.</p>}

      {(task.requestedDocuments?.length ?? 0) > 0 && task.status === "needs_documents" && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.requestedDocuments!.map((d) => (
            <Chip key={d} tone="clay">
              {d}
            </Chip>
          ))}
        </div>
      )}

      {task.aiNote && task.status !== "researching" && (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">{task.aiNote}</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {task.status === "closed" && <Chip tone="sage">Done {timeAgo(task.lastInboundAt ?? task.updatedAt)}</Chip>}
        {task.status === "needs_call" && <Chip tone="clay">Call them</Chip>}
        {source && task.playbook?.quality === "ok" && <Chip tone="mist">from {source}</Chip>}
        {task.playbook?.quality === "generic" && <Chip>general steps</Chip>}
      </div>
    </button>
  );
}
