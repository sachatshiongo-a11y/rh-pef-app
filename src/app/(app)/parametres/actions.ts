"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { decSaisi, decSaisiOptionnel } from "@/lib/nombre";

/** Téléverse une image (logo/signature) vers Supabase Storage (bucket privé). PNG/JPG, max 5 Mo. */
async function televerserImageEntreprise(dossier: string, file: File): Promise<{ url: string; nom: string }> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!["png", "jpg", "jpeg"].includes(ext)) throw new Error("Image PNG ou JPG uniquement.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image trop lourde (max 5 Mo).");
  const path = `parametres/${dossier}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/employes/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error("Le téléversement de l'image a échoué. Réessayez.");
  return { url: `/fichiers/${path}`, nom: file.name };
}

/** Modèle de checklist d'intégration (onboarding) : une tâche par ligne. Admin. */
export async function mettreAJourModeleOnboarding(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const lignes = String(formData.get("taches") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  await prisma.$transaction([
    prisma.modeleTacheOnboarding.deleteMany({}),
    prisma.modeleTacheOnboarding.createMany({ data: lignes.map((libelle, i) => ({ libelle, ordre: i + 1 })) }),
  ]);
  revalidatePath("/parametres");
}

/** Identité de l'entreprise (en-tête/pied des documents) : coordonnées, logo, signature. Admin. */
export async function mettreAJourEntreprise(formData: FormData) {
  await formulaireLisible("/parametres", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const t = (n: string) => String(formData.get(n) ?? "").trim() || null;
    const existante = await prisma.paramEntreprise.findUnique({ where: { id: "singleton" } });

    let logoUrl = existante?.logoUrl ?? null, logoNom = existante?.logoNom ?? null;
    let signatureUrl = existante?.signatureUrl ?? null, signatureNom = existante?.signatureNom ?? null;
    const logo = formData.get("logo");
    if (logo instanceof File && logo.size > 0) { const r = await televerserImageEntreprise("logo", logo); logoUrl = r.url; logoNom = r.nom; }
    const sig = formData.get("signature");
    if (sig instanceof File && sig.size > 0) { const r = await televerserImageEntreprise("signature", sig); signatureUrl = r.url; signatureNom = r.nom; }

    const data = {
      nom: t("nom"), enseigne: t("enseigne"), telephone: t("telephone"), email: t("email"), site: t("site"),
      adresse: t("adresse"), lieuTravail: t("lieuTravail"), pays: t("pays"), compteBancaire: t("compteBancaire"),
      rccm: t("rccm"), idNat: t("idNat"), numImpot: t("numImpot"), logoUrl, logoNom, signatureUrl, signatureNom,
    };
    await prisma.paramEntreprise.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });

    revalidatePath("/parametres");
    revalidatePath("/", "layout");
  });
}

/** Paramètres opérationnels (non légaux) : taux de change et période courante. */
export async function mettreAJourConfig(formData: FormData) {
  await formulaireLisible("/parametres", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    // Champs de texte lus à la française (« 2.350 » = 2350, « 2,5 » = 2,5) ; une saisie illisible
    // lève une erreur lisible (affichée en tête de page) au lieu de devenir 0.
    const tauxChangeCDF = decSaisi(formData.get("tauxChangeCDF"), "Taux de change");
    if (!(tauxChangeCDF > 0)) throw new Error("Le taux de change doit être un nombre positif (ex. 2 350).");
    const moisCourant = decSaisi(formData.get("moisCourant"), "Mois en cours");
    if (!Number.isInteger(moisCourant) || moisCourant < 1 || moisCourant > 12) throw new Error("Le mois en cours doit être un entier de 1 à 12.");
    const anneeCourante = decSaisi(formData.get("anneeCourante"), "Année en cours");
    if (!Number.isInteger(anneeCourante) || anneeCourante < 2000 || anneeCourante > 2100) throw new Error("L'année en cours doit être un entier à 4 chiffres (ex. 2026).");
    // Jour de paie : vide = 30 (défaut de la base) ; hors 1-31 ou décimal = refusé (plus d'arrondi silencieux).
    const jourPaieSaisi = decSaisiOptionnel(formData.get("jourPaie"), "Jour de paie");
    if (jourPaieSaisi !== null && (!Number.isInteger(jourPaieSaisi) || jourPaieSaisi < 1 || jourPaieSaisi > 31)) throw new Error("Le jour de paie doit être un entier de 1 à 31.");
    const jourPaie = jourPaieSaisi ?? 30;
    // Quitter un mois CLÔTURÉ qui garde une ligne rouverte (salarié toujours calculé) en attente de
    // re-validation : elle deviendrait « hors calcul » (mois passé clôturé, paie-hors-calcul.ts),
    // sortirait des totaux et des déclarations et ne serait plus validable depuis /paie. Refusé.
    const avant = await prisma.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
    if (avant && (avant.moisCourant !== moisCourant || avant.anneeCourante !== anneeCourante)) {
      const run = await prisma.payrollRun.findUnique({
        where: { mois_annee: { mois: avant.moisCourant, annee: avant.anneeCourante } },
        select: { statut: true, lignes: { where: { statutPaiement: "PAS_VALIDE" }, select: { id: true, employeeId: true, statutPaiement: true, employee: { select: { nom: true } } } } },
      });
      if (run?.statut === "VALIDE") {
        const enAttente = await lignesComptees(prisma, run.lignes);
        if (enAttente.length > 0) {
          throw new Error(`La paie du mois en cours est clôturée mais ${enAttente.length} bulletin(s) rouvert(s) attendent d'être revalidés (${enAttente.map((l) => l.employee.nom).join(", ")}) : revalidez-les dans Paie avant de changer de mois.`);
        }
      }
    }

    await prisma.config.update({
      where: { id: "singleton" },
      data: {
        tauxChangeCDF,
        anneeCourante,
        moisCourant,
        jourPaie,
      },
    });

    revalidatePath("/parametres");
    revalidatePath("/accueil");
  });
}

/** Active / désactive l'espace salarié (self-service). Réservé à l'ADMIN. OFF par défaut. */
export async function basculerEspaceEmploye(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const actif = String(formData.get("actif")) === "1";
  await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: actif } });
  revalidatePath("/parametres");
  revalidatePath("/", "layout");
}

/**
 * Bascule « salaires saisis en net » (ADMIN). Interrupteur DÉDIÉ (et non un champ numérique perdu
 * dans la liste des paramètres légaux, où il pouvait être remis à 0 par erreur) : quand actif, le
 * moteur reconstitue le brut à partir du salaire net saisi. Upsert sur l'exercice fiscal actif.
 */
export async function basculerSalairesEnNet(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const actif = String(formData.get("actif")) === "1";
  const exercice = await prisma.exerciceFiscal.findFirstOrThrow({ where: { actif: true } });
  await prisma.parametreLegal.upsert({
    where: { exerciceId_cle: { exerciceId: exercice.id, cle: "salaires_saisis_en_net" } },
    update: { valeur: actif ? 1 : 0 },
    create: {
      exerciceId: exercice.id,
      cle: "salaires_saisis_en_net",
      valeur: actif ? 1 : 0,
      unite: "choix",
      libelle: "Salaires saisis interprétés comme des NETS (reconstitution du brut)",
      commentaire: "Basculer via l'interrupteur dédié. À valider par un comptable.",
    },
  });
  revalidatePath("/parametres");
  revalidatePath("/", "layout");
}

/**
 * Paramètres légaux versionnés — modification réservée à l'ADMIN (le directeur).
 * Toute modification remet le statut à « À VALIDER » sauf validation explicite.
 */
export async function mettreAJourParametreLegal(id: number, formData: FormData) {
  await formulaireLisible("/parametres", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    // Lu à la française (« 150.000 » = 150 000, « 0,05 » = 0,05) ; illisible → erreur en tête de page.
    const valeur = decSaisiOptionnel(formData.get("valeur"), "Valeur du paramètre");
    const valider = formData.get("valider") === "on";

    await prisma.parametreLegal.update({
      where: { id },
      data: {
        valeur,
        statutValidation: valider ? "VALIDE" : "A_VALIDER",
      },
    });

    revalidatePath("/parametres");
  });
}

export async function mettreAJourTrancheIprCDF(id: number, formData: FormData) {
  await formulaireLisible("/parametres", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const plafondAnnuelCDF = decSaisiOptionnel(formData.get("plafondAnnuelCDF"), "Plafond annuel");
    // Le taux est obligatoire : vide = oubli, pas 0 (avant : « Number("null") » → NaN rejeté par la base).
    const taux = decSaisiOptionnel(formData.get("taux"), "Taux");
    if (taux === null) throw new Error("Le taux de la tranche est requis (ex. 0,03 pour 3 %).");
    const valider = formData.get("valider") === "on";

    await prisma.trancheIprCDF.update({
      where: { id },
      data: {
        plafondAnnuelCDF,
        taux,
        statutValidation: valider ? "VALIDE" : "A_VALIDER",
      },
    });

    revalidatePath("/parametres");
  });
}

export async function ajouterJourFerie(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const date = new Date(String(formData.get("date")));
  const designation = String(formData.get("designation"));

  await prisma.jourFerie.create({
    data: { date, designation, annee: date.getFullYear() },
  });

  revalidatePath("/parametres");
}

export async function supprimerJourFerie(id: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.jourFerie.delete({ where: { id } });
  revalidatePath("/parametres");
}
