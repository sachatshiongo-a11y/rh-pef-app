// Avatar à initiales avec couleur dérivée du nom (stable). Utilisé dans les listes façon « inbox ».
const COULEURS = [
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
];

export function initiales(nom: string): string {
  const parts = nom.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

export function Avatar({
  nom,
  taille = 36,
  photoUrl,
}: {
  nom: string;
  taille?: number;
  photoUrl?: string | null;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={nom}
        className="shrink-0 rounded-full object-cover"
        style={{ width: taille, height: taille }}
      />
    );
  }
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) >>> 0;
  const couleur = COULEURS[h % COULEURS.length];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${couleur}`}
      style={{ width: taille, height: taille, fontSize: taille * 0.38 }}
      aria-hidden
    >
      {initiales(nom)}
    </span>
  );
}
