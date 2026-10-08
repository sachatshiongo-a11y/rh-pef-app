"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formaterNombre } from "@/lib/montant";
import { estErreur } from "@/lib/action-lisible";
import { BoutonValider } from "@/components/action-buttons";
import { NOM_ESPACE, type DecisionAuto } from "@/lib/fiches/rattachement-resto";
import { conseilSignalement, conseilLivraison, type ArticleRestoSR, type LivraisonSR, type SignalementLivraison } from "@/lib/stock-restaurant";
import { rattacherLivraisonsAutomatiquement } from "./actions";

// Grille du restaurant : livraisons de la semaine qui n'alimentent PAS son stock, en trois groupes :
//  1. RATTACHABLES AUTOMATIQUEMENT (règle du 2026-10-08, lib/fiches/rattachement-resto.ts) : ce que
//     le bouton fera, ligne par ligne, AVANT le clic ; le bouton les traite en lot ;
//  2. À CHOISIR : non rattachées que la règle ne tranche pas (plusieurs candidats, homonyme…), avec
//     la raison — choix explicite dans la colonne « Article du catalogue » ;
//  3. À CORRIGER À LA MAIN : unités (non renseignée, incompatibles) et livraisons à répartir — jamais
//     corrigées automatiquement (ce serait deviner), avec le même conseil que Mouvements.
// Composant client : le compte-rendu du bouton reste affiché après le rafraîchissement, même quand
// il ne reste plus rien à signaler.

const q3 = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 3 });
const jjmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const quantite = (q: string, unite: string | null) => `${q3(q)}${unite ? ` ${unite}` : ""}`;
const pl = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;

type Automatique = Extract<DecisionAuto, { action: "RATTACHER" | "CREER" }>;
type CompteRendu = {
  rattaches: { designationResto: string; designationCatalogue: string; espace: "CUISINE" | "BAR" }[];
  crees: { designation: string; espace: "CUISINE" | "BAR"; unite: string; categorie: string }[];
  laisses: { designationCatalogue: string; raison: string }[];
};

/** Ce que le rattachement automatique fera pour une livraison (texte de la ligne). */
function annonce(d: Automatique): string {
  return d.action === "RATTACHER"
    ? `sera rattaché à « ${d.designationResto} » (${NOM_ESPACE[d.espace]})`
    : `sera ajouté au stock du restaurant : « ${d.designation} » (${NOM_ESPACE[d.espace]}, ${d.unite}, ${d.categorie})`;
}

export function BandeauLivraisons({ nonRattachees, signalements, articles, planAuto = [] }: {
  nonRattachees: LivraisonSR[]; signalements: SignalementLivraison[]; articles: ArticleRestoSR[];
  /** Plan du rattachement automatique, par article du catalogue (page.tsx → planRattachementAuto). */
  planAuto?: DecisionAuto[];
}) {
  const [isPending, start] = useTransition();
  const [compteRendu, setCompteRendu] = useState<CompteRendu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const parArticle = new Map(planAuto.map((d) => [d.articleStockId, d]));
  const automatique = (l: LivraisonSR): Automatique | null => { const d = parArticle.get(l.articleStockId); return d && d.action !== "LAISSER" ? d : null; };
  const auto = nonRattachees.filter((l) => automatique(l) !== null);
  const aChoisir = nonRattachees.filter((l) => automatique(l) === null);
  const idsAuto = [...new Set(auto.map((l) => l.articleStockId))];
  // Une livraison « à répartir » est signalée sur chaque article candidat : une seule ligne ici.
  const aCorriger = [...new Map(signalements.map((s) => [s.livraisonId, s])).values()];

  if (nonRattachees.length === 0 && aCorriger.length === 0 && !compteRendu && !erreur) return null;

  const rattacher = () => {
    setErreur(null); setCompteRendu(null);
    start(async () => {
      const r = await rattacherLivraisonsAutomatiquement(idsAuto);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setCompteRendu(r);
    });
  };

  const lienCatalogue = (id: string, designation: string) => (
    <Link href={`/stock/catalogue/${id}`} className="font-medium text-primary hover:underline">{designation}</Link>
  );
  const sousTitre = "mt-1 text-xs font-semibold";

  return (
    <section className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {(nonRattachees.length > 0 || aCorriger.length > 0) && (
        <p className="font-semibold">Livraisons de la semaine non prises en compte dans le stock du restaurant</p>
      )}

      {auto.length > 0 && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={sousTitre}>Rattachables automatiquement ({pl(idsAuto.length, "article")})</p>
            <BoutonValider disabled={isPending} onClick={rattacher}>
              {isPending ? "Rattachement…" : `Rattacher automatiquement (${idsAuto.length})`}
            </BoutonValider>
          </div>
          <ul className="space-y-1 text-xs">
            {auto.map((l) => (
              <li key={l.id} className="min-w-0 break-words">
                {jjmm(l.date)} — {lienCatalogue(l.articleStockId, l.designation)} ({quantite(l.quantite, l.uniteCatalogue)}) — {annonce(automatique(l)!)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {aChoisir.length > 0 && (
        <div className="space-y-1">
          <p className={sousTitre}>À choisir ({pl(aChoisir.length, "livraison")})</p>
          <ul className="space-y-1 text-xs">
            {aChoisir.map((l) => {
              const d = parArticle.get(l.articleStockId);
              const texte = d?.action === "LAISSER" ? d.raison : conseilLivraison({ etat: "NON_RATTACHE" }, l.articleStockId, articles)!.texte;
              return (
                <li key={l.id} className="min-w-0 break-words">
                  {jjmm(l.date)} — {lienCatalogue(l.articleStockId, l.designation)} ({quantite(l.quantite, l.uniteCatalogue)}) —{" "}
                  <a href="#grille-restaurant" className="font-medium underline">{texte}</a>
                  <span className="text-amber-800"> (colonne « Article du catalogue »)</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {aCorriger.length > 0 && (
        <div className="space-y-1">
          <p className={sousTitre}>À corriger à la main ({pl(aCorriger.length, "livraison")})</p>
          <ul className="space-y-1 text-xs">
            {aCorriger.map((s) => {
              const c = conseilSignalement(s, articles);
              return (
                <li key={s.livraisonId} className="min-w-0 break-words">
                  {jjmm(s.date)} — {lienCatalogue(s.articleStockId, s.designation)} ({quantite(s.quantite, s.uniteCatalogue)}) —{" "}
                  <Link href={c.href} className="font-medium underline">{c.texte}</Link>
                  {s.candidats && <span className="text-amber-800"> ({s.candidats.join(", ")})</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {erreur && <p role="alert" className="text-xs text-destructive">{erreur}</p>}
      {compteRendu && (
        <div role="status" className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
          <p className="font-semibold">
            Rattachement automatique : {pl(compteRendu.rattaches.length, "rattaché")} · {pl(compteRendu.crees.length, "créé")} · {pl(compteRendu.laisses.length, "laissé")}
          </p>
          <ul className="space-y-0.5">
            {compteRendu.rattaches.map((r, i) => <li key={`r${i}`}>« {r.designationCatalogue} » → rattaché à « {r.designationResto} » ({NOM_ESPACE[r.espace]})</li>)}
            {compteRendu.crees.map((c, i) => <li key={`c${i}`}>« {c.designation} » ajouté au stock du restaurant ({NOM_ESPACE[c.espace]}, {c.unite}, {c.categorie}) — stock de base à renseigner</li>)}
            {compteRendu.laisses.map((l, i) => <li key={`l${i}`} className="text-amber-900">« {l.designationCatalogue} » laissé : {l.raison}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
