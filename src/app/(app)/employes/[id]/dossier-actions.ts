"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, invaliderProfil } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";
import { chargerParametresPaie } from "@/lib/config";
import { reconstituerBrutDepuisNet } from "@/lib/payroll";
import type {
  TypeContrat,
  TypeDisciplinaire,
  TypeDocument,
} from "@prisma/client";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { notifierContratASigner } from "@/lib/contrats-notification";
import { decSaisi, decSaisiOptionnel } from "@/lib/nombre";
import { enregistrerChangementSalaire } from "@/lib/historique-salaire";
import { canonique, changementsProposes, messagePerime, type Changement } from "@/lib/fiche-sensible";
import { creerDemandeFicheTx, estDirection, notifierNouvelleDemandeFiche, recopierContratSurFicheTx, verrouillerFiche } from "@/lib/demandes-fiche";
import { chargerReprisesSolde } from "@/lib/solde-tout-compte";
import { formaterUSD } from "@/lib/montant";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa } from "@/lib/heure-kinshasa";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fin de contrat (démission / licenciement / fin CDD) + solde de tout compte.
 * ⚠️ Les indemnités LÉGALES (préavis, licenciement) sont SAISIES par l'utilisateur (jamais
 * inventées) et à faire valider par un juriste — droit du travail RDC. Le logiciel ne calcule
 * mécaniquement que le salaire au prorata et l'indemnité de congés non pris.
 *
 * Audit paie du 2026-10-10 — acte grave, UNITAIRE, tracé :
 *  - UNE transaction (fiche verrouillée) : solde archivé, prêts repris, contrats résiliés, fiche et
 *    compte désactivés — tout ou rien ;
 *  - refus si le salarié est déjà inactif, ou si une fin de contrat est déjà enregistrée depuis son
 *    embauche (double clic, second onglet : jamais deux soldes) ;
 *  - le solde REPREND le reste des prêts en cours et les acomptes approuvés non retenus
 *    (`chargerReprisesSolde`, les mêmes chiffres que l'écran : un écart depuis l'affichage refuse) ;
 *    un net à verser négatif est refusé — la Direction décide (annuler le prêt, accord de
 *    remboursement) avant d'archiver ;
 *  - un bulletin du mois déjà validé ou payé est SIGNALÉ à l'écran (double paiement possible), la
 *    paie n'est jamais recalculée ici. CNSS/IPR sur le solde : non traités, avertissement affiché.
 */
export async function terminerContrat(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const motif = String(formData.get("motif") ?? "AUTRE");
    const dateFin = new Date(String(formData.get("dateFin")));
    if (Number.isNaN(dateFin.getTime())) throw new Error("Date de fin invalide : choisissez un jour du calendrier.");
    // Saisies lues à la française (« 1 250,5 »), erreur lisible si illisible — jamais un zéro silencieux
    // dans un solde de tout compte. Les minimums du champ natif (>= 0) sont repris ici.
    const positif = (nom: string, libelle: string) => {
      const n = decSaisi(formData.get(nom), libelle);
      if (n < 0) throw new Error(`${libelle} : une valeur négative n'est pas permise.`);
      return n;
    };
    const entier = (n: number, libelle: string) => {
      if (!Number.isInteger(n)) throw new Error(`${libelle} : un nombre entier de jours est attendu.`);
      return n;
    };
    const joursTravaillesMois = entier(positif("joursTravaillesMois", "Jours de présence"), "Jours de présence");
    const joursCongesNonPris = positif("joursCongesNonPris", "Jours de congés non pris");
    const preavisJours = entier(positif("preavisJours", "Préavis (jours)"), "Préavis (jours)");
    const indemniteLicenciementUSD = positif("indemniteLicenciementUSD", "Indemnité de licenciement");
    const autresUSD = positif("autresUSD", "Autres indemnités");
    const commentaire = String(formData.get("commentaire") ?? "").trim() || null;
    // Reprises que l'écran a MONTRÉES (champs cachés) : revérifiées au centime dans la transaction.
    const repriseAffichee = (nom: string) => {
      const v = String(formData.get(nom) ?? "").trim();
      return v === "" ? null : Number(v);
    };
    const reprisePretAffichee = repriseAffichee("reprisePretUSD");
    const repriseAcomptesAffichee = repriseAffichee("repriseAcomptesUSD");

    const parametres = await chargerParametresPaie();
    const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
    const periode = { mois: config?.moisCourant ?? numeroMoisCourantKinshasa(), annee: config?.anneeCourante ?? anneeCouranteKinshasa() };

    const compte = await prisma.$transaction(async (tx) => {
      // Fiche verrouillée : deux soldes concurrents (double clic, deux onglets) s'attendent ; le second
      // lit la fiche déjà désactivée et refuse.
      await tx.$queryRaw`SELECT "id" FROM "public"."Employee" WHERE "id" = ${employeeId} FOR UPDATE`;
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      if (!employee.actif) {
        throw new Error(`${employee.nom} n'est plus actif : son contrat est déjà terminé. Un seul solde de tout compte par départ — rien n'a été enregistré.`);
      }
      const dejaFin = await tx.finContrat.findFirst({
        where: { employeeId, dateFin: { gte: employee.dateEmbauche } },
        orderBy: { createdAt: "desc" },
        select: { dateFin: true },
      });
      if (dejaFin) {
        throw new Error(`Une fin de contrat au ${dejaFin.dateFin.toISOString().slice(0, 10).split("-").reverse().join("/")} est déjà enregistrée pour ${employee.nom} depuis son embauche : rien n'a été enregistré.`);
      }

      // Solde de tout compte sur la base BRUTE (décision client 2026-07-22) : si les salaires sont
      // saisis en net (`salairesSaisisEnNet`), on reconstitue d'abord le brut mensuel puis on le divise
      // par les jours ouvrables → journalier BRUT, base légale RDC pour prorata et indemnités. Sinon
      // (flag inactif), `salaireMensuel` est déjà un brut. NB : aucune CNSS/IPR n'est déduite du solde
      // lui-même — À FAIRE VALIDER PAR UN JURISTE/COMPTABLE (avertissement affiché sur le formulaire).
      const baseMensuelleUSD = parametres.salairesSaisisEnNet
        ? reconstituerBrutDepuisNet(Number(employee.salaireMensuel), parametres, employee.enfants)
        : Number(employee.salaireMensuel);
      const salaireJournalier = r2(baseMensuelleUSD / parametres.joursOuvrablesMois);
      const salaireProrataUSD = r2(salaireJournalier * joursTravaillesMois);
      const indemniteCongesUSD = r2(salaireJournalier * joursCongesNonPris);
      const indemnitePreavisUSD = r2(salaireJournalier * preavisJours);
      const totalUSD = r2(
        salaireProrataUSD + indemniteCongesUSD + indemnitePreavisUSD + indemniteLicenciementUSD + autresUSD
      );

      const reprises = await chargerReprisesSolde(tx, employeeId, periode);
      const ecart = (affichee: number | null, calculee: number) => affichee !== null && Math.round(affichee * 100) !== Math.round(calculee * 100);
      if (ecart(reprisePretAffichee, reprises.reprisePretUSD) || ecart(repriseAcomptesAffichee, reprises.repriseAcomptesUSD)) {
        throw new Error("Le reste des prêts ou les acomptes à reprendre ont changé depuis l'affichage : rechargez la fiche et relisez le solde. Rien n'a été enregistré.");
      }
      const netAVerserUSD = r2(totalUSD - reprises.reprisePretUSD - reprises.repriseAcomptesUSD);
      if (netAVerserUSD < 0) {
        throw new Error(`Le reste des prêts (${formaterUSD(reprises.reprisePretUSD)}) et les acomptes non retenus (${formaterUSD(reprises.repriseAcomptesUSD)}) dépassent le solde (${formaterUSD(totalUSD)}) : ${formaterUSD(-netAVerserUSD)} resteraient dus par ${employee.nom}. À la Direction de décider (annuler le prêt, accord de remboursement) avant d'archiver — rien n'a été enregistré.`);
      }

      await tx.finContrat.create({
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
          reprisePretUSD: reprises.reprisePretUSD,
          repriseAcomptesUSD: reprises.repriseAcomptesUSD,
          commentaire,
          creeParId: user.id,
        },
      });

      // Prêts repris : soldés par le solde de tout compte (tracé ; aucune retenue de paie inventée).
      for (const p of reprises.prets) {
        await tx.pretPersonnel.update({ where: { id: p.id }, data: { statut: "SOLDE" } });
        await journaliser(tx, { entite: "PretPersonnel", entiteId: p.id, champ: "statut", ancienneValeur: "EN_COURS", nouvelleValeur: `SOLDE — ${formaterUSD(p.resteUSD)} repris au solde de tout compte`, userId: user.id });
      }

      // Sortie de l'employé : contrats actifs résiliés + employé désactivé (jamais supprimé).
      await tx.contrat.updateMany({ where: { employeeId, statut: "ACTIF" }, data: { statut: "RESILIE" } });
      await tx.employee.update({ where: { id: employeeId }, data: { actif: false } });

      // Sécurité : couper l'accès du compte lié (espace salarié / stock) — l'ex-salarié ne doit plus
      // pouvoir se connecter. Le compte n'est pas supprimé (réactivable si erreur).
      const compteLie = await tx.user.findUnique({ where: { employeeId }, select: { id: true, actif: true } });
      if (compteLie?.actif) await tx.user.update({ where: { id: compteLie.id }, data: { actif: false } });

      const reprisesTexte = [
        reprises.reprisePretUSD > 0 ? `prêt repris ${formaterUSD(reprises.reprisePretUSD)}` : null,
        reprises.repriseAcomptesUSD > 0 ? `acomptes repris ${formaterUSD(reprises.repriseAcomptesUSD)}` : null,
      ].filter(Boolean).join(", ");
      await journaliser(tx, {
        entite: "Employee",
        entiteId: employeeId,
        champ: "finContrat",
        nouvelleValeur: `${motif} — solde ${totalUSD.toFixed(2)} $${reprisesTexte ? ` (${reprisesTexte} ; net à verser ${netAVerserUSD.toFixed(2)} $)` : ""}${reprises.bulletinFigeDuMois ? ` · bulletin du mois déjà ${reprises.bulletinFigeDuMois.statut === "PAYE" ? "payé" : "validé"}` : ""}${compteLie?.actif ? " · compte désactivé" : ""}`,
        userId: user.id,
      });
      return compteLie?.actif ? compteLie : null;
    }, { timeout: 30_000 });

    if (compte) invaliderProfil(compte.id); // après le commit : la session est refusée à la prochaine requête

    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/employes");
    revalidatePath("/paie");

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
    const coutJour = decSaisi(formData.get("coutJourUSD"), "Coût / jour facturé");
    if (type === "INTERIM" && !agence) throw new Error("Pour un intérimaire, indiquez l'agence d'intérim (c'est elle qui l'emploie et le paie).");

    // CLÔTURE PROPOSÉE du contrat en cours (spec 2026-09-28, §3.4) : la case du formulaire, jamais
    // une déduction. Cochée, l'ancien contrat passe en Transformé ou Résilié (au choix) DANS LA MÊME
    // TRANSACTION que la création — jamais un nouveau contrat à côté d'un ancien resté ACTIF parce
    // que la seconde écriture aurait échoué, ni l'inverse.
    const cloturerId = formData.get("cloturer") === "on" ? String(formData.get("cloturerContratId") ?? "").trim() || null : null;
    const statutCloture = String(formData.get("statutCloture") ?? "TRANSFORME");
    if (cloturerId && statutCloture !== "TRANSFORME" && statutCloture !== "RESILIE") {
      throw new Error("Le contrat en cours se clôture en Transformé ou Résilié.");
    }
    // Clôturer l'ancien contrat le fait sortir (Transformé / Résilié) : même règle que
    // `terminerContrat` et `rompreContrat`, réservé à la Direction (arbitrage du 2026-10-01). Sans
    // clôture, le responsable ajoute un contrat comme avant.
    if (cloturerId) exigerDirectionPourSupprimer(user, "Clôturer ou résilier le contrat en cours est réservé à la Direction : ajoutez le contrat sans cocher la clôture.");

    // Lus avant la transaction : une saisie illisible s'arrête ici avec son message, rien n'est écrit.
    const heuresHebdo = decSaisi(formData.get("heuresHebdo"), "Heures / semaine");
    const salaireMensuel = decSaisi(formData.get("salaireMensuel"), "Salaire mensuel");
    const sortie: { demande: Awaited<ReturnType<typeof recopierContratSurFicheTx>> } = { demande: null };
    const cree = await prisma.$transaction(async (tx) => {
      if (cloturerId) {
        // VERROU sur le contrat à clôturer AVANT de relire son statut : un double envoi du
        // formulaire attend ici la fin du premier, relit TRANSFORMÉ/RÉSILIÉ et s'arrête — il ne
        // crée pas un second contrat.
        await tx.$queryRaw`SELECT "id" FROM "public"."Contrat" WHERE "id" = ${cloturerId} FOR UPDATE`;
        const ancien = await tx.contrat.findUnique({ where: { id: cloturerId }, select: { employeeId: true, statut: true } });
        if (!ancien || ancien.employeeId !== employeeId) throw new Error("Ce contrat n'appartient pas à ce salarié : il n'a pas été clôturé.");
        if (ancien.statut !== "ACTIF") throw new Error("Le contrat à clôturer n'est plus actif. Rechargez la page.");
        await tx.contrat.update({ where: { id: cloturerId }, data: { statut: statutCloture as "TRANSFORME" | "RESILIE" } });
        await journaliser(tx, {
          entite: "Contrat",
          entiteId: cloturerId,
          champ: "cloture",
          ancienneValeur: "ACTIF",
          nouvelleValeur: statutCloture,
          userId: user.id,
        });
      }

      const nouveau = await tx.contrat.create({
        data: {
          employeeId,
          type,
          dateDebut: new Date(String(formData.get("dateDebut"))),
          dateFin: date(formData, "dateFin"),
          finPeriodeEssai: date(formData, "finPeriodeEssai"),
          heuresHebdo: heuresHebdo || 48,
          salaireMensuel,
          devise: String(formData.get("devise") ?? "USD"),
          poste: String(formData.get("poste") ?? ""),
          documentUrl,
          agence,
          coutJourUSD: type === "INTERIM" && Number.isFinite(coutJour) && coutJour > 0 ? coutJour : null,
        },
      });
      // La fiche employé affiche le type du contrat courant (hors Direction : demande « À valider »).
      sortie.demande = await recopierContratSurFicheTx(tx, { employeeId, contrat: type, auteur: { id: user.id, nom: user.nom, role: user.role } });

      await journaliser(tx, {
        entite: "Contrat",
        entiteId: employeeId,
        champ: "creation",
        nouvelleValeur: String(formData.get("type")),
        userId: user.id,
      });
      return nouveau;
    });

    if (sortie.demande) await notifierNouvelleDemandeFiche(sortie.demande, sortie.demande.nomSalarie);
    // Le salarié est prévenu qu'un contrat attend sa signature (cloche de l'espace + push).
    await notifierContratASigner(cree.id);

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
    requireRole(user, ["ADMIN", "MANAGER"]);

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const nouveauSalaire = decSaisi(formData.get("nouveauSalaire"), "Nouveau salaire");
    if (!(nouveauSalaire > 0)) throw new Error("Nouveau salaire : un montant supérieur à 0 est attendu.");
    const nouveauPoste = String(formData.get("nouveauPoste") ?? "").trim() || employee.poste;
    const motif = String(formData.get("motif") ?? "Ajustement");

    // Formulaire périmé : la valeur d'origine du salaire / du poste est portée par le formulaire ; si la
    // personne a changé l'un d'eux et que la fiche a bougé depuis l'ouverture, on refuse (rien n'est écrasé).
    // Relue SOUS le verrou de la fiche, dans la transaction qui écrit.
    const origineSalaire = formData.get("origineSalaire");
    const originePoste = formData.get("originePoste");
    function verifierNonPerime(fiche: { salaireMensuel: { toString(): string }; poste: string }) {
      const perimes: Changement[] = [];
      const sal = canonique("salaireMensuel", nouveauSalaire);
      const salActuel = canonique("salaireMensuel", fiche.salaireMensuel);
      if (typeof origineSalaire === "string" && origineSalaire !== "" && sal !== origineSalaire && origineSalaire !== salActuel) perimes.push({ champ: "salaireMensuel", avant: origineSalaire, apres: salActuel });
      if (typeof originePoste === "string" && originePoste !== "" && nouveauPoste !== originePoste && originePoste !== fiche.poste) perimes.push({ champ: "poste", avant: originePoste, apres: fiche.poste });
      if (perimes.length > 0) throw new Error(messagePerime(perimes));
    }

    // Hors Direction (RH) : rien n'est appliqué, une demande part à la Direction (2026-10-12).
    if (!estDirection(user)) {
      const demande = await prisma.$transaction(async (tx) => {
        await verrouillerFiche(tx, employeeId);
        const fiche = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
        verifierNonPerime(fiche);
        const changements = changementsProposes(fiche as unknown as Record<string, unknown>, { salaireMensuel: nouveauSalaire, poste: nouveauPoste });
        if (changements.length === 0) throw new Error("Ni le salaire ni le poste ne changent : rien à soumettre.");
        return creerDemandeFicheTx(tx, { employeeId, changements, origine: "CHANGER_SALAIRE", motif, auteur: { id: user.id, nom: user.nom, role: user.role } });
      });
      await notifierNouvelleDemandeFiche(demande, employee.nom);
      revalidatePath(`/employes/${employeeId}`);
      revalidatePath("/a-valider");
      revalidatePath("/", "layout");
      return;
    }

    // Même chemin que « Modifier » côté Direction (lib/historique-salaire) : historique + fiche + journal.
    await prisma.$transaction(async (tx) => {
      await verrouillerFiche(tx, employeeId);
      const fiche = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      verifierNonPerime(fiche);
      await enregistrerChangementSalaire(tx, {
        employeeId,
        ancienSalaire: fiche.salaireMensuel,
        nouveauSalaire,
        ancienPoste: fiche.poste,
        nouveauPoste,
        motif,
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

    const note = decSaisiOptionnel(formData.get("note"), "Note");
    if (note !== null && (note < 0 || note > 100 || !Number.isInteger(note))) throw new Error("Note : un nombre entier entre 0 et 100.");

    await prisma.evaluation.create({
      data: {
        employeeId,
        date: new Date(String(formData.get("date"))),
        note,
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
