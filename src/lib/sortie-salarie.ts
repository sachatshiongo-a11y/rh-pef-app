import type { Prisma, PrismaClient } from "@prisma/client";

// LA DATE DE SORTIE D'UN SALARIÉ — UNE SEULE RÉPONSE (décision de la Direction du 2026-10-12 : « il faut une date de
// sortie si le salarié part »). Module sans `server-only` : la partie pure se teste telle quelle.
//
// OÙ VIT LA DATE
//  - Sortie par « Fin de contrat » : `FinContrat.dateFin` — elle existait déjà, c'est la date du solde de tout
//    compte archivé. On la LIT, on ne la recopie pas (jamais deux dates qui divergent).
//  - Fiche désactivée SANS fin de contrat (désactivation simple, anciens départs) : `Employee.dateSortie`, saisie
//    depuis la fiche (demande « À valider » si c'est la RH).
//  - Fiche ACTIVE : pas de sortie. Une fiche réactivée (paie rouverte « hors calcul ») reprend son cours ; ses
//    dates restent en base et valent de nouveau dès qu'elle est désactivée.
//
// La date est le DERNIER JOUR DE PRÉSENCE, inclus (comme la « date de fin » du solde de tout compte).

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const jourPur = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type FicheSortie = { id: string; actif: boolean; dateEmbauche: Date; dateSortie: Date | null };

/**
 * La date de sortie d'une fiche, ou null si elle n'en a pas (active, ou inactive dont la date est inconnue).
 * Une fin de contrat compte si elle tombe à partir de l'embauche de la fiche (la plus tardive l'emporte) ; sinon
 * `Employee.dateSortie`. PURE.
 */
export function resoudreDateSortie(fiche: Omit<FicheSortie, "id">, finsContrat: { dateFin: Date }[]): Date | null {
  if (fiche.actif) return null;
  const embauche = jourPur(new Date(fiche.dateEmbauche)).getTime();
  const fins = finsContrat.map((f) => jourPur(new Date(f.dateFin))).filter((d) => d.getTime() >= embauche).sort((a, b) => a.getTime() - b.getTime());
  if (fins.length > 0) return fins[fins.length - 1];
  return fiche.dateSortie ? jourPur(new Date(fiche.dateSortie)) : null;
}

/** D'où vient la date : la fin de contrat (non modifiable ici) ou la fiche. */
export function sourceDateSortie(fiche: Omit<FicheSortie, "id">, finsContrat: { dateFin: Date }[]): "FIN_CONTRAT" | "FICHE" | null {
  if (fiche.actif) return null;
  const embauche = jourPur(new Date(fiche.dateEmbauche)).getTime();
  if (finsContrat.some((f) => jourPur(new Date(f.dateFin)).getTime() >= embauche)) return "FIN_CONTRAT";
  return fiche.dateSortie ? "FICHE" : null;
}

/**
 * Lit la date de sortie d'un formulaire (AAAA-MM-JJ) : OBLIGATOIRE. Vide, absente ou illisible → erreur lisible, jamais
 * une date par défaut (ni « aujourd'hui », ni l'embauche). PURE.
 */
export function lireDateSortieSaisie(brut: unknown): Date {
  const texte = typeof brut === "string" ? brut.trim() : "";
  if (texte === "") {
    throw new Error("La date de sortie est obligatoire : indiquez le dernier jour de présence du salarié. Rien n'a été enregistré.");
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(texte) ? new Date(`${texte}T00:00:00.000Z`) : new Date(Number.NaN);
  // Le moteur JS accepte « 2026-02-30 » (il passe au 2 mars) : on exige que le jour relu soit celui qui a été saisi.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texte) throw new Error("Date de sortie invalide : choisissez un jour du calendrier. Rien n'a été enregistré.");
  return d;
}

/**
 * Refus lisible d'une date de sortie incohérente (avant l'embauche, illisible), null si elle convient. PURE.
 * Une date FUTURE est admise : un départ annoncé (la fiche est déjà désactivée) s'arrête à ce jour-là.
 */
export function controlerDateSortie(dateEmbauche: Date, dateSortie: Date): string | null {
  if (Number.isNaN(dateSortie.getTime())) return "Date de sortie invalide : choisissez un jour du calendrier.";
  if (jourPur(dateSortie).getTime() < jourPur(new Date(dateEmbauche)).getTime()) {
    return `La date de sortie (${iso(dateSortie).split("-").reverse().join("/")}) ne peut pas précéder la date d'embauche (${iso(dateEmbauche).split("-").reverse().join("/")}).`;
  }
  return null;
}

/**
 * Les dates de sortie de plusieurs fiches, en lot : 2 requêtes. Les fiches ACTIVES et celles dont la date est
 * inconnue sont absentes du résultat (« inactive sans date » = fiche à compléter, voir `fichesSansDateSortie`).
 */
export async function chargerDatesSortie(db: Db, employeeIds: string[]): Promise<Map<string, Date>> {
  const m = new Map<string, Date>();
  if (employeeIds.length === 0) return m;
  const [fiches, fins] = await Promise.all([
    db.employee.findMany({ where: { id: { in: employeeIds }, actif: false }, select: { id: true, actif: true, dateEmbauche: true, dateSortie: true } }),
    db.finContrat.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, dateFin: true } }),
  ]);
  for (const f of fiches) {
    const d = resoudreDateSortie(f, fins.filter((x) => x.employeeId === f.id));
    if (d) m.set(f.id, d);
  }
  return m;
}

/**
 * Où en est la sortie d'UNE fiche, pour l'écran : sa date et d'où elle vient, ou « inconnue » quand la fiche est
 * INACTIVE sans date (à compléter par la Direction — l'outil signale, il ne devine pas).
 */
export async function chargerSortieFiche(db: Db, employeeId: string): Promise<{ dateSortie: Date | null; source: "FIN_CONTRAT" | "FICHE" | null; inconnue: boolean }> {
  const fiche = await db.employee.findUnique({ where: { id: employeeId }, select: { actif: true, dateEmbauche: true, dateSortie: true } });
  if (!fiche || fiche.actif) return { dateSortie: null, source: null, inconnue: false };
  const fins = await db.finContrat.findMany({ where: { employeeId }, select: { dateFin: true } });
  const dateSortie = resoudreDateSortie(fiche, fins);
  return { dateSortie, source: sourceDateSortie(fiche, fins), inconnue: dateSortie === null };
}

const jjmmaaaa = (d: Date) => iso(d).split("-").reverse().join("/");

/**
 * Contrôles d'une date de sortie saisie sur la fiche (à l'écran ET à l'approbation d'une demande) : la fiche doit
 * être désactivée, aucune fin de contrat ne doit déjà porter la date (elle fait foi, pas de seconde date), et la date
 * ne précède pas l'embauche. `apres` = valeur canonique AAAA-MM-JJ, null = date effacée. Lève un message lisible.
 */
export async function exigerSortieSaisissable(
  db: Db,
  fiche: { id: string; actif: boolean; dateEmbauche: Date },
  apres: string | null,
  embaucheApres: string | null = null,
): Promise<void> {
  if (fiche.actif) {
    throw new Error("La date de sortie se saisit sur une fiche désactivée. Pour faire partir un salarié, utilisez « Fin de contrat » (onglet Contrats de la fiche). Rien n'a été enregistré.");
  }
  const fins = await db.finContrat.findMany({ where: { employeeId: fiche.id }, select: { dateFin: true } });
  const retenue = resoudreDateSortie({ actif: false, dateEmbauche: fiche.dateEmbauche, dateSortie: null }, fins);
  if (retenue) {
    throw new Error(`Une fin de contrat est enregistrée au ${jjmmaaaa(retenue)} : cette date fait foi, elle ne se double pas sur la fiche. Rien n'a été enregistré.`);
  }
  if (apres === null) return;
  const refus = controlerDateSortie(embaucheApres ? new Date(`${embaucheApres}T00:00:00.000Z`) : fiche.dateEmbauche, new Date(`${apres}T00:00:00.000Z`));
  if (refus) throw new Error(`${refus} Rien n'a été enregistré.`);
}
