"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "tamise" | "dark";
const OPTIONS: { v: Theme; label: string; icon: string }[] = [
  { v: "light", label: "Clair", icon: "☀️" },
  { v: "tamise", label: "Tamisé", icon: "🌗" },
  { v: "dark", label: "Sombre", icon: "🌙" },
];

// État lu directement depuis la classe de <html> (posée par le script anti-clignotement) —
// useSyncExternalStore gère proprement le SSR (pas d'erreur d'hydratation) et le lint.
const subscribe = (cb: () => void) => {
  window.addEventListener("theme-change", cb);
  return () => window.removeEventListener("theme-change", cb);
};
const getSnapshot = (): Theme => {
  const c = document.documentElement.classList;
  return c.contains("dark") ? "dark" : c.contains("tamise") ? "tamise" : "light";
};

/** Sélecteur de thème : Clair / Tamisé / Sombre. Applique la classe sur <html> et la mémorise. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "light" as Theme);

  const apply = (t: Theme) => {
    const el = document.documentElement;
    el.classList.remove("dark", "tamise");
    if (t !== "light") el.classList.add(t);
    try { localStorage.setItem("theme", t); } catch { /* stockage indisponible */ }
    window.dispatchEvent(new Event("theme-change"));
  };

  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs" role="group" aria-label="Thème">
      {OPTIONS.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => apply(o.v)}
          title={o.label}
          aria-pressed={theme === o.v}
          className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${theme === o.v ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <span aria-hidden>{o.icon}</span>
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
