// Barre de couverture des effectifs requis (BesoinShift) : un badge par jour « couvert/requis »,
// vert si complet, orange si sous-effectif (détail des manques au survol). Rendu serveur : les
// server actions du planning revalident la page, la barre se met donc à jour après chaque saisie.

export type CouvertureJour = {
  iso: string;
  label: string;
  requis: number;
  couvert: number;
  manques: string[]; // ex. « Matin cuisine · Cuisinier : 2/3 »
};

export function calculerCouverture(params: {
  besoins: { shiftId: string; poste: string; jourSemaine: number; nombreRequis: number }[];
  employees: { id: string; poste: string }[];
  creneauMap: Record<string, string>; // `${employeeId}_${iso}` -> shiftId
  isoDates: string[];
  labelsJours: string[];
  nomShift: (id: string) => string;
}): CouvertureJour[] {
  const { besoins, employees, creneauMap, isoDates, labelsJours, nomShift } = params;
  return isoDates.map((iso, i) => {
    const dow = new Date(iso + "T00:00:00Z").getUTCDay();
    let requis = 0;
    let couvert = 0;
    const manques: string[] = [];
    for (const b of besoins) {
      if (b.jourSemaine !== dow) continue;
      const present = employees.filter((e) => e.poste === b.poste && creneauMap[`${e.id}_${iso}`] === b.shiftId).length;
      requis += b.nombreRequis;
      couvert += Math.min(present, b.nombreRequis);
      if (present < b.nombreRequis) manques.push(`${nomShift(b.shiftId)} · ${b.poste} : ${present}/${b.nombreRequis}`);
    }
    return { iso, label: labelsJours[i], requis, couvert, manques };
  });
}

export function CouvertureBar({ jours, isoAujourdhui }: { jours: CouvertureJour[]; isoAujourdhui: string }) {
  if (jours.every((j) => j.requis === 0)) return null;
  return (
    <div className="mb-4 rounded-xl border bg-card p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Couverture des effectifs requis
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {jours.map((j) => {
          const complet = j.couvert >= j.requis;
          return (
            <div
              key={j.iso}
              title={j.manques.length > 0 ? `Manque :\n${j.manques.join("\n")}` : "Effectifs complets"}
              className={`shrink-0 rounded-lg border px-2 py-1 text-center text-[11px] ${
                j.requis === 0
                  ? "text-muted-foreground"
                  : complet
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-orange-300 bg-orange-50 text-orange-800"
              } ${j.iso === isoAujourdhui ? "ring-2 ring-primary/40" : ""}`}
            >
              <div className="whitespace-nowrap font-medium">{j.label}</div>
              <div className="font-semibold">
                {j.requis === 0 ? "—" : `${j.couvert}/${j.requis}`}
                {j.requis > 0 && (complet ? " ✓" : " ⚠")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
