# Hackathon log

- **Project:** After
- **Event:** Convex All Gas Hackathon
- **What it does:** Finds each company's real bereavement procedure, drafts the letters, sends them from one inbox after a person approves, and tracks every reply on a shared board.
- **Live app:** https://kindred-guanaco-234.convex.site
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** https://kindred-guanaco-234.convex.cloud
- **Components:** @convex-dev/static-hosting, @convex-dev/agent, @convex-dev/rate-limiter
- **Convex features:** schema, tables, indexes, queries, mutations, actions, internal functions, HTTP actions, scheduled functions, crons, file storage, realtime queries, optimistic updates
- **Auth:** Convex Auth
- **AI models:** OpenAI-compatible chat model, set per deployment via the `LLM_MODEL` env var (no model id is checked into the repo)
- **Started:** 2026-09-01T17:35:39Z
- **Last updated:** 2026-09-08T18:36:28Z

## Log

### 2026-09-01 - cd635dd
Stood the chassis up on Convex: schema with indexed tables for usage counters,
the inbox settings singleton, every inbound and outbound mail row, and sender
routes. Registered static hosting, the Agent component and the rate limiter in
`convex/convex.config.ts`. Convex Auth wired with anonymous and password
providers so the live URL never shows a login wall. HTTP router carries the auth
routes plus a Svix-verified AgentMail webhook, with static hosting registered
last as the catch-all. Signature verification is hand-rolled on Web Crypto
(`convex/lib/svix.ts`) because the Node SDK cannot be bundled into an
`httpAction`. Convex features: schema, indexes, HTTP actions, components, auth
(`convex/schema.ts`, `convex/http.ts`, `convex/auth.ts`, `convex/convex.config.ts`).

### 2026-09-01 - ee0da0f
Built the product backend. Estates, members, tasks (one company per card),
playbooks, documents, daily plans and presence, all indexed by estate. The
research pipeline runs as a Node action: Firecrawl search, an official-domain
filter, the model choosing the page, a scrape when the search text is thin, then
a structured extraction validated with zod before it becomes a row. Letter
drafting, approval-gated sending, inbound classification and the "Ask After"
agent thread followed, plus two daily crons for the follow-up sweep and the
daily plan. Every AI path has a deterministic fallback so a card is never empty.
Convex features: queries, mutations, actions, scheduled functions, crons, file
storage (`convex/estates.ts`, `convex/tasks.ts`, `convex/research.ts`,
`convex/ai.ts`, `convex/send.ts`, `convex/inbound.ts`, `convex/ask.ts`,
`convex/crons.ts`).

### 2026-09-01 - e6f346d
Added a demo estate that is seeded through the real pipeline rather than with
fixture text: eight companies researched with live Firecrawl and model calls,
then staged into mixed board states. Research lookups now reschedule themselves
with the rate limiter's own `retryAfter` instead of failing when several
companies are added at once (`convex/seed.ts`, `convex/research.ts`,
`convex/devtools.ts`).

### 2026-09-01 - 9afa800, 46df99a, ef92b88
Shipped the UI: the three-field start form, the live board, the card detail with
an editable letter and its thread, the papers checklist with file upload, the
Today panel, Ask After, and the share and print views. All board data is a live
`useQuery` subscription; send and status changes use optimistic updates. Two
follow-up passes on layout so all five columns, including Done, stay reachable
at every width and the Today panel sits under the board rather than beside it
(`src/pages/Board.tsx`, `src/components/*`).

### 2026-09-01 - 4d6081f, 4bdb2cb, eaa52e6
Fixed reply routing. A case code names the estate, not the card, so an inbound
message is now matched to the outbound letter that started the conversation by
normalised subject, with the most recent letter under that code as the fallback;
the thread id returned by the send now travels back and is stored on the task
that sent. Added CLI helpers so the whole loop can be driven and inspected from
`convex run` without a browser (`convex/mail.ts`, `convex/lib/mailUtil.ts`,
`convex/devtools.ts`).

### 2026-09-01 - e98ae23
Closed a disclosure hole: the live demo signs every visitor in anonymously, so
being signed in proved nothing. Unrouted mail — anything a stranger sends the
app inbox — is now readable only by an account with a real email address, and
bodies are truncated and sender addresses redacted even then (`convex/mail.ts`).

### 2026-09-07 - a0dd2e7, cede11d, e2506a8, 1e08575
Made the free crawl tier structurally safe. Every Firecrawl call goes through
one gateway that serves a stored result when it has one, checks Firecrawl's own
credit-usage endpoint before spending, and refuses to go below a reserve or past
a daily ceiling — budgeted in credits, not calls, since a JSON extraction costs
about ten times a plain scrape. A refused crawl is no longer an error: the card
degrades to general steps with an honest note, and the board says when it is
showing saved research (`convex/lib/firecrawl.ts`, `convex/crawlCache.ts`,
`convex/research.ts`, `src/pages/Board.tsx`).

### 2026-09-08 - deb63c5
Stopped labelling a good playbook with the note from the lookup that failed to
fetch it. When a fallback lands on a cached real playbook, the note is cleared,
so a card never says "quota reached" above a complete set of steps taken from
the company's own page (`convex/research.ts`).

### 2026-09-08 - b501d60
Wrote the judge-facing `README.md` from the shipped code, with the sponsor
breakdown, a Mermaid diagram of the browser/Convex/actions/webhook/cron paths
and the seven screenshots committed under `public/demo/`, four of them embedded
in the README. While verifying claims,
found and fixed one product bug: the deterministic fallback letter rendered the
writer's own relationship as the dead person's ("Robert, my daughter, died"),
since `relationship` is the writer's relation to them. It now states the
relationship in its own sentence (`convex/lib/product.ts`, `README.md`).
