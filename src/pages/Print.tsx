import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Link } from "../router";
import { Button } from "../components/ui";
import { domainOf, longDate, possessive, statusLabel } from "../lib/ui";

/** The whole plan on paper, for people who prefer paper. */
export function Print({ slug }: { slug: string }) {
  const estate = useQuery(api.estates.get, { slug });
  const tasks = useQuery(api.tasks.list, estate ? { estateId: estate._id } : "skip");
  const docs = useQuery(api.estates.documents, estate ? { estateId: estate._id } : "skip");

  if (estate === undefined) return <p className="p-10 text-sm text-ink-3">…</p>;
  if (estate === null) return <p className="p-10">We couldn't find that.</p>;

  return (
    <div className="mx-auto max-w-2xl bg-white px-8 py-10 text-ink print:max-w-none print:px-0 print:py-0">
      <div className="no-print mb-8 flex items-center justify-between text-sm">
        <Link to={`/e/${slug}`} className="text-ink-2 hover:text-ink">
          ← Back to the board
        </Link>
        <Button tone="primary" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <h1 className="serif text-3xl">{possessive(estate.personFirstName)} accounts</h1>
      <p className="mt-1 text-sm text-ink-2">
        {longDate(estate.dateOfPassing)} · printed {new Date().toLocaleDateString()} · code {estate.caseCode}
      </p>

      {docs && docs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-ink-3">Papers</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {docs.map((d) => (
              <li key={d._id} className="flex items-center gap-2">
                <span className={`inline-block size-3.5 rounded-sm border ${d.status === "have" ? "border-sage bg-sage" : "border-line-2"}`} />
                {d.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 space-y-6">
        {(tasks ?? []).map((t) => (
          <article key={t._id} className="break-inside-avoid border-t border-line pt-4">
            <div className="flex items-baseline justify-between">
              <h2 className="serif text-xl">{t.companyName}</h2>
              <span className="text-xs text-ink-3">
                {t.category} · {statusLabel(t.status)}
              </span>
            </div>
            {t.summary && <p className="mt-1 text-sm text-ink-2">{t.summary}</p>}
            {t.playbook && (
              <div className="mt-2 text-sm">
                <ol className="list-decimal space-y-0.5 pl-5">
                  {t.playbook.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                {t.playbook.documents.length > 0 && <p className="mt-1.5 text-ink-2">Bring: {t.playbook.documents.join(", ")}</p>}
                <p className="mt-1 text-xs text-ink-3">
                  {[t.playbook.contactEmail, t.playbook.phone, t.playbook.contactFormUrl].filter(Boolean).join(" · ")}
                  {t.playbook.sourceUrl ? ` · source: ${domainOf(t.playbook.sourceUrl)}` : ""}
                </p>
              </div>
            )}
          </article>
        ))}
      </section>

      <p className="mt-12 text-xs text-ink-3">You don't have to finish this today.</p>
    </div>
  );
}
