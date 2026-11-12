"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, invaliderProfil } from "@/lib/auth";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import {
  DEFINITIONS_PERMISSIONS,
  aPermission,
  definitionPermission,
  estPermission,
  lireSurcharges,
  permissionsReglables,
  surchargesDepuisCases,
  type EspacePermission,
  type Permission,
} from "@/lib/permissions";

/**
 * Enregistre les cases cochées d'un compte RH ou Stock (Direction seule).
 *
 * `coches` : { "stock.bon_valider": true, "rh.paie": false, … } — l'état voulu de CHAQUE permission
 * réglable de ce compte. Le serveur ne fait pas confiance à l'écran : clés inconnues, valeurs non
 * booléennes et permissions d'un espace que le rôle du compte ne règle pas sont refusées. Seuls les écarts
 * avec le défaut du rôle sont stockés ; chaque permission accordée ou retirée est journalisée.
 */
export const definirPermissionsUtilisateur = actionLisible(async (userId: string, coches: Record<string, boolean>) => {
  const admin = await verifySession();
  requireRole(admin, ["ADMIN"]);

  if (!coches || typeof coches !== "object" || Array.isArray(coches)) throw new Error("Réglage invalide.");
  const voulu: Partial<Record<Permission, boolean>> = {};
  for (const [cle, valeur] of Object.entries(coches)) {
    if (!estPermission(cle) || typeof valeur !== "boolean") throw new Error(`Permission inconnue ou invalide : ${cle}.`);
    voulu[cle] = valeur;
  }

  const cible = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nom: true, role: true, accesStock: true, permissions: true } });
  if (!cible) throw new Error("Utilisateur introuvable.");
  if (cible.role === "ADMIN") throw new Error("La Direction a toujours tous les droits : aucun réglage possible.");

  const espaces = (["rh", "stock"] as EspacePermission[]).filter((e) => permissionsReglables(cible, e));
  if (espaces.length === 0) throw new Error("Les permissions se règlent sur un compte RH ou Stock.");
  for (const cle of Object.keys(voulu) as Permission[]) {
    if (!espaces.includes(definitionPermission(cle).espace)) throw new Error(`« ${definitionPermission(cle).libelle} » ne concerne pas le rôle de ce compte.`);
  }

  const avant = lireSurcharges(cible.permissions);
  let apres = avant;
  for (const espace of espaces) {
    // L'état voulu de chaque case de l'espace : celle envoyée, sinon l'état actuel (une case absente ne change pas).
    const cases: Partial<Record<Permission, boolean>> = {};
    for (const d of DEFINITIONS_PERMISSIONS) {
      if (d.espace === espace) cases[d.cle] = voulu[d.cle] ?? aPermission({ role: cible.role, accesStock: cible.accesStock, permissions: avant }, d.cle);
    }
    apres = surchargesDepuisCases(espace, cases, apres) ?? {};
  }
  const stocke = Object.keys(apres).length ? apres : null;

  const entrees: EntreeJournal[] = [];
  for (const d of DEFINITIONS_PERMISSIONS) {
    if (!espaces.includes(d.espace)) continue;
    const a = aPermission({ role: cible.role, accesStock: cible.accesStock, permissions: avant }, d.cle);
    const b = aPermission({ role: cible.role, accesStock: cible.accesStock, permissions: apres }, d.cle);
    if (a !== b) {
      entrees.push({
        entite: "User",
        entiteId: userId,
        champ: `permission:${d.cle}`,
        ancienneValeur: a ? "accordée" : "retirée",
        nouvelleValeur: b ? "accordée" : "retirée",
        userId: admin.id,
      });
    }
  }
  if (entrees.length === 0) return; // rien ne change : pas d'écriture, pas de bruit au journal

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { permissions: stocke ?? Prisma.DbNull } });
    await journaliserPlusieurs(tx, entrees);
  });
  invaliderProfil(userId);
  revalidatePath("/parametres");
});
