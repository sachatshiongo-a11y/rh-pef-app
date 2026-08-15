import { Icone } from "@/components/icones";

// Vignette d'un plat (fiches techniques) : cadre RECTANGULAIRE, jamais un cercle. `Avatar`
// (src/components/avatar.tsx) recadre en cercle — juste pour un visage, où rogner les bords n'ôte
// rien d'utile. Un plat, c'est l'inverse : le dressage se lit justement dans la composition de
// l'assiette, jusqu'aux bords. Un cadrage rond la mutilerait.
//
// Deux tailles : « mini » (carré à coins arrondis, listes) et « grande » (format paysage 3:2,
// fiche — assez grand pour vraiment distinguer le dressage). Sans photo : un cadre en pointillés
// avec une icône neutre, même grammaire que `EtatVide` (src/components/etat-vide.tsx) — jamais un
// trou vide.

export function VignettePlat({
  nom,
  photoUrl,
  taille = "mini",
}: {
  nom: string;
  photoUrl: string | null;
  taille?: "mini" | "grande";
}) {
  const cadre = taille === "mini" ? "h-8 w-8 shrink-0 rounded-md" : "aspect-[3/2] w-full rounded-lg";

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt={nom} className={`${cadre} border object-cover`} />
    );
  }
  return (
    <div className={`${cadre} flex flex-col items-center justify-center gap-1 border border-dashed bg-muted/40 text-muted-foreground`} aria-hidden>
      <Icone nom="marmite" taille={taille === "mini" ? 14 : 22} />
      {taille === "grande" && <span className="text-[11px]">Pas encore de photo</span>}
    </div>
  );
}
