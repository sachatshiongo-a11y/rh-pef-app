import Link from "next/link";
import { formaterNombre } from "@/lib/montant";
import { conseilSignalement, conseilLivraison, type ArticleRestoSR, type LivraisonSR, type SignalementLivraison } from "@/lib/stock-restaurant";

// Grille du restaurant : livraisons de la semaine qui n'alimentent PAS son stock, avec le même conseil
// (texte + lien) que l'avertissement de Mouvements. Composant de présentation, rendu côté serveur.

const q3 = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 3 });
const jjmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const quantite = (q: string, unite: string | null) => `${q3(q)}${unite ? ` ${unite}` : ""}`;

export function BandeauLivraisons({ nonRattachees, signalements, articles }: {
  nonRattachees: LivraisonSR[]; signalements: SignalementLivraison[]; articles: ArticleRestoSR[];
}) {
  // Une livraison « à répartir » est signalée sur chaque article candidat : une seule ligne ici.
  const uniques = [...new Map(signalements.map((s) => [s.livraisonId, s])).values()];
  if (nonRattachees.length === 0 && uniques.length === 0) return null;
  return (
    <section className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">Livraisons de la semaine non prises en compte dans le stock du restaurant</p>
      <ul className="space-y-1 text-xs">
        {nonRattachees.map((l) => {
          const c = conseilLivraison({ etat: "NON_RATTACHE" }, l.articleStockId, articles)!;
          return (
            <li key={l.id} className="min-w-0 break-words">
              {jjmm(l.date)} — <Link href={`/stock/catalogue/${l.articleStockId}`} className="font-medium text-primary hover:underline">{l.designation}</Link>{" "}
              ({quantite(l.quantite, l.uniteCatalogue)}) — <a href="#grille-restaurant" className="font-medium underline">{c.texte}</a>
              <span className="text-amber-800"> (colonne « Article du catalogue »)</span>
            </li>
          );
        })}
        {uniques.map((s) => {
          const c = conseilSignalement(s, articles);
          return (
            <li key={s.livraisonId} className="min-w-0 break-words">
              {jjmm(s.date)} — <Link href={`/stock/catalogue/${s.articleStockId}`} className="font-medium text-primary hover:underline">{s.designation}</Link>{" "}
              ({quantite(s.quantite, s.uniteCatalogue)}) — <Link href={c.href} className="font-medium underline">{c.texte}</Link>
              {s.candidats && <span className="text-amber-800"> ({s.candidats.join(", ")})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
