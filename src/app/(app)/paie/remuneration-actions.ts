"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { recalculerPaieSiCalculee } from "./actions";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { chargerPlafondAcompte, verifierMontantAcompte } from "@/lib/acompte-plafond";
import type { DecisionAcompte, ResultatLotAcomptes } from "@/lib/acompte-plafond";

async function periodeCourante() {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  return {
    mois: config?.moisCourant ?? new Date().getMonth() + 1,
    annee: config?.anneeCourante ?? new Date().getFullYear(),
  };
}

/** Applique une prime à un employé pour la période en cours (répercutée au calcul de la paie). */
export async function ajouterPrime(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const nom = String(formData.get("nom") ?? "").trim() || "Prime";
    const montantUSD = Number(formData.get("montantUSD"));
    if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant de prime invalide.");
    const motif = String(formData.get("motif") ?? "").trim() || null;

    // Majoration exprimée en % du salaire de base : le taux est CONSERVÉ pour la traçabilité, mais
    // c'est le montant soumis qui fait foi (calculé et ajustable à la saisie, jamais recalculé à la
    // paie) — même principe que la prime d'ancienneté, une seule source de vérité.
    const pctBrut = String(formData.get("pourcentageBase") ?? "").trim();
    const pourcentageBase = pctBrut ? Number(pctBrut.replace(",", ".")) : null;
    if (pourcentageBase !== null && (!Number.isFinite(pourcentageBase) || pourcentageBase <= 0)) {
      throw new Error("Pourcentage de majoration invalide.");
    }

    const { mois, annee } = await periodeCourante();

    await prisma.prime.create({
      data: { employeeId, nom, montantUSD, pourcentageBase, motif, mois, annee, creeParId: user.id },
    });
    await journaliser(prisma, {
      entite: "Prime",
      entiteId: employeeId,
      champ: "ajout",
      nouvelleValeur: `${nom} : ${montantUSD} $${pourcentageBase !== null ? ` (${pourcentageBase} % du salaire de base)` : ""}${motif ? ` — ${motif}` : ""} (${mois}/${annee})`,
      userId: user.id,
    });
    await recalculerPaieSiCalculee(); // répercute la prime sur le bulletin déjà calculé (non figé)
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/paie");

  });
}

export async function supprimerPrime(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const prime = await prisma.prime.findUnique({ where: { id } });
  if (!prime) return;
  await prisma.prime.delete({ where: { id } });
  await journaliser(prisma, {
    entite: "Prime",
    entiteId: prime.employeeId,
    champ: "suppression",
    ancienneValeur: `${prime.nom} : ${Number(prime.montantUSD)} $`,
    userId: user.id,
  });
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${prime.employeeId}`);
  revalidatePath("/paie");
}

/** Supprime un acompte (réservé ADMIN). Tracé au journal d'audit. */
export async function supprimerAcompte(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const acompte = await prisma.acompteSalaire.findUnique({ where: { id } });
  if (!acompte) return;
  await prisma.acompteSalaire.delete({ where: { id } });
  await journaliser(prisma, {
    entite: "Acompte",
    entiteId: acompte.employeeId,
    champ: "suppression",
    ancienneValeur: `${acompte.mois}/${acompte.annee} : ${Number(acompte.montantUSD)} $`,
    userId: user.id,
  });
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${acompte.employeeId}`);
  revalidatePath("/paie");
}

/** Téléverse un certificat vers Supabase Storage (bucket employes, préfixe certificats/). */
async function televerserCertificat(employeeId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!["pdf", "png", "jpg", "jpeg", "webp"].includes(ext)) throw new Error("Certificat : PDF ou image uniquement.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Fichier trop lourd (max 15 Mo).");
  const path = `certificats/${employeeId}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/employes/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error("Échec du téléversement du certificat.");
  return `/fichiers/${path}`; // bucket privé — servi derrière session
}

/** Ajoute un frais médical (avec certificat) pour la période en cours. Répercuté au calcul de la paie. */
export async function ajouterFraisMedical(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const montantUSD = Number(formData.get("montantUSD"));
    if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant de frais médical invalide.");
    const motif = String(formData.get("motif") ?? "").trim() || null;
    const { mois, annee } = await periodeCourante();

    let certificatUrl: string | null = null;
    const fichier = formData.get("certificat");
    if (fichier instanceof File && fichier.size > 0) certificatUrl = await televerserCertificat(employeeId, fichier);

    await prisma.fraisMedical.create({ data: { employeeId, montantUSD, mois, annee, motif, certificatUrl, creeParId: user.id } });
    await journaliser(prisma, {
      entite: "FraisMedical",
      entiteId: employeeId,
      champ: "ajout",
      nouvelleValeur: `${montantUSD} $ (${mois}/${annee})${certificatUrl ? " + certificat" : ""}`,
      userId: user.id,
    });
    await recalculerPaieSiCalculee();
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/paie");

  });
}

export async function supprimerFraisMedical(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const fm = await prisma.fraisMedical.findUnique({ where: { id } });
  if (!fm) return;
  await prisma.fraisMedical.delete({ where: { id } });
  await journaliser(prisma, { entite: "FraisMedical", entiteId: fm.employeeId, champ: "suppression", ancienneValeur: `${Number(fm.montantUSD)} $`, userId: user.id });
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${fm.employeeId}`);
  revalidatePath("/paie");
}

/**
 * Consigne un avantage en nature du mois (logement, nourriture, véhicule…).
 * PUREMENT INFORMATIF : aucun recalcul de paie n'est déclenché, car l'avantage n'entre dans aucune
 * assiette ni dans le net (décision 2026-08-16, traitement fiscal À VALIDER par un comptable).
 * Il apparaît sur le bulletin en mention, jamais dans une addition.
 */
export async function ajouterAvantageNature(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const nature = String(formData.get("nature") ?? "").trim();
    if (!nature) throw new Error("Indiquez la nature de l'avantage (logement, nourriture…).");
    const montantUSD = Number(String(formData.get("montantUSD") ?? "").replace(",", "."));
    if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant d'avantage invalide.");
    const motif = String(formData.get("motif") ?? "").trim() || null;
    const { mois, annee } = await periodeCourante();

    await prisma.avantageNature.create({
      data: { employeeId, nature, montantUSD, motif, mois, annee, creeParId: user.id },
    });
    await journaliser(prisma, {
      entite: "AvantageNature",
      entiteId: employeeId,
      champ: "ajout",
      nouvelleValeur: `${nature} : ${montantUSD} $ (${mois}/${annee})`,
      userId: user.id,
    });
    // Pas de `recalculerPaieSiCalculee()` : rien à recalculer, l'avantage ne change aucun montant.
    // Le bulletin déjà calculé reprend la valeur au prochain recalcul déclenché par autre chose.
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/paie");
  });
}

/** Retire un avantage en nature. Tracé au journal d'audit. */
export async function supprimerAvantageNature(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const a = await prisma.avantageNature.findUnique({ where: { id } });
  if (!a) return;
  await prisma.avantageNature.delete({ where: { id } });
  await journaliser(prisma, {
    entite: "AvantageNature",
    entiteId: a.employeeId,
    champ: "suppression",
    ancienneValeur: `${a.nature} : ${Number(a.montantUSD)} $`,
    userId: user.id,
  });
  revalidatePath(`/employes/${a.employeeId}`);
  revalidatePath("/paie");
}

/** Demande d'acompte sur salaire (à approuver dans les Demandes de validation). */
export async function demanderAcompte(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const montantUSD = Number(formData.get("montantUSD"));
    if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant d'acompte invalide.");
    const motif = String(formData.get("motif") ?? "").trim() || null;
    const { mois, annee } = await periodeCourante();

    // Un acompte est une avance sur un droit DÉJÀ acquis : plafonné au net du mois précédent (à
    // défaut, au salaire de la fiche), cumul des acomptes du mois compris.
    const plafond = await chargerPlafondAcompte(prisma, { employeeId, mois, annee });
    const verdict = verifierMontantAcompte(montantUSD, plafond);
    if (!verdict.ok) throw new Error(verdict.message);

    const acompte = await prisma.acompteSalaire.create({
      data: { employeeId, montantUSD, mois, annee, motif, statut: "EN_ATTENTE" },
    });

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    await creerNotification({
      type: "ACOMPTE",
      message: `Nouvelle demande d'acompte — ${emp?.nom ?? "employé"}, ${montantUSD.toFixed(2)} $.`,
      lien: "/a-valider",
      refId: acompte.id,
    });

    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");

  });
}

/** `recalculer` : recalcule le bulletin (déjà calculé, non figé) impacté par l'acompte approuvé.
 * Par défaut à `true` (comportement inchangé de l'appel unitaire) ; les lots le mettent à `false`
 * pour ne recalculer QU'UNE fois après la boucle, plutôt qu'à chaque acompte décidé. */
async function deciderAcompte(
  id: string,
  statut: "APPROUVE" | "REFUSE",
  options?: { recalculer?: boolean }
): Promise<DecisionAcompte> {
  const recalculer = options?.recalculer ?? true;
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const a = await prisma.acompteSalaire.findUnique({ where: { id } });
  if (!a || a.statut !== "EN_ATTENTE") return { ok: true };

  // Le plafond est re-vérifié À L'APPROBATION, pas seulement à la demande : plusieurs demandes
  // tenant chacune dans le plafond peuvent le dépasser une fois cumulées. L'acompte examiné est
  // exclu du cumul (il est EN_ATTENTE, il se compterait lui-même).
  if (statut === "APPROUVE") {
    const plafond = await chargerPlafondAcompte(prisma, {
      employeeId: a.employeeId,
      mois: a.mois,
      annee: a.annee,
      exclureAcompteId: a.id,
    });
    const verdict = verifierMontantAcompte(Number(a.montantUSD), plafond);
    if (!verdict.ok) return { ok: false, message: verdict.message };
  }

  await prisma.acompteSalaire.update({
    where: { id },
    data: { statut, decideParId: user.id, dateDecision: new Date() },
  });
  await journaliser(prisma, {
    entite: "AcompteSalaire",
    entiteId: a.employeeId,
    champ: "statut",
    nouvelleValeur: `${statut} — ${Number(a.montantUSD)} $ (${a.mois}/${a.annee})`,
    userId: user.id,
  });
  await supprimerNotificationsPour(id);
  // Un acompte APPROUVÉ est déduit du net → recalculer le bulletin déjà calculé (non figé).
  if (statut === "APPROUVE" && recalculer) await recalculerPaieSiCalculee();
  revalidatePath("/a-valider");
  revalidatePath(`/employes/${a.employeeId}`);
  revalidatePath("/paie");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function approuverAcompte(id: string): Promise<DecisionAcompte> {
  return deciderAcompte(id, "APPROUVE");
}
export async function refuserAcompte(id: string): Promise<DecisionAcompte> {
  return deciderAcompte(id, "REFUSE");
}

/** Actions groupées sur les demandes d'acompte (mêmes règles que l'individuel). Le recalcul de la
 * paie (coûteux) n'est fait QU'UNE fois après la boucle plutôt qu'à chaque acompte approuvé.
 * Un acompte bloqué par le plafond n'interrompt PAS le lot : il est compté et signalé, les autres
 * passent — sinon une seule ligne hors plafond annulerait une validation de trente. */
async function deciderAcomptesEnLot(
  ids: string[],
  statut: "APPROUVE" | "REFUSE"
): Promise<ResultatLotAcomptes> {
  let traites = 0;
  const bloques: string[] = [];
  for (const id of ids) {
    const r = await deciderAcompte(id, statut, { recalculer: false });
    if (r.ok) traites++;
    else bloques.push(r.message);
  }
  if (statut === "APPROUVE" && traites > 0) await recalculerPaieSiCalculee();
  return { traites, bloques: bloques.length, message: bloques[0] };
}
export async function approuverAcomptesEnLot(ids: string[]): Promise<ResultatLotAcomptes> {
  return deciderAcomptesEnLot(ids, "APPROUVE");
}
export async function refuserAcomptesEnLot(ids: string[]): Promise<ResultatLotAcomptes> {
  return deciderAcomptesEnLot(ids, "REFUSE");
}
