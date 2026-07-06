/**
 * Import ponctuel des données existantes du classeur "RH PEF version finale.xlsm"
 * (onglets Employes + Payroll Backoffice + CONFIG) vers la base Postgres.
 *
 * Usage : npx tsx scripts/import-from-excel.ts "/chemin/vers/RH PEF version finale.xlsm"
 */
import "dotenv/config";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const cheminFichier =
  process.argv[2] ??
  "/Users/sachatshiongo/Library/CloudStorage/OneDrive-Personnel/RH PEF version finale .xlsm";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function excelDateToJs(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  return new Date(String(value));
}

async function importEmployesBrigade(wb: XLSX.WorkBook) {
  const ws = wb.Sheets["Employes"];
  if (!ws) {
    console.warn("Onglet 'Employes' introuvable, import brigade ignoré.");
    return 0;
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: 1,
    range: 5, // ligne 6 = première ligne de données (0-indexé)
    defval: "",
  }) as unknown as unknown[][];

  // La colonne A est entièrement vide sur cet onglet ("!ref" commence à B) : sheet_to_json
  // ne la restitue donc pas comme élément [0] vide, le tableau démarre directement à la colonne B.
  let count = 0;
  for (const row of rows) {
    const matricule = String(row[0] ?? "").trim();
    const nom = String(row[1] ?? "").trim();
    if (!matricule || !nom) continue;

    const data = {
      matricule,
      nom,
      sexe: String(row[2] ?? "M"),
      etatCivil: String(row[3] ?? "Célibataire"),
      poste: String(row[4] ?? ""),
      secteur: String(row[5] ?? ""),
      categorie: "BRIGADE" as const,
      salaireMensuel: Number(row[6]) || 0,
      transportJourCDF: Number(row[9]) || 0,
      transportMoisCDF: Number(row[10]) || 0,
      transportMoisUSD: Number(row[11]) || 0,
      cnssMontant: Number(row[12]) || 0,
      enfants: Number(row[13]) || 0,
      type: (String(row[14]).toLowerCase().startsWith("expat") ? "EXPATRIE" : "NATIONAL") as
        | "EXPATRIE"
        | "NATIONAL",
      dateEmbauche: excelDateToJs(row[15]),
      contrat: String(row[17] ?? "CDD"),
      heuresParJour: Number(row[18]) || 8,
    };

    await prisma.employee.upsert({ where: { matricule }, update: data, create: data });
    count++;
  }
  return count;
}

async function importBackoffice(wb: XLSX.WorkBook) {
  const ws = wb.Sheets["Payroll Backoffice"];
  if (!ws) {
    console.warn("Onglet 'Payroll Backoffice' introuvable, import backoffice ignoré.");
    return 0;
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: 1,
    range: 4, // ligne 5 = première ligne de données
    defval: "",
  }) as unknown as unknown[][];

  // Même remarque que pour l'onglet Employes : colonne A vide, tableau démarre à la colonne B.
  let count = 0;
  let index = 1;
  for (const row of rows) {
    const nom = String(row[0] ?? "").trim();
    const poste = String(row[3] ?? "").trim();
    // La liste des employés s'arrête à la première ligne sans poste (lignes de
    // totaux/récapitulatif en bas de l'onglet : "TOTAUX BACKOFFICE", "SAL. NET à verser...", etc.)
    if (!nom || !poste) break;

    const matricule = `BO${String(index).padStart(2, "0")}-PEF`;
    index++;

    const data = {
      matricule,
      nom,
      sexe: String(row[1] ?? "M"),
      etatCivil: String(row[2] ?? "Célibataire"),
      poste: String(row[3] ?? ""),
      secteur: "Backoffice",
      categorie: "BACKOFFICE" as const,
      salaireMensuel: Number(row[4]) || 0,
      transportMoisUSD: Number(row[5]) || 0,
      enfants: 0,
      type: "NATIONAL" as const,
      dateEmbauche: new Date(),
      contrat: "CDI",
      heuresParJour: 8,
    };

    await prisma.employee.upsert({ where: { matricule }, update: data, create: data });
    count++;
  }
  return count;
}

async function importConfig(wb: XLSX.WorkBook) {
  const ws = wb.Sheets["CONFIG"];
  if (!ws) {
    console.warn("Onglet 'CONFIG' introuvable, import config ignoré.");
    return;
  }
  const get = (cell: string) => ws[cell]?.v;

  // Seules les valeurs opérationnelles sont importées ici ; les paramètres légaux
  // (CNSS, IPR, HS...) sont gérés séparément dans ParametreLegal via seed-legal-2026.ts.
  const donnees = {
    tauxChangeCDF: Number(get("C4")) || 2300,
    anneeCourante: Number(get("C5")) || new Date().getFullYear(),
    moisCourant: Number(get("C6")) || new Date().getMonth() + 1,
  };

  await prisma.config.upsert({
    where: { id: "singleton" },
    update: donnees,
    create: { id: "singleton", ...donnees },
  });
}

async function main() {
  console.log(`Lecture du fichier : ${cheminFichier}`);
  const wb = XLSX.readFile(cheminFichier);

  await importConfig(wb);
  const nbBrigade = await importEmployesBrigade(wb);
  const nbBackoffice = await importBackoffice(wb);

  console.log(`Import terminé : ${nbBrigade} employé(s) brigade, ${nbBackoffice} employé(s) backoffice.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
