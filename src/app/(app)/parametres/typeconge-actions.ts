"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { decSaisiOptionnel } from "@/lib/nombre";
import { estTypeCongeProtege } from "@/lib/conges-regles";

/** Entier facultatif d'un champ (vide = « À VALIDER »). Illisible, décimal ou hors bornes : refusé, jamais arrondi. */
function entierOuNull(v: FormDataEntryValue | null, libelle: string, max?: number): number | null {
  const n = decSaisiOptionnel(v, libelle);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0 || (max !== undefined && n > max)) {
    throw new Error(`${libelle} : un nombre entier${max !== undefined ? ` de 0 à ${max}` : " positif"} est attendu (« ${String(v).trim()} » refusé).`);
  }
  return n;
}

/** Crée un type de congé/absence paramétrable. joursPayes/tauxPct vides = « À VALIDER » et la case
 * « compte dans le solde » (seuls les types cochés se déduisent du solde de congé annuel). */
export const creerTypeConge = actionLisible(async (formData: FormData) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du type est requis.");
  if (await prisma.typeConge.findUnique({ where: { nom } })) throw new Error(`Un type « ${nom} » existe déjà.`);
  const dernier = await prisma.typeConge.findFirst({ orderBy: { ordre: "desc" } });
  await prisma.typeConge.create({
    data: {
      nom,
      joursPayes: entierOuNull(formData.get("joursPayes"), "Jours payés"),
      tauxPct: entierOuNull(formData.get("tauxPct"), "Taux %"),
      compteDansSolde: formData.get("compteDansSolde") === "on",
      ordre: (dernier?.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Modifie un type de congé (nom, jours payés, taux, case « compte dans le solde »). Le NOM d'un type
 * protégé ou déjà utilisé par une demande ne change pas. */
export const modifierTypeConge = actionLisible(async (id: string, formData: FormData) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du type est requis.");
  const joursPayes = entierOuNull(formData.get("joursPayes"), "Jours payés");
  const tauxPct = entierOuNull(formData.get("tauxPct"), "Taux %");
  const t = await prisma.typeConge.findUniqueOrThrow({ where: { id } });
  // Le type d'une demande est son NOM (texte) : renommer un type déjà utilisé détachait ses
  // demandes de leur règle (« compte dans le solde », taux) — solde remonté, « S » payé en « C ».
  if (nom !== t.nom) {
    if (estTypeCongeProtege(t.nom)) throw new Error(`« ${t.nom} » est un type protégé : il ne se renomme pas (désactivez-le si besoin).`);
    const n = await prisma.leaveRequest.count({ where: { type: t.nom } });
    if (n > 0) throw new Error(`« ${t.nom} » est utilisé par ${n} demande(s) de congé : il ne se renomme pas. Désactivez-le et créez un nouveau type si besoin.`);
    if (await prisma.typeConge.findUnique({ where: { nom } })) throw new Error(`Un type « ${nom} » existe déjà.`);
  }
  // « Congé sans solde » EST le type à 0 % : un autre taux ferait payer ses jours comme un congé.
  if (t.nom === "Congé sans solde" && tauxPct !== 0) throw new Error("« Congé sans solde » reste à 0 % (non payé) : c'est ce qui pose « S » sur la grille.");
  await prisma.typeConge.update({
    where: { id },
    data: { nom, joursPayes, tauxPct, compteDansSolde: formData.get("compteDansSolde") === "on" },
  });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Active / désactive un type (un type inactif n'apparaît plus dans le menu des congés). */
export const basculerTypeConge = actionLisible(async (id: string) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const t = await prisma.typeConge.findUniqueOrThrow({ where: { id } });
  await prisma.typeConge.update({ where: { id }, data: { actif: !t.actif } });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Supprime un type non système, non protégé et jamais utilisé par une demande (sinon : le désactiver). */
export const supprimerTypeConge = actionLisible(async (id: string) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const t = await prisma.typeConge.findUniqueOrThrow({ where: { id } });
  if (t.systeme || estTypeCongeProtege(t.nom)) throw new Error(`« ${t.nom} » est un type protégé : il ne peut pas être supprimé (désactivez-le).`);
  // Un type utilisé ne se détruit pas : ses demandes perdraient leur règle (taux, solde) — comme un
  // shift utilisé, il se DÉSACTIVE.
  const n = await prisma.leaveRequest.count({ where: { type: t.nom } });
  if (n > 0) throw new Error(`« ${t.nom} » est utilisé par ${n} demande(s) de congé : il ne peut pas être supprimé. Désactivez-le (il ne sera plus proposé).`);
  await prisma.typeConge.delete({ where: { id } });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});
