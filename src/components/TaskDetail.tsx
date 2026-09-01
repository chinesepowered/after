import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button, Chip, inputClass } from "./ui";
import { aiStateLine, domainOf, friendlyError, statusLabel, timeAgo } from "../lib/ui";
import type { Task } from "../lib/types";

export function TaskDetail({
  task,
  canEdit,
  onClose,
  onNotice,
}: {
  task: Task;
  canEdit: boolean;
  onClose: () => void;
  onNotice: (s: string) => void;
}) {
  const thread = useQuery(api.tasks.thread, { taskId: task._id }) ?? [];
  const updateDraft = useMutation(api.tasks.updateDraft);
  const approveAndSend = useMutation(api.tasks.approveAndSend).withOptimisticUpdate((store, { taskId }) => {
    for (const q of store.getAllQueries(api.tasks.list)) {
      if (!q.value) continue;
      store.setQuery(api.tasks.list, q.args, q.value.map((t) => (t._id === taskId ? { ...t, status: "sent" as const, aiState: "sending" as const } : t)));
    }
  });
  const setStatus = useMutation(api.tasks.setStatus).withOptimisticUpdate((store, { taskId, status }) => {
    for (const q of store.getAllQueries(api.tasks.list)) {
      if (!q.value) continue;
      store.setQuery(api.tasks.list, q.args, q.value.map((t) => (t._id === taskId ? { ...t, status } : t)));
    }
  });
  const redraft = useMutation(api.tasks.redraft);
  const retry = useMutation(api.tasks.retryResearch);
  const prepareDocs = useMutation(api.tasks.prepareDocumentsReply);
  const remove = useMutation(api.tasks.remove);
  const simulate = useMutation(api.tasks.simulateReply);

  const [to, setTo] = useState(task.recipient ?? task.playbook?.contactEmail ?? "");
  const [subject, setSubject] = useState(task.draftSubject ?? "");
  const [body, setBody] = useState(task.draftBody ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [playOpen, setPlayOpen] = useState(false);

  // Re-sync the editor when the server draft changes (e.g. a rewrite lands).
  useEffect(() => {
    setSubject(task.draftSubject ?? "");
    setBody(task.draftBody ?? "");
  }, [task.draftSubject, task.draftBody]);
  useEffect(() => {
    setTo(task.recipient ?? task.playbook?.contactEmail ?? "");
  }, [task.recipient, task.playbook?.contactEmail]);

  const dirty = subject !== (task.draftSubject ?? "") || body !== (task.draftBody ?? "") || to !== (task.recipient ?? task.playbook?.contactEmail ?? "");

  const run = async (name: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      onNotice(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () => run("save", () => updateDraft({ taskId: task._id, subject, body, recipient: to }));
  const send = () =>
    run("send", async () => {
      if (dirty) await updateDraft({ taskId: task._id, subject, body, recipient: to });
      await approveAndSend({ taskId: task._id });
    });

  const pb = task.playbook;
  const source = domainOf(pb?.sourceUrl);
  const working = aiStateLine(task);
  const sent = ["awaiting", "needs_documents", "needs_call", "closed", "bounced"].includes(task.status);

  const quick = [
    { label: "Ask for the death certificate", text: "Thank you for letting us know. To close the account we will need a copy of the death certificate and a photo ID for the person handling the estate. Please reply with both attached and we will take it from there." },
    { label: "Confirm it is closed", text: "Thank you. We have now closed the account and no further charges will be made. Please accept our condolences." },
    { label: "Ask for a phone call", text: "Thank you for contacting us. For security reasons we are unable to close accounts by email. Please call our bereavement team on the number on our website, Monday to Friday, and have the account details to hand." },
  ];

  return (
    <aside className="animate-settle flex h-full flex-col rounded-2xl border border-line bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="serif text-2xl leading-tight">{task.companyName}</h2>
          <p className="mt-1 text-xs text-ink-3">
            {task.category} · {statusLabel(task.status)}
            {task.sentAt ? ` · sent ${timeAgo(task.sentAt)}` : ""}
          </p>
        </div>
        <button onClick={onClose} className="rounded-full px-2 text-xl leading-none text-ink-3 hover:text-ink" aria-label="Close">
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
        {task.summary && task.status !== "draft_ready" && (
          <p className="rounded-xl bg-paper-2 px-4 py-3 text-sm leading-relaxed text-ink">{task.summary}</p>
        )}

        {/* Letter */}
        {task.status === "draft_ready" && (
          <section>
            <h3 className="text-xs uppercase tracking-wide text-ink-3">
              {task.draftKind === "follow_up" ? "The follow-up" : task.draftKind === "documents" ? "Your reply" : "The letter"}
            </h3>
            {task.aiNote && <p className="mt-2 text-xs leading-snug text-ink-3">{task.aiNote}</p>}
            <div className="mt-2 space-y-2">
              <input className={`${inputClass} text-sm`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="To (email address)" disabled={!canEdit} />
              <input className={`${inputClass} text-sm`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" disabled={!canEdit} />
              <textarea
                className={`${inputClass} min-h-64 resize-y text-sm leading-relaxed`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <p className="mt-2 text-xs text-ink-3">Change anything you like. Nothing is sent until you press Send.</p>
            {canEdit && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button tone="primary" onClick={send} disabled={busy !== null || !body.trim() || !subject.trim()}>
                  {busy === "send" ? "Sending" : "Send"}
                </Button>
                {dirty && (
                  <Button onClick={save} disabled={busy !== null}>
                    {busy === "save" ? "Saving" : "Save changes"}
                  </Button>
                )}
                <Button tone="ghost" onClick={() => run("redraft", () => redraft({ taskId: task._id }))} disabled={busy !== null || task.aiState === "drafting"}>
                  {task.aiState === "drafting" ? "Rewriting" : "Rewrite it for me"}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Playbook */}
        <section>
          <h3 className="text-xs uppercase tracking-wide text-ink-3">What {task.companyName} asks for</h3>
          {working && !pb ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-2">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-sand" /> {working}
            </p>
          ) : pb ? (
            <div className="mt-2 space-y-3 text-sm">
              {pb.note && <p className="text-xs leading-snug text-ink-3">{pb.note}</p>}
              <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed text-ink">
                {pb.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {pb.documents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pb.documents.map((d) => (
                    <Chip key={d}>{d}</Chip>
                  ))}
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-2">
                {pb.contactEmail && (
                  <>
                    <dt className="text-ink-3">Email</dt>
                    <dd className="break-all">{pb.contactEmail}</dd>
                  </>
                )}
                {pb.phone && (
                  <>
                    <dt className="text-ink-3">Phone</dt>
                    <dd>{pb.phone}</dd>
                  </>
                )}
                {pb.contactFormUrl && (
                  <>
                    <dt className="text-ink-3">Web form</dt>
                    <dd className="break-all">
                      <a href={pb.contactFormUrl} target="_blank" rel="noreferrer" className="text-mist hover:underline">
                        {pb.contactFormUrl.replace(/^https?:\/\//, "").slice(0, 60)}
                      </a>
                    </dd>
                  </>
                )}
                {pb.expectedDays && (
                  <>
                    <dt className="text-ink-3">Usually takes</dt>
                    <dd>about {pb.expectedDays} days</dd>
                  </>
                )}
              </dl>
              {pb.sourceUrl && (
                <p className="text-xs text-ink-3">
                  {pb.quality === "ok" ? "Read from" : "Found at"}{" "}
                  <a href={pb.sourceUrl} target="_blank" rel="noreferrer" className="text-mist hover:underline">
                    {source}
                  </a>{" "}
                  {timeAgo(pb.fetchedAt)}
                  {pb.confidence !== null && pb.quality === "ok" ? ` · confidence ${Math.round(pb.confidence * 100)}%` : ""}
                </p>
              )}
              {canEdit && (
                <button className="text-xs text-ink-3 hover:text-ink" disabled={busy !== null} onClick={() => run("retry", () => retry({ taskId: task._id }))}>
                  {busy === "retry" ? "Looking again" : "Look this up again"}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-3">Nothing yet.</p>
          )}
        </section>

        {/* What next, for cards that need something */}
        {canEdit && task.status === "needs_documents" && (
          <section className="rounded-xl border border-clay-2 bg-clay-2/40 p-4">
            <p className="text-sm text-ink">They need papers before they can go on.</p>
            <p className="mt-1 text-xs text-ink-2">Tick them off under Papers, then send a short reply saying they are enclosed.</p>
            <Button tone="primary" className="mt-3" disabled={busy !== null} onClick={() => run("docs", () => prepareDocs({ taskId: task._id }))}>
              {busy === "docs" ? "Preparing" : "Prepare the reply"}
            </Button>
          </section>
        )}
        {canEdit && task.status === "needs_call" && (
          <section className="rounded-xl border border-clay-2 bg-clay-2/40 p-4">
            <p className="text-sm text-ink">This one needs a phone call. There is no rush.</p>
            {pb?.phone && <p className="mt-1 text-sm text-ink-2">{pb.phone}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => run("called", () => setStatus({ taskId: task._id, status: "awaiting" }))} disabled={busy !== null}>
                I called them
              </Button>
              <Button onClick={() => run("done", () => setStatus({ taskId: task._id, status: "closed" }))} disabled={busy !== null}>
                It's done
              </Button>
            </div>
          </section>
        )}
        {canEdit && task.status === "bounced" && (
          <section className="rounded-xl border border-clay-2 bg-clay-2/40 p-4">
            <p className="text-sm text-ink">The email address did not work.</p>
            {pb?.contactFormUrl ? (
              <p className="mt-1 text-xs text-ink-2">
                Their web form is the surer route:{" "}
                <a href={pb.contactFormUrl} target="_blank" rel="noreferrer" className="text-mist hover:underline">
                  open it
                </a>
                .
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-2">Try a different address, or their web form.</p>
            )}
            <Button className="mt-3" onClick={() => run("back", () => setStatus({ taskId: task._id, status: "draft_ready" }))} disabled={busy !== null}>
              Edit and send again
            </Button>
          </section>
        )}

        {/* Thread */}
        {thread.length > 0 && (
          <section>
            <h3 className="text-xs uppercase tracking-wide text-ink-3">Correspondence</h3>
            <ol className="mt-2 space-y-3">
              {thread.map((m) => (
                <li key={m._id} className={`rounded-xl border px-4 py-3 text-sm ${m.direction === "in" ? "border-line bg-paper-2/60" : "border-line bg-card"}`}>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-ink-3">
                    <span>{m.direction === "in" ? `${task.companyName} replied` : "You wrote"}</span>
                    <span>{timeAgo(m.at)}</span>
                  </div>
                  {m.direction === "out" && <p className="mt-1 text-xs text-ink-2">{m.subject.replace(/^\[to: [^\]]+\]\s*/, "")}</p>}
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">{m.text}</p>
                  {m.classification && (
                    <p className="mt-2">
                      <Chip tone={m.classification === "closed" ? "sage" : m.classification === "auto_reply" ? "line" : "clay"}>
                        {m.classification.replace("_", " ")}
                      </Chip>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Demo tool */}
        {canEdit && sent && (
          <section className="rounded-xl border border-dashed border-line-2 p-4">
            <button className="flex w-full items-center justify-between text-left text-xs text-ink-3" onClick={() => setPlayOpen((o) => !o)}>
              <span>Demo: reply as {task.companyName}</span>
              <span>{playOpen ? "–" : "+"}</span>
            </button>
            {playOpen && (
              <div className="mt-3 space-y-2">
                <p className="text-xs leading-snug text-ink-3">
                  In real use the company answers the email. Here you can play them: the text goes through the same
                  inbound path, is read by the assistant, and the card moves.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {quick.map((q) => (
                    <button key={q.label} className="rounded-full bg-paper-2 px-2.5 py-1 text-xs text-ink-2 hover:bg-line" onClick={() => setReply(q.text)}>
                      {q.label}
                    </button>
                  ))}
                </div>
                <textarea className={`${inputClass} min-h-24 text-sm`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="What the company writes back…" />
                <Button
                  disabled={busy !== null || !reply.trim()}
                  onClick={() =>
                    run("sim", async () => {
                      await simulate({ taskId: task._id, text: reply });
                      setReply("");
                    })
                  }
                >
                  {busy === "sim" ? "Delivering" : "Deliver this reply"}
                </Button>
              </div>
            )}
          </section>
        )}
      </div>

      {canEdit && (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-3">
          {task.status !== "closed" && task.status !== "researching" && (
            <button className="hover:text-ink" onClick={() => run("done", () => setStatus({ taskId: task._id, status: "closed" }))}>
              Mark as done
            </button>
          )}
          {task.status === "closed" && (
            <button className="hover:text-ink" onClick={() => run("reopen", () => setStatus({ taskId: task._id, status: "awaiting" }))}>
              Not done after all
            </button>
          )}
          {task.status === "awaiting" && (
            <button className="hover:text-ink" onClick={() => run("fu", () => redraft({ taskId: task._id }))}>
              Write a follow-up now
            </button>
          )}
          <span className="flex-1" />
          <button
            className="hover:text-ink"
            onClick={() => {
              if (confirm(`Remove ${task.companyName} from the list?`)) {
                run("remove", async () => {
                  await remove({ taskId: task._id });
                  onClose();
                });
              }
            }}
          >
            Remove
          </button>
        </footer>
      )}
    </aside>
  );
}

