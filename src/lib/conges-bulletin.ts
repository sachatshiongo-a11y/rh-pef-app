import { compterJoursOuvrables } from "@/lib/jours-ouvrables";

/**
 * CONGÉS IMPRIMÉS SUR LE BULLETIN — pur, sans accès base.
 *
 * Trois règles (audit paie du 2026-10-10) :
 *  1. le bulletin d'un mois ne parle que de CE mois : un congé à cheval est rogné aux bornes du mois
 *     (le décompte des jours aussi — 24 jours « sur la période » pour un congé du 21/09 au 17/10
 *     sur le bulletin de septembre était faux) ;
 *  2. les jours se comptent avec `lib/jours-ouvrables.ts`, la seule boucle du dépôt (ni dimanche ni
 *     férié) — le bulletin n'en porte plus de copie ;
 *  3. maladie, congé sans solde et autres absences ne sont pas rangés sous « Congés » : trois
 *     rubriques, décidées par les PARAMÈTRES du type (jamais par son nom).
 */

export type CategorieAbsenceBulletin = "CONGE" | "AUTRE" | "SANS_SOLDE";

/** Un congé tel que le bulletin l'imprime (et tel qu'il est figé dans l'instantané de validation). */
export type CongeBulletin = {
  dateDebut: Date;
  dateFin: Date;
  /** Nom du type de congé (« Congé annuel », « Congé maladie »…) ; absent = congé, comme avant. */
  type?: string;
  categorie?: CategorieAbsenceBulletin;
  /** Jours ouvrables de la période IMPRIMÉE (bornée au mois). Absent : recalculé avec les fériés fournis. */
  jours?: number;
  /** Vrai quand le congé déborde du mois : la période imprimée est rognée, le bulletin le dit. */
  rogne?: boolean;
};

export type TypeCongeInfo = { nom: string; tauxPct: number | null; compteDansSolde: boolean };

/** Rubrique d'un type : sans solde = taux 0 EXACTEMENT (même règle que le code S des présences) ;
 * congé = type déduit du solde annuel ; tout le reste (maladie, maternité…) = autre absence. Type
 * inconnu (supprimé depuis) : « congé », comme le bulletin le faisait. */
export function categorieDuType(type: string | undefined, types: TypeCongeInfo[]): CategorieAbsenceBulletin {
  const t = type === undefined ? undefined : types.find((x) => x.nom === type);
  if (!t) return "CONGE";
  if (t.tauxPct === 0) return "SANS_SOLDE";
  return t.compteDansSolde ? "CONGE" : "AUTRE";
}

const jour = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * Les congés du bulletin du mois `mois/annee` : rognés aux bornes du mois, jours ouvrables
 * recalculés sur la période rognée. Idempotent : une période déjà rognée (instantané figé) ressort
 * identique. Les congés hors du mois sont écartés.
 */
export function congesDuBulletin(
  conges: { dateDebut: Date; dateFin: Date; type?: string; categorie?: CategorieAbsenceBulletin; jours?: number; rogne?: boolean }[],
  feries: Iterable<Date | string>,
  mois: number,
  annee: number,
  types: TypeCongeInfo[] = [],
): CongeBulletin[] {
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const feriesIso = [...feries];
  const sortie: CongeBulletin[] = [];
  for (const c of conges) {
    const debut = new Date(c.dateDebut);
    const fin = new Date(c.dateFin);
    if (fin < debutMois || debut > finMois) continue;
    const d = debut < debutMois ? debutMois : debut;
    const f = fin > finMois ? finMois : fin;
    const rogne = c.rogne === true || jour(d) !== jour(debut) || jour(f) !== jour(fin);
    // Un nombre de jours déjà figé (instantané) n'est PAS recalculé : les fériés d'alors ne sont plus connus.
    const jours = c.jours !== undefined && jour(d) === jour(debut) && jour(f) === jour(fin) ? c.jours : compterJoursOuvrables(d, f, feriesIso);
    sortie.push({
      dateDebut: d,
      dateFin: f,
      type: c.type,
      categorie: c.categorie ?? categorieDuType(c.type, types),
      jours,
      rogne,
    });
  }
  return sortie;
}
