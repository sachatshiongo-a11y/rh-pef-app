"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TelechargerLien } from "@/components/telecharger-lien";
import { VisionneuseDocument } from "@/components/visionneuse-document";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";

/**
 * Bouton qui OUVRE UN DOCUMENT (PDF ou image) en plein écran, avec un bouton pour le refermer.
 * C'est le seul chemin de la maison pour VOIR un fichier : « un document se récupère, il ne se
 * visite pas » — la fenêtre de l'application ne navigue jamais vers le fichier (dans l'application
 * installée il n'y a ni barre d'adresse ni bouton retour : un lien vers un PDF y enferme, cf.
 * src/components/telecharger-lien.tsx). Un lien classique `<a href="/…/pdf" target="_blank">` est
 * interdit par le garde-fou src/components/pwa-telechargements.garde-fou.test.ts.
 *
 * `href` = adresse de la route qui sert le document (session comprise, aucune extension requise :
 * le type vient du `Content-Type`). `telechargerHref` = ce que « Télécharger » récupère (par défaut
 * la même adresse ; les routes de bulletins et de contrats la déclinent en `?dl=1`).
 * Le contenu du bouton est `children`, à défaut `libelle`.
 */
export function ApercuDocumentBouton({
  href,
  titre,
  libelle = "Voir le document",
  children,
  className = "font-medium text-primary underline",
  telechargerHref,
  nomFichier,
}: {
  href: string;
  titre: string;
  libelle?: string;
  children?: ReactNode;
  className?: string;
  telechargerHref?: string;
  nomFichier?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const panneauRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(ouvert);

  return (
    <>
      <button type="button" onClick={() => setOuvert(true)} className={className}>
        {children ?? libelle}
      </button>

      {/* Portail DANS <body> + verrou de scroll : sur iOS Safari/PWA, une modale `fixed`
          descendante d'un ancêtre `overflow-hidden` (la coquille de l'app) est recadrée à une
          « petite case » et fige la page. Le portail évite ce piège. */}
      {ouvert &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black/70 p-2 sm:p-4"
            // SEUL un clic sur le fond lui-même referme (cf. bulletin-viewer.tsx) : un geste de
            // zoom relâché sur un enfant ne doit jamais passer pour un clic sur le fond.
            onClick={(e) => {
              if (e.target === e.currentTarget) setOuvert(false);
            }}
          >
            <div ref={panneauRef} className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-card px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{titre}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {/* Pas de lien « Nouvel onglet » : voir l'en-tête de ce fichier. */}
                  <TelechargerLien href={telechargerHref ?? href} nomFichier={nomFichier} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Télécharger
                  </TelechargerLien>
                  <button type="button" onClick={() => setOuvert(false)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                    Fermer ✕
                  </button>
                </div>
              </div>
              {/* Plus d'`<iframe>` : iOS n'y rend AUCUN PDF (cadre blanc). Voir
                  src/components/visionneuse-document.tsx. */}
              <VisionneuseDocument
                key={href}
                src={href}
                titre={titre}
                actions={["Télécharger"]}
                onFermer={() => setOuvert(false)}
                panneauRef={panneauRef}
                className="rounded-b-lg"
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
