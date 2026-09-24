import Link from "next/link";
import { formaterNombre } from "@/lib/montant";
import {
  libelleRaison,
  type DetailArticleDispo, type DetailLigneDispo, type ResultatDisponibilite,
} from "@/lib/fiches/disponibilite";
import { DISPO_CLASSE } from "../_data/fiche-calc";

// Disponibilité sur la page d'une fiche : pure présentation du résultat de `calculerDisponibilite`
// (aucun calcul ici). Quantités par `formaterNombre` (montant.ts), jamais un formateur local.

const q = (v: string | null) => (v === null ? "—" : formaterNombre(Number(v), { maximumFractionDigits: 3 }));
/** « 2026-09-22 » → « 22/09/2026 » (date PURE, aucune conversion de fuseau). */
const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

const ETAT_LABEL = { DISPONIBLE: "Disponible", RUPTURE: "En rupture", A_VERIFIER: "À vérifier" } as const;

export function BlocDisponibilite({
  dispo, estSousRecette, rendement,
}: {
  dispo: ResultatDisponibilite;
  estSousRecette: boolean;
  /** Sous-recette : son rendement lisible (« 1 000 g »). */
  rendement: string | null;
}) {
  const unite = estSousRecette ? (rendement ? `× ${rendement}` : "fournée(s)") : "portion(s)";
  const limitant = dispo.limitantId ? dispo.articles.find((a) => a.articleId === dispo.limitantId) : undefined;
  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-2 text-base font-semibold">Disponibilité selon le stock</h2>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${DISPO_CLASSE[dispo.etat]}`}>{ETAT_LABEL[dispo.etat]}</span>
        {dispo.portions !== null && <span className="text-lg font-semibold tabular-nums">{dispo.portions} {unite}</span>}
      </div>
      {limitant && (
        <p className="mt-1 text-sm">
          Ingrédient limitant :{" "}
          <Link href={`/stock/catalogue/${limitant.articleId}`} className="font-medium text-primary hover:underline">{limitant.designation}</Link>
        </p>
      )}
      {dispo.etat === "RUPTURE" && <p className="mt-1 text-sm text-red-800">Manque : {dispo.enRupture.join(", ")}</p>}
      {dispo.raisons.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">À vérifier — {dispo.raisons.length} raison(s). Rien n&apos;est compté zéro en silence :</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {dispo.raisons.map((r, i) => <li key={`${r.motif}-${i}`}>{libelleRaison(r)}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Stock = dépôt + restaurant (dernier comptage des articles du restaurant rattachés au catalogue).</p>
    </section>
  );
}

/** Cellule « Stock » d'une ligne : total dans l'unité de l'article, puis dépôt / restaurant. */
export function CelluleStock({ detail, estSousRecette }: { detail: DetailArticleDispo | undefined; estSousRecette: boolean }) {
  if (estSousRecette) return <span className="text-[11px] text-muted-foreground">voir la sous-recette</span>;
  if (!detail) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <span className="font-medium tabular-nums">{detail.disponible === null ? "—" : `${q(detail.disponible)} ${detail.unite}`}</span>
      <div className="text-[11px] text-muted-foreground">
        dépôt {q(detail.depot)} · resto {q(detail.restaurant)}
        {detail.dateComptage && ` (compté le ${jjmmaaaa(detail.dateComptage)})`}
      </div>
    </div>
  );
}

/** Cellule « Portions possibles » d'une ligne, avec ses raisons « À vérifier » écrites en clair. */
export function CellulePortions({
  ligne, details, limitante,
}: {
  ligne: DetailLigneDispo | undefined;
  details: Map<string, DetailArticleDispo>;
  limitante: boolean;
}) {
  if (!ligne) return <span className="text-muted-foreground">—</span>;
  const raisons = [
    ...ligne.raisons.map(libelleRaison),
    ...ligne.articleIds.flatMap((id) => {
      const d = details.get(id);
      return d?.motif ? [libelleRaison({ motif: d.motif, ingredient: d.designation })] : [];
    }),
  ];
  return (
    <div>
      <span className="font-medium tabular-nums">{ligne.portions === null ? "—" : ligne.portions}</span>
      {limitante && <div className="text-[11px] font-medium text-amber-800">Ingrédient limitant</div>}
      {raisons.map((r, i) => (
        <div key={`${r}-${i}`} className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">{r}</div>
      ))}
    </div>
  );
}
