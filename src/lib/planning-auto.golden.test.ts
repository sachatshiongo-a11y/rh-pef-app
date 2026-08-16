import { describe, expect, it } from "vitest";
import { genererPlanning, type EntreesGeneration } from "@/lib/planning-auto";

// GOLDEN — une brigade de référence réaliste et son planning figé. Ce test n'a pas vocation à
// prouver une règle précise (les autres s'en chargent) mais à rendre VISIBLE tout changement de
// comportement, y compris ceux qu'on n'avait pas prévus.
//
// Quand il casse : lire le diff, décider si le changement est voulu, et seulement alors mettre à
// jour l'attendu — jamais l'inverse. Même convention que src/lib/fiches/golden.integration.test.ts.

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

const SHIFTS = [
  { id: "matin-cuisine", nom: "Matin cuisine", dureeHeures: 8 },
  { id: "soir-cuisine", nom: "Soir cuisine", dureeHeures: 8 },
  { id: "matin-salle", nom: "Matin/midi salle", dureeHeures: 8 },
  { id: "caisse", nom: "Caisse", dureeHeures: 8 },
];

const BRIGADE = [
  { id: "cuis-1", nom: "Cuisinier 1", poste: "Cuisinier", secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "cuis-2", nom: "Cuisinier 2", poste: "Cuisinier", secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "chef-1", nom: "Chef de partie", poste: "Chef de partie", secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "serv-1", nom: "Serveur 1", poste: "Serveur", secteur: "Salle", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "caiss-1", nom: "Caissière", poste: "Caissier", secteur: "Salle", heuresParJour: 8, heuresHebdomadaires: 48 },
];

/** Semaine du lundi 6 au dimanche 12 juillet 2026. */
const ENTREES: EntreesGeneration = {
  debut: d("2026-07-06"),
  fin: d("2026-07-12"),
  employes: BRIGADE,
  shifts: SHIFTS,
  besoins: [1, 2, 3, 4, 5, 6].flatMap((j) => [
    { shiftId: "matin-cuisine", poste: "Cuisinier", jourSemaine: j, nombreRequis: 2 },
    { shiftId: "matin-salle", poste: "Serveur", jourSemaine: j, nombreRequis: 1 },
    { shiftId: "caisse", poste: "Caissier", jourSemaine: j, nombreRequis: 1 },
  ]),
  shiftsPoste: [
    { poste: "Cuisinier", shiftId: "matin-cuisine", ordre: 0 },
    { poste: "Cuisinier", shiftId: "soir-cuisine", ordre: 1 },
    { poste: "Chef de partie", shiftId: "matin-cuisine", ordre: 0 },
    { poste: "Serveur", shiftId: "matin-salle", ordre: 0 },
    { poste: "Caissier", shiftId: "caisse", ordre: 0 },
  ],
  polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
  modeles: [],
  conges: [{ employeeId: "cuis-2", dateDebut: d("2026-07-08"), dateFin: d("2026-07-09") }],
  feries: [],
  existants: [],
  historique: [],
  options: {
    jours: [1, 2, 3, 4, 5, 6],
    nbParSemaine: 0,
    inclureFeries: false,
    utiliserModeles: true,
    ecraser: true,
    completer: true,
    autoriserDepassementHeures: false,
  },
};

describe("GOLDEN — brigade de référence, semaine du 6 juillet 2026", () => {
  it("produit un planning stable et explicable", () => {
    const r = genererPlanning(ENTREES);

    // Forme lisible : « jour | employé | shift », triée, pour que le diff soit parlant.
    const lignes = r.creneaux
      .map((c) => `${c.date.toISOString().slice(0, 10)} | ${c.employeeId} | ${c.shiftId}`)
      .sort();

    expect(lignes).toMatchSnapshot();
    expect({
      crees: r.rapport.crees,
      trous: r.rapport.trous.map((t) => `${t.date.toISOString().slice(0, 10)} ${t.shiftId}×${t.poste} manque ${t.manque} (${t.raison})`),
      sansShiftPoste: r.rapport.sansShiftPoste,
      depassements: r.rapport.depassements.length,
      sousHeures: r.rapport.sousHeures.map((s) => s.employeeId),
    }).toMatchSnapshot();
  });

  it("respecte les invariants, quoi qu'il arrive au reste du planning", () => {
    const r = genererPlanning(ENTREES);

    // Un seul shift par personne et par jour.
    const cles = r.creneaux.map((c) => `${c.employeeId}_${c.date.toISOString().slice(0, 10)}`);
    expect(new Set(cles).size).toBe(cles.length);

    // Jamais plus de 6 jours dans la semaine.
    for (const emp of BRIGADE) {
      const n = r.creneaux.filter((c) => c.employeeId === emp.id).length;
      expect(n, `${emp.nom} travaille ${n} jours`).toBeLessThanOrEqual(6);
    }

    // Aucun créneau pendant le congé de cuis-2.
    const pendantConge = r.creneaux.filter(
      (c) => c.employeeId === "cuis-2" && ["2026-07-08", "2026-07-09"].includes(c.date.toISOString().slice(0, 10)),
    );
    expect(pendantConge).toEqual([]);

    // Sans l'option de dépassement, aucun dépassement n'est engagé.
    expect(r.rapport.depassements).toEqual([]);
  });
});
