import type { Employee } from "@prisma/client";
import type { Colonne } from "@/lib/pdf/tableau";

const money = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Filtre la liste (mêmes critères que l'onglet Employés) et ordonne Brigade puis Backoffice, par nom. */
export function filtrerEmployes(tous: Employee[], sp: URLSearchParams): Employee[] {
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const poste = sp.get("poste") ?? "";
  const secteur = sp.get("secteur") ?? "";
  const annee = sp.get("annee") ?? "";
  return tous
    .filter((e) => {
      if (poste && e.poste !== poste) return false;
      if (secteur && e.secteur !== secteur) return false;
      if (annee && String(new Date(e.dateEmbauche).getFullYear()) !== annee) return false;
      if (q && !e.nom.toLowerCase().includes(q) && !e.matricule.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) =>
      a.categorie === b.categorie
        ? a.nom.localeCompare(b.nom)
        : a.categorie === "BRIGADE" ? -1 : 1, // Brigade d'abord, comme l'onglet
    );
}

/** Colonnes (largeurs en % pour le PDF ; `header` réutilisé tel quel pour l'en-tête Excel). */
export const colonnesEmployes: Colonne[] = [
  { header: "Matricule", width: "11%" },
  { header: "Nom et prénom", width: "21%" },
  { header: "Poste", width: "16%" },
  { header: "Secteur", width: "13%" },
  { header: "Catégorie", width: "12%" },
  { header: "Salaire $", width: "10%", align: "right" },
  { header: "H/sem.", width: "7%", align: "right" },
  { header: "Contrat", width: "10%" },
];

const CATEGORIE_LABEL: Record<string, string> = { BRIGADE: "Brigade", BACKOFFICE: "Back-office" };

export function ligneEmploye(e: Employee): (string | number)[] {
  return [
    e.matricule,
    e.nom,
    e.poste,
    e.secteur,
    CATEGORIE_LABEL[e.categorie] ?? e.categorie,
    money(Number(e.salaireMensuel)),
    Number(e.heuresHebdomadaires),
    e.contrat,
  ];
}
