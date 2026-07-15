import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { qte } from "@/lib/stock";
import { ListeAchatForm } from "./entree-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { lundiDe, JOURS_FR as JOURS, MOIS_FR as MOIS } from "@/lib/dates-fr";

type SP = { periode?: string };


export default async function EntreePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const periode = sp.periode === "jour" || sp.periode === "mois" ? sp.periode : "semaine";

  const [articles, mouvements, config] = await Promise.all([
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true } }),
    prisma.mouvementStock.findMany({
      // Les entrées issues d'une FACTURE (factureId non nul) ne s'affichent PAS ici : elles
      // apparaissent dans « Mouvements » et se répercutent dans le catalogue. La liste d'achat
      // ne montre que les achats saisis directement ici.
      where: { type: "ENTREE", factureId: null },
      orderBy: { date: "desc" },
      take: 400,
      include: { article: { select: { designation: true } } },
    }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  // Groupement par période
  const groupes: { cle: string; titre: string; lignes: typeof mouvements }[] = [];
  const idx = new Map<string, number>();
  for (const m of mouvements) {
    const dt = new Date(m.date);
    let cle: string, titre: string;
    if (periode === "jour") {
      cle = dt.toISOString().slice(0, 10);
      titre = `${JOURS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MOIS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    } else if (periode === "mois") {
      cle = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
      titre = `${MOIS[dt.getUTCMonth()][0].toUpperCase()}${MOIS[dt.getUTCMonth()].slice(1)} ${dt.getUTCFullYear()}`;
    } else {
      const l = lundiDe(dt);
      cle = l.toISOString().slice(0, 10);
      titre = `Semaine du ${l.getUTCDate()} ${MOIS[l.getUTCMonth()]} ${l.getUTCFullYear()}`;
    }
    if (!idx.has(cle)) { idx.set(cle, groupes.length); groupes.push({ cle, titre, lignes: [] }); }
    groupes[idx.get(cle)!].lignes.push(m);
  }

  const onglets: { k: string; label: string }[] = [
    { k: "jour", label: "Par jour" },
    { k: "semaine", label: "Par semaine" },
    { k: "mois", label: "Par mois" },
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Liste d&apos;achat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Réservez cette liste aux achats <strong>sans facture</strong> : chaque ligne alimente directement
            l&apos;inventaire. Un achat avec facture s&apos;enregistre dans <strong>Factures</strong> (c&apos;est la facture
            qui alimente le stock) ; les légumes frais dans <strong>leur onglet dédié</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoutonRapport types={[{ value: "ACHATS", label: "Achats" }]} />
        </div>
      </div>

      <ListeAchatForm articles={articles} taux={taux} estDirection={estDirection} />

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Historique des achats</span>
          <span className="text-muted-foreground">·</span>
          {onglets.map((o) => (
            <a key={o.k} href={`/stock/entree?periode=${o.k}`} className={`rounded-full border px-3 py-1 ${periode === o.k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{o.label}</a>
          ))}
        </div>

        {groupes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune entrée enregistrée pour le moment.</p>
        ) : (
          <div className="space-y-2">
            {groupes.map((g) => (
              <details key={g.cle} className="group overflow-hidden rounded-lg border">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/50 px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{g.titre} <span className="font-normal text-muted-foreground">· {g.lignes.length} ligne(s)</span></span>
                </summary>
                <ul className="divide-y border-t text-sm">
                  {g.lignes.map((m) => (
                    <li key={m.id} className="flex items-center justify-between px-3 py-1">
                      <span className="truncate pr-2">
                        <Link href={`/stock/catalogue/${m.articleId}`} className="text-primary hover:underline">{m.article.designation}</Link>
                        {m.origine ? <span className="text-xs text-muted-foreground"> · {m.origine}</span> : null}
                      </span>
                      <span className="shrink-0 font-medium text-emerald-700">+{qte(m.quantite)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
