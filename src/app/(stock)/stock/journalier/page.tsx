import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { qte } from "@/lib/stock";
import { lundiDe } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";
import { CommandeGrid, type CmdArticle } from "./commande-grid";
import { LEGUMES } from "../legumes/legumes-data";

type SP = { semaine?: string; domaine?: string; vue?: string };
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

export default async function JournalierPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;
  const vue = sp.vue === "commande" || sp.vue === "comparaison" ? sp.vue : "conso";
  const lundi = sp.semaine ? lundiDe(new Date(sp.semaine)) : lundiDe(new Date());
  const jours = Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
  const finSemaine = addDays(lundi, 7);
  const joursLabel = jours.map((d, i) => ({ iso: iso(d), label: `${JOURS[i]} ${d.getUTCDate()}` }));

  const lien = (params: Partial<SP>) => {
    const p = new URLSearchParams();
    p.set("vue", params.vue ?? vue);
    p.set("semaine", params.semaine ?? iso(lundi));
    const dom = params.domaine !== undefined ? params.domaine : domaine;
    if (dom) p.set("domaine", dom);
    return `/stock/journalier?${p}`;
  };

  const enTete = (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Consommation journalière</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suivi par jour : ce qui est <strong>commandé</strong> par le restaurant et ce qui est <strong>livré</strong> (sorties de stock). Enregistrez les livraisons datées depuis l&apos;onglet Mouvements.
        </p>
      </div>

      {/* Sélecteur de vue */}
      <div className="flex overflow-hidden rounded-md border text-sm w-fit">
        {([["conso", "Consommation"], ["commande", "Commande"], ["comparaison", "Comparaison"]] as const).map(([v, label]) => (
          <Link key={v} href={lien({ vue: v })} className={`px-3 py-1.5 ${vue === v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1">
          <Link href={lien({ semaine: iso(addDays(lundi, -7)) })} className="rounded-md border px-2 py-1 hover:bg-accent">←</Link>
          <span className="px-2 font-medium">Semaine du {lundi.getUTCDate()}/{lundi.getUTCMonth() + 1} au {addDays(lundi, 6).getUTCDate()}/{addDays(lundi, 6).getUTCMonth() + 1}</span>
          <Link href={lien({ semaine: iso(addDays(lundi, 7)) })} className="rounded-md border px-2 py-1 hover:bg-accent">→</Link>
          <Link href={lien({ semaine: iso(new Date()) })} className="ml-1 rounded-md border px-2 py-1 hover:bg-accent">Cette semaine</Link>
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="flex gap-1.5">
          {([["", "Tous"], ["NOURRITURE", "Cuisine (nourriture)"], ["BOISSON", "Bar (boissons)"]] as const).map(([k, label]) => (
            <Link key={k} href={lien({ domaine: k })} className={`rounded-full border px-3 py-1 ${(domaine ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</Link>
          ))}
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="flex items-center overflow-hidden rounded-md border">
          <span className="px-2 py-1 text-xs text-muted-foreground">Exporter</span>
          <a href={`/stock/journalier/pdf?vue=${vue}&semaine=${iso(lundi)}${domaine ? `&domaine=${domaine}` : ""}`} download className="border-l px-2.5 py-1 hover:bg-accent">PDF</a>
          <a href={`/stock/journalier/excel?vue=${vue}&semaine=${iso(lundi)}${domaine ? `&domaine=${domaine}` : ""}`} download className="border-l px-2.5 py-1 hover:bg-accent">Excel</a>
        </div>
      </div>
    </div>
  );

  // ---------- Livraisons (sorties de stock) agrégées par article × jour ----------
  const chargerLivraisons = async () => {
    const where: Prisma.MouvementStockWhereInput = { type: "SORTIE", date: { gte: lundi, lt: finSemaine }, ...(domaine ? { article: { domaine } } : {}) };
    const sorties = await prisma.mouvementStock.findMany({ where, include: { article: { select: { designation: true } } } });
    const parArticle = new Map<string, { articleId: string; designation: string; jours: number[]; total: number }>();
    for (const m of sorties) {
      const row = parArticle.get(m.articleId) ?? { articleId: m.articleId, designation: m.article.designation, jours: Array(7).fill(0), total: 0 };
      const idx = Math.floor((new Date(m.date).getTime() - lundi.getTime()) / 86_400_000);
      const q = Number(m.quantite);
      if (idx >= 0 && idx < 7) row.jours[idx] += q;
      row.total += q;
      parArticle.set(m.articleId, row);
    }
    return parArticle;
  };

  // Légumes frais : achats du jour (AchatLegume) et commandes (CommandeLegumeResto). Cuisine only.
  const inclureLegumes = domaine !== "BOISSON";
  const chargerLegumesAchats = async () => {
    const legumes = await prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: finSemaine } }, select: { legume: true, date: true, quantite: true } });
    const m = new Map<string, { jours: number[]; total: number }>();
    for (const l of legumes) {
      const row = m.get(l.legume) ?? { jours: Array(7).fill(0), total: 0 };
      const idx = Math.floor((new Date(l.date).getTime() - lundi.getTime()) / 86_400_000);
      const q = Number(l.quantite);
      if (idx >= 0 && idx < 7) row.jours[idx] += q;
      row.total += q;
      m.set(l.legume, row);
    }
    return m;
  };
  const chargerCommandesLegumes = async () => {
    const cmds = await prisma.commandeLegumeResto.findMany({ where: { date: { gte: lundi, lt: finSemaine } }, select: { legume: true, date: true, quantite: true } });
    const map: Record<string, number> = {};
    for (const c of cmds) map[`legume:${c.legume}_${iso(new Date(c.date))}`] = Number(c.quantite);
    return map;
  };

  // ---------- VUE CONSOMMATION (livraisons + légumes) ----------
  if (vue === "conso") {
    const [parArticle, legAchats] = await Promise.all([chargerLivraisons(), inclureLegumes ? chargerLegumesAchats() : Promise.resolve(new Map<string, { jours: number[]; total: number }>())]);
    const rows = [...parArticle.values()].sort((a, b) => a.designation.localeCompare(b.designation));
    const legRows = [...legAchats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const totauxJour = jours.map((_, i) => rows.reduce((t, r) => t + r.jours[i], 0));
    return (
      <div className="space-y-4">
        {enTete}
        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
              <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                <th className="sticky left-0 z-30 bg-muted">Article</th>
                {joursLabel.map((j) => <th key={j.iso} className="!text-right">{j.label}</th>)}
                <th className="!text-right">Total</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
              {rows.map((r) => (
                <tr key={r.articleId} className="hover:bg-accent/40 even:bg-muted/25">
                  <td className="sticky left-0 z-10 bg-background font-medium"><Link href={`/stock/catalogue/${r.articleId}`} className="text-primary hover:underline">{r.designation}</Link></td>
                  {r.jours.map((q, i) => <td key={i} className="text-right text-muted-foreground">{q > 0 ? qte(q) : ""}</td>)}
                  <td className="text-right font-semibold">{qte(r.total)}</td>
                </tr>
              ))}
              {legRows.length > 0 && (
                <tr><td colSpan={9} className="sticky left-0 !bg-emerald-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-emerald-900">Légumes frais (achats du jour)</td></tr>
              )}
              {legRows.map(([nom, r]) => (
                <tr key={`leg-${nom}`} className="hover:bg-accent/40 even:bg-muted/25">
                  <td className="sticky left-0 z-10 bg-background font-medium">{nom}</td>
                  {r.jours.map((q, i) => <td key={i} className="text-right text-muted-foreground">{q > 0 ? qte(q) : ""}</td>)}
                  <td className="text-right font-semibold">{qte(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && legRows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Aucune livraison enregistrée cette semaine.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0"><tr className="bg-muted/60 font-semibold [&>td]:px-3 [&>td]:py-2">
                <td className="sticky left-0 bg-muted/60">Total jour</td>
                {totauxJour.map((t, i) => <td key={i} className="text-right">{t > 0 ? qte(t) : ""}</td>)}
                <td className="text-right">{qte(totauxJour.reduce((a, b) => a + b, 0))}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  // Articles actifs (filtrés par domaine) + catégorie, pour la saisie et la comparaison.
  const chargerArticles = async (): Promise<CmdArticle[]> => {
    const articles = await prisma.articleStock.findMany({
      where: { actif: true, ...(domaine ? { domaine } : {}) },
      orderBy: [{ categorie: { nom: "asc" } }, { designation: "asc" }],
      select: { id: true, designation: true, categorie: { select: { nom: true } } },
    });
    return articles.map((a) => ({ id: a.id, designation: a.designation, categorie: a.categorie?.nom ?? "À classer" }));
  };
  const chargerCommandes = async () => {
    const cmds = await prisma.commandeResto.findMany({ where: { date: { gte: lundi, lt: finSemaine } }, select: { articleId: true, date: true, quantite: true } });
    const map: Record<string, number> = {};
    for (const c of cmds) map[`${c.articleId}_${iso(new Date(c.date))}`] = Number(c.quantite);
    return map;
  };

  // ---------- VUE COMMANDE (saisie) ----------
  if (vue === "commande") {
    const [articles, commandes, cmdLeg] = await Promise.all([chargerArticles(), chargerCommandes(), inclureLegumes ? chargerCommandesLegumes() : Promise.resolve<Record<string, number>>({})]);
    if (inclureLegumes) articles.push(...LEGUMES.map((l) => ({ id: `legume:${l.nom}`, designation: l.unite ? `${l.nom} (${l.unite})` : l.nom, categorie: "Légumes frais" })));
    return (
      <div className="space-y-4">
        {enTete}
        <p className="text-xs text-muted-foreground">Saisissez la quantité <strong>commandée</strong> par le restaurant, par article et par jour (les légumes frais sont en fin de liste). Enregistrement automatique.</p>
        <CommandeGrid articles={articles} jours={joursLabel} commandes={{ ...commandes, ...cmdLeg }} peutModifier />
      </div>
    );
  }

  // ---------- VUE COMPARAISON (commande vs livraison) ----------
  const [livrParArticle, commandes, articles, legAchatsC, cmdLegC] = await Promise.all([
    chargerLivraisons(), chargerCommandes(), chargerArticles(),
    inclureLegumes ? chargerLegumesAchats() : Promise.resolve(new Map<string, { jours: number[]; total: number }>()),
    inclureLegumes ? chargerCommandesLegumes() : Promise.resolve<Record<string, number>>({}),
  ]);
  const nomCat = new Map(articles.map((a) => [a.id, { designation: a.designation, categorie: a.categorie }]));
  // Assemble par article : commande[7] et livraison[7]. On garde les articles ayant au moins une valeur.
  const combine = new Map<string, { designation: string; categorie: string; cmd: number[]; liv: number[] }>();
  for (const a of articles) {
    const liv = livrParArticle.get(a.id)?.jours ?? Array(7).fill(0);
    const cmd = joursLabel.map((j) => commandes[`${a.id}_${j.iso}`] ?? 0);
    if (cmd.some((v) => v > 0) || liv.some((v) => v > 0)) combine.set(a.id, { designation: a.designation, categorie: a.categorie, cmd, liv });
  }
  // Articles livrés mais absents du catalogue filtré (autre domaine) : on les ajoute si pas de filtre.
  if (!domaine) for (const [id, r] of livrParArticle) if (!combine.has(id) && r.total > 0) combine.set(id, { designation: r.designation, categorie: nomCat.get(id)?.categorie ?? "À classer", cmd: Array(7).fill(0), liv: r.jours });
  // Légumes frais : commande (CommandeLegumeResto) vs achat (AchatLegume).
  if (inclureLegumes) for (const nom of new Set([...LEGUMES.map((l) => l.nom), ...legAchatsC.keys()])) {
    const cmd = joursLabel.map((j) => cmdLegC[`legume:${nom}_${j.iso}`] ?? 0);
    const liv = legAchatsC.get(nom)?.jours ?? Array(7).fill(0);
    if (cmd.some((v) => v > 0) || liv.some((v) => v > 0)) combine.set(`legume:${nom}`, { designation: nom, categorie: "Légumes frais", cmd, liv });
  }
  const rows = [...combine.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => a.categorie.localeCompare(b.categorie) || a.designation.localeCompare(b.designation));

  return (
    <div className="space-y-4">
      {enTete}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><span className="font-semibold text-emerald-700">C</span> = commandé (vert) · <span className="font-semibold text-red-700">L</span> = livré (rouge)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-200" /> écart (livré ≠ commandé)</span>
      </p>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th className="sticky left-0 z-30 bg-muted px-3">Article</th>
              {joursLabel.map((j) => <th key={j.iso} className="!text-center" colSpan={2}>{j.label}</th>)}
              <th className="!text-center" colSpan={2}>Total</th>
            </tr>
            <tr className="[&>th]:border-b [&>th]:px-1 [&>th]:pb-1 [&>th]:text-[10px] [&>th]:font-medium [&>th]:text-muted-foreground">
              <th className="sticky left-0 z-30 bg-muted" />
              {joursLabel.map((j) => <Fragment key={j.iso}><th className="!text-right">C</th><th className="!text-right">L</th></Fragment>)}
              <th className="!text-right">C</th><th className="!text-right">L</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-1 [&>tr>td]:py-1.5">
            {rows.map((r, ri) => {
              const nouvelleCat = ri === 0 || rows[ri - 1].categorie !== r.categorie;
              const totC = r.cmd.reduce((a, b) => a + b, 0), totL = r.liv.reduce((a, b) => a + b, 0);
              return (
                <Fragment key={r.id}>
                  {nouvelleCat && <tr><td colSpan={joursLabel.length * 2 + 3} className="sticky left-0 !bg-amber-100 !px-3 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{r.categorie}</td></tr>}
                  <tr className="even:bg-muted/25 hover:bg-accent/40">
                    <td className="sticky left-0 z-10 bg-background px-3 font-medium">{r.id.startsWith("legume:") ? r.designation : <Link href={`/stock/catalogue/${r.id}`} className="text-primary hover:underline">{r.designation}</Link>}</td>
                    {joursLabel.map((j, i) => {
                      const c = r.cmd[i], l = r.liv[i], ecart = c !== l && (c > 0 || l > 0);
                      return (
                        <Fragment key={j.iso}>
                          <td className={`text-right font-medium tabular-nums text-emerald-700 ${ecart ? "bg-orange-50" : ""}`}>{c > 0 ? qte(c) : ""}</td>
                          <td className={`text-right font-medium tabular-nums text-red-700 ${ecart ? "bg-orange-100" : ""}`}>{l > 0 ? qte(l) : ""}</td>
                        </Fragment>
                      );
                    })}
                    <td className="text-right font-semibold tabular-nums text-emerald-700">{totC > 0 ? qte(totC) : ""}</td>
                    <td className="text-right font-semibold tabular-nums text-red-700">{totL > 0 ? qte(totL) : ""}</td>
                  </tr>
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={joursLabel.length * 2 + 3} className="px-3 py-6 text-center text-muted-foreground">Aucune commande ni livraison cette semaine.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
