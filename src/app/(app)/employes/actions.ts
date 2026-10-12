"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { decSaisi } from "@/lib/nombre";
import { enregistrerChangementSalaire } from "@/lib/historique-salaire";
import { CHAMPS_SENSIBLES, CHAMP_ORIGINES, changementsDeLUtilisateur, estChampSensible, libelleValeur, lireOrigines, messagePerime, versDonnee, type ChampSensible } from "@/lib/fiche-sensible";
import { creerDemandeFicheTx, estDirection, notifierNouvelleDemandeFiche, verrouillerFiche } from "@/lib/demandes-fiche";
import {
  clePaire, fichesProches, identiteModifiee, lireIdsEcartes, messageDoublons, CHAMP_DOUBLONS_ECARTES, JOURNAL_DOUBLON_ECARTE,
  type IdentiteFiche,
} from "@/lib/employe-doublon";
import { chargerFichesIdentite, chargerPairesEcartees } from "@/lib/employe-doublon-serveur";
import { controlerDonneesCreation } from "@/lib/creation-fiche-donnees";
import { creerDemandeCreation, creerFicheTx, exigerIdentifiantsLibres, lisibleSiDoublon, notifierNouvelleCreation } from "@/lib/creation-fiche";

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
    // `modePaiement` est lu brut : `toEmployeeInput` remplacerait une valeur inconnue par « espèces ».
    const modeBrut = formData.get("modePaiement");
    const ctrl = controlerDonneesCreation({ ...data, ...(modeBrut !== null ? { modePaiement: String(modeBrut) as typeof data.modePaiement } : {}) });
    if (ctrl) throw new Error(`${ctrl} Rien n'a été enregistré.`);
    const ecartes = await exigerDoublonsTranches(data, formData);

    // Hors Direction : RIEN n'est créé (aucune fiche visible nulle part) ; une demande part à la Direction.
    // Les contrôles de la saisie (matricule et pointeuse libres) s'appliquent dès maintenant, puis sont refaits à l'approbation.
    if (!estDirection(user)) {
      await exigerIdentifiantsLibres(prisma, data);
      const demande = await creerDemandeCreation({ donnees: data, ecartes, auteur: { id: user.id, nom: user.nom, role: user.role } });
      await notifierNouvelleCreation(demande);
      revalidatePath("/employes");
      revalidatePath("/a-valider");
      revalidatePath("/", "layout");
      redirect("/employes?creation=envoyee");
    }

    // Direction : création directe, comme avant (matricule auto-généré si laissé vide, selon la catégorie).
    await exigerIdentifiantsLibres(prisma, data);
    await prisma.$transaction((tx) => creerFicheTx(tx, data, ecartes, user.id)).catch(lisibleSiDoublon);

    revalidatePath("/employes");
    redirect("/employes");
  });
}

export async function modifierEmploye(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}/modifier`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const direction = estDirection(user);
    const complet = toEmployeeInput(formData);
    // Champs SENSIBLES (paie, contrat, versement — lib/fiche-sensible) : seuls ceux que le formulaire
    // envoie sont pris en compte (un champ absent n'est jamais lu comme « 0 » ou « vide »).
    const sensiblesEnvoyes = CHAMPS_SENSIBLES.filter((c) => formData.has(c));
    const commun = Object.fromEntries(Object.entries(complet).filter(([c]) => !estChampSensible(c))) as Omit<typeof complet, ChampSensible>;
    if (!commun.matricule) throw new Error("Le matricule ne peut pas être vide (il sert à la connexion et à la pointeuse). Rien n'a été enregistré.");
    if (sensiblesEnvoyes.includes("dateEmbauche") && Number.isNaN(complet.dateEmbauche.getTime())) throw new Error("Date d'embauche invalide.");
    await exigerIdentifiantsLibres(prisma, commun, employeeId);
    // La question des doublons ne se repose que si l'identité (nom, téléphone, date de naissance) change.
    const avant = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const ecartes = identiteModifiee(avant, commun) ? await exigerDoublonsTranches(commun, formData, employeeId) : [];
    // Ce que la personne a RÉELLEMENT changé (valeur soumise ≠ valeur d'origine du formulaire) : un champ
    // laissé tel quel n'écrase jamais une valeur changée entre-temps (formulaire périmé → refus lisible).
    // `modePaiement` est lu brut : `toEmployeeInput` remplacerait une valeur inconnue par « espèces ».
    const soumis: Partial<Record<ChampSensible, unknown>> = Object.fromEntries(sensiblesEnvoyes.map((c) => [c, c === "modePaiement" ? String(formData.get("modePaiement") ?? "") : complet[c]]));
    const origines = lireOrigines(formData.get(CHAMP_ORIGINES));

    // Champs non sensibles ET (Direction) écriture directe des sensibles, ou (autres rôles) demande à
    // valider : dans UNE transaction, sous le verrou de la fiche (la comparaison se fait sur la fiche
    // relue SOUS verrou) — une demande refusée (champ déjà en attente) n'enregistre rien.
    const demande = await prisma.$transaction(async (tx) => {
      await verrouillerFiche(tx, employeeId);
      const fiche = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const { changements, perimes, invalides } = changementsDeLUtilisateur(fiche as unknown as Record<string, unknown>, soumis, origines);
      if (invalides.length > 0) throw new Error(`${invalides.join(" ")} Rien n'a été enregistré.`);
      if (perimes.length > 0) throw new Error(messagePerime(perimes));
      await tx.employee.update({ where: { id: employeeId }, data: commun });
      if (changements.length === 0) return null;
      if (!direction) {
        return creerDemandeFicheTx(tx, { employeeId, changements, origine: "MODIFIER", auteur: { id: user.id, nom: user.nom, role: user.role } });
      }
      // Direction : le salaire passe par le chemin de « Changer le salaire » (historique + journal) ;
      // chaque autre champ sensible laisse sa trace.
      const salaire = changements.find((c) => c.champ === "salaireMensuel");
      if (salaire) {
        await enregistrerChangementSalaire(tx, {
          employeeId,
          ancienSalaire: fiche.salaireMensuel,
          nouveauSalaire: Number(versDonnee("salaireMensuel", salaire.apres)),
          ancienPoste: fiche.poste,
          nouveauPoste: commun.poste || fiche.poste,
          motif: "Modification de la fiche",
          userId: user.id,
        });
      }
      const autres = changements.filter((c) => c.champ !== "salaireMensuel");
      if (autres.length > 0) {
        await tx.employee.update({ where: { id: employeeId }, data: Object.fromEntries(autres.map((c) => [c.champ, versDonnee(c.champ, c.apres)])) });
        for (const c of autres) {
          await journaliser(tx, { entite: "Employee", entiteId: employeeId, champ: c.champ, ancienneValeur: libelleValeur(c.champ, c.avant), nouvelleValeur: libelleValeur(c.champ, c.apres), userId: user.id });
        }
      }
      return null;
    }).catch(lisibleSiDoublon);
    if (ecartes.length > 0) {
      await journaliser(prisma, { entite: "Employee", entiteId: employeeId, champ: JOURNAL_DOUBLON_ECARTE, nouvelleValeur: ecartes.join(","), userId: user.id });
    }

    revalidatePath("/employes");
    revalidatePath(`/employes/${employeeId}`);
    if (demande) {
      // La Direction est prévenue APRÈS la transaction ; la fiche montre le bandeau « en attente ».
      await notifierNouvelleDemandeFiche(demande, commun.nom || avant.nom);
      revalidatePath("/a-valider");
      revalidatePath("/", "layout");
      redirect(`/employes/${employeeId}`);
    }
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
