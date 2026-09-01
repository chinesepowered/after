import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Link } from "../router";
import { Button, Notice, Wordmark } from "../components/ui";
import { AddCompanies } from "../components/AddCompanies";
import { Papers } from "../components/Papers";
import { TaskCard } from "../components/TaskCard";
import { TaskDetail } from "../components/TaskDetail";
import { TodayPanel } from "../components/TodayPanel";
import { AskPanel } from "../components/AskPanel";
import { COLUMNS, columnOf, friendlyError, longDate, possessive } from "../lib/ui";
import type { Estate } from "../lib/types";

export function Board({ slug }: { slug: string }) {
  const estate = useQuery(api.estates.get, { slug });
  if (estate === undefined) return <Loading />;
  if (estate === null) return <NotFound />;
  return <BoardInner estate={estate} />;
}

/**
 * Layout, so all five columns are always reachable and Done is never clipped:
 *
 *   < 1024px  everything stacks; the board scrolls sideways in fixed cards.
 *   ≥ 1024px  two columns — the checklist on the left, the board beside it —
 *             and the Today / Ask panel drops *below* the board.
 *   ≥ 1536px  three columns; there is finally room for Today beside the board.
 *
 * A card's detail is a layer over the board below 1536px (with a soft scrim),
 * and takes the third column at 1536px and up, so the board stays whole and you
 * can watch a card move while you read one.
 */
function BoardInner({ estate }: { estate: Estate }) {
  const tasks = useQuery(api.tasks.list, { estateId: estate._id });
  const viewers = useQuery(api.estates.viewers, { estateId: estate._id }) ?? [];
  const heartbeat = useMutation(api.estates.heartbeat);
  const join = useMutation(api.estates.join);
  const [selectedId, setSelectedId] = useState<Id<"tasks"> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = estate.isMember;

  // Presence: a quiet heartbeat while the board is open.
  useEffect(() => {
    if (!canEdit) return;
    const label = estate.role === "owner" ? "Owner" : "Family";
    const beat = () => heartbeat({ estateId: estate._id, label }).catch(() => {});
    beat();
    const id = setInterval(beat, 20_000);
    return () => clearInterval(id);
  }, [canEdit, estate._id, estate.role, heartbeat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byColumn = useMemo(() => {
    const m = new Map<string, NonNullable<typeof tasks>>();
    for (const c of COLUMNS) m.set(c.key, []);
    for (const t of tasks ?? []) m.get(columnOf(t.status))!.push(t);
    return m;
  }, [tasks]);

  const selected = tasks?.find((t) => t._id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && tasks && !selected) setSelectedId(null);
  }, [selectedId, tasks, selected]);

  return (
    <div className="min-h-screen pb-16">
      <header className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-5">
        <Wordmark />
        <div className="min-w-0 flex-1">
          <h1 className="serif truncate text-xl leading-tight sm:text-2xl">{possessive(estate.personFirstName)} accounts</h1>
          <p className="text-xs text-ink-3">
            {longDate(estate.dateOfPassing)} · you are their {estate.relationship}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {viewers.length > 0 && (
            <div className="flex -space-x-1.5" title={viewers.map((v) => (v.me ? "You" : v.label)).join(", ")}>
              {viewers.slice(0, 5).map((v, i) => (
                <span
                  key={i}
                  className={`inline-flex size-6 items-center justify-center rounded-full border-2 border-paper text-[10px] ${
                    v.me ? "bg-sage text-paper" : "bg-mist-2 text-mist"
                  }`}
                >
                  {v.me ? "you" : v.label[0]}
                </span>
              ))}
            </div>
          )}
          <Link to={`/e/${estate.slug}/share`} className="text-ink-2 hover:text-ink">
            Share
          </Link>
          <Link to={`/e/${estate.slug}/print`} className="text-ink-2 hover:text-ink">
            Print
          </Link>
        </div>
      </header>

      {!canEdit && (
        <div className="mx-auto max-w-[1680px] px-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sage-2 bg-sage-2/40 px-5 py-3 text-sm">
            <span>You've been given the link to {possessive(estate.personFirstName)} accounts. Join to help with the letters.</span>
            <Button tone="primary" onClick={() => join({ slug: estate.slug }).catch((e) => setNotice(friendlyError(e)))}>
              Join
            </Button>
          </div>
        </div>
      )}

      <main
        className={`mx-auto mt-4 grid max-w-[1680px] gap-4 px-4 sm:px-5 lg:grid-cols-[196px_minmax(0,1fr)] ${
          selected ? "2xl:grid-cols-[212px_minmax(0,1fr)_440px]" : "2xl:grid-cols-[212px_minmax(0,1fr)_296px]"
        }`}
      >
        {/* Spans both rows below 1536px so the Today panel sits directly under
            the board instead of waiting for this column to run out. */}
        <aside className="space-y-4 lg:row-span-2 2xl:row-span-1">
          <AddCompanies estateId={estate._id} tasks={tasks ?? []} canEdit={canEdit} onNotice={setNotice} />
          <Papers estateId={estate._id} canEdit={canEdit} onNotice={setNotice} />
        </aside>

        <section className="min-w-0">
          {notice && (
            <div className="mb-4">
              <Notice onClose={() => setNotice(null)}>{notice}</Notice>
            </div>
          )}
          {tasks === undefined ? (
            <p className="px-2 text-sm text-ink-3">…</p>
          ) : tasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
              <p className="serif text-xl text-ink">Start with one or two.</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
                The bank and the phone company are usually the most useful. Add them on the left; we'll find what each
                one asks for and write the letter.
              </p>
            </div>
          ) : (
            <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-3">
              {COLUMNS.map((col) => {
                const items = byColumn.get(col.key) ?? [];
                return (
                  <div key={col.key} className="flex w-[220px] shrink-0 flex-col lg:w-auto lg:min-w-[136px] lg:flex-1 lg:basis-0">
                    <div className="flex items-baseline justify-between px-1 pb-2">
                      <h2 className="text-xs uppercase tracking-wide text-ink-3">{col.title}</h2>
                      <span className="text-xs text-ink-3">{items.length || ""}</span>
                    </div>
                    <div className={`flex-1 space-y-2 rounded-2xl p-1.5 ${col.key === "done" ? "bg-sage-2/30" : "bg-paper-2/70"}`}>
                      {items.map((t) => (
                        <TaskCard key={t._id} task={t} selected={t._id === selectedId} onOpen={() => setSelectedId(t._id)} />
                      ))}
                      {items.length === 0 && col.hint && <p className="px-2 py-3 text-[11px] leading-snug text-ink-3">{col.hint}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Today / Ask. Below the board until there is room beside it; stands
            aside entirely while a card's detail is open in that column. */}
        <aside
          className={`space-y-4 lg:col-start-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0 2xl:col-start-3 2xl:row-start-1 2xl:block 2xl:space-y-4 ${
            selected ? "2xl:hidden" : ""
          }`}
        >
          <TodayPanel estateId={estate._id} tasks={tasks ?? []} canEdit={canEdit} onOpen={setSelectedId} />
          <div className="space-y-4">
            <AskPanel estateId={estate._id} canEdit={canEdit} />
            <p className="px-1 text-[11px] leading-snug text-ink-3">
              Letters go out from one shared inbox with the code {estate.caseCode} in the subject, so replies find their
              way back to the right card.
            </p>
          </div>
        </aside>

        {selected && (
          <>
            <div
              className="animate-fade fixed inset-0 z-10 bg-ink/10 2xl:hidden"
              onClick={() => setSelectedId(null)}
              aria-hidden
            />
            <div
              className="fixed inset-y-0 right-0 z-20 w-full max-w-[460px] p-3 sm:p-4 2xl:sticky 2xl:inset-auto 2xl:top-4 2xl:z-auto 2xl:col-start-3 2xl:row-start-1 2xl:h-[calc(100dvh-2rem)] 2xl:max-w-none 2xl:p-0"
            >
              <TaskDetail key={selected._id} task={selected} canEdit={canEdit} onClose={() => setSelectedId(null)} onNotice={setNotice} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-ink-3">
      <span>…</span>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="serif text-2xl">We couldn't find that.</p>
      <p className="mt-2 text-sm text-ink-2">The link may be incomplete.</p>
      <Link to="/" className="mt-6 inline-block text-sm text-ink-2 underline">
        Go to the start
      </Link>
    </div>
  );
}
