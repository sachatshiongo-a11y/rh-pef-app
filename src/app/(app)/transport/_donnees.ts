import type { Colonne } from "@/lib/pdf/tableau";

export const cdf = (n: number) => Math.round(n).toLocaleString("fr-FR");
export const usd = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CATEGORIE_LABEL: Record<string, string> = { BRIGADE: "Brigade", BACKOFFICE: "Back-office" };

type EmpTransport = {
  matricule: string; nom: string; poste: string; categorie: string;
  transportJourCDF: unknown; transportMoisUSD: unknown;
};

export type LigneTransport = {
  matricule: string; nom: string; poste: string; categorie: string;
  brigade: boolean; jourCDF: number; forfaitUSD: number; moisCompletCDF: number;
};

/** Prime de transport par employé — MÊME formule que l'onglet (brigade au tarif/jour, backoffice au forfait). */
export function lignesTransport(employes: EmpTransport[], jours: number, taux: number): {
  items: LigneTransport[];
  totalMoisCDF: number;
} {
  const items = employes.map((e) => {
    const brigade = e.categorie === "BRIGADE";
    const jourCDF = Number(e.transportJourCDF);
    const forfaitUSD = brigade ? 0 : Number(e.transportMoisUSD);
    return {
      matricule: e.matricule, nom: e.nom, poste: e.poste,
      categorie: CATEGORIE_LABEL[e.categorie] ?? e.categorie,
      brigade, jourCDF, forfaitUSD,
      moisCompletCDF: brigade ? jourCDF * jours : forfaitUSD * taux,
    };
  });
  return { items, totalMoisCDF: items.reduce((s, l) => s + l.moisCompletCDF, 0) };
}

export const colonnesTransport: Colonne[] = [
  { header: "Matricule", width: "12%" },
  { header: "Nom", width: "23%" },
  { header: "Poste", width: "19%" },
  { header: "Catégorie", width: "13%" },
  { header: "Transport / jour (CDF)", width: "13%", align: "right" },
  { header: "Forfait mensuel ($)", width: "10%", align: "right" },
  { header: "Mois complet (CDF)", width: "10%", align: "right" },
];
