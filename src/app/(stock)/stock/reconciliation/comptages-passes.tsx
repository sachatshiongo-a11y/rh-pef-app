import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { MoisAccordeon } from "@/components/mois-accordeon";
import { Pagination } from "@/components/pagination";
import { prisma } from "@/lib/prisma";
import { DOMAINE_LABEL } from "@/lib/stock";
import { grouperParMois } from "@/lib/dates-fr";
import { PLAFOND_TOUT, fenetrePage, groupePartiel, type ParPage } from "@/lib/pagination";

const jfr = (d: Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

/**
 * Onglet « Comptages passés » de Réconciliation (plan d'ergonomie, V3) : l'historique complet des
 * comptages, qui vivait dans Archives. Pagination côté serveur (skip/take + count) ; un mois coupé par
 * une frontière de page ne montre que le compteur de la PAGE : on le dit. La fiche d'un comptage
 * garde son adresse (/stock/archives/<id>) : des notifications déjà envoyées y mènent.
 */
export async function ComptagesPasses({ page, par, sp }: { page: number; par: ParPage; sp: Record<string, string | undefined> }) {
  const nb = await prisma.sessionComptage.count();
  const fen = fenetrePage(nb, page, par, PLAFOND_TOUT);
  const sessions = await prisma.sessionComptage.findMany({ orderBy: [{ date: "desc" }, { id: "asc" }], skip: fen.skip, take: fen.take });
  if (nb === 0) return <EtatVide message="Aucun comptage archivé." />;
  const groupes = grouperParMois(sessions, (s) => s.date);
  return (
    <div className="space-y-2">
      {groupes.map((g, i) => (
        <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} comptage(s)${groupePartiel(i, groupes.length, fen) ? " sur cette page" : ""}`} defaultOpen={i === 0}>
          <ul className="divide-y border-t text-sm">
            {g.items.map((s) => (
              <li key={s.id}>
                <Link href={`/stock/archives/${s.id}`} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-accent/40">
                  <span className="min-w-0">
                    <span className="font-medium">{jfr(s.date)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.domaine ? DOMAINE_LABEL[s.domaine] ?? s.domaine : "Tous"} · {s.nbArticles} articles · {s.nbEcarts} écart(s)</span>
                  </span>
                  {s.nbHorsTol > 0 ? <span className="shrink-0 text-xs font-semibold text-red-700">{s.nbHorsTol} hors tol.</span> : <span className="shrink-0 text-xs text-muted-foreground">0 hors tol.</span>}
                </Link>
              </li>
            ))}
          </ul>
        </MoisAccordeon>
      ))}
      <Pagination plafondTout={PLAFOND_TOUT} total={nb} page={fen.page} par={par} chemin="/stock/reconciliation" params={sp} libelle="comptages" />
    </div>
  );
}
