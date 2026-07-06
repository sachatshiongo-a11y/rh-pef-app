export type EvenementTimeline = {
  date: Date;
  icone: string;
  titre: string;
  detail?: string;
};

/** Chronologie verticale des événements d'un employé (du plus récent au plus ancien). */
export function Timeline({ evenements }: { evenements: EvenementTimeline[] }) {
  const tries = [...evenements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (tries.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun événement enregistré.</p>;
  }

  return (
    <ol className="relative ml-2 border-l pl-6">
      {tries.map((e, i) => (
        <li key={i} className="mb-5 last:mb-0">
          <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-card text-xs ring-1 ring-border">
            {e.icone}
          </span>
          <p className="text-xs text-muted-foreground">
            {new Date(e.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
          <p className="text-sm font-medium">{e.titre}</p>
          {e.detail && <p className="text-sm text-muted-foreground">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
