import type { ScanPointage, SourcePointage } from "@prisma/client";
import { verdictDe } from "@/lib/pointage-scan";
import { libelleMotif, libellePause, scanAVerifier } from "@/lib/pointage-qr";
import { heuresPayables, pauseDuJour } from "@/lib/pointage-jour";
import { heureKinshasa } from "@/lib/heure-kinshasa";
import type { LigneSuivi } from "./suivi-bulk";

// Les lignes du Suivi des pointages (page `pointer/suivi`), sorties de la page pour être TESTÉES
// (`lignes-suivi.test.ts`) : heures, pause et total du jour. Les heures sont celles PAYÉES —
// `heuresPayables`, la même fonction que celle qui écrit aux présences : la pause par défaut
// s'affiche « non déduite » et ne retire rien (décision d'argent de la Direction du 2026-09-29).

// « QR », « manuel », « appli (ancien) » (brief) — IVMS n'arrive jamais sur ce modèle en pratique
// (réservé à l'import de présences), mais un libellé neutre évite un badge vide si ça change.
const LABEL_SOURCE: Record<SourcePointage, string> = {
  QR: "QR",
  MANUEL: "manuel",
  APP: "appli (ancien)",
  IVMS_RAPPORT: "IVMS",
  IVMS_API: "IVMS",
};

type EmployeSuivi = { id: string; nom: string; photoUrl: string | null };
type ScanSuivi = Pick<ScanPointage, "id" | "moment" | "verdict" | "motif" | "distanceM" | "precisionM" | "verifieLe">;
type PointageSuivi = {
  id: string;
  employeeId: string;
  heureDebut: Date;
  heureFin: Date | null;
  pauseMinutes: number;
  pauseParDefaut: boolean;
  source: SourcePointage;
  scans: ScanSuivi[];
};

export function lignesSuivi(employees: EmployeSuivi[], pointages: PointageSuivi[]) {
  const parEmp = new Map(pointages.map((p) => [p.employeeId, p]));

  const lignesBrutes = employees.map((e) => {
    const p = parEmp.get(e.id);
    const heures = p?.heureFin ? heuresPayables({ ...p, heureFin: p.heureFin }) : null;
    const statut: LigneSuivi["statut"] = !p ? "ABSENT" : p.heureFin ? "TERMINE" : "EN_COURS";

    const scans = p?.scans ?? [];
    // « À vérifier » se DÉRIVE des scans (un scan A_VERIFIER sans `verifieLe`) — jamais un booléen
    // recopié sur Pointage, même règle que la signature électronique. `scanAVerifier` est la
    // fonction pure testée dans `pointage-qr.test.ts` ; on ne la réécrit pas ici.
    const badgeArriveeScan = scanAVerifier(scans, "ARRIVEE");
    const badgeDepartScan = scanAVerifier(scans, "DEPART");
    const departScanneSansPause = !p?.heureFin && scans.some((s) => s.moment === "DEPART");
    const pause = p ? pauseDuJour(p) : null;

    const ligne: LigneSuivi = {
      employeeId: e.id,
      nom: e.nom,
      photoUrl: e.photoUrl,
      pointageId: p?.id ?? null,
      arriveeLabel: p ? heureKinshasa(p.heureDebut) : "—",
      departLabel: p?.heureFin ? heureKinshasa(p.heureFin) : departScanneSansPause ? "départ scanné, pause non saisie" : "—",
      // La pause posée d'office au départ (30 min) se lit « pause par défaut 30 min (non déduite) »,
      // jamais comme saisie ; une pause saisie (déduite) se lit en minutes.
      pauseLabel: !pause ? "—" : pause.parDefaut ? libellePause(pause) : `${pause.minutesDeduites} min`,
      heuresLabel: heures !== null ? `${heures.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h` : "—",
      statut,
      sourceLabel: p ? LABEL_SOURCE[p.source] : null,
      badgeArrivee: badgeArriveeScan ? `À vérifier · ${libelleMotif(verdictDe(badgeArriveeScan))}` : null,
      badgeDepart: badgeDepartScan ? `À vérifier · ${libelleMotif(verdictDe(badgeDepartScan))}` : null,
      aVerifier: !!badgeArriveeScan || !!badgeDepartScan,
    };
    return { ligne, statut, heures };
  });

  return {
    lignes: lignesBrutes.map((l) => l.ligne),
    nbTermine: lignesBrutes.filter((l) => l.statut === "TERMINE").length,
    nbEnCours: lignesBrutes.filter((l) => l.statut === "EN_COURS").length,
    nbAbsent: lignesBrutes.filter((l) => l.statut === "ABSENT").length,
    totalHeures: Math.round(lignesBrutes.reduce((s, l) => s + (l.heures ?? 0), 0) * 100) / 100,
  };
}
