"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { logout } from "@/app/login/actions";
import { Icone } from "@/components/icones";
import { BoutonRetour } from "@/components/bouton-retour";
import { BarreDuBas, RESERVE_BARRE_DU_BAS } from "@/components/barre-du-bas";
import { ENTETE_COLLANT, HAUTEUR_ENTETE } from "@/components/entete-mobile";
import { Tiroir, VoileTiroir, useTiroir } from "@/components/tiroir-mobile";
import { choisirBarreDuBas, entreesVisibles } from "@/lib/navigation-espaces";
import { BARRE_DU_BAS, NAV_GROUPS, lienActif } from "./navigation";

export function StockShell({
  userNom,
  userRole,
  maPhoto,
  autresEspaces = [],
  badges = {},
  notif,
  children,
}: {
  userNom: string;
  userRole: string;
  maPhoto: string | null;
  autresEspaces?: { href: string; icone: string; label: string }[];
  badges?: Record<string, number>;
  notif: React.ComponentProps<typeof NotificationBell> | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Tiroir : ouverture, verrou de la page derrière, fermeture à la navigation — voir tiroir-mobile.
  const { ouvert: open, ouvrir, fermer } = useTiroir();
  // État actif du menu et de la barre du bas : une seule règle, dans ./navigation.
  const actif = (href: string) => lienActif(href, pathname);
  const roleLabel = userRole === "ADMIN" ? "Direction" : "Responsable stock";

  return (
    <>
      {/* Voile hors du conteneur `overflow-hidden` ci-dessous (Safari iOS y recadre un fixe). */}
      <VoileTiroir ouvert={open} onFermer={fermer} />

      <div className={`flex h-dvh overflow-hidden ${RESERVE_BARRE_DU_BAS} ${HAUTEUR_ENTETE}`}>
        <Tiroir id="menu-stock" ouvert={open} className="w-64 lg:bg-muted/30">
          <div className="mb-4 flex items-start justify-between px-2">
            <div>
              <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={160} height={55} priority className="h-auto w-full max-w-36" />
              <p className="mt-1 text-xs font-medium text-muted-foreground">Stock &amp; Achats</p>
            </div>
            <button type="button" onClick={fermer} aria-label="Fermer le menu" className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent lg:hidden">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {/* Recherche globale : article, bon de commande, facture, fournisseur */}
          <form method="GET" action="/stock/recherche" className="mb-4" onSubmit={fermer}>
            <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
              <input name="q" placeholder="Article, N° BC, N° facture, fournisseur…" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
          </form>

          <nav className="flex flex-1 flex-col gap-4 lg:overflow-y-auto">
            {NAV_GROUPS.map((groupe) => {
              const items = entreesVisibles(groupe.items, userRole);
              if (items.length === 0) return null;
              return (
              <div key={groupe.titre}>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{groupe.titre}</p>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={fermer}
                      className={`flex min-h-11 items-center gap-2.5 rounded-md px-2 py-2 text-sm lg:min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:py-1.5 ${
                        actif(item.href) ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <Icone nom={item.icone} className="w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1">{item.label}</span>
                      {(badges[item.href] ?? 0) > 0 && (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">{badges[item.href]}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
              );
            })}
          </nav>

          <div className="mt-3 border-t pt-3">
            <div className="flex items-center gap-2 px-2">
              <Avatar nom={userNom} taille={32} photoUrl={maPhoto} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{userNom}</p>
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              </div>
            </div>
            {/* Saut DIRECT vers les autres espaces du compte — un clic, sans repasser par le sélecteur. */}
            {autresEspaces.map((e) => (
              <Link key={e.href} href={e.href} onClick={fermer} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm lg:min-h-0 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <Icone nom={e.icone} /> {e.label}
              </Link>
            ))}
            <form action={logout}>
              <button type="submit" className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm lg:min-h-0 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"><Icone nom="deconnexion" /> Déconnexion</button>
            </form>
          </div>
        </Tiroir>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <header className={`${ENTETE_COLLANT} flex px-4 lg:hidden`}>
            <BoutonRetour />
            <span className="truncate font-medium">Stock &amp; Achats</span>
            <div className="ml-auto flex items-center gap-2">
              {notif && <NotificationBell {...notif} domaine="STOCK" />}
              <Avatar nom={userNom} taille={28} photoUrl={maPhoto} />
            </div>
          </header>
          {notif && (
            <div className="hidden items-center justify-between border-b bg-background px-8 py-2 lg:flex">
              <BoutonRetour />
              <NotificationBell {...notif} domaine="STOCK" />
            </div>
          )}
          <div className="p-4 lg:p-8">{children}</div>
        </main>
      </div>

      {/* Barre du bas — téléphone et tablette : le composant commun à tous les espaces. Le menu
          s'ouvre depuis son bouton « Menu », plus de hamburger en haut. */}
      <BarreDuBas
        entrees={choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, userRole, badges)}
        estActif={actif}
        menuOuvert={open}
        onMenu={ouvrir}
        menuId="menu-stock"
      />
    </>
  );
}
