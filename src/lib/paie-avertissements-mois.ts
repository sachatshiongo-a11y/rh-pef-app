// Signalements de paie du lot d'audit du 2026-10-10 — module PUR (ni base, ni `server-only`).
// Ils ne changent AUCUN montant : l'outil signale, la Direction tranche. Recopiés sur la ligne de
// paie (`avertissementsPaie`), donc visibles sur l'écran Paie et dans la confirmation de validation.
import type { CodePresence } from "@/lib/payroll";
import type { AvertissementPaie } from "@/lib/paie-reference";
import { formaterUSD } from "@/lib/montant";
import { totalVerseUSD, type LigneNet } from "@/lib/paie-net";

const jjmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const jjmmaaaa = (d: Date) => `${jjmm(d)}/${d.getUTCFullYear()}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const LIBELLE_CODE: Record<"N" | "S" | "M", string> = { N: "absence injustifiée (N)", S: "sans solde (S)", M: "maladie (M)" };

/**
 * Salarié payé au MOIS ENTIER (back-office, stagiaire) : absences N/S/M et congés sans solde du mois,
 * embauche ou fin de contrat en cours de mois. Rien n'est retenu ni proratisé — la règle attend la
 * décision de la Direction (audit du 2026-10-10) — mais chaque jour concerné est nommé.
 */
export function avertissementsMoisEntier(e: {
  mois: number;
  annee: number;
  presences: { date: Date; code: CodePresence }[];
  /** Dates "AAAA-MM-JJ" d'un congé sans solde approuvé (plage élargie : filtrée au mois ici). */
  joursCongeSansSolde: string[];
  dateEmbauche: Date;
  /** Fin du contrat DANS le mois (date pure), `null` sinon — `chargerJoursMois`. */
  dateFinContrat: Date | null;
}): AvertissementPaie[] {
  const debut = Date.UTC(e.annee, e.mois - 1, 1);
  const fin = Date.UTC(e.annee, e.mois, 0);
  const dansMois = (d: Date) => d.getTime() >= debut && d.getTime() <= fin;
  const parCode = new Map<"N" | "S" | "M", Set<string>>();
  const ajouter = (code: "N" | "S" | "M", d: Date) => (parCode.get(code) ?? parCode.set(code, new Set()).get(code)!).add(iso(d));
  for (const p of e.presences) if ((p.code === "N" || p.code === "S" || p.code === "M") && dansMois(p.date)) ajouter(p.code, p.date);
  for (const j of e.joursCongeSansSolde) {
    const d = new Date(`${j}T00:00:00Z`);
    if (dansMois(d) && d.getUTCDay() !== 0) ajouter("S", d);
  }
  const sortie: AvertissementPaie[] = [];
  const morceaux = (["N", "S", "M"] as const)
    .filter((c) => (parCode.get(c)?.size ?? 0) > 0)
    .map((c) => {
      const dates = [...parCode.get(c)!].sort().map((x) => jjmm(new Date(`${x}T00:00:00Z`)));
      return `${LIBELLE_CODE[c]} ${dates.length === 1 ? `le ${dates[0]}` : `les ${dates.join(", ")} (${dates.length} j)`}`;
    });
  if (morceaux.length > 0) {
    sortie.push({
      code: "ABSENCES_NON_DEDUITES",
      message: `Payé au mois entier, rien n'est retenu pour : ${morceaux.join(" ; ")}. Retenue à décider par la Direction (règle en attente).`,
    });
  }
  const entree = new Date(e.dateEmbauche);
  const mouvements = [
    entree.getTime() > debut && entree.getTime() <= fin ? `embauche le ${jjmmaaaa(entree)}` : null,
    e.dateFinContrat && e.dateFinContrat.getTime() >= debut && e.dateFinContrat.getTime() < fin ? `fin de contrat le ${jjmmaaaa(e.dateFinContrat)}` : null,
  ].filter((m): m is string => m !== null);
  if (mouvements.length > 0) {
    sortie.push({
      code: "ENTREE_SORTIE_EN_COURS_DE_MOIS",
      message: `Mois incomplet (${mouvements.join(", ")}) : salaire du mois entier versé, sans prorata. Prorata à décider par la Direction (règle en attente).`,
    });
  }
  return sortie;
}

/**
 * Net à payer (TOTAL VERSÉ, lib/paie-net.ts) qui ne peut pas être validé (audit du 2026-10-10) :
 * NÉGATIF (acompte et/ou échéance de prêt au-delà de ce que le mois rapporte : le bulletin dirait que
 * le salarié doit de l'argent), ou NUL parce que ces retenues absorbent tout. Un net nul SANS aucune retenue (rien gagné, rien retenu :
 * congé sans solde tout le mois) reste validable — sinon la clôture serait bloquée sans remède.
 * L'outil ne plafonne rien lui-même : la Direction réduit l'acompte ou décide du report de l'échéance.
 */
export function netNonValidable(l: LigneNet & { acompteUSD: number; retenuePretUSD: number }): boolean {
  const verse = totalVerseUSD(l);
  return verse < 0 || (verse === 0 && l.acompteUSD + l.retenuePretUSD > 0);
}

/** Négatif entre parenthèses, jamais un signe moins (convention maison, lib/montant.ts). */
export const usdSigne = (n: number) => (n < 0 ? `(${formaterUSD(n)})` : formaterUSD(n));

export function avertissementNetNonPositif(l: LigneNet & { acompteUSD: number; retenuePretUSD: number }): AvertissementPaie {
  const verse = totalVerseUSD(l);
  return {
    code: "NET_NON_POSITIF",
    message: `Total versé (net à payer) ${verse < 0 ? "négatif" : "nul"} (${usdSigne(verse)} ; acompte ${usdSigne(l.acompteUSD)}, échéance de prêt ${usdSigne(l.retenuePretUSD)}) : la validation sera refusée tant que l'acompte n'est pas réduit ou l'échéance reportée.`,
  };
}
