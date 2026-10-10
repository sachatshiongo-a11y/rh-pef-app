import Decimal from "decimal.js";
import { normaliserUnite } from "@/lib/fiches/conversion";
import { sansAccents } from "@/lib/texte";

// Légumes frais de la Conso. journalière (Consommation, Comparaison, exports) : achats du marché
// rangés PAR LIGNE (légume + unité). La commande du restaurant est saisie dans l'unité de la LISTE
// (« Ail (Kg) ») ; un achat enregistré dans une autre unité (« Sac ») ne s'additionne jamais à elle
// et ne se met pas sur la même ligne (audit du 10/10/2026). Fonctions PURES.

const D = Decimal.clone({ precision: 60 });

export type LegumeListe = { nom: string; unite: string };
export type AchatLegumeBrut = { legume: string; unite: string | null; jour: string; quantite: number };
export type LigneLegume = { id: string; nom: string; unite: string | null; jours: number[]; total: number };

/** Clé de rapprochement d'un libellé : sans accents, sans casse, ponctuation et espaces réduits (comme la fiche d'achat). */
const cle = (s: string) => sansAccents(String(s ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Identifiant de la ligne des légumes : « legume:Ail » pour l'unité de la liste, « legume:Ail|sac » pour une autre. */
export const idLigneLegume = (nom: string, uniteAutre?: string) => `legume:${nom}${uniteAutre ? `|${normaliserUnite(uniteAutre)}` : ""}`;

/**
 * Achats de la semaine rangés par ligne : le légume de la liste dans SON unité (ou sans unité saisie),
 * et une ligne SÉPARÉE, avec sa propre unité, pour chaque autre unité. Un légume hors liste garde son
 * libellé. Sommes exactes (décimales). Ordre : alphabétique, l'unité de la liste avant les autres.
 */
export function achatsLegumesParLigne(achats: AchatLegumeBrut[], jours: string[], liste: LegumeListe[]): LigneLegume[] {
  const parCle = new Map(liste.map((l) => [cle(l.nom), l]));
  const lignes = new Map<string, { id: string; nom: string; unite: string | null; rangs: Decimal[] }>();
  for (const a of achats) {
    const i = jours.indexOf(a.jour);
    if (i < 0) continue;
    const dansListe = parCle.get(cle(a.legume));
    const nom = dansListe ? dansListe.nom : a.legume.trim();
    const saisie = a.unite?.trim() || "";
    const memeUnite = !saisie || (dansListe !== undefined && normaliserUnite(saisie) === normaliserUnite(dansListe.unite));
    const unite = memeUnite ? (dansListe ? dansListe.unite : null) : saisie;
    const id = idLigneLegume(nom, memeUnite ? undefined : saisie);
    const l = lignes.get(id) ?? { id, nom, unite, rangs: jours.map(() => new D(0)) };
    l.rangs[i] = l.rangs[i]!.plus(a.quantite);
    lignes.set(id, l);
  }
  return [...lignes.values()]
    .sort((x, y) => x.nom.localeCompare(y.nom, "fr") || x.id.length - y.id.length)
    .map((l) => ({ id: l.id, nom: l.nom, unite: l.unite, jours: l.rangs.map((r) => r.toNumber()), total: l.rangs.reduce((t, r) => t.plus(r), new D(0)).toNumber() }));
}

/**
 * Lignes des légumes de la Comparaison : chaque légume de la liste (commande saisie dans l'unité de la
 * liste, livré = achats dans cette unité), puis les achats dans une AUTRE unité ou hors liste, chacun
 * sur sa ligne, sans commande — jamais commande et achat d'unités différentes sur la même ligne.
 */
export function lignesLegumesComparaison(p: {
  liste: LegumeListe[];
  achats: LigneLegume[];
  commandes: (nom: string) => number[];
  nbJours: number;
}): { id: string; nom: string; unite: string | null; cmd: number[]; liv: number[] }[] {
  const zeros = () => Array<number>(p.nbJours).fill(0);
  const parId = new Map(p.achats.map((a) => [a.id, a]));
  const lignes = p.liste.map((l) => ({ id: idLigneLegume(l.nom), nom: l.nom, unite: l.unite as string | null, cmd: p.commandes(l.nom), liv: parId.get(idLigneLegume(l.nom))?.jours ?? zeros() }));
  const pris = new Set(lignes.map((l) => l.id));
  for (const a of p.achats) if (!pris.has(a.id)) lignes.push({ id: a.id, nom: a.nom, unite: a.unite, cmd: zeros(), liv: a.jours });
  return lignes;
}
