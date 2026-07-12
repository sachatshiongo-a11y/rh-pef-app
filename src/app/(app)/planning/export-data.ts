import "server-only";
import { prisma } from "@/lib/prisma";
import { libelleShift } from "./creneaux";
import { lundiDe } from "@/lib/dates-fr";

const isoJ = (d: Date) => d.toISOString().slice(0, 10);
const WD = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

/**
 * Données du planning pour l'export (PDF/Excel), à partir des mêmes paramètres que l'écran :
 * `?mois=&annee=` (vue mois) sinon `?debut=` (semaine). Grille employés × jours (libellé du shift),
 * groupée Brigade / Backoffice (lignes-titres = sectionRows).
 */
export async function donneesPlanning(sp: URLSearchParams) {
  const moisParam = sp.get("mois"), anneeParam = sp.get("annee");
  let dates: Date[], titre: string, sousTitre: string, fichierBase: string;

  if (moisParam && anneeParam) {
    const mois = Math.min(12, Math.max(1, Number(moisParam) || 1));
    const annee = Number(anneeParam) || new Date().getUTCFullYear();
    const nb = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
    dates = Array.from({ length: nb }, (_, i) => new Date(Date.UTC(annee, mois - 1, i + 1)));
    titre = "Planning mensuel";
    sousTitre = new Date(Date.UTC(annee, mois - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    fichierBase = `Planning_${annee}-${String(mois).padStart(2, "0")}`;
  } else {
    const base = sp.get("debut") ? new Date(sp.get("debut") + "T00:00:00Z") : new Date();
    const lundi = lundiDe(isNaN(base.getTime()) ? new Date() : base);
    dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + i); return d; });
    titre = "Planning hebdomadaire";
    sousTitre = `Semaine du ${dates[0].getUTCDate()}/${dates[0].getUTCMonth() + 1} au ${dates[6].getUTCDate()}/${dates[6].getUTCMonth() + 1}`;
    fichierBase = `Planning_semaine_${isoJ(dates[0])}`;
  }

  const isoDates = dates.map(isoJ);
  const [employees, creneaux, shifts] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: [{ categorie: "asc" }, { nom: "asc" }], select: { id: true, nom: true, categorie: true } }),
    prisma.planningCreneau.findMany({ where: { date: { gte: dates[0], lte: dates[dates.length - 1] } } }),
    prisma.shift.findMany(),
  ]);
  const shiftLabel = new Map(shifts.map((s) => [s.id, libelleShift(s.nom, s.heureDebut, s.heureFin)]));
  const cre: Record<string, string> = {};
  for (const c of creneaux) cre[`${c.employeeId}_${isoJ(new Date(c.date))}`] = c.shiftId;

  const labels = dates.map((d) => `${WD[d.getUTCDay()]} ${d.getUTCDate()}`);
  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  const groupe = (titreG: string, cat: string) => {
    const emps = employees.filter((e) => e.categorie === cat);
    if (emps.length === 0) return;
    sectionRows.push(lignes.length);
    lignes.push([titreG]);
    for (const e of emps) lignes.push([e.nom, ...isoDates.map((iso) => { const s = cre[`${e.id}_${iso}`]; return s ? (shiftLabel.get(s) ?? "") : "—"; })]);
  };
  groupe("Brigade", "BRIGADE");
  groupe("Backoffice", "BACKOFFICE");

  return { titre, sousTitre, fichierBase, labels, lignes, sectionRows };
}
