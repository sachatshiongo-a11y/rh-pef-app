"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

const NAV: { href: string; label: string; icone: string }[] = [
  { href: "/stock", label: "Tableau de bord", icone: "🏠" },
  { href: "/stock/catalogue", label: "Catalogue", icone: "📦" },
  { href: "/stock/fournisseurs", label: "Fournisseurs", icone: "🏭" },
  { href: "/stock/factures", label: "Factures", icone: "🧾" },
];

export function StockShell({
  userNom,
  doubleAcces,
  children,
}: {
  userNom: string;
  doubleAcces: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const fermer = () => setOpen(false);
  const actif = (href: string) => (href === "/stock" ? pathname === href : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={fermer} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85%] flex-col overflow-y-auto border-r bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:bg-muted/30 lg:shadow-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-start justify-between px-2">
          <div>
            <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={160} height={55} priority className="h-auto w-full max-w-36" />
            <p className="mt-1 text-xs font-medium text-muted-foreground">Stock &amp; Achats</p>
          </div>
          <button type="button" onClick={fermer} aria-label="Fermer le menu" className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={fermer}
              className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm lg:py-1.5 ${
                actif(item.href) ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <span aria-hidden>{item.icone}</span>
              <span className="flex-1">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-3 border-t pt-3">
          <p className="truncate px-2 text-sm font-medium">{userNom}</p>
          <p className="px-2 text-xs text-muted-foreground">Espace Stock</p>
          {doubleAcces && (
            <Link href="/choix-espace" onClick={fermer} className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground">
              🔄 Changer d&apos;espace
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground">
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Ouvrir le menu" className="rounded-md p-1.5 hover:bg-accent">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="truncate font-medium">Stock &amp; Achats</span>
        </header>
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
