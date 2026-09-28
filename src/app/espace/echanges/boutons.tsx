"use client";

import { useState, useTransition } from "react";
import { repondreEchange, annulerEchange, annulerChangement } from "../actions";
import { BoutonApprouver, BoutonRefuser, CLASSES_NEUTRE } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";

// Les réponses des actions reviennent comme des VALEURS : une erreur (« déjà traitée ») ou une
// information (« planning verrouillé ») s'affiche sous les boutons — avant, le clic ne faisait rien.

function Avis({ avis }: { avis: { ok: boolean; texte: string } | null }) {
  if (!avis) return null;
  return (
    <p role={avis.ok ? "status" : "alert"} className={`basis-full text-sm ${avis.ok ? "text-emerald-700" : "text-destructive"}`}>
      {avis.texte}
    </p>
  );
}

function lire(r: unknown): { ok: boolean; texte: string } | null {
  if (estErreur(r)) return { ok: false, texte: r.erreur };
  if (r && typeof r === "object" && "info" in r && typeof r.info === "string") return { ok: true, texte: r.info };
  return null;
}

export function RepondreEchange({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [avis, setAvis] = useState<{ ok: boolean; texte: string } | null>(null);
  const repondre = (accepte: boolean) => start(async () => setAvis(lire(await repondreEchange(id, accepte))));
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <BoutonApprouver disabled={pending} onClick={() => repondre(true)} className="min-h-11 flex-1 justify-center sm:min-h-0 sm:flex-none">Accepter</BoutonApprouver>
      <BoutonRefuser
        disabled={pending}
        onClick={() => { if (confirm("Refuser cette proposition d'échange ? Votre collègue sera prévenu.")) repondre(false); }}
        className="min-h-11 flex-1 justify-center sm:min-h-0 sm:flex-none"
      />
      <Avis avis={avis} />
    </span>
  );
}

function BoutonAnnuler({ action, question }: { action: () => Promise<unknown>; question: string }) {
  const [pending, start] = useTransition();
  const [avis, setAvis] = useState<{ ok: boolean; texte: string } | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => { if (confirm(question)) start(async () => setAvis(lire(await action()))); }}
        className={`${CLASSES_NEUTRE} min-h-11 sm:min-h-0`}
      >
        {pending ? "Annulation…" : "Annuler la demande"}
      </button>
      <Avis avis={avis} />
    </span>
  );
}

export function AnnulerEchange({ id }: { id: string }) {
  return <BoutonAnnuler action={() => annulerEchange(id)} question="Annuler cette proposition d'échange ? Votre collègue sera prévenu." />;
}

export function AnnulerChangement({ id }: { id: string }) {
  return <BoutonAnnuler action={() => annulerChangement(id)} question="Annuler cette demande de changement de shift ?" />;
}
