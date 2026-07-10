import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { qte, DOMAINE_LABEL } from "@/lib/stock";
import { ImprimerBtn, AutoPrint } from "./imprimer-btn";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string; auto?: string };

// Fiche de comptage imprimable (page HTML légère, imprimée / enregistrée en PDF par le navigateur).
// Remplace l'ancien PDF serveur (react-pdf) qui saturait Render sur ~491 articles.
export default async function FicheComptagePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;
  const auto = sp.auto === "1";

  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({
    where,
    orderBy: [{ domaine: "asc" }, { designation: "asc" }],
    include: { stock: true, categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } } },
  });

  // Regroupe par domaine puis par catégorie (comme les catalogues), pour compter catégorie par catégorie.
  const SANS_CAT = "Sans catégorie";
  const parDomaine = new Map<string, Map<string, typeof articles>>();
  for (const a of articles) {
    const cat = a.categorie?.nom ?? SANS_CAT;
    if (!parDomaine.has(a.domaine)) parDomaine.set(a.domaine, new Map());
    const cats = parDomaine.get(a.domaine)!;
    if (!cats.has(cat)) cats.set(cat, []);
    cats.get(cat)!.push(a);
  }
  const trierCats = (cats: Map<string, typeof articles>) =>
    [...cats.entries()].sort(([a], [b]) =>
      a === SANS_CAT ? 1 : b === SANS_CAT ? -1 : a.localeCompare(b, "fr"));
  const dateJour = new Date().toLocaleDateString("fr-FR");

  return (
    <div>
      {auto && <AutoPrint />}
      <style>{`
        @media print {
          aside, .no-print { display: none !important; }
          main { overflow: visible !important; }
          @page { margin: 12mm; }
        }
        .fiche table { width: 100%; border-collapse: collapse; }
        .fiche th, .fiche td { border: 0.5pt solid #cbb89a; padding: 3px 6px; font-size: 11px; text-align: left; }
        .fiche th { background: #f5ecd9; }
        .fiche td.cat { background: #efe4cd; font-weight: 600; }
        .fiche .vide { width: 80px; color: #bbb; }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/stock/reconciliation" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">← Retour</Link>
          <div>
            <h1 className="text-xl font-semibold">Fiche de comptage — Inventaire</h1>
            <p className="text-sm text-muted-foreground">Imprimez cette page ou enregistrez-la en PDF pour compter à la main.</p>
          </div>
        </div>
        <ImprimerBtn />
      </div>

      <div className="fiche space-y-6">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-pates-en-folie.png" alt="Pâtes en Folie" style={{ height: 48, width: "auto" }} />
            <div>
              <h2 className="text-lg font-semibold">Fiche de comptage — {domaine ? DOMAINE_LABEL[domaine] : "Inventaire"}</h2>
              <p className="text-sm text-muted-foreground">TOLYA SARL · {dateJour} · {articles.length} article(s)</p>
            </div>
          </div>
        </div>

        {[...parDomaine.entries()].map(([dom, cats]) => (
          <div key={dom}>
            <h3 className="mb-1 text-base font-semibold">{DOMAINE_LABEL[dom] ?? dom}</h3>
            <table>
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th style={{ width: 150 }}>Fournisseur</th>
                  <th style={{ width: 55 }}>Unité</th>
                  <th style={{ width: 65 }}>Théorique</th>
                  <th className="vide">Physique</th>
                  <th className="vide">Écart</th>
                </tr>
              </thead>
              <tbody>
                {trierCats(cats).map(([cat, arts]) => (
                  <Fragment key={cat}>
                    <tr><td className="cat" colSpan={6}>{cat}</td></tr>
                    {arts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.designation}</td>
                        <td>{a.fournisseur?.nom ?? ""}</td>
                        <td>{a.unite ?? ""}</td>
                        <td>{a.stock ? qte(a.stock.quantite) : "0"}</td>
                        <td className="vide"></td>
                        <td className="vide"></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
