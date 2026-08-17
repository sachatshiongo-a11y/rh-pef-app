import { describe, expect, it } from "vitest";
import { calculerEcarts, type EntreesEcart } from "@/lib/planning-ecart";

// GOLDEN — même brigade de référence que src/lib/planning-auto.golden.test.ts (mêmes id/poste),
// pour que les deux goldens parlent de la même équipe et que tout glissement de comportement, y
// compris non prévu, devienne visible.
//
// Quand il casse : lire le diff, décider si le changement est voulu, et seulement alors mettre à
// jour l'attendu — jamais l'inverse.

const d = (dateIso: string) => new Date(dateIso + "T00:00:00.000Z");

const SHIFTS = [
  { id: "matin-cuisine", nom: "Matin cuisine", dureeHeures: 8 },
  { id: "matin-salle", nom: "Matin/midi salle", dureeHeures: 8 },
  { id: "caisse", nom: "Caisse", dureeHeures: 8 },
];

const BRIGADE = [
  { id: "cuis-1", nom: "Cuisinier 1", poste: "Cuisinier" },
  { id: "cuis-2", nom: "Cuisinier 2", poste: "Cuisinier" },
  { id: "chef-1", nom: "Chef de partie", poste: "Chef de partie" },
  { id: "serv-1", nom: "Serveur 1", poste: "Serveur" },
  { id: "caiss-1", nom: "Caissière", poste: "Caissier" },
];

// Planning de la semaine du lundi 6 au dimanche 12 juillet 2026 :
//  - cuis-1 : matin-cuisine, Mon → Sam (6 j), repos dimanche.
//  - cuis-2 : matin-cuisine, Mon, Tue, Fri, Sam — en congé mercredi/jeudi (pas de créneau posé).
//  - chef-1 : matin-cuisine, Mon → Sam (6 j) — polyvalent, comble le trou laissé par le congé.
//  - serv-1 : matin-salle, Mon → Sam (6 j).
//  - caiss-1 : caisse, Mon → Sam (6 j).
const JOURS_OUVRES = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"];
const creneaux: EntreesEcart["creneaux"] = [
  ...JOURS_OUVRES.map((j) => ({ employeeId: "cuis-1", date: d(j), shiftId: "matin-cuisine" })),
  ...["2026-07-06", "2026-07-07", "2026-07-10", "2026-07-11"].map((j) => ({
    employeeId: "cuis-2", date: d(j), shiftId: "matin-cuisine",
  })),
  ...JOURS_OUVRES.map((j) => ({ employeeId: "chef-1", date: d(j), shiftId: "matin-cuisine" })),
  ...JOURS_OUVRES.map((j) => ({ employeeId: "serv-1", date: d(j), shiftId: "matin-salle" })),
  ...JOURS_OUVRES.map((j) => ({ employeeId: "caiss-1", date: d(j), shiftId: "caisse" })),
];

// Pointage de la semaine (Attendance.code) — quelques écarts volontaires et plausibles :
//  - cuis-1 : lundi non renseigné (trou de saisie), mercredi malade, le reste tenu.
//  - cuis-2 : présent les jours planifiés, en congé (C) mercredi/jeudi.
//  - chef-1 : présent toute la semaine, fiable.
//  - serv-1 : présent Mon → Ven, absence injustifiée samedi.
//  - caiss-1 : présent sauf jeudi (absence justifiée).
// Un seul jour hors planning : serv-1 travaille le dimanche (non prévu).
const codes: EntreesEcart["codes"] = [
  // cuis-1 : lundi 06 volontairement absent de cette liste (non renseigné)
  { employeeId: "cuis-1", date: d("2026-07-07"), code: "P" },
  { employeeId: "cuis-1", date: d("2026-07-08"), code: "M" },
  { employeeId: "cuis-1", date: d("2026-07-09"), code: "P" },
  { employeeId: "cuis-1", date: d("2026-07-10"), code: "P" },
  { employeeId: "cuis-1", date: d("2026-07-11"), code: "P" },

  { employeeId: "cuis-2", date: d("2026-07-06"), code: "P" },
  { employeeId: "cuis-2", date: d("2026-07-07"), code: "P" },
  { employeeId: "cuis-2", date: d("2026-07-08"), code: "C" },
  { employeeId: "cuis-2", date: d("2026-07-09"), code: "C" },
  { employeeId: "cuis-2", date: d("2026-07-10"), code: "P" },
  { employeeId: "cuis-2", date: d("2026-07-11"), code: "P" },

  ...JOURS_OUVRES.map((j) => ({ employeeId: "chef-1", date: d(j), code: "P" })),

  { employeeId: "serv-1", date: d("2026-07-06"), code: "P" },
  { employeeId: "serv-1", date: d("2026-07-07"), code: "P" },
  { employeeId: "serv-1", date: d("2026-07-08"), code: "P" },
  { employeeId: "serv-1", date: d("2026-07-09"), code: "P" },
  { employeeId: "serv-1", date: d("2026-07-10"), code: "P" },
  { employeeId: "serv-1", date: d("2026-07-11"), code: "N" },
  { employeeId: "serv-1", date: d("2026-07-12"), code: "P" }, // dimanche, hors planning

  { employeeId: "caiss-1", date: d("2026-07-06"), code: "P" },
  { employeeId: "caiss-1", date: d("2026-07-07"), code: "P" },
  { employeeId: "caiss-1", date: d("2026-07-08"), code: "P" },
  { employeeId: "caiss-1", date: d("2026-07-09"), code: "A" },
  { employeeId: "caiss-1", date: d("2026-07-10"), code: "P" },
  { employeeId: "caiss-1", date: d("2026-07-11"), code: "P" },
];

// Heures saisies — cuis-1 travaille samedi (code P) sans qu'aucune heure n'ait été saisie : le
// trou de saisie que la paie surveille déjà pour la clôture.
const heures: EntreesEcart["heures"] = [
  { employeeId: "cuis-1", date: d("2026-07-07"), heuresTravaillees: 8 },
  // 2026-07-08 : malade, pas d'heures — normal, pas de créneau P.
  { employeeId: "cuis-1", date: d("2026-07-09"), heuresTravaillees: 8 },
  { employeeId: "cuis-1", date: d("2026-07-10"), heuresTravaillees: 8 },
  // 2026-07-11 : présent (P) mais AUCUNE heure saisie — cas signalé par joursPresenceSansHeures.

  { employeeId: "cuis-2", date: d("2026-07-06"), heuresTravaillees: 8 },
  { employeeId: "cuis-2", date: d("2026-07-07"), heuresTravaillees: 8 },
  { employeeId: "cuis-2", date: d("2026-07-10"), heuresTravaillees: 8 },
  { employeeId: "cuis-2", date: d("2026-07-11"), heuresTravaillees: 8 },

  ...JOURS_OUVRES.map((j) => ({ employeeId: "chef-1", date: d(j), heuresTravaillees: 8 })),

  { employeeId: "serv-1", date: d("2026-07-06"), heuresTravaillees: 8 },
  { employeeId: "serv-1", date: d("2026-07-07"), heuresTravaillees: 8 },
  { employeeId: "serv-1", date: d("2026-07-08"), heuresTravaillees: 8 },
  { employeeId: "serv-1", date: d("2026-07-09"), heuresTravaillees: 8 },
  { employeeId: "serv-1", date: d("2026-07-10"), heuresTravaillees: 8 },
  // samedi : absence injustifiée, aucune heure.
  { employeeId: "serv-1", date: d("2026-07-12"), heuresTravaillees: 6 }, // dimanche hors planning

  { employeeId: "caiss-1", date: d("2026-07-06"), heuresTravaillees: 8 },
  { employeeId: "caiss-1", date: d("2026-07-07"), heuresTravaillees: 8 },
  { employeeId: "caiss-1", date: d("2026-07-08"), heuresTravaillees: 8 },
  // jeudi : absence justifiée, aucune heure.
  { employeeId: "caiss-1", date: d("2026-07-10"), heuresTravaillees: 8 },
  { employeeId: "caiss-1", date: d("2026-07-11"), heuresTravaillees: 8 },
];

const ENTREES: EntreesEcart = {
  debut: d("2026-07-06"),
  fin: d("2026-07-12"),
  employes: BRIGADE,
  shifts: SHIFTS,
  creneaux,
  codes,
  heures,
};

describe("GOLDEN — brigade de référence, écart prévu/réalisé, semaine du 6 juillet 2026", () => {
  it("produit une couverture et des écarts d'heures stables", () => {
    const r = calculerEcarts(ENTREES);

    const couvertureLisible = r.couverture.map(
      (l) =>
        `${l.date.toISOString().slice(0, 10)} | ${l.shiftId}×${l.poste} : ${l.tenus}/${l.prevus} tenus` +
        (l.manquants.length > 0
          ? ` — manquants: ${l.manquants.map((m) => `${m.employeeId}(${m.code ?? "non renseigné"})`).join(", ")}`
          : ""),
    );

    expect(couvertureLisible).toMatchSnapshot();
    expect(r.heures).toMatchSnapshot();
    expect(r.total).toMatchSnapshot();
  });

  it("respecte les invariants attendus, quoi qu'il arrive au reste du calcul", () => {
    const r = calculerEcarts(ENTREES);

    // Les totaux attendus sont écrits en dur (pas recalculés depuis `r` : une assertion qui dérive
    // du même résultat qu'elle vérifie reste vraie même si ce résultat est faux — c'est exactement
    // ce qui s'est produit avec un doublon (employeeId, date) avant la correction du module : 2 = 2
    // passait, alors que 2 était le chiffre en trop). Ces valeurs viennent de l'instantané golden ci-
    // dessus, relu et vérifié à la main pour cette brigade de référence.
    expect(r.total).toEqual({
      creneauxPrevus: 28,
      creneauxTenus: 24,
      creneauxAbsents: 3,
      creneauxNonRenseignes: 1,
      heuresPlanifiees: 224,
      heuresRealisees: 190,
    });
    // Chaque (date, shift, poste) n'apparaît qu'une seule fois dans la couverture — pas de ligne
    // dupliquée qui compterait deux fois le même besoin.
    const cles = r.couverture.map((l) => `${l.date.toISOString().slice(0, 10)}_${l.shiftId}_${l.poste}`);
    expect(new Set(cles).size).toBe(cles.length);
    // Le travail hors planning du dimanche de serv-1 ne crée aucun groupe de couverture le dimanche.
    expect(r.couverture.some((l) => l.date.toISOString().slice(0, 10) === "2026-07-12")).toBe(false);
    // Une ligne d'heures par employé de la brigade, dans l'ordre d'entrée.
    expect(r.heures.map((l) => l.employeeId)).toEqual(BRIGADE.map((e) => e.id));
  });
});
