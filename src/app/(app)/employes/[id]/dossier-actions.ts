"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, invaliderProfil } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { chargerParametresPaie } from "@/lib/config";
import type {
  TypeContrat,
  TypeDisciplinaire,
  TypeDocument,
} from "@prisma/client";
import { formulaireLisible } from "@/lib/erreur-formulaire";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fin de contrat (démission / licenciement / fin CDD) + solde de tout compte.
 * ⚠️ Les indemnités LÉGALES (préavis, licenciement) sont SAISIES par l'utilisateur (jamais
 * inventées) et à faire valider par un juriste — droit du travail RDC. Le logiciel ne calcule
 * mécaniquement que le salaire au prorata et l'indemnité de congés non pris.
 */
export async function terminerContrat(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const motif = String(formData.get("motif") ?? "AUTRE");
    const dateFin = new Date(String(formData.get("dateFin")));
    const joursTravaillesMois = Number(formData.get("joursTravaillesMois") ?? 0) || 0;
    const joursCongesNonPris = Number(formData.get("joursCongesNonPris") ?? 0) || 0;
    const preavisJours = Number(formData.get("preavisJours") ?? 0) || 0;
    const indemniteLicenciementUSD = Number(formData.get("indemniteLicenciementUSD") ?? 0) || 0;
    const autresUSD = Number(formData.get("autresUSD") ?? 0) || 0;
    const commentaire = String(formData.get("commentaire") ?? "").trim() || null;

    const [employee, parametres] = await Promise.all([
      prisma.employee.findUniqueOrThrow({ where: { id: employeeId } }),
      chargerParametresPaie(),
    ]);
    const salaireJournalier = r2(Number(employee.salaireMensuel) / parametres.joursOuvrablesMois);
    const salaireProrataUSD = r2(salaireJournalier * joursTravaillesMois);
    const indemniteCongesUSD = r2(salaireJournalier * joursCongesNonPris);
    const indemnitePreavisUSD = r2(salaireJournalier * preavisJours);
    const totalUSD = r2(
      salaireProrataUSD + indemniteCongesUSD + indemnitePreavisUSD + indemniteLicenciementUSD + autresUSD
    );

    await prisma.finContrat.create({
      data: {
        employeeId,
        motif,
        dateFin,
        salaireJournalierUSD: salaireJournalier,
        joursTravaillesMois,
        salaireProrataUSD,
        joursCongesNonPris,
        indemniteCongesUSD,
        preavisJours,
        indemnitePreavisUSD,
        indemniteLicenciementUSD,
        autresUSD,
        totalUSD,
        commentaire,
        creeParId: user.id,
      },
    });

    // Sortie de l'employé : contrats actifs résiliés + employé désactivé (jamais supprimé).
    await prisma.contrat.updateMany({ where: { employeeId, statut: "ACTIF" }, data: { statut: "RESILIE" } });
    await prisma.employee.update({ where: { id: employeeId }, data: { actif: false } });

    // Sécurité : couper l'accès du compte lié (espace salarié / stock) — l'ex-salarié ne doit plus
    // pouvoir se connecter. Le compte n'est pas supprimé (réactivable si erreur).
    const compte = await prisma.user.findUnique({ where: { employeeId }, select: { id: true, actif: true } });
    if (compte?.actif) {
      await prisma.user.update({ where: { id: compte.id }, data: { actif: false } });
      invaliderProfil(compte.id); // prise en compte immédiate (la session est refusée à la prochaine requête)
    }

    await journaliser(prisma, {
      entite: "Employee",
      entiteId: employeeId,
      champ: "finContrat",
      nouvelleValeur: `${motif} — solde ${totalUSD.toFixed(2)} $${compte?.actif ? " · compte désactivé" : ""}`,
      userId: user.id,
    });

    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/employes");

  });
}

function date(formData: FormData, name: string): Date | null {
  const v = String(formData.get(name) ?? "").trim();
  return v ? new Date(v) : null;
}

export async function ajouterContrat(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    // Fichier du contrat téléversé (prioritaire), sinon URL fournie.
    const fichier = formData.get("fichier");
    let documentUrl = String(formData.get("documentUrl") ?? "").trim() || null;
    if (fichier instanceof File && fichier.size > 0) {
      documentUrl = await televerserFichier(employeeId, fichier);
    }

    const type = String(formData.get("type")) as TypeContrat;
    const agence = String(formData.get("agence") ?? "").trim() || null;
    const coutJour = Number(String(formData.get("coutJourUSD") ?? "").replace(",", "."));
    if (type === "INTERIM" && !agence) throw new Error("Pour un intérimaire, indiquez l'agence d'intérim (c'est elle qui l'emploie et le paie).");

    await prisma.contrat.create({
      data: {
        employeeId,
        type,
        dateDebut: new Date(String(formData.get("dateDebut"))),
        dateFin: date(formData, "dateFin"),
        finPeriodeEssai: date(formData, "finPeriodeEssai"),
        heuresHebdo: Number(formData.get("heuresHebdo")) || 48,
        salaireMensuel: Number(formData.get("salaireMensuel")) || 0,
        devise: String(formData.get("devise") ?? "USD"),
        poste: String(formData.get("poste") ?? ""),
        documentUrl,
        agence,
        coutJourUSD: type === "INTERIM" && Number.isFinite(coutJour) && coutJour > 0 ? coutJour : null,
      },
    });
    // La fiche employé affiche le type du contrat courant.
    await prisma.employee.update({ where: { id: employeeId }, data: { contrat: type } });

    await journaliser(prisma, {
      entite: "Contrat",
      entiteId: employeeId,
      champ: "creation",
      nouvelleValeur: String(formData.get("type")),
      userId: user.id,
    });

    revalidatePath(`/employes/${employeeId}`);

  });
}

/**
 * Modifie le salaire/poste d'un employé en conservant l'historique salarial
 * (le prompt exige la traçabilité des promotions et changements de salaire).
 */
export async function changerSalaire(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const nouveauSalaire = Number(formData.get("nouveauSalaire"));
    const nouveauPoste = String(formData.get("nouveauPoste") ?? "").trim() || employee.poste;
    const motif = String(formData.get("motif") ?? "Ajustement");

    await prisma.$transaction(async (tx) => {
      await tx.historiqueSalaire.create({
        data: {
          employeeId,
          ancienSalaire: employee.salaireMensuel,
          nouveauSalaire,
          ancienPoste: employee.poste,
          nouveauPoste,
          motif,
          decideParId: user.id,
        },
      });
      await tx.employee.update({
        where: { id: employeeId },
        data: { salaireMensuel: nouveauSalaire, poste: nouveauPoste },
      });
      await journaliser(tx, {
        entite: "Employee",
        entiteId: employeeId,
        champ: "salaireMensuel",
        ancienneValeur: employee.salaireMensuel.toString(),
        nouvelleValeur: String(nouveauSalaire),
        userId: user.id,
      });
    });

    revalidatePath(`/employes/${employeeId}`);

  });
}

export async function ajouterDisciplinaire(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    await prisma.dossierDisciplinaire.create({
      data: {
        employeeId,
        type: String(formData.get("type")) as TypeDisciplinaire,
        date: new Date(String(formData.get("date"))),
        motif: String(formData.get("motif") ?? ""),
        description: String(formData.get("description") ?? "").trim() || null,
        documentUrl: String(formData.get("documentUrl") ?? "").trim() || null,
        emisParId: user.id,
      },
    });

    await journaliser(prisma, {
      entite: "DossierDisciplinaire",
      entiteId: employeeId,
      champ: "creation",
      nouvelleValeur: String(formData.get("type")),
      userId: user.id,
    });

    revalidatePath(`/employes/${employeeId}`);

  });
}

export async function ajouterEvaluation(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const noteRaw = String(formData.get("note") ?? "").trim();

    await prisma.evaluation.create({
      data: {
        employeeId,
        date: new Date(String(formData.get("date"))),
        note: noteRaw ? Number(noteRaw) : null,
        commentaire: String(formData.get("commentaire") ?? "").trim() || null,
        evaluateur: String(formData.get("evaluateur") ?? "").trim() || user.nom,
        documentUrl: String(formData.get("documentUrl") ?? "").trim() || null,
      },
    });

    revalidatePath(`/employes/${employeeId}`);

  });
}

const BUCKET_DOCS = "employes";
// Type MIME par extension : le bucket restreint les types autorisés, et le navigateur renvoie
// souvent un file.type vide (Word/PDF) → « octet-stream » refusé. On force le bon type d'après l'extension.
const MIME_PAR_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const EXT_DOC_OK = Object.keys(MIME_PAR_EXT);

/** Téléverse un fichier vers le bucket privé et renvoie son lien applicatif /fichiers/… (session requise). */
async function televerserFichier(employeeId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!EXT_DOC_OK.includes(ext))
    throw new Error("Format non supporté (PDF, image, Word ou Excel).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Fichier trop lourd (max 15 Mo).");

  const path = `documents/${employeeId}-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!base || !key) throw new Error("Stockage non configuré (variables Supabase manquantes).");
  const res = await fetch(`${base}/storage/v1/object/${BUCKET_DOCS}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": MIME_PAR_EXT[ext] ?? file.type ?? "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Échec du téléversement (${res.status})${detail ? ` : ${detail.slice(0, 200)}` : ""}`);
  }
  return `/fichiers/${path}`;
}

export async function ajouterDocument(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    // Fichier téléversé prioritaire, sinon URL fournie (rétrocompatibilité).
    const file = formData.get("fichier");
    let fichierUrl = String(formData.get("fichierUrl") ?? "").trim();
    if (file instanceof File && file.size > 0) {
      fichierUrl = await televerserFichier(employeeId, file);
    }
    if (!fichierUrl) throw new Error("Ajoutez un fichier ou une URL.");

    await prisma.documentEmploye.create({
      data: {
        employeeId,
        type: String(formData.get("type")) as TypeDocument,
        nom: String(formData.get("nom") ?? ""),
        fichierUrl,
        dateEmission: date(formData, "dateEmission"),
        dateExpiration: date(formData, "dateExpiration"),
        importeParId: user.id,
      },
    });

    revalidatePath(`/employes/${employeeId}`);

  });
}

/** Joint (ou remplace) le fichier d'un contrat EXISTANT — PDF, Word… Réservé à la Direction. */
export async function attacherFichierContrat(employeeId: string, contratId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const fichier = formData.get("fichier");
    if (!(fichier instanceof File) || fichier.size === 0) throw new Error("Aucun fichier sélectionné.");
    const contrat = await prisma.contrat.findUniqueOrThrow({ where: { id: contratId }, select: { employeeId: true, documentUrl: true } });
    if (contrat.employeeId !== employeeId) throw new Error("Contrat introuvable pour cet employé.");

    const documentUrl = await televerserFichier(employeeId, fichier);
    await prisma.contrat.update({ where: { id: contratId }, data: { documentUrl } });
    await journaliser(prisma, {
      entite: "Contrat", entiteId: contratId, champ: "documentUrl",
      ancienneValeur: contrat.documentUrl ? "remplacé" : null, nouvelleValeur: "joint", userId: user.id,
    });
    revalidatePath(`/employes/${employeeId}`);

  });
}
