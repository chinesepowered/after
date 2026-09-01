import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";

/** Tiny history router. Deep links work because static hosting falls back to index.html. */

const RouteContext = createContext<string>("/");

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener("after:navigate", onNav);
    return () => window.removeEventListener("after:navigate", onNav);
  }, []);
  return <RouteContext.Provider value={path}>{children}</RouteContext.Provider>;
}

export function usePath() {
  return useContext(RouteContext);
}

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event("after:navigate"));
  window.scrollTo({ top: 0 });
}

export function Link({
  to,
  children,
  className,
  replace,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  replace?: boolean;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to, replace);
  };
  return (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

export type Route =
  | { name: "home" }
  | { name: "start" }
  | { name: "board"; slug: string }
  | { name: "share"; slug: string }
  | { name: "print"; slug: string }
  | { name: "admin" }
  | { name: "missing" };

export function matchRoute(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { name: "home" };
  if (p === "/start") return { name: "start" };
  if (p === "/admin") return { name: "admin" };
  const m = p.match(/^\/e\/([a-z0-9-]+)(?:\/(share|print))?$/);
  if (m) {
    const slug = m[1];
    if (m[2] === "share") return { name: "share", slug };
    if (m[2] === "print") return { name: "print", slug };
    return { name: "board", slug };
  }
  return { name: "missing" };
}
