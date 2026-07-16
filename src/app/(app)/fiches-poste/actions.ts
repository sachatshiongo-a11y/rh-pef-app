"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { formulaireLisible } from "@/lib/erreur-formulaire";

const BUCKET = "employes";
const EXT_OK = ["pdf", "doc", "docx"];

/** Téléverse une fiche de poste (PDF/Word) vers Supabase Storage et renvoie son URL publique. */
async function televerserFiche(poste: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!EXT_OK.includes(ext)) throw new Error("Format non supporté (PDF ou Word uniquement).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Fichier trop lourd (max 15 Mo).");

  const slug = poste.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const path = `fiches-poste/${slug || "poste"}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).toLowerCase();
    if (res.status === 413 || detail.includes("exceeded") || detail.includes("size"))
      throw new Error("Fichier trop volumineux (max 15 Mo).");
    if (detail.includes("mime") || detail.includes("415"))
      throw new Error("Type de fichier non accepté par le stockage (PDF ou Word attendu).");
    throw new Error("Le téléversement du fichier a échoué. Réessayez.");
  }
  return `/fichiers/${path}`; // bucket privé — servi derrière session
}

/** Crée un nouvel intitulé de poste (fiche vide, à documenter ensuite). Admin/Manager. */
export async function creerPoste(formData: FormData) {
  await formulaireLisible("/fiches-poste", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const poste = String(formData.get("poste") ?? "").trim();
    if (!poste) redirect(`/fiches-poste?erreur=${encodeURIComponent("Indiquez un intitulé de poste.")}`);

    // Existe déjà comme fiche ou comme poste d'un employé ? On ne crée pas de doublon.
    const [existeFiche, existeEmploye] = await Promise.all([
      prisma.fichePoste.findUnique({ where: { poste } }),
      prisma.employee.findFirst({ where: { poste }, select: { id: true } }),
    ]);
    if (existeFiche || existeEmploye) {
      redirect(`/fiches-poste?erreur=${encodeURIComponent(`Le poste « ${poste} » existe déjà.`)}`);
    }

    await prisma.fichePoste.create({ data: { poste, creeParId: user.id } });
    await journaliser(prisma, { entite: "FichePoste", entiteId: poste, champ: "creation", nouvelleValeur: "poste créé", userId: user.id });

    revalidatePath("/fiches-poste");
    revalidatePath("/employes");
    redirect(`/fiches-poste?msg=${encodeURIComponent(`Poste « ${poste} » créé. Vous pouvez le documenter et l'affecter à un employé.`)}`);

  });
}

/** Crée ou met à jour la fiche d'un poste (description + fichier optionnel). Admin/Manager. */
export async function enregistrerFichePoste(formData: FormData) {
  await formulaireLisible("/fiches-poste", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const poste = String(formData.get("poste") ?? "").trim();
    if (!poste) redirect(`/fiches-poste?erreur=${encodeURIComponent("Intitulé de poste manquant.")}`);

    // Les erreurs (format/taille refusés, échec de téléversement…) sont renvoyées à la page sous
    // forme de message lisible plutôt que de faire planter la page en « server error ».
    let erreur: string | null = null;
    try {
      const description = String(formData.get("description") ?? "").trim() || null;
      const existante = await prisma.fichePoste.findUnique({ where: { poste } });

      let fichierUrl = existante?.fichierUrl ?? null;
      let fichierNom = existante?.fichierNom ?? null;
      const file = formData.get("fichier");
      if (file instanceof File && file.size > 0) {
        fichierUrl = await televerserFiche(poste, file);
        fichierNom = file.name;
      }

      await prisma.fichePoste.upsert({
        where: { poste },
        create: { poste, description, fichierUrl, fichierNom, creeParId: user.id },
        update: { description, fichierUrl, fichierNom },
      });

      await journaliser(prisma, {
        entite: "FichePoste",
        entiteId: poste,
        champ: existante ? "modification" : "creation",
        nouvelleValeur: `${description ? "description" : "—"}${fichierNom ? ` + ${fichierNom}` : ""}`,
        userId: user.id,
      });
    } catch (e) {
      erreur = e instanceof Error ? e.message : "Erreur lors de l'enregistrement de la fiche.";
    }

    if (erreur) redirect(`/fiches-poste?erreur=${encodeURIComponent(erreur)}`);
    revalidatePath("/fiches-poste");
    redirect(`/fiches-poste?msg=${encodeURIComponent(`Fiche du poste « ${poste} » enregistrée.`)}`);

  });
}

const STOPWORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "aux", "au", "un", "une", "pour", "fiche", "poste", "pef"]);

/** Normalise une chaîne (sans accents, minuscules) en une liste de mots significatifs (≥ 3 lettres, hors mots vides). */
function motsSignificatifs(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 3 && !STOPWORDS.has(m));
}

/**
 * Reconnaît le poste d'un fichier d'après son nom : on retient le poste dont TOUS les mots
 * significatifs apparaissent dans le nom du fichier, en privilégiant le plus spécifique
 * (le plus de mots reconnus). Renvoie null si aucune correspondance fiable.
 */
function reconnaitrePoste(nomFichier: string, postes: string[]): string | null {
  const motsFichier = new Set(motsSignificatifs(nomFichier));
  let meilleur: { poste: string; score: number } | null = null;
  for (const poste of postes) {
    const motsPoste = motsSignificatifs(poste);
    if (motsPoste.length === 0) continue;
    if (motsPoste.every((m) => motsFichier.has(m))) {
      if (!meilleur || motsPoste.length > meilleur.score) meilleur = { poste, score: motsPoste.length };
    }
  }
  return meilleur?.poste ?? null;
}

/**
 * Importe plusieurs fiches d'un coup : chaque fichier est rattaché automatiquement au poste
 * reconnu d'après son nom. Les fichiers non reconnus sont signalés à l'utilisateur. Admin/Manager.
 */
export async function importerFichesEnMasse(formData: FormData) {
  await formulaireLisible("/fiches-poste", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
    if (fichiers.length === 0) redirect(`/fiches-poste?erreur=${encodeURIComponent("Aucun fichier sélectionné.")}`);

    // Liste des postes connus (employés actifs + fiches existantes).
    const [employes, fiches] = await Promise.all([
      prisma.employee.findMany({ where: { actif: true }, select: { poste: true } }),
      prisma.fichePoste.findMany({ select: { poste: true } }),
    ]);
    const postes = [...new Set([...employes.map((e) => e.poste.trim()), ...fiches.map((f) => f.poste)])].filter(Boolean);

    const importes: string[] = [];
    const nonReconnus: string[] = [];
    const echecs: string[] = [];

    for (const file of fichiers) {
      const poste = reconnaitrePoste(file.name, postes);
      if (!poste) {
        nonReconnus.push(file.name);
        continue;
      }
      try {
        const url = await televerserFiche(poste, file);
        const existante = await prisma.fichePoste.findUnique({ where: { poste } });
        await prisma.fichePoste.upsert({
          where: { poste },
          create: { poste, description: null, fichierUrl: url, fichierNom: file.name, creeParId: user.id },
          update: { fichierUrl: url, fichierNom: file.name },
        });
        await journaliser(prisma, {
          entite: "FichePoste", entiteId: poste, champ: existante ? "import (maj)" : "import (creation)",
          nouvelleValeur: file.name, userId: user.id,
        });
        importes.push(`${poste} ← ${file.name}`);
      } catch (e) {
        echecs.push(`${file.name} (${e instanceof Error ? e.message : "échec"})`);
      }
    }

    revalidatePath("/fiches-poste");
    revalidatePath("/documents");

    const parts: string[] = [];
    if (importes.length) parts.push(`${importes.length} fiche(s) importée(s) : ${importes.join(" ; ")}.`);
    if (nonReconnus.length) parts.push(`${nonReconnus.length} fichier(s) non reconnu(s) — à renseigner manuellement : ${nonReconnus.join(", ")}.`);
    if (echecs.length) parts.push(`${echecs.length} échec(s) : ${echecs.join(", ")}.`);
    const cle = nonReconnus.length || echecs.length ? "erreur" : "msg";
    redirect(`/fiches-poste?${cle}=${encodeURIComponent(parts.join(" ") || "Aucune fiche importée.")}`);

  });
}

/** Renomme un intitulé de poste partout où il est utilisé (employés, contrats, fiche, besoins,
 *  polyvalences). L'historique des changements de poste (HistoriqueSalaire) n'est pas réécrit.
 *  Admin/Manager. */
export async function renommerPoste(formData: FormData) {
  await formulaireLisible("/fiches-poste", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const ancien = String(formData.get("poste") ?? "").trim();
    const nouveau = String(formData.get("nouveau") ?? "").trim();
    if (!ancien) redirect(`/fiches-poste?erreur=${encodeURIComponent("Poste introuvable.")}`);
    if (!nouveau) redirect(`/fiches-poste?erreur=${encodeURIComponent("Indiquez le nouveau nom du poste.")}`);
    if (nouveau === ancien) redirect(`/fiches-poste?msg=${encodeURIComponent("Le nom est inchangé.")}`);

    // Refuse la fusion accidentelle : le nouveau nom ne doit pas déjà exister ailleurs.
    const [fEmp, fFiche, fContrat, fBesoin, fPoly] = await Promise.all([
      prisma.employee.findFirst({ where: { poste: nouveau }, select: { id: true } }),
      prisma.fichePoste.findUnique({ where: { poste: nouveau }, select: { id: true } }),
      prisma.contrat.findFirst({ where: { poste: nouveau }, select: { id: true } }),
      prisma.besoinShift.findFirst({ where: { poste: nouveau }, select: { id: true } }),
      prisma.polyvalencePoste.findFirst({ where: { OR: [{ posteSource: nouveau }, { posteCible: nouveau }] }, select: { id: true } }),
    ]);
    if (fEmp || fFiche || fContrat || fBesoin || fPoly) {
      redirect(`/fiches-poste?erreur=${encodeURIComponent(`Le poste « ${nouveau} » existe déjà. Choisissez un autre nom.`)}`);
    }

    await prisma.$transaction([
      prisma.employee.updateMany({ where: { poste: ancien }, data: { poste: nouveau } }),
      prisma.contrat.updateMany({ where: { poste: ancien }, data: { poste: nouveau } }),
      prisma.fichePoste.updateMany({ where: { poste: ancien }, data: { poste: nouveau } }),
      prisma.besoinShift.updateMany({ where: { poste: ancien }, data: { poste: nouveau } }),
      prisma.polyvalencePoste.updateMany({ where: { posteSource: ancien }, data: { posteSource: nouveau } }),
      prisma.polyvalencePoste.updateMany({ where: { posteCible: ancien }, data: { posteCible: nouveau } }),
    ]);
    await journaliser(prisma, { entite: "FichePoste", entiteId: nouveau, champ: "renommage", ancienneValeur: ancien, nouvelleValeur: nouveau, userId: user.id });

    revalidatePath("/fiches-poste");
    revalidatePath("/employes");
    revalidatePath("/planning");
    redirect(`/fiches-poste?msg=${encodeURIComponent(`Poste « ${ancien} » renommé en « ${nouveau} ».`)}`);

  });
}

/** Supprime entièrement un intitulé de poste (fiche + besoins + polyvalences liés). Bloqué s'il
 *  reste des salariés à ce poste. Admin. */
export async function supprimerPoste(poste: string) {
  await formulaireLisible("/fiches-poste", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const nb = await prisma.employee.count({ where: { poste } });
    if (nb > 0) {
      redirect(`/fiches-poste?erreur=${encodeURIComponent(`Impossible de supprimer « ${poste} » : ${nb} salarié(s) l'occupent encore. Renommez-les ou réaffectez-les d'abord.`)}`);
    }

    await prisma.$transaction([
      prisma.fichePoste.deleteMany({ where: { poste } }),
      prisma.besoinShift.deleteMany({ where: { poste } }),
      prisma.polyvalencePoste.deleteMany({ where: { OR: [{ posteSource: poste }, { posteCible: poste }] } }),
    ]);
    await journaliser(prisma, { entite: "FichePoste", entiteId: poste, champ: "suppression du poste", ancienneValeur: poste, userId: user.id });

    revalidatePath("/fiches-poste");
    revalidatePath("/employes");
    revalidatePath("/planning");
    redirect(`/fiches-poste?msg=${encodeURIComponent(`Poste « ${poste} » supprimé.`)}`);

  });
}

/** Supprime la fiche d'un poste (la description et le lien ; le fichier reste dans Storage). Admin. */
export async function supprimerFichePoste(poste: string) {
  await formulaireLisible("/fiches-poste", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);
    const existante = await prisma.fichePoste.findUnique({ where: { poste } });
    if (!existante) return;
    await prisma.fichePoste.delete({ where: { poste } });
    await journaliser(prisma, {
      entite: "FichePoste",
      entiteId: poste,
      champ: "suppression",
      ancienneValeur: existante.fichierNom ?? "fiche",
      userId: user.id,
    });
    revalidatePath("/fiches-poste");

  });
}
