"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TelechargerLien } from "@/components/telecharger-lien";
import { VisionneuseDocument } from "@/components/visionneuse-document";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";
import type { Devise } from "@/lib/pdf/theme";

/** Bouton « Aperçu » ouvrant le vrai bulletin PDF en plein écran (sans téléchargement), façon PayFit.
 *  `base` = route du PDF (Direction : /paie/bulletin ; espace salarié : /espace/bulletin). */
export function BulletinViewerButton({ payrollLineId, nom, base = "/paie/bulletin", libelle = "Aperçu" }: { payrollLineId: string; nom: string; base?: string; libelle?: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [devise, setDevise] = useState<Devise>("USD");
  const src = `${base}/${payrollLineId}?devise=${devise}`;
  const panneauRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(ouvert);

  return (
    <>
      <button onClick={() => setOuvert(true)} className="font-medium text-primary underline">
        {libelle}
      </button>

      {/* Rendue via portail DANS <body>, hors de la coquille `overflow-hidden` de l'app (voir
          app-shell.tsx) : sur iOS Safari/PWA, un descendant `position: fixed` d'un ancêtre
          `overflow: hidden` peut être recadré aux bornes de cet ancêtre au lieu du viewport entier
          — d'où un aperçu réduit à « une petite case » et le doigt piégé entre deux zones
          scrollables (page figée). Le portail évite ce piège. */}
      {ouvert &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black/70 p-2 sm:p-4"
            // `e.target === e.currentTarget` : SEUL un clic sur le fond lui-même referme. Un geste
            // de zoom ou de défilement qui finit par « relâcher » sur un enfant ne doit jamais
            // être pris pour un clic sur le fond (le `stopPropagation` ci-dessous l'empêche déjà,
            // ce test le garantit même si un futur enfant l'oubliait).
            onClick={(e) => {
              if (e.target === e.currentTarget) setOuvert(false);
            }}
          >
            <div
              ref={panneauRef}
              className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-card px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">Bulletin — {nom}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border text-xs">
                    {(["USD", "CDF"] as Devise[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDevise(d)}
                        className={`px-2.5 py-1 ${devise === d ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                      >
                        {d === "USD" ? "$" : "CDF"}
                      </button>
                    ))}
                  </div>
                  {/* Sortie de secours, DANS L'EN-TÊTE — donc au-dessus de la visionneuse et
                      indépendante d'elle : elle fonctionne que le dessin réussisse ou non. (Le
                      cadre blanc de l'`<iframe>` sur iOS, que ce lien compensait jadis, n'existe
                      plus : les pages sont dessinées, cf. visionneuse-document.tsx.) */}
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    Nouvel onglet
                  </a>
                  <TelechargerLien href={`${src}&dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Télécharger
                  </TelechargerLien>
                  <button onClick={() => setOuvert(false)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                    Fermer ✕
                  </button>
                </div>
              </div>
              {/* Plus d'`<iframe>` : iOS n'y rend AUCUN PDF (cadre blanc). La visionneuse dessine
                  les pages elle-même et porte les gestes d'Aperçu (pincer, double-taper, glisser
                  vers le bas pour refermer). Voir src/components/visionneuse-document.tsx. */}
              <VisionneuseDocument
                key={src}
                src={src}
                titre={`Bulletin — ${nom}`}
                actions={["Télécharger", "Nouvel onglet"]}
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
