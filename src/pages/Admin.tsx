import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Wordmark } from "../components/ui";
import { timeAgo } from "../lib/ui";

/** Free-tier burn and unmatched mail, for whoever runs the demo. */
export function Admin() {
  const usage = useQuery(api.usage.today);
  const unrouted = useQuery(api.mail.unrouted) ?? [];
  const settings = useQuery(api.mail.getSettings);
  const crawl = useQuery(api.crawlCache.status);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Wordmark />
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="text-3xl">Behind the scenes</h1>
        <dl className="mt-8 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {["firecrawl", "llm", "agentmail"].map((p) => (
            <div key={p} className="rounded-2xl border border-line bg-card p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-3">{p}</dt>
              <dd className="serif mt-1 text-2xl">{usage?.counts[p] ?? 0}</dd>
              <dd className="text-xs text-ink-3">calls today</dd>
            </div>
          ))}
          <div className="rounded-2xl border border-line bg-card p-4">
            <dt className="text-xs uppercase tracking-wide text-ink-3">status</dt>
            <dd className="serif mt-1 text-2xl">{usage?.paused ? "Paused" : "Running"}</dd>
            <dd className="text-xs text-ink-3">{usage?.day}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-ink-2">
          Inbox: <span className="text-ink">{settings?.inboxAddress ?? "not created yet"}</span>
        </p>
        {crawl && (
          <p className="mt-1 text-sm text-ink-2">
            Crawl:{" "}
            <span className="text-ink">
              {crawl.live ? "live" : "saved results only — credits held in reserve"}
            </span>
            {crawl.checkedAt > 0 && <span className="text-ink-3"> · checked {timeAgo(crawl.checkedAt)}</span>}
          </p>
        )}

        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-wide text-ink-3">Mail we couldn't match to a card</h2>
          {unrouted.length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">Nothing unmatched.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-card text-sm">
              {unrouted.map((m) => (
                <li key={m._id} className="px-4 py-3">
                  <div className="flex justify-between text-xs text-ink-3">
                    <span>{m.from?.replace(/^.*@/, "…@")}</span>
                    <span>{timeAgo(m.at)}</span>
                  </div>
                  <p className="mt-1">{m.subject}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-2">{m.extractedText}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
