import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Link } from "../router";
import { Button, Wordmark } from "../components/ui";
import { longDate, possessive } from "../lib/ui";

export function Home() {
  const mine = useQuery(api.estates.mine);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Wordmark />
        <Link to="/e/demo-robert" className="text-sm text-ink-2 hover:text-ink">
          See an example
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16 sm:pt-24">
        <h1 className="animate-settle text-4xl leading-tight text-ink sm:text-5xl">
          When someone dies, there are forty companies to tell.
          <br />
          <span className="text-ink-2">You don't have to do that part.</span>
        </h1>

        <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
          Name the companies. After finds each one's actual bereavement procedure, writes the letters in a plain,
          calm voice, sends them from one inbox, and keeps track of every reply. When a company goes quiet, it
          prepares a gentle follow-up for you to approve.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link to="/start">
            <Button tone="primary" className="px-6 py-2.5 text-base">
              Begin
            </Button>
          </Link>
          <Link to="/e/demo-robert">
            <Button tone="quiet" className="px-5 py-2.5 text-base">
              Look at an example first
            </Button>
          </Link>
        </div>

        <p className="mt-6 text-sm text-ink-3">
          We keep a first name, a date and how you are related. Nothing else about them is stored.
        </p>

        {mine && mine.length > 0 && (
          <section className="mt-20">
            <h2 className="text-sm uppercase tracking-wide text-ink-3">Continue</h2>
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
              {mine.map((e) => (
                <li key={e._id}>
                  <Link to={`/e/${e.slug}`} className="flex items-baseline justify-between px-5 py-4 hover:bg-paper-2">
                    <span className="serif text-lg">{possessive(e.personFirstName)} accounts</span>
                    <span className="text-sm text-ink-3">{longDate(e.dateOfPassing)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-20 grid gap-8 text-sm text-ink-2 sm:grid-cols-3">
          <div>
            <h3 className="serif text-lg text-ink">It finds the real process</h3>
            <p className="mt-2">
              Each company's own "deceased customer" page, read and turned into a few plain steps, with the source
              linked.
            </p>
          </div>
          <div>
            <h3 className="serif text-lg text-ink">You approve every letter</h3>
            <p className="mt-2">Nothing is sent until you have read it and pressed Send. Change any line you like.</p>
          </div>
          <div>
            <h3 className="serif text-lg text-ink">Share it with a sibling</h3>
            <p className="mt-2">One link. Everyone sees the same board, and it updates as replies arrive.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
