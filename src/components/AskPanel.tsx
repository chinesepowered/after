import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { friendlyError } from "../lib/ui";

/** "Ask After": a small assistant over this estate's playbooks and cards (Agent component). */
export function AskPanel({ estateId, canEdit }: { estateId: Id<"estates">; canEdit: boolean }) {
  const messages = useQuery(api.assistant.messages, { estateId }) ?? [];
  const send = useAction(api.ask.send);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, pending]);

  const submit = async (q?: string) => {
    const prompt = (q ?? text).trim();
    if (!prompt || pending) return;
    setText("");
    setPending(prompt);
    setNotice(null);
    try {
      const res = await send({ estateId, text: prompt });
      if (!res.ok && res.message) setNotice(res.message);
    } catch (e) {
      setNotice(friendlyError(e));
    } finally {
      setPending(null);
    }
  };

  const suggestions = ["What does the bank need from me?", "Which companies still need a document?", "What should I do first?"];

  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card p-4">
      <h2 className="serif text-lg">Ask After</h2>
      <p className="mt-1 text-xs text-ink-3">Questions about what each company needs. It only knows what's on this board.</p>

      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
        {messages.length === 0 && !pending && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} disabled={!canEdit} onClick={() => submit(s)} className="rounded-full bg-paper-2 px-2.5 py-1 text-left text-xs text-ink-2 hover:bg-line disabled:opacity-60">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m._id} className={`animate-fade rounded-xl px-3 py-2 leading-relaxed ${m.role === "user" ? "ml-6 bg-paper-2 text-ink" : "mr-2 text-ink"}`}>
            <p className="whitespace-pre-wrap">{m.text || (m.status === "pending" ? "…" : "")}</p>
          </div>
        ))}
        {pending && !messages.some((m) => m.role === "user" && m.text === pending) && (
          <div className="ml-6 rounded-xl bg-paper-2 px-3 py-2 text-ink">{pending}</div>
        )}
        {pending && (
          <p className="flex items-center gap-2 px-3 text-xs text-ink-3">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-sand" /> thinking
          </p>
        )}
        {notice && <p className="px-3 text-xs text-ink-3">{notice}</p>}
        <div ref={bottom} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-xl border border-line-2 bg-card px-3 py-2 text-sm placeholder:text-ink-3 focus:border-sand focus:outline-none"
          placeholder={canEdit ? "Ask something…" : "Join to ask"}
          value={text}
          disabled={!canEdit || pending !== null}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!canEdit || pending !== null || !text.trim()} className="rounded-xl border border-line-2 px-3 text-sm text-ink-2 hover:bg-paper-2 disabled:opacity-50">
          Ask
        </button>
      </form>
    </section>
  );
}
