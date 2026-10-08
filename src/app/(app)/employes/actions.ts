"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { genererMatricule } from "@/lib/matricule";
import { journaliser } from "@/lib/audit";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { decSaisi } from "@/lib/nombre";
import {
  clePaire, fichesProches, identiteModifiee, lireIdsEcartes, messageDoublons, CHAMP_DOUBLONS_ECARTES, JOURNAL_DOUBLON_ECARTE,
  type IdentiteFiche,
} from "@/lib/employe-doublon";
import { chargerFichesIdentite, chargerPairesEcartees } from "@/lib/employe-doublon-serveur";

// Nombre d'un champ du formulaire : lu à la française (« 1 250,5 », « 150.000 »), 0 si vide, erreur
// lisible si illisible — jamais un zéro silencieux (cf. lib/nombre).
function decimalField(formData: FormData, name: string, libelle: string): number {
  return decSaisi(formData.get(name), libelle);
}

function toEmployeeInput(formData: FormData) {
  // Règles que le champ numérique natif portait (min / pas entier) : reportées ici, avec un message.
  const enfantsSaisis = decimalField(formData, "enfants", "Enfants");
  if (enfantsSaisis < 0 || !Number.isInteger(enfantsSaisis)) throw new Error("Enfants : un nombre entier positif est attendu.");
  for (const [champ, libelle] of [["heuresParJour", "Heures / jour"], ["heuresHebdomadaires", "Heures / semaine"]] as const) {
    if (decimalField(formData, champ, libelle) < 0) throw new Error(`${libelle} : une valeur négative n'est pas permise.`);
  }
  return {
    matricule: String(formData.get("matricule") ?? "").trim(),
    nom: String(formData.get("nom") ?? "").trim(),
    sexe: String(formData.get("sexe") ?? ""),
    etatCivil: String(formData.get("etatCivil") ?? ""),
    poste: String(formData.get("poste") ?? ""),
    secteur: String(formData.get("secteur") ?? ""),
    categorie: String(formData.get("categorie") ?? "BRIGADE") as "BRIGADE" | "BACKOFFICE",
    categorieProfessionnelle: String(formData.get("categorieProfessionnelle") ?? "").trim() || null,
    salaireMensuel: decimalField(formData, "salaireMensuel", "Salaire mensuel"),
    transportJourCDF: decimalField(formData, "transportJourCDF", "Transport / jour (CDF)"),
    transportMoisCDF: decimalField(formData, "transportMoisCDF", "Transport / mois (CDF)"),
    transportMoisUSD: decimalField(formData, "transportMoisUSD", "Transport / mois ($)"),
    cnssMontant: decimalField(formData, "cnssMontant", "CNSS $"),
    enfants: Math.round(decimalField(formData, "enfants", "Enfants")),
    type: String(formData.get("type") ?? "NATIONAL") as "NATIONAL" | "EXPATRIE",
    dateEmbauche: new Date(String(formData.get("dateEmbauche"))),
    contrat: String(formData.get("contrat") ?? ""),
    heuresParJour: decimalField(formData, "heuresParJour", "Heures / jour") || 8,
    heuresHebdomadaires: decimalField(formData, "heuresHebdomadaires", "Heures / semaine") || 48,
    fraisMedicauxMoisCourant: decimalField(formData, "fraisMedicauxMoisCourant", "Frais médicaux du mois ($)"),
    idExterneIVMS: String(formData.get("idExterneIVMS") ?? "").trim() || null,
    dateNaissance: String(formData.get("dateNaissance") ?? "").trim()
      ? new Date(String(formData.get("dateNaissance")))
      : null,
    telephone: String(formData.get("telephone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    adresse: String(formData.get("adresse") ?? "").trim() || null,
    banque: String(formData.get("banque") ?? "").trim() || null,
    compteBancaire: String(formData.get("compteBancaire") ?? "").trim() || null,
    mobileMoney: String(formData.get("mobileMoney") ?? "").trim() || null,
    modePaiement: (["ESPECES", "VIREMENT", "MOBILE_MONEY"].includes(String(formData.get("modePaiement")))
      ? String(formData.get("modePaiement"))
      : "ESPECES") as "ESPECES" | "VIREMENT" | "MOBILE_MONEY",
  };
}

/**
 * ANTI-DOUBLON, revérifié ICI (l'écran le montre en direct, mais une action serveur s'appelle sans
 * lui) : toute fiche existante proche — active ou inactive, règle de `lib/employe-doublon` — doit
 * avoir été tranchée par « C'est une autre personne » (ids dans le champ caché `doublonsEcartes`).
 * Sinon : refus lisible qui nomme les fiches. Une fiche apparue entre l'affichage et l'envoi n'est
 * pas couverte par un choix fait sans elle. Renvoie les ids écartés, à journaliser.
 */
async function exigerDoublonsTranches(saisie: IdentiteFiche, formData: FormData, exclureId?: string): Promise<string[]> {
  const [fiches, ecartees] = await Promise.all([chargerFichesIdentite(), exclureId ? chargerPairesEcartees() : Promise.resolve(undefined)]);
  const proches = fichesProches(saisie, fiches, { exclureId, ecartees });
  const vus = lireIdsEcartes(formData.get(CHAMP_DOUBLONS_ECARTES));
  const nonTranches = proches.filter((p) => !vus.has(p.fiche.id));
  if (nonTranches.length > 0) throw new Error(messageDoublons(nonTranches));
  return proches.map((p) => p.fiche.id);
}

export async function creerEmploye(formData: FormData) {
  // Une saisie illisible revient sur le formulaire avec son message (les erreurs jetées sont masquées en production).
  await formulaireLisible("/employes/nouveau", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const data = toEmployeeInput(formData);
    const ecartes = await exigerDoublonsTranches(data, formData);
    // Matricule auto-généré si laissé vide, selon la logique de la catégorie (brigade / back-office).
    if (!data.matricule) {
      const existants = await prisma.employee.findMany({
        where: { categorie: data.categorie },
        select: { matricule: true },
      });
      data.matricule = genererMatricule(data.nom, data.categorie, existants.map((e) => e.matricule));
    }

    const nouvel = await prisma.employee.create({ data });
    // « C'est une autre personne » : décision tracée, et la paire ne se représente plus (liste des doublons probables).
    if (ecartes.length > 0) {
      await journaliser(prisma, { entite: "Employee", entiteId: nouvel.id, champ: JOURNAL_DOUBLON_ECARTE, nouvelleValeur: ecartes.join(","), userId: user.id });
    }

    // Checklist d'intégration : copie du modèle d'onboarding pour le nouvel employé.
    const modeleOnboarding = await prisma.modeleTacheOnboarding.findMany({ orderBy: { ordre: "asc" } });
    if (modeleOnboarding.length > 0) {
      await prisma.tacheOnboarding.createMany({
        data: modeleOnboarding.map((m) => ({ employeeId: nouvel.id, libelle: m.libelle, ordre: m.ordre })),
      });
    }

    revalidatePath("/employes");
    redirect("/employes");
  });
}

export async function modifierEmploye(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}/modifier`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const data = toEmployeeInput(formData);
    // La question des doublons ne se repose que si l'identité (nom, téléphone, date de naissance) change.
    const avant = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true, telephone: true, dateNaissance: true } });
    const ecartes = avant && identiteModifiee(avant, data) ? await exigerDoublonsTranches(data, formData, employeeId) : [];

    await prisma.employee.update({
      where: { id: employeeId },
      data,
    });
    if (ecartes.length > 0) {
      await journaliser(prisma, { entite: "Employee", entiteId: employeeId, champ: JOURNAL_DOUBLON_ECARTE, nouvelleValeur: ecartes.join(","), userId: user.id });
    }

    revalidatePath("/employes");
    redirect("/employes");
  });
}

/**
 * Ajoute un membre à la composition familiale (conjoint ou enfant).
 * NE TOUCHE PAS au compteur `Employee.enfants` qui pilote la paie : la fiche nominative est un
 * justificatif, l'écart éventuel est signalé sur la fiche et tranché par la Direction.
 */
export async function ajouterMembreFamille(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const lien = String(formData.get("lien") ?? "ENFANT") as "CONJOINT" | "ENFANT";
    if (lien !== "CONJOINT" && lien !== "ENFANT") throw new Error("Lien de parenté invalide.");
    const nom = String(formData.get("nom") ?? "").trim();
    if (!nom) throw new Error("Indiquez le nom du membre de la famille.");

    const brut = String(formData.get("dateNaissance") ?? "").trim();
    if (brut && !/^\d{4}-\d{2}-\d{2}$/.test(brut)) throw new Error("Date de naissance invalide.");
    // Date pure (colonne DATE) : construite en UTC pour ne pas glisser d'un jour selon le fuseau.
    const dateNaissance = brut ? new Date(brut + "T00:00:00.000Z") : null;
    if (dateNaissance && dateNaissance > new Date()) {
      throw new Error("La date de naissance ne peut pas être dans le futur.");
    }

    // Un seul conjoint : remplacer plutôt qu'empiler des lignes contradictoires. Remplacer EFFACE
    // le conjoint enregistré : réservé à la Direction (règle de Sacha, 2026-10-01).
    if (lien === "CONJOINT") {
      if (await prisma.membreFamille.count({ where: { employeeId, lien: "CONJOINT" } })) {
        exigerDirectionPourSupprimer(user, "Un conjoint est déjà saisi : seule la Direction peut le remplacer.");
      }
      await prisma.membreFamille.deleteMany({ where: { employeeId, lien: "CONJOINT" } });
    }

    await prisma.membreFamille.create({
      data: { employeeId, lien, nom, dateNaissance, creeParId: user.id },
    });
    await journaliser(prisma, {
      entite: "MembreFamille",
      entiteId: employeeId,
      champ: "ajout",
      nouvelleValeur: `${lien === "CONJOINT" ? "Conjoint" : "Enfant"} : ${nom}${brut ? ` (né(e) le ${brut})` : " (sans date de naissance)"}`,
      userId: user.id,
    });

    revalidatePath(`/employes/${employeeId}`);
  });
}

/** Retire un membre de la composition familiale (Direction seulement). Tracé au journal d'audit. */
export async function supprimerMembreFamille(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const membre = await prisma.membreFamille.findUnique({ where: { id } });
  if (!membre) return;
  await formulaireLisible(`/employes/${membre.employeeId}/modifier`, async () => {
    exigerDirectionPourSupprimer(user);
    await prisma.membreFamille.delete({ where: { id } });
    await journaliser(prisma, {
      entite: "MembreFamille",
      entiteId: membre.employeeId,
      champ: "suppression",
      ancienneValeur: `${membre.lien === "CONJOINT" ? "Conjoint" : "Enfant"} : ${membre.nom}`,
      userId: user.id,
    });

    revalidatePath(`/employes/${membre.employeeId}`);
  });
}

/**
 * Réactive une fiche désactivée (Direction). Sortie prévue pour une ligne de paie rouverte « hors
 * calcul » (paie-hors-calcul.ts) : la fiche réactivée revient dans le calcul, sa ligne est recalculée
 * et peut être validée — la Direction la désactive ensuite. Journalisé.
 */
export async function reactiverEmploye(employeeId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const avant = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { actif: true } });
  if (!avant.actif) {
    await prisma.employee.update({ where: { id: employeeId }, data: { actif: true } });
    await journaliser(prisma, { entite: "Employee", entiteId: employeeId, champ: "actif", ancienneValeur: "false", nouvelleValeur: "true", userId: user.id });
  }
  revalidatePath("/employes");
  revalidatePath(`/employes/${employeeId}`);
  revalidatePath("/paie");
}

/**
 * « Ce sont deux personnes différentes » sur la liste des doublons probables (Direction) : la paire
 * est journalisée et ne s'affiche plus. Aucune fiche n'est modifiée — la fusion de deux dossiers
 * n'existe pas (chantier à part).
 */
export async function ecarterDoublon(idA: string, idB: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!idA || !idB || idA === idB) return;
  const trouvees = await prisma.employee.count({ where: { id: { in: [idA, idB] } } });
  if (trouvees !== 2) return;
  // Déjà écartée (double clic, deux onglets) : rien de plus au journal.
  if ((await chargerPairesEcartees()).has(clePaire(idA, idB))) return;
  await journaliser(prisma, { entite: "Employee", entiteId: idA, champ: JOURNAL_DOUBLON_ECARTE, nouvelleValeur: idB, userId: user.id });
  revalidatePath("/employes");
}

export async function desactiverEmploye(employeeId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.employee.update({ where: { id: employeeId }, data: { actif: false } });
  // Journalisé comme la réactivation : une fiche qui sort du calcul de la paie se retrouve au journal.
  await journaliser(prisma, { entite: "Employee", entiteId: employeeId, champ: "actif", ancienneValeur: "true", nouvelleValeur: "false", userId: user.id });

  revalidatePath("/employes");
  redirect("/employes");
}
