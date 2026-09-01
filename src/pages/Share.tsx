import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Link } from "../router";
import { Button, Wordmark } from "../components/ui";
import { possessive } from "../lib/ui";

/**
 * The invite. Opening this link makes you a member (the unguessable slug is
 * the invitation), then shows the link to pass on and who is here now.
 */
export function Share({ slug }: { slug: string }) {
  const estate = useQuery(api.estates.get, { slug });
  const join = useMutation(api.estates.join);
  const viewers = useQuery(api.estates.viewers, estate ? { estateId: estate._id } : "skip") ?? [];
  const joined = useRef(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (estate && !estate.isMember && !joined.current) {
      joined.current = true;
      join({ slug }).catch(() => {});
    }
  }, [estate, join, slug]);

  const url = `${window.location.origin}/e/${slug}/share`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the field is selectable */
    }
  };

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Wordmark />
        {estate && (
          <Link to={`/e/${slug}`} className="text-sm text-ink-2 hover:text-ink">
            Open the board
          </Link>
        )}
      </header>
      <main className="mx-auto max-w-md px-6 pb-24 pt-10">
        {estate === undefined ? (
          <p className="text-sm text-ink-3">…</p>
        ) : estate === null ? (
          <p className="serif text-xl">We couldn't find that.</p>
        ) : (
          <>
            <h1 className="animate-settle text-3xl leading-snug">Share {possessive(estate.personFirstName)} board</h1>
            <p className="mt-3 text-ink-2">
              Anyone with this link can see the same board and help with the letters. It updates for everyone as
              replies come in, so nobody has to forward emails.
            </p>

            <div className="mt-8 flex gap-2">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-line-2 bg-card px-3.5 py-2.5 text-sm text-ink-2" />
              <Button tone="primary" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <section className="mt-10">
              <h2 className="text-xs uppercase tracking-wide text-ink-3">Here now</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {viewers.length === 0 && <li className="text-ink-3">Just you, for the moment.</li>}
                {viewers.map((v, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`inline-block size-2 rounded-full ${v.me ? "bg-sage" : "bg-mist"}`} />
                    {v.me ? "You" : v.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">
                {estate.memberCount} {estate.memberCount === 1 ? "person has" : "people have"} joined so far.
              </p>
            </section>

            <div className="mt-10">
              <Link to={`/e/${slug}`}>
                <Button>Open the board</Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
