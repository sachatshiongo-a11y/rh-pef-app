"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { changerStatutEnLot } from "../paie/actions";
import { Avatar } from "@/components/avatar";
import { TelechargerLien } from "@/components/telecharger-lien";
import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";
import type { ModePaiement, PaymentStatus } from "@prisma/client";
import { estErreur } from "@/lib/action-lisible";
import type { AvertissementPaie } from "@/lib/paie-reference";
import { lignesAValiderDuLot, messageConfirmationValidation } from "../paie/avertissements-validation";
import { ChampDateVersement } from "../paie/champ-date-versement";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { cleSelection, lignesSelectionnees, messageEcartes } from "../paie/selection-paie";

export type BulletinRow = {
  id: string;
  employeeId: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  montant: string;
  statutPaiement: PaymentStatus;
  // Rappelés avant de valider, comme sur l'écran Paie (jamais bloquants).
  avertissements: AvertissementPaie[];
  /** Montants affichés (paie-jeton.ts) : renvoyés à la validation. */
  jeton?: string;
  /** Mois de la paie quand ce n'est pas le mois courant (« septembre 2026 ») : bulletin validé d'un
   *  mois clôturé, resté à payer après le passage de l'espace RH au mois suivant. */
  periode?: string | null;
};

// "" = automatique : le moyen de paiement de la fiche de chaque salarié (comme l'écran Paie). Jusqu'au
// 2026-10-01 un lot payé d'ici enregistrait « Virement » pour tous, quelle que soit la fiche.
const MODES = [
  { value: "", label: "Auto (selon la fiche)" },
  { value: "ESPECES", label: "Espèces" },
  { value: "VIREMENT", label: "Virement" },
  { value: "MOBILE_MONEY", label: "Mobile Money" },
  { value: "CHEQUE", label: "Chèque" },
  { value: "AUTRE", label: "Autre" },
];

export function BulletinsInbox({
  rows,
  cible,
  actionLabel,
  lectureSeule,
  peutRouvrir,
}: {
  rows: BulletinRow[];
  cible: PaymentStatus;
  actionLabel: string;
  /** Lecture seule (la RH devant les bulletins que la Direction n'a pas validés) : ce libellé
   *  remplace les cases et les boutons. Le serveur refuse de toute façon (paie-etats.ts). */
  lectureSeule?: string;
  /** « ↩ Rouvrir » (Validé → Pas validé), ligne et lot : la Direction seule (paie-etats.ts), sur la liste des
   *  bulletins à payer. Le geste vivait sur l'écran Paie jusqu'au lot 8 (V5) ; le serveur revérifie le rôle. */
  peutRouvrir?: boolean;
}) {
  // Sélection = SALARIÉS (cleSelection) : les identifiants des lignes changent à chaque recalcul.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const { ids: idsSelection, ecartes } = lignesSelectionnees(rows, selection);
  const avisEcartes = messageEcartes(ecartes);
  const [mode, setMode] = useState("");
  // Date de versement (« Marquer payé », lot ou ligne) : aujourd'hui à Kinshasa par défaut, jamais future.
  const [dateVersement, setDateVersement] = useState(() => jourKinshasaISO());
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function toggle(cle: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(cle) ? n.delete(cle) : n.add(cle);
      return n;
    });
  }
  /** `vers` : l'état visé — la cible de la liste, ou « Pas validé » pour rouvrir un bulletin validé. */
  function lancer(ids: string[], vers: PaymentStatus = cible) {
    if (ids.length === 0) return;
    // Validation (une ligne ou le lot) : mêmes avertissements et même boîte que l'écran Paie, sur les
    // lignes qui vont réellement être validées. Rien à signaler → validation directe, sans boîte.
    if (vers === "VALIDE") {
      const message = messageConfirmationValidation(lignesAValiderDuLot(rows, new Set(ids)));
      if (message && !window.confirm(message)) return;
    }
    if (vers === "PAS_VALIDE") {
      // Seuls les bulletins du mois en cours se rouvrent (le serveur refuse les autres) : un bulletin d'un mois
      // clôturé rouvert sortirait des totaux de son mois sans pouvoir être revalidé (paie-hors-calcul.ts).
      const autresMois = rows.filter((x) => ids.includes(x.id) && x.periode).length;
      ids = ids.filter((id) => !rows.find((x) => x.id === id)?.periode);
      if (ids.length === 0) { setErreur("Un bulletin d'un mois clôturé ne se rouvre pas : il reste à payer."); return; }
      const n = ids.length;
      const question = (n > 1
        ? `Rouvrir ces ${n} bulletins validés ? Ils repassent « pas validé » et devront être validés de nouveau.`
        : "Rouvrir ce bulletin validé ? Il repasse « pas validé » et devra être validé de nouveau.")
        + (autresMois > 0 ? `\n\n${autresMois} bulletin${autresMois > 1 ? "s" : ""} d'un mois clôturé ${autresMois > 1 ? "restent" : "reste"} à payer (il${autresMois > 1 ? "s" : ""} ne se rouvre${autresMois > 1 ? "nt" : ""} pas).` : "");
      if (!window.confirm(question)) return;
    }
    setErreur(null);
    setInfo(null);
    const envoyes = ids;
    startTransition(async () => {
      const jetons = Object.fromEntries(rows.filter((x) => envoyes.includes(x.id) && x.jeton).map((x) => [x.id, x.jeton!]));
      const r = await changerStatutEnLot(envoyes, vers, vers === "PAYE" ? ((mode || null) as ModePaiement | null) : null, jetons, vers === "PAYE" ? dateVersement : null);
      if (estErreur(r)) { setErreur(`Lot annulé (aucune ligne modifiée) : ${r.erreur}`); return; }
      // Lignes ignorées par le serveur (payées, rouvertes ou validées entre-temps par un autre compte) : le dire,
      // comme le faisait l'écran Paie, au lieu d'un succès muet.
      if (r < envoyes.length) setInfo(`${envoyes.length - r} bulletin(s) non modifié(s) : leur état a changé entre-temps (autre compte, autre onglet). Rechargez la page.`);
      setSelection(new Set());
    });
  }

  return (
    <div>
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {info && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{info}</p>}
      {avisEcartes && (
        <p className="mb-3 text-xs text-muted-foreground">
          {avisEcartes}{" "}
          <button onClick={() => setSelection(new Set())} className="underline">Tout désélectionner</button>
        </p>
      )}
      {!lectureSeule && (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rows.every((r) => selection.has(cleSelection(r)))}
            onChange={(e) => setSelection(e.target.checked ? new Set(rows.map(cleSelection)) : new Set())}
          />
          Tout sélectionner
        </label>
        {/* Toujours visible au paiement, comme la date : le bouton de chaque ligne s'en sert aussi (le moyen
            de paiement se choisissait ligne par ligne sur l'écran Paie). */}
        {cible === "PAYE" && (
          <select value={mode} onChange={(e) => setMode(e.target.value)} title="Moyen de paiement" aria-label="Moyen de paiement" className="rounded border border-input bg-background px-2 py-1 text-xs">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
        {cible === "PAYE" && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">Versement le
            <ChampDateVersement value={dateVersement} onChange={setDateVersement} />
          </label>
        )}
        {idsSelection.length > 0 && (
          <>
            <span className="text-xs font-medium">{idsSelection.length} sélectionné(s) :</span>
            <BoutonValider onClick={() => lancer(idsSelection)} disabled={isPending}>{actionLabel}</BoutonValider>
            {peutRouvrir && <BoutonNeutre onClick={() => lancer(idsSelection, "PAS_VALIDE")} disabled={isPending}>↩ Rouvrir</BoutonNeutre>}
            {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
          </>
        )}
      </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-xl border bg-card p-3 ${selection.has(cleSelection(r)) ? "ring-1 ring-primary" : ""}`}>
            {!lectureSeule && <input type="checkbox" checked={selection.has(cleSelection(r))} onChange={() => toggle(cleSelection(r))} aria-label={`Sélectionner ${r.nom}`} />}
            <Avatar nom={r.nom} photoUrl={r.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <Link href={`/employes/${r.employeeId}`} className="font-semibold hover:underline">{r.nom}</Link>{" "}
                <span className="font-mono text-xs text-muted-foreground">{r.matricule}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Salaire net : {r.montant}
                {r.periode && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">Paie de {r.periode}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <TelechargerLien href={`/paie/bulletin/${r.id}?devise=USD&dl=1`} className="text-primary underline">Bulletin $</TelechargerLien>
              <TelechargerLien href={`/paie/bulletin/${r.id}?devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
              {lectureSeule ? (
                <span className="text-muted-foreground">{lectureSeule}</span>
              ) : (
                <>
                  <BoutonValider onClick={() => lancer([r.id])} disabled={isPending}>{actionLabel}</BoutonValider>
                  {peutRouvrir && !r.periode && <BoutonNeutre onClick={() => lancer([r.id], "PAS_VALIDE")} disabled={isPending}>↩ Rouvrir</BoutonNeutre>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
