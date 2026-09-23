"use server";

// Les réglages du pointage par QR — Direction (ADMIN) uniquement : la position du restaurant,
// le rayon toléré, et le changement du code de l'affiche. Chaque réglage est journalisé ; le code
// de l'affiche, lui, est un secret et n'est JAMAIS écrit au journal.
// Cf. docs/superpowers/specs/2026-09-23-pointage-qr-design.md §3.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { actionLisible } from "@/lib/action-lisible";
import { formaterNombre } from "@/lib/montant";
import { genererCodeAffiche } from "@/lib/pointage-code";
import { exigerPositionReglee } from "@/lib/pointage-affiche";
import { PRECISION_REGLAGE_MAX_M } from "@/lib/pointage-qr";

const RAYON_MIN_M = 50;
const RAYON_MAX_M = 1000;

const arrondi6 = (x: number) => Math.round(x * 1e6) / 1e6; // colonnes Decimal(9, 6)

/**
 * La position du restaurant : par le GPS du téléphone (`precisionM` = la précision annoncée) ou
 * saisie à la main (`precisionM` null, coordonnées lues par `lireCoordonneesSaisies`). Le
 * navigateur n'est pas cru sur parole : coordonnées et précision sont revérifiées ici.
 */
export const reglerPositionRestaurant = actionLisible(
  async (e: { lat: number; lng: number; precisionM: number | null }): Promise<void> => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const { lat, lng, precisionM } = e ?? ({} as typeof e);
    if (
      typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    )
      throw new Error("Coordonnées illisibles : latitude entre -90 et 90, longitude entre -180 et 180.");
    if (precisionM !== null && (typeof precisionM !== "number" || !Number.isFinite(precisionM) || precisionM < 0))
      throw new Error("La précision de la position est illisible. Réessayez.");
    if (precisionM !== null && precisionM > PRECISION_REGLAGE_MAX_M)
      throw new Error(
        `Position trop imprécise (±${formaterNombre(Math.round(precisionM))} m, il faut ${formaterNombre(PRECISION_REGLAGE_MAX_M)} m au plus) : rapprochez-vous d'une fenêtre et réessayez.`,
      );

    const la = arrondi6(lat);
    const lo = arrondi6(lng);
    await prisma.$transaction(async (tx) => {
      const avant = await tx.config.findUniqueOrThrow({
        where: { id: "singleton" },
        select: { pointageLatitude: true, pointageLongitude: true },
      });
      await tx.config.update({ where: { id: "singleton" }, data: { pointageLatitude: la, pointageLongitude: lo } });
      await journaliser(tx, {
        entite: "Config", entiteId: "singleton", champ: "pointagePosition",
        ancienneValeur:
          avant.pointageLatitude === null || avant.pointageLongitude === null
            ? "non réglée"
            : `${Number(avant.pointageLatitude)}, ${Number(avant.pointageLongitude)}`,
        nouvelleValeur: `${la}, ${lo} (${precisionM === null ? "saisie manuelle" : `précision ±${Math.round(precisionM)} m`})`,
        userId: user.id,
      });
    });
    revalidatePath("/parametres");
  },
);

/** Le rayon toléré autour du restaurant, en mètres entiers, de 50 à 1 000. */
export const reglerRayon = actionLisible(async (rayonM: number): Promise<void> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (typeof rayonM !== "number" || !Number.isInteger(rayonM) || rayonM < RAYON_MIN_M || rayonM > RAYON_MAX_M)
    throw new Error(
      `Le rayon doit être un nombre entier de mètres, entre ${formaterNombre(RAYON_MIN_M)} et ${formaterNombre(RAYON_MAX_M)}.`,
    );

  await prisma.$transaction(async (tx) => {
    const avant = await tx.config.findUniqueOrThrow({ where: { id: "singleton" }, select: { pointageRayonM: true } });
    await tx.config.update({ where: { id: "singleton" }, data: { pointageRayonM: rayonM } });
    await journaliser(tx, {
      entite: "Config", entiteId: "singleton", champ: "pointageRayonM",
      ancienneValeur: avant.pointageRayonM, nouvelleValeur: rayonM, userId: user.id,
    });
  });
  revalidatePath("/parametres");
});

/**
 * Nouveau code d'affiche : toutes les affiches déjà imprimées cessent de pointer (une photo
 * circule, une affiche a été emportée). Refusé tant que la position n'est pas réglée : un code
 * sans position ferait refuser chaque scan.
 */
export const changerCodeAffiche = actionLisible(async (): Promise<void> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  await prisma.$transaction(async (tx) => {
    const { code } = await exigerPositionReglee(tx);
    await tx.config.update({ where: { id: "singleton" }, data: { pointageCode: genererCodeAffiche() } });
    await journaliser(tx, {
      entite: "Config", entiteId: "singleton", champ: "pointageCode",
      ancienneValeur: code ? "code précédent" : "aucun",
      nouvelleValeur: "nouveau code : les affiches déjà imprimées ne pointent plus",
      userId: user.id,
    });
  });
  revalidatePath("/parametres");
});
