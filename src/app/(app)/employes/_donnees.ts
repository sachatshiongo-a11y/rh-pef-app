import type { Employee } from "@prisma/client";
import type { Colonne } from "@/lib/pdf/tableau";
import { formaterNombre } from "@/lib/montant";

const money = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `?statut=` de l'onglet Employés : actifs (défaut), inactifs (ex-employés) ou tous. UNE lecture pour l'écran ET pour ses exports. */
export function statutEmployes(brut: string | null | undefined): "actifs" | "inactifs" | "tous" {
  return brut === "inactifs" ? "inactifs" : brut === "tous" ? "tous" : "actifs";
}
export const whereStatutEmployes = (statut: "actifs" | "inactifs" | "tous") =>
  statut === "inactifs" ? { actif: false } : statut === "tous" ? {} : { actif: true };
/** « 12 employé(s) actif(s) » / « inactif(s) » / « au total » : le libellé suit le statut exporté. */
export const libelleNombreEmployes = (n: number, statut: "actifs" | "inactifs" | "tous") =>
  `${n} employé(s) ${statut === "inactifs" ? "inactif(s)" : statut === "tous" ? "au total" : "actif(s)"}`;

/** Plafond de l'export d'une SÉLECTION d'employés (`?ids=…`) : lu par le bouton (qui se désactive au-delà) ET par les routes (400 lisible). */
export const MAX_EXPORT_EMPLOYES = 200;
export const MESSAGE_EXPORT_EMPLOYES_TROP_GRAND = `Exportez ${MAX_EXPORT_EMPLOYES} employés au plus à la fois.`;

/** Identifiants d'une sélection (`?ids=a,b,c`), ou null si l'export n'est pas une sélection. */
export function idsSelectionEmployes(sp: URLSearchParams): string[] | null {
  const brut = sp.get("ids");
  if (brut === null) return null;
  return [...new Set(brut.split(",").map((x) => x.trim()).filter(Boolean))];
}

/** Réponse 400 des routes d'export quand la sélection dépasse le plafond (jamais tronquée en silence). */
export function refusSelectionTropGrande(sp: URLSearchParams): Response | null {
  const ids = idsSelectionEmployes(sp);
  return ids && ids.length > MAX_EXPORT_EMPLOYES ? new Response(MESSAGE_EXPORT_EMPLOYES_TROP_GRAND, { status: 400 }) : null;
}

/** Filtre la liste (mêmes critères que l'onglet Employés) et ordonne Brigade puis Backoffice, par nom.
 *  `?ids=` restreint à la sélection cochée sur l'écran (les autres filtres s'appliquent encore). */
export function filtrerEmployes(tous: Employee[], sp: URLSearchParams): Employee[] {
  const choisis = idsSelectionEmployes(sp);
  const dansSelection = choisis ? new Set(choisis) : null;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const poste = sp.get("poste") ?? "";
  const secteur = sp.get("secteur") ?? "";
  const annee = sp.get("annee") ?? "";
  return tous
    .filter((e) => {
      if (dansSelection && !dansSelection.has(e.id)) return false;
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
