"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { pariteSemaine } from "./creneaux";

/** Enregistre / efface le shift d'un employé pour un jour. shiftId vide = effacer. */
export async function saisirCreneau(employeeId: string, dateIso: string, shiftId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  // Date stockée en UTC minuit du bon jour (évite le décalage de fuseau).
  const date = new Date(dateIso + "T00:00:00Z");
  if (!shiftId) {
    await prisma.planningCreneau.deleteMany({ where: { employeeId, date } });
  } else {
    await prisma.planningCreneau.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: { shiftId },
      create: { employeeId, date, shiftId },
    });
  }
  revalidatePath("/planning");
}

/** Enregistre / efface le shift du MODÈLE d'un employé pour un jour (0=dim…6=sam) et une couche
 *  de semaine (0=chaque semaine, 1=semaine A, 2=semaine B). */
export async function saisirModele(employeeId: string, jour: number, shiftId: string, semaine = 0) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  if (jour < 0 || jour > 6 || semaine < 0 || semaine > 2) return;
  if (!shiftId) {
    await prisma.planningModele.deleteMany({ where: { employeeId, jour, semaine } });
  } else {
    await prisma.planningModele.upsert({
      where: { employeeId_jour_semaine: { employeeId, jour, semaine } },
      update: { shiftId },
      create: { employeeId, jour, semaine, shiftId },
    });
  }
  revalidatePath("/planning");
}

/**
 * Génère automatiquement le planning sur une période, avec paramètres précis (formulaire) :
 *   - shiftId : shift à affecter (vide = 1er shift actif non-Nuit/non-système) ;
 *   - jours[] : jours de la semaine à couvrir (0=dim … 6=sam ; défaut lun→sam) ;
 *   - nbParSemaine : nb de jours/semaine par employé (0 = auto = heures hebdo ÷ heures/jour) ;
 *   - inclureFeries : couvrir aussi les jours fériés (défaut non) ;
 *   - modeles : utiliser les modèles hebdomadaires (rôle/shift fixe par jour) quand ils existent ;
 *   - ecraser : régénérer toute la période (sinon on ne remplit que les créneaux vides).
 */
export async function genererPlanningAuto(debutIso: string, finIso: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const debut = new Date(debutIso + "T00:00:00Z");
  const fin = new Date(finIso + "T00:00:00Z");
  if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut > fin) return;

  const shiftIdParam = String(formData.get("shiftId") ?? "").trim();
  const joursParam = formData.getAll("jours").map(Number).filter((n) => n >= 0 && n <= 6);
  const joursActifs = new Set(joursParam.length > 0 ? joursParam : [1, 2, 3, 4, 5, 6]);
  const nbParSemaine = Number(formData.get("nbParSemaine") ?? 0) || 0;
  const inclureFeries = formData.get("inclureFeries") === "on";
  const utiliserModeles = formData.get("modeles") === "on"; // coché par défaut dans le formulaire
  const ecraser = formData.get("ecraser") === "on";

  const [employees, shifts, feries, existants, modeles] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      select: { id: true, heuresParJour: true, heuresHebdomadaires: true, poste: true, secteur: true },
    }),
    prisma.shift.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } } }),
    prisma.planningCreneau.findMany({ where: { date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true } }),
    utiliserModeles ? prisma.planningModele.findMany() : Promise.resolve([]),
  ]);

  // Shift de repli selon la FICHE (poste/secteur) pour les employés SANS modèle hebdo :
  //   caissier(ère) → Caisse ; secteur Cuisine → Matin cuisine ; secteur Salle → Matin/midi salle ;
  //   autres (transport, direction, backoffice) → Journée 8h-17h. Le shift Admin (réservé, via
  //   modèle uniquement) et Nuit ne sont JAMAIS affectés automatiquement.
  const parNom = (re: RegExp) => shifts.find((s) => re.test(s.nom));
  const shiftCaisse = parNom(/caisse/i);
  const shiftCuisine = parNom(/matin cuisine/i);
  const shiftSalle = parNom(/matin\/midi salle/i);
  const shiftJournee =
    parNom(/journée 8h-17h/i) ?? shifts.find((s) => !s.systeme && !/admin|nuit/i.test(s.nom));
  const shiftChoisi = shiftIdParam ? shifts.find((s) => s.id === shiftIdParam) : null;

  const shiftPourEmploye = (emp: { poste: string | null; secteur: string | null }) => {
    if (shiftChoisi) return shiftChoisi; // choix explicite de l'utilisateur
    const poste = (emp.poste ?? "").toLowerCase();
    const secteur = (emp.secteur ?? "").toLowerCase();
    if (/caissi/.test(poste)) return shiftCaisse ?? shiftJournee;
    if (/cuisine/.test(secteur)) return shiftCuisine ?? shiftJournee;
    if (/salle/.test(secteur)) return shiftSalle ?? shiftJournee;
    return shiftJournee;
  };

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const feriesIso = new Set(feries.map((f) => iso(new Date(f.date))));
  const existSet = new Set(existants.map((c) => `${c.employeeId}_${iso(new Date(c.date))}`));
  const shiftsActifsIds = new Set(shifts.map((s) => s.id));
  // Modèle : employeeId -> ("jour_semaine" -> shiftId) ; seuls les shifts encore actifs.
  const modeleParEmp = new Map<string, Map<string, string>>();
  for (const m of modeles) {
    if (!shiftsActifsIds.has(m.shiftId)) continue;
    (modeleParEmp.get(m.employeeId) ?? modeleParEmp.set(m.employeeId, new Map()).get(m.employeeId)!).set(`${m.jour}_${m.semaine}`, m.shiftId);
  }
  // Shift du modèle pour une date : couche de la parité (semaine A/B) sinon couche « chaque semaine ».
  const shiftDuModele = (mod: Map<string, string>, d: Date): string | undefined => {
    const dow = d.getUTCDay();
    return mod.get(`${dow}_${pariteSemaine(d)}`) ?? mod.get(`${dow}_0`);
  };

  // Jours retenus de la période (selon jours de semaine choisis, fériés optionnels), par semaine.
  const joursParSemaine = new Map<string, Date[]>();
  for (let d = new Date(debut); d <= fin; d = new Date(d.getTime() + 86_400_000)) {
    const dow = d.getUTCDay();
    if (!joursActifs.has(dow)) continue;
    if (!inclureFeries && feriesIso.has(iso(d))) continue;
    const lundi = new Date(d);
    lundi.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const cle = iso(lundi);
    (joursParSemaine.get(cle) ?? joursParSemaine.set(cle, []).get(cle)!).push(new Date(d));
  }

  const aCreer: { employeeId: string; date: Date; shiftId: string }[] = [];
  for (const emp of employees) {
    const modele = modeleParEmp.get(emp.id);
    if (modele && modele.size > 0) {
      // L'employé a un modèle hebdomadaire : on affecte son shift/rôle du jour de la semaine.
      for (const jours of joursParSemaine.values()) {
        for (const d of jours) {
          const shiftId = shiftDuModele(modele, d);
          if (!shiftId) continue; // pas de shift ce jour-là dans le modèle = repos
          if (!ecraser && existSet.has(`${emp.id}_${iso(d)}`)) continue;
          aCreer.push({ employeeId: emp.id, date: d, shiftId });
        }
      }
      continue;
    }
    // Sinon : shift selon la FICHE (caisse / cuisine / salle / journée), réparti selon les heures.
    const shiftEmp = shiftPourEmploye(emp);
    if (!shiftEmp) continue;
    const hj = Number(emp.heuresParJour) || 8;
    const hh = Number(emp.heuresHebdomadaires) || 48;
    const nbSem = nbParSemaine > 0
      ? Math.min(joursActifs.size, nbParSemaine)
      : Math.min(joursActifs.size, Math.max(1, Math.round(hh / hj)));
    for (const jours of joursParSemaine.values()) {
      for (const d of jours.slice(0, nbSem)) {
        if (!ecraser && existSet.has(`${emp.id}_${iso(d)}`)) continue;
        aCreer.push({ employeeId: emp.id, date: d, shiftId: shiftEmp.id });
      }
    }
  }

  // « Écraser » = régénérer toute la période (2 requêtes). Sinon on remplit seulement les vides.
  if (ecraser) {
    await prisma.planningCreneau.deleteMany({ where: { date: { gte: debut, lte: fin } } });
  }
  if (aCreer.length > 0) {
    await prisma.planningCreneau.createMany({ data: aCreer, skipDuplicates: true });
  }
  revalidatePath("/planning");
}

/** Affecte (ou efface) un shift en LOT : plusieurs employés × plusieurs jours en un aller-retour. */
export async function saisirCreneauxEnLot(
  entrees: { employeeId: string; dateIso: string; shiftId: string }[]
) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const aVider = entrees.filter((e) => !e.shiftId);
  const aPoser = entrees.filter((e) => e.shiftId);
  if (aVider.length > 0) {
    await prisma.planningCreneau.deleteMany({
      where: { OR: aVider.map((e) => ({ employeeId: e.employeeId, date: new Date(e.dateIso + "T00:00:00Z") })) },
    });
  }
  for (const e of aPoser) {
    const date = new Date(e.dateIso + "T00:00:00Z");
    await prisma.planningCreneau.upsert({
      where: { employeeId_date: { employeeId: e.employeeId, date } },
      update: { shiftId: e.shiftId },
      create: { employeeId: e.employeeId, date, shiftId: e.shiftId },
    });
  }
  revalidatePath("/planning");
}

function lireHeure(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : null;
}

function lireNombre(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Ajoute un nouveau shift configurable. */
export async function creerShift(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du shift est requis.");
  const couleur = String(formData.get("couleur") ?? "indigo");
  const dernier = await prisma.shift.findFirst({ orderBy: { ordre: "desc" } });

  await prisma.shift.create({
    data: {
      nom,
      heureDebut: lireHeure(formData.get("heureDebut")),
      heureFin: lireHeure(formData.get("heureFin")),
      couleur,
      dureeHeures: lireNombre(formData.get("dureeHeures")),
      tauxHoraireUSD: lireNombre(formData.get("tauxHoraireUSD")),
      ordre: (dernier?.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/planning");
}

/** Modifie un shift existant (nom, heures, couleur). */
export async function modifierShift(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const id = String(formData.get("id"));
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du shift est requis.");

  await prisma.shift.update({
    where: { id },
    data: {
      nom,
      heureDebut: lireHeure(formData.get("heureDebut")),
      heureFin: lireHeure(formData.get("heureFin")),
      couleur: String(formData.get("couleur") ?? "indigo"),
      dureeHeures: lireNombre(formData.get("dureeHeures")),
      tauxHoraireUSD: lireNombre(formData.get("tauxHoraireUSD")),
    },
  });
  revalidatePath("/planning");
}

/**
 * Supprime un shift. Les shifts « système » (Repos/Congé/Férié) ne sont pas supprimables.
 * S'il est utilisé dans un planning, on le désactive (actif=false) pour préserver l'historique
 * plutôt que de le supprimer.
 */
export async function supprimerShift(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const shift = await prisma.shift.findUnique({ where: { id }, include: { _count: { select: { creneaux: true } } } });
  if (!shift) return;
  if (shift.systeme) throw new Error("Ce shift système ne peut pas être supprimé.");

  if (shift._count.creneaux > 0) {
    await prisma.shift.update({ where: { id }, data: { actif: false } });
  } else {
    await prisma.shift.delete({ where: { id } });
  }
  revalidatePath("/planning");
}

/** Réactive un shift désactivé. */
export async function reactiverShift(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.shift.update({ where: { id }, data: { actif: true } });
  revalidatePath("/planning");
}
