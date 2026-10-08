// Abréviations des shifts pour les cases étroites de la vue Mois du Planning (31 colonnes de ~25 px).
// Deux shifts ne donnent JAMAIS la même abréviation : « Matin » et « Maintenance » ne peuvent pas
// s'afficher tous deux « Ma ». On allonge, pour les seuls shifts en conflit, jusqu'à ce qu'elles diffèrent.

const majuscule = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/** Candidats du plus court au plus long : initiales (nom à plusieurs mots), puis préfixes de 2, 3… lettres, puis le nom entier. */
function candidats(nom: string): string[] {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  const complet = mots.join(" ");
  const liste: string[] = [];
  if (mots.length > 1) liste.push(mots.slice(0, 2).map((m) => m[0]).join("").toUpperCase());
  for (let n = 2; n < complet.length; n++) liste.push(complet.slice(0, n));
  liste.push(complet);
  return [...new Set(liste.map(majuscule))];
}

export function abreviationsShifts(shifts: { id: string; nom: string }[]): Map<string, string> {
  const cands = new Map(shifts.map((s) => [s.id, candidats(s.nom)]));
  const rang = new Map(shifts.map((s) => [s.id, 0]));
  const lire = (id: string) => { const c = cands.get(id)!; return c[Math.min(rang.get(id)!, c.length - 1)]; };
  for (let tour = 0; tour < 64; tour++) {
    const parLabel = new Map<string, string[]>();
    for (const s of shifts) parLabel.set(lire(s.id), [...(parLabel.get(lire(s.id)) ?? []), s.id]);
    let conflit = false;
    for (const ids of parLabel.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        if (rang.get(id)! < cands.get(id)!.length - 1) { rang.set(id, rang.get(id)! + 1); conflit = true; }
      }
    }
    if (!conflit) break;
  }
  return new Map(shifts.map((s) => [s.id, lire(s.id)]));
}
