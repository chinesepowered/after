import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { navigate } from "../router";
import { Button, Field, Notice, Wordmark, inputClass } from "../components/ui";
import { friendlyError, RELATIONSHIPS } from "../lib/ui";

export function Start() {
  const create = useMutation(api.estates.create);
  const [firstName, setFirstName] = useState("");
  const [date, setDate] = useState("");
  const [relationship, setRelationship] = useState("daughter");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await create({ personFirstName: firstName, dateOfPassing: date, relationship });
      navigate(`/e/${res.slug}`);
    } catch (err) {
      setNotice(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Wordmark />
      </header>
      <main className="mx-auto max-w-md px-6 pb-24 pt-10 sm:pt-16">
        <h1 className="animate-settle text-3xl leading-snug text-ink">Let's start with three things.</h1>
        <p className="mt-3 text-ink-2">Take your time. You can change any of this later.</p>

        <form onSubmit={submit} className="mt-10 space-y-6">
          <Field label="Their first name" hint="Only the first name. It goes in the letters.">
            <input
              className={inputClass}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Robert"
              autoFocus
              required
              maxLength={40}
            />
          </Field>
          <Field label="The date they died">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="You are their">
            <select className={inputClass} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          {notice && <Notice onClose={() => setNotice(null)}>{notice}</Notice>}

          <Button tone="primary" type="submit" disabled={busy || !firstName || !date} className="w-full py-3 text-base">
            {busy ? "One moment" : "Begin"}
          </Button>
          <p className="text-center text-xs text-ink-3">
            That is all we keep about them: a first name, a date, and how you are related.
          </p>
        </form>
      </main>
    </div>
  );
}
