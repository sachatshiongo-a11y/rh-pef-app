import { prisma } from "@/lib/prisma";
import { qte } from "@/lib/stock";
import { ImprimerBtn } from "./imprimer-btn";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string };
const DOM_LABEL: Record<string, string> = { NOURRITURE: "Nourriture", BOISSON: "Boissons" };

// Fiche de comptage imprimable (page HTML légère, imprimée / enregistrée en PDF par le navigateur).
// Remplace l'ancien PDF serveur (react-pdf) qui saturait Render sur ~491 articles.
export default async function FicheComptagePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;

  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({ where, orderBy: [{ domaine: "asc" }, { designation: "asc" }], include: { stock: true } });

  const parDomaine = new Map<string, typeof articles>();
  for (const a of articles) {
    if (!parDomaine.has(a.domaine)) parDomaine.set(a.domaine, []);
    parDomaine.get(a.domaine)!.push(a);
  }
  const dateJour = new Date().toLocaleDateString("fr-FR");

  return (
    <div>
      <style>{`
        @media print {
          aside, .no-print { display: none !important; }
          main { overflow: visible !important; }
          @page { margin: 12mm; }
        }
        .fiche table { width: 100%; border-collapse: collapse; }
        .fiche th, .fiche td { border: 0.5pt solid #cbb89a; padding: 3px 6px; font-size: 11px; text-align: left; }
        .fiche th { background: #f5ecd9; }
        .fiche .vide { width: 90px; color: #bbb; }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Fiche de comptage — Inventaire</h1>
          <p className="text-sm text-muted-foreground">Imprimez cette page ou enregistrez-la en PDF pour compter à la main.</p>
        </div>
        <ImprimerBtn />
      </div>

      <div className="fiche space-y-6">
        <div className="flex items-baseline justify-between border-b pb-2">
          <h2 className="text-lg font-semibold">Fiche de comptage — {dateJour}</h2>
          <span className="text-sm text-muted-foreground">{articles.length} article(s){domaine ? ` · ${DOM_LABEL[domaine]}` : ""}</span>
        </div>

        {[...parDomaine.entries()].map(([dom, arts]) => (
          <div key={dom}>
            <h3 className="mb-1 text-base font-semibold">{DOM_LABEL[dom] ?? dom}</h3>
            <table>
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th style={{ width: 60 }}>Unité</th>
                  <th style={{ width: 70 }}>Théorique</th>
                  <th className="vide">Physique</th>
                  <th className="vide">Écart</th>
                </tr>
              </thead>
              <tbody>
                {arts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.designation}</td>
                    <td>{a.unite ?? ""}</td>
                    <td>{a.stock ? qte(a.stock.quantite) : "0"}</td>
                    <td className="vide"></td>
                    <td className="vide"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
