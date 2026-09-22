"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { CibleSignature } from "@prisma/client";
import { CadreSignature } from "@/components/cadre-signature";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";
import { estErreur } from "@/lib/action-lisible";

/**
 * LE BOUTON DE SIGNATURE — partagé par l'espace salarié et les écrans de la Direction.
 *
 * ⚠️ `cote` ne pilote QUE le libellé et le bandeau. Il ne choisit NI le mode de signature
 * (ESPACE_SALARIE / PRESENTIEL) NI l'identité du signataire : ces deux décisions appartiennent à
 * la garde serveur, et à elle seule. C'est pourquoi l'action à appeler est reçue en PROPRIÉTÉ,
 * liée par la page (serveur) qui affiche le bouton — `signerMonDocument` côté espace salarié,
 * `faireSignerDocument` côté Direction. Chacune a sa propre garde et fixe son propre mode. Ce
 * composant ne fait que produire un PNG et le transmettre : rien de ce qu'il envoie ne peut
 * changer qui signe ni dans quelles conditions.
 *
 * L'état affiché vient lui aussi du serveur (`etatSignature`), qui le DÉRIVE de l'empreinte du
 * document. Aucun booléen « signé » n'est stocké : un document modifié après coup repasse en
 * « À resigner » de lui-même.
 */
export type EtatSignatureUI = "A_SIGNER" | "SIGNE" | "A_RESIGNER";

/** Ce que la page serveur lie : l'action de SON côté, jamais choisie par le navigateur. */
export type ActionSignature = (
  cible: CibleSignature,
  cibleId: string,
  pngDataUrl: string
) => Promise<unknown>;

export function BoutonSigner({
  cible,
  cibleId,
  nomSalarie,
  libelleDocument,
  cote,
  etat,
  signeLeTexte,
  action,
}: {
  cible: CibleSignature;
  cibleId: string;
  /** Nom du salarié — affiché dans le bandeau côté Direction (« Remettez l'appareil à … »). */
  nomSalarie: string;
  /** Ce qu'on signe, en clair : « Bulletin septembre 2026 », « Contrat CDI · Cuisinière »… */
  libelleDocument: string;
  cote: "SALARIE" | "DIRECTION";
  etat: EtatSignatureUI;
  signeLeTexte: string | null;
  action: ActionSignature;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  useLockBodyScroll(ouvert);

  if (etat === "SIGNE") {
    return (
      <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Signé le {signeLeTexte}
      </span>
    );
  }

  const aResigner = etat === "A_RESIGNER";

  const signer = (pngDataUrl: string) => {
    setErreur(null);
    demarrer(async () => {
      const r = await action(cible, cibleId, pngDataUrl);
      if (estErreur(r)) {
        setErreur(r.erreur);
        return;
      }
      setOuvert(false);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErreur(null);
          setOuvert(true);
        }}
        className={
          aResigner
            ? "whitespace-nowrap rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
            : "whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
        }
        title={aResigner ? "Ce document a été modifié après la signature : il doit être resigné." : undefined}
      >
        {aResigner ? "À resigner" : "Signer"}
      </button>

      {/* Rendue via portail DANS <body> : la coquille de l'app est `overflow-hidden`, et sur
          iOS/PWA un `position: fixed` qui en descend peut être recadré à ses bornes au lieu du
          viewport (même piège que `bulletin-viewer.tsx`). */}
      {ouvert &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-black/70 p-3"
            onClick={() => !enCours && setOuvert(false)}
          >
            <div
              className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold">Signature — {libelleDocument}</h2>
                <button
                  type="button"
                  onClick={() => setOuvert(false)}
                  disabled={enCours}
                  className="shrink-0 rounded-md border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Fermer ✕
                </button>
              </div>

              <p className="mb-3 text-sm text-muted-foreground">
                {cote === "SALARIE"
                  ? "En signant, vous reconnaissez avoir pris connaissance de ce document."
                  : "La signature sera enregistrée comme recueillie sur l'appareil de l'entreprise, en votre présence."}
              </p>

              {aResigner && (
                <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Ce document a été modifié après la précédente signature. Relisez-le avant de le
                  resigner : c&apos;est la version actuelle qui sera signée.
                </p>
              )}

              {erreur && (
                <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {erreur}
                </p>
              )}

              <CadreSignature
                onSigner={signer}
                enCours={enCours}
                bandeau={
                  cote === "DIRECTION"
                    ? `Remettez l'appareil à ${nomSalarie}. En signant, il ou elle reconnaît avoir pris connaissance de ce document.`
                    : undefined
                }
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
