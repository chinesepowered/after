import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "../router";

type Tone = "primary" | "quiet" | "ghost";

export function Button({
  tone = "quiet",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; children: ReactNode }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm transition-colors duration-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sand/60";
  const tones: Record<Tone, string> = {
    primary: "bg-ink text-paper hover:bg-ink-2",
    quiet: "border border-line-2 bg-card text-ink hover:bg-paper-2",
    ghost: "text-ink-2 hover:text-ink hover:bg-paper-2",
  };
  return (
    <button className={`${base} ${tones[tone]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** A quiet inline notice. Never red. */
export function Notice({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  if (!children) return null;
  return (
    <div className="animate-fade flex items-start justify-between gap-4 rounded-2xl border border-sand-2 bg-sand-2/50 px-4 py-3 text-sm text-ink-2">
      <span>{children}</span>
      {onClose && (
        <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

export function Ring({ value, total, size = 72 }: { value: number; total: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : value / total;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-sage)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.7, 0.2, 1)" }}
      />
    </svg>
  );
}

export function Chip({ children, tone = "line" }: { children: ReactNode; tone?: "line" | "sage" | "clay" | "mist" | "sand" }) {
  const tones = {
    line: "bg-paper-2 text-ink-2",
    sage: "bg-sage-2 text-sage",
    clay: "bg-clay-2 text-clay",
    mist: "bg-mist-2 text-mist",
    sand: "bg-sand-2 text-sand",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

export function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="serif inline-flex items-center gap-2 text-lg text-ink">
      <span className="inline-block size-3.5 rounded-full border-2 border-sage" />
      After
    </Link>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-ink-2">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line-2 bg-card px-3.5 py-2.5 text-ink placeholder:text-ink-3 focus:border-sand focus:outline-none";
