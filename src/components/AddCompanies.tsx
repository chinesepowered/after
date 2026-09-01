import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES, SUGGESTIONS, companyKey, type Category } from "../../convex/lib/product";
import { Button } from "./ui";
import { friendlyError } from "../lib/ui";
import type { Task } from "../lib/types";

export function AddCompanies({
  estateId,
  tasks,
  canEdit,
  onNotice,
}: {
  estateId: Id<"estates">;
  tasks: Task[];
  canEdit: boolean;
  onNotice: (s: string) => void;
}) {
  const addMany = useMutation(api.tasks.addMany);
  const known = useQuery(api.tasks.knownCompanies) ?? [];
  const [category, setCategory] = useState<Category>("Bank");
  const [picked, setPicked] = useState<Record<string, string>>({}); // name -> category
  const [free, setFree] = useState("");
  const [busy, setBusy] = useState(false);

  const have = useMemo(() => new Set(tasks.map((t) => t.companyKey)), [tasks]);
  const knownKeys = useMemo(() => new Set(known.map((k) => k.companyKey)), [known]);
  const pickedList = Object.entries(picked);

  const toggle = (name: string) => {
    setPicked((p) => {
      const n = { ...p };
      if (n[name]) delete n[name];
      else n[name] = category;
      return n;
    });
  };

  const addFree = () => {
    const name = free.trim();
    if (!name) return;
    setPicked((p) => ({ ...p, [name]: category }));
    setFree("");
  };

  const submit = async () => {
    const list = pickedList.map(([name, cat]) => ({ name, category: cat }));
    if (free.trim()) list.push({ name: free.trim(), category });
    if (!list.length || busy) return;
    setBusy(true);
    try {
      await addMany({ estateId, companies: list });
      setPicked({});
      setFree("");
    } catch (e) {
      onNotice(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="serif text-lg">Who needs to know?</h2>
      <p className="mt-1 text-xs text-ink-3">Pick a kind of company, then tick the ones that apply.</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              category === c ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:bg-line"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <ul className="mt-3 space-y-1">
        {SUGGESTIONS[category].map((name) => {
          const key = companyKey(name);
          const already = have.has(key);
          const on = Boolean(picked[name]);
          return (
            <li key={name}>
              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
                  already ? "text-ink-3" : "hover:bg-paper-2"
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-sage"
                  disabled={already || !canEdit}
                  checked={on || already}
                  onChange={() => toggle(name)}
                />
                <span className="flex-1">{name}</span>
                {already ? (
                  <span className="text-xs text-ink-3">added</span>
                ) : knownKeys.has(key) ? (
                  <span className="text-xs text-sage" title="Another family already looked this company up; its process is ready.">
                    known
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border border-line-2 bg-card px-3 py-2 text-sm placeholder:text-ink-3 focus:border-sand focus:outline-none"
          placeholder={`Another ${category === "Other" ? "company" : category.toLowerCase()}…`}
          value={free}
          disabled={!canEdit}
          onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addFree();
            }
          }}
        />
      </div>

      {pickedList.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pickedList.map(([name]) => (
            <button
              key={name}
              onClick={() => toggle(name)}
              className="rounded-full bg-sand-2 px-2.5 py-0.5 text-xs text-ink-2 hover:bg-line"
              title="Remove"
            >
              {name} ×
            </button>
          ))}
        </div>
      )}

      <Button
        tone="primary"
        className="mt-3 w-full"
        disabled={!canEdit || busy || (pickedList.length === 0 && !free.trim())}
        onClick={submit}
      >
        {busy
          ? "Adding"
          : pickedList.length + (free.trim() ? 1 : 0) > 1
            ? `Add ${pickedList.length + (free.trim() ? 1 : 0)} companies`
            : "Add"}
      </Button>
      {!canEdit && <p className="mt-2 text-xs text-ink-3">Join this estate to add companies.</p>}
    </section>
  );
}
