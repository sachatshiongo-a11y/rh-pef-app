"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { pariteSemaine, dureeShift } from "./creneaux";

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
export type ResumeGeneration = { crees: number; besoinsNonCouverts: number; detailNonCouverts: string[]; sousHeures: number };

 export async function genererPlanningAuto(debutIso: string, finIso: string, formData: FormData): Promise<ResumeGeneration> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const debut = new Date(debutIso + "T00:00:00Z");
  const fin = new Date(finIso + "T00:00:00Z");
  const resumeVide: ResumeGeneration = { crees: 0, besoinsNonCouverts: 0, detailNonCouverts: [], sousHeures: 0 };
  if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut > fin) return resumeVide;

  const shiftIdParam = String(formData.get("shiftId") ?? "").trim();
  const joursParam = formData.getAll("jours").map(Number).filter((n) => n >= 0 && n <= 6);
  const joursActifs = new Set(joursParam.length > 0 ? joursParam : [1, 2, 3, 4, 5, 6]);
  const nbParSemaine = Number(formData.get("nbParSemaine") ?? 0) || 0;
  const inclureFeries = formData.get("inclureFeries") === "on";
  const utiliserModeles = formData.get("modeles") === "on"; // coché par défaut dans le formulaire
  const ecraser = formData.get("ecraser") === "on";

  const [employees, shifts, feries, existants, modeles, besoins, polyvalences, congesApprouves] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      select: { id: true, nom: true, heuresParJour: true, heuresHebdomadaires: true, poste: true, secteur: true },
    }),
    prisma.shift.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } } }),
    prisma.planningCreneau.findMany({ where: { date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true, shiftId: true } }),
    utiliserModeles ? prisma.planningModele.findMany() : Promise.resolve([]),
    prisma.besoinShift.findMany(),
    prisma.polyvalencePoste.findMany(),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: fin }, dateFin: { gte: debut } },
      select: { employeeId: true, dateDebut: true, dateFin: true },
    }),
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

  // Congés validés : intervalles par employé (un salarié en congé n'est pas planifiable ce jour-là).
  const congesParEmp = new Map<string, { debut: Date; fin: Date }[]>();
  for (const c of congesApprouves) {
    (congesParEmp.get(c.employeeId) ?? congesParEmp.set(c.employeeId, []).get(c.employeeId)!).push({
      debut: new Date(c.dateDebut),
      fin: new Date(c.dateFin),
    });
  }
  const estEnConge = (empId: string, d: Date) =>
    (congesParEmp.get(empId) ?? []).some((iv) => d >= iv.debut && d <= iv.fin);

  const lundiIso = (d: Date) => {
    const dow = d.getUTCDay();
    const l = new Date(d);
    l.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    return iso(l);
  };
  const posteOf = new Map(employees.map((e) => [e.id, e.poste]));
  // Durée réelle de chaque shift (heures) → planification À L'HEURE EXACTE : on vise les heures
  // hebdomadaires de chaque employé en additionnant la durée des shifts, au lieu de compter des jours.
  const dureeParShift = new Map(
    shifts.map((s) => [s.id, dureeShift({ heureDebut: s.heureDebut, heureFin: s.heureFin, dureeHeures: s.dureeHeures == null ? null : Number(s.dureeHeures) })]),
  );
  const EPS = 0.01;
  const cibleHeures = (e: { heuresHebdomadaires: unknown }) => Number(e.heuresHebdomadaires) || 48;
  // Plafond en JOURS — utilisé uniquement quand l'utilisateur force « nombre par semaine ».
  const capJours = nbParSemaine > 0 ? Math.min(joursActifs.size, nbParSemaine) : joursActifs.size;
  const joursPlats = [...joursParSemaine.values()].flat().sort((a, b) => a.getTime() - b.getTime());

  const aCreer: { employeeId: string; date: Date; shiftId: string }[] = [];
  // Résumé : besoins restés découverts (détail lisible) et salariés sous leurs heures.
  let besoinsNonCouverts = 0;
  const detailNonCouverts: string[] = [];
  let sousHeures = 0;

  if (besoins.length > 0) {
    // ===== Génération « couverture d'abord » : remplir chaque besoin (shift × poste × jour) =====
    const empsParPoste = new Map<string, typeof employees>();
    for (const e of employees) {
      (empsParPoste.get(e.poste) ?? empsParPoste.set(e.poste, []).get(e.poste)!).push(e);
    }
    const occupeJour = new Set<string>(); // `${empId}_${isoD}` — 1 seul shift/jour
    const joursSem = new Map<string, number>(); // `${empId}_${lundiIso}` — nb de jours (mode « nombre par semaine »)
    const heuresSem = new Map<string, number>(); // `${empId}_${lundiIso}` — heures déjà planifiées cette semaine
    const heuresTotales = new Map<string, number>(); // empId -> total heures sur la période (équité/rotation)
    const couverture = new Map<string, number>(); // `${isoD}_${shiftId}_${poste}` — déjà couvert
    const add = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

    // Place restante cette semaine pour un shift de durée `ds` :
    //   mode « nombre par semaine » → plafond en jours ;
    //   sinon → on vise les heures hebdo, en autorisant le dernier shift s'il rapproche de la cible
    //   (dépassement toléré jusqu'à un demi-shift → équivalent « à l'heure exacte »).
    const aDeLaPlace = (e: (typeof employees)[number], lundi: string, ds: number) =>
      nbParSemaine > 0
        ? (joursSem.get(`${e.id}_${lundi}`) ?? 0) < capJours
        : (heuresSem.get(`${e.id}_${lundi}`) ?? 0) <= cibleHeures(e) - ds / 2 + EPS;

    // Créneaux existants conservés (si on n'écrase pas) : comptent dans la couverture et les quotas.
    if (!ecraser) {
      for (const ex of existants) {
        const isoD = iso(new Date(ex.date));
        const ds = dureeParShift.get(ex.shiftId) ?? 0;
        const lundi = lundiIso(new Date(ex.date));
        occupeJour.add(`${ex.employeeId}_${isoD}`);
        add(joursSem, `${ex.employeeId}_${lundi}`);
        add(heuresSem, `${ex.employeeId}_${lundi}`, ds);
        add(heuresTotales, ex.employeeId, ds);
        const p = posteOf.get(ex.employeeId);
        if (p) add(couverture, `${isoD}_${ex.shiftId}_${p}`);
      }
    }
    const affecter = (empId: string, d: Date, shiftId: string, poste: string) => {
      const isoD = iso(d);
      const ds = dureeParShift.get(shiftId) ?? 0;
      aCreer.push({ employeeId: empId, date: d, shiftId });
      occupeJour.add(`${empId}_${isoD}`);
      add(joursSem, `${empId}_${lundiIso(d)}`);
      add(heuresSem, `${empId}_${lundiIso(d)}`, ds);
      add(heuresTotales, empId, ds);
      add(couverture, `${isoD}_${shiftId}_${poste}`);
    };

    // 1) Modèles hebdo (affectations fixes prioritaires) s'ils sont activés : comptent dans la couverture.
    if (utiliserModeles) {
      for (const emp of employees) {
        const mod = modeleParEmp.get(emp.id);
        if (!mod || mod.size === 0) continue;
        for (const d of joursPlats) {
          const shiftId = shiftDuModele(mod, d);
          if (!shiftId || occupeJour.has(`${emp.id}_${iso(d)}`) || estEnConge(emp.id, d)) continue;
          affecter(emp.id, d, shiftId, emp.poste);
        }
      }
    }

    // 2) Couverture : pour chaque jour × besoin du jour, compléter jusqu'au nombre requis.
    const besoinsParDow = new Map<number, typeof besoins>();
    for (const b of besoins) {
      (besoinsParDow.get(b.jourSemaine) ?? besoinsParDow.set(b.jourSemaine, []).get(b.jourSemaine)!).push(b);
    }
    for (const d of joursPlats) {
      const isoD = iso(d);
      const lundi = lundiIso(d);
      for (const b of besoinsParDow.get(d.getUTCDay()) ?? []) {
        if (!shiftsActifsIds.has(b.shiftId)) continue;
        const ds = dureeParShift.get(b.shiftId) ?? 0;
        let have = couverture.get(`${isoD}_${b.shiftId}_${b.poste}`) ?? 0;
        if (have >= b.nombreRequis) continue;
        const pool = (empsParPoste.get(b.poste) ?? []).filter(
          (e) =>
            !occupeJour.has(`${e.id}_${isoD}`) &&
            !estEnConge(e.id, d) &&
            aDeLaPlace(e, lundi, ds),
        );
        // Équité : d'abord ceux qui ont le moins d'heures au total, puis le moins cette semaine.
        pool.sort(
          (a, b2) =>
            (heuresTotales.get(a.id) ?? 0) - (heuresTotales.get(b2.id) ?? 0) ||
            (heuresSem.get(`${a.id}_${lundi}`) ?? 0) - (heuresSem.get(`${b2.id}_${lundi}`) ?? 0),
        );
        for (const e of pool) {
          if (have >= b.nombreRequis) break;
          affecter(e.id, d, b.shiftId, b.poste);
          have++;
        }
        // Titulaires insuffisants → POLYVALENCE : postes déclarés capables de couvrir ce besoin
        // (ex. « Chef » couvre « Commis cuisine »), mêmes règles (dispo, congés, heures, équité).
        if (have < b.nombreRequis) {
          const sources = polyvalences.filter((p) => p.posteCible === b.poste).map((p) => p.posteSource);
          const poolPoly = sources
            .flatMap((src) => empsParPoste.get(src) ?? [])
            .filter((e) => !occupeJour.has(`${e.id}_${isoD}`) && !estEnConge(e.id, d) && aDeLaPlace(e, lundi, ds));
          poolPoly.sort(
            (a, b2) =>
              (heuresTotales.get(a.id) ?? 0) - (heuresTotales.get(b2.id) ?? 0) ||
              (heuresSem.get(`${a.id}_${lundi}`) ?? 0) - (heuresSem.get(`${b2.id}_${lundi}`) ?? 0),
          );
          for (const e of poolPoly) {
            if (have >= b.nombreRequis) break;
            affecter(e.id, d, b.shiftId, b.poste);
            have++;
          }
        }
        if (have < b.nombreRequis) {
          const manque = b.nombreRequis - have;
          besoinsNonCouverts += manque;
          if (detailNonCouverts.length < 6) {
            const nomShift = shifts.find((s) => s.id === b.shiftId)?.nom ?? "shift";
            detailNonCouverts.push(`${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${nomShift} × ${b.poste} : manque ${manque}`);
          }
        }
      }
    }
  } else {
    // ===== Aucun besoin défini : ancienne logique centrée employé (rôle selon fiche / modèle) =====
    for (const emp of employees) {
      const modele = modeleParEmp.get(emp.id);
      if (modele && modele.size > 0) {
        for (const jours of joursParSemaine.values()) {
          for (const d of jours) {
            const shiftId = shiftDuModele(modele, d);
            if (!shiftId) continue;
            if (estEnConge(emp.id, d)) continue; // un salarié en congé approuvé n'est pas planifiable
            if (!ecraser && existSet.has(`${emp.id}_${iso(d)}`)) continue;
            aCreer.push({ employeeId: emp.id, date: d, shiftId });
          }
        }
        continue;
      }
      const shiftEmp = shiftPourEmploye(emp);
      if (!shiftEmp) continue;
      const ds = dureeParShift.get(shiftEmp.id) || (Number(emp.heuresParJour) || 8);
      const cible = cibleHeures(emp);
      // On remplit la semaine jusqu'à approcher au plus près les heures hebdo (à l'heure exacte),
      // ou jusqu'au nombre de jours forcé. Les créneaux existants comptent dans le total.
      for (const jours of joursParSemaine.values()) {
        let h = 0, j = 0;
        for (const d of jours) {
          if (estEnConge(emp.id, d)) continue; // un salarié en congé approuvé n'est pas planifiable
          const stop = nbParSemaine > 0 ? j >= capJours : h > cible - ds / 2 + EPS;
          if (stop) break;
          j++;
          h += ds;
          if (!ecraser && existSet.has(`${emp.id}_${iso(d)}`)) continue;
          aCreer.push({ employeeId: emp.id, date: d, shiftId: shiftEmp.id });
        }
      }
    }
  }

  // Salariés sous leurs heures hebdo sur la période (mode couverture : heures suivies précisément).
  if (besoins.length > 0) {
    const nbSemaines = Math.max(1, joursParSemaine.size);
    const totaux = new Map<string, number>();
    for (const c of aCreer) totaux.set(c.employeeId, (totaux.get(c.employeeId) ?? 0) + (dureeParShift.get(c.shiftId) ?? 0));
    if (!ecraser) for (const ex of existants) totaux.set(ex.employeeId, (totaux.get(ex.employeeId) ?? 0) + (dureeParShift.get(ex.shiftId) ?? 0));
    sousHeures = employees.filter((e) => (totaux.get(e.id) ?? 0) < cibleHeures(e) * nbSemaines - EPS).length;
  }

  // « Écraser » = régénérer toute la période (2 requêtes). Sinon on remplit seulement les vides.
  if (ecraser) {
    await prisma.planningCreneau.deleteMany({ where: { date: { gte: debut, lte: fin } } });
  }
  if (aCreer.length > 0) {
    await prisma.planningCreneau.createMany({ data: aCreer, skipDuplicates: true });
  }
  revalidatePath("/planning");
  return { crees: aCreer.length, besoinsNonCouverts, detailNonCouverts, sousHeures };
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

/**
 * Définit l'effectif requis pour un shift × poste × jour de la semaine (0=dim…6=sam).
 * nombreRequis ≤ 0 efface le besoin. Pilote la génération auto « couverture d'abord ».
 */
export async function definirBesoin(shiftId: string, poste: string, jourSemaine: number, nombreRequis: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  if (!shiftId || !poste || jourSemaine < 0 || jourSemaine > 6) return;
  const n = Math.round(Number(nombreRequis) || 0);
  if (n <= 0) {
    await prisma.besoinShift.deleteMany({ where: { shiftId, poste, jourSemaine } });
  } else {
    await prisma.besoinShift.upsert({
      where: { shiftId_poste_jourSemaine: { shiftId, poste, jourSemaine } },
      update: { nombreRequis: n },
      create: { shiftId, poste, jourSemaine, nombreRequis: n },
    });
  }
  revalidatePath("/planning");
}

/** Déclare qu'un poste peut en couvrir un autre au planning (ex. « Chef » couvre « Commis cuisine »). */
export async function definirPolyvalence(posteSource: string, posteCible: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const src = posteSource.trim(), cible = posteCible.trim();
  if (!src || !cible || src === cible) return;
  await prisma.polyvalencePoste.upsert({
    where: { posteSource_posteCible: { posteSource: src, posteCible: cible } },
    update: {},
    create: { posteSource: src, posteCible: cible },
  });
  revalidatePath("/planning");
}

export async function supprimerPolyvalence(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.polyvalencePoste.delete({ where: { id } });
  revalidatePath("/planning");
}
