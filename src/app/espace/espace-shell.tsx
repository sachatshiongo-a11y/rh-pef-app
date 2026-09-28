"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icone } from "@/components/icones";
import { Avatar } from "@/components/avatar";
import { PushToggle } from "@/app/(app)/push-toggle";
import { ClocheSalarie } from "./cloche-salarie";
import { logout } from "@/app/login/actions";
import type { NotificationItem } from "@/lib/notifications";
import { ACCUEIL, BARRE_DU_BAS, GROUPES_ESPACE, lienActif, type LienEspace } from "./navigation";

const CLASSE_LIEN_COMPTE =
  "mt-1 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0";

/**
 * Coquille de l'espace salarié — téléphone d'abord (lot 6, 2026-09-28).
 * - Téléphone : barre du bas à cinq boutons (Accueil, Pointer, Planning, Congés, Menu), toujours
 *   sous le pouce ; « Menu » ouvre le tiroir, rangé en trois groupes.
 * - Ordinateur : le menu est ouvert en permanence à gauche, la barre du bas disparaît.
 * La barre du bas est `position: fixed` SANS `backdrop-filter` : les deux ensemble la font
 * décrocher en PWA iOS (piège déjà rencontré).
 * `navigation={false}` (mot de passe temporaire à remplacer) : ni menu ni barre — les liens
 * ramèneraient de toute façon au formulaire.
 */
export function EspaceShell({
  nom,
  matricule,
  photoUrl,
  notifs,
  autresEspaces = [],
  navigation = true,
  children,
}: {
  nom: string;
  matricule: string | null;
  photoUrl: string | null;
  notifs: { items: NotificationItem[]; nonLues: number };
  autresEspaces?: { href: string; icone: string; label: string }[];
  navigation?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [tiroir, setTiroir] = useState(false);
  const fermer = () => setTiroir(false);

  const lienMenu = (l: LienEspace) => {
    const actif = lienActif(l.href, pathname);
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={fermer}
        aria-current={actif ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition lg:min-h-0 lg:text-sm ${
          actif ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent lg:text-muted-foreground lg:hover:text-foreground"
        }`}
      >
        <Icone nom={l.icone} taille={18} className="shrink-0" /> {l.label}
      </Link>
    );
  };

  return (
    <div className="flex min-h-[100dvh]">
      {navigation && (
        <>
          {/* Tiroir mobile : voile + panneau */}
          {tiroir && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={fermer} />}
          <aside
            id="menu-espace"
            aria-label="Menu"
            className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col overflow-y-auto border-r bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none ${
              tiroir ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="mb-5 flex items-center justify-between">
              <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={132} height={45} priority className="h-8 w-auto" />
              <button onClick={fermer} aria-label="Fermer le menu" className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent lg:hidden">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <nav aria-label="Menu de l'espace salarié" className="flex flex-col gap-4">
              <div className="flex flex-col gap-0.5">{lienMenu(ACCUEIL)}</div>
              {GROUPES_ESPACE.map((g) => (
                <div key={g.titre} className="flex flex-col gap-0.5">
                  <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{g.titre}</p>
                  {g.liens.map(lienMenu)}
                </div>
              ))}
            </nav>

            {/* Pousse le bloc « compte » en bas, avec un écart minimal quand le menu est long. */}
            <div className="min-h-6 flex-1" />
            <div className="border-t pt-3">
              <div className="flex items-center gap-2.5 px-1">
                <Avatar nom={nom} taille={34} photoUrl={photoUrl} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{nom}</p>
                  {matricule && <p className="truncate text-xs text-muted-foreground">Matricule <span className="font-mono">{matricule}</span></p>}
                </div>
              </div>
              {/* Saut DIRECT vers les autres espaces du compte — un clic, sans repasser par le sélecteur. */}
              {autresEspaces.map((e) => (
                <Link key={e.href} href={e.href} onClick={fermer} className={CLASSE_LIEN_COMPTE}>
                  <Icone nom={e.icone} className="shrink-0" /> {e.label}
                </Link>
              ))}
              {/* Même place que dans la coquille de la Direction (bloc du compte) : dans la barre du
                  haut, « Notifications activées » prenait la moitié de la largeur d'un téléphone. */}
              <div className="mt-1">
                <PushToggle />
              </div>
              <Link href="/espace/mot-de-passe" onClick={fermer} className={CLASSE_LIEN_COMPTE}>
                <Icone nom="parametres" className="shrink-0" /> Changer mon mot de passe
              </Link>
              <form action={logout}>
                <button type="submit" className={CLASSE_LIEN_COMPTE}>
                  <Icone nom="deconnexion" /> Se déconnecter
                </button>
              </form>
            </div>
          </aside>
        </>
      )}

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure : logo (téléphone) + notifications. Le menu est dans la barre du bas. */}
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b bg-background px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-5">
          <Link href="/espace" aria-label="Accueil de mon espace" className={navigation ? "lg:hidden" : ""}>
            <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={110} height={38} className="h-7 w-auto" />
          </Link>
          {navigation && (
            <div className="ml-auto flex items-center gap-2">
              <ClocheSalarie items={notifs.items} nonLues={notifs.nonLues} />
              {/* Sa photo de fiche (initiales en repli) → « Mes informations ». Sur ordinateur, elle
                  est déjà dans le bloc du compte du menu, toujours visible. */}
              <Link href="/espace/dossier" aria-label="Mes informations" className="rounded-full lg:hidden">
                <Avatar nom={nom} taille={36} photoUrl={photoUrl} />
              </Link>
            </div>
          )}
        </header>

        <main
          className={`flex-1 px-3 pt-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-5 ${
            navigation ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8" : "pb-[max(2rem,env(safe-area-inset-bottom))]"
          }`}
        >
          <div className="mx-auto w-full max-w-3xl">{children}</div>
        </main>
      </div>

      {/* Barre du bas — téléphone et tablette. Fond plein, jamais de flou (voir plus haut). */}
      {navigation && (
        <nav
          aria-label="Navigation principale"
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden"
        >
          <ul className="grid grid-cols-5">
            {BARRE_DU_BAS.map((l) => {
              const actif = lienActif(l.href, pathname);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={actif ? "page" : undefined}
                    className={`flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${actif ? "text-primary" : "text-muted-foreground"}`}
                  >
                    <span className={`flex h-7 w-12 items-center justify-center rounded-full ${actif ? "bg-primary/10" : ""}`}>
                      <Icone nom={l.icone} taille={20} />
                    </span>
                    {l.court}
                  </Link>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setTiroir(true)}
                aria-expanded={tiroir}
                aria-controls="menu-espace"
                className="flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
              >
                <span className="flex h-7 w-12 items-center justify-center rounded-full">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M3 6h18M3 12h18M3 18h18" /></svg>
                </span>
                Menu
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
