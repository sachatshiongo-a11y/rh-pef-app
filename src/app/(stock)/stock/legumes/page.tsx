import { prisma } from "@/lib/prisma";
import { usd } from "@/lib/stock";
import { AchatLegumesForm, SupprimerAchatBtn } from "./legumes-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { OngletsAchats } from "../_achats/onglets-achats";
import { MenuFichePdf, classeLienFiche } from "../_print/menu-fiche-pdf";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { lundiDe, JOURS_FR as JOURS, MOIS_FR as MOIS } from "@/lib/dates-fr";
import { exigerPageStock } from "@/lib/garde-page";
import { TelechargerLien, TelechargerFormulaire } from "@/components/telecharger-lien";
import { Pagination } from "@/components/pagination";
import { PLAFOND_TOUT, fenetrePage, groupePartiel, lirePagination, PAR_DEFAUT } from "@/lib/pagination";
import { bornesGroupe } from "@/lib/groupes-periode";

const cdf = (n: number) => n.toLocaleString("fr-FR");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type SP = { periode?: string; page?: string; par?: string };

export default async function LegumesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const periode = sp.periode === "jour" || sp.periode === "mois" ? sp.periode : "semaine";
  const demande = lirePagination(sp);
  // Historique paginé CÔTÉ SERVEUR (count + skip/take) : il s'arrêtait en silence aux 500 achats les plus récents.
  const nbAchats = await prisma.achatLegume.count();
  const fen = fenetrePage(nbAchats, demande.page, demande.par, PLAFOND_TOUT);

  const [achats, config] = await Promise.all([
    prisma.achatLegume.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: fen.skip, take: fen.take }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  // Groupement par période (jour / semaine / mois), comme la liste d'achat.
  const groupes: { cle: string; titre: string; lignes: typeof achats }[] = [];
  const idx = new Map<string, number>();
  for (const a of achats) {
    const dt = new Date(a.date);
    let cle: string, titre: string;
    if (periode === "jour") {
      cle = dt.toISOString().slice(0, 10);
      titre = `${JOURS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MOIS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    } else if (periode === "mois") {
      cle = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
      titre = `${cap(MOIS[dt.getUTCMonth()])} ${dt.getUTCFullYear()}`;
    } else {
      const l = lundiDe(dt);
      cle = l.toISOString().slice(0, 10);
      titre = `Semaine du ${l.getUTCDate()} ${MOIS[l.getUTCMonth()]} ${l.getUTCFullYear()}`;
    }
    if (!idx.has(cle)) { idx.set(cle, groupes.length); groupes.push({ cle, titre, lignes: [] }); }
    groupes[idx.get(cle)!].lignes.push(a);
  }
  // Un groupe coupé par une frontière de page se relit sur sa tranche de dates ENTIÈRE (compteur et totaux exacts,
  // « N affiché(s) » pour ce que la page en montre) — au plus deux groupes (le premier et le dernier de la page).
  const totauxGroupes = new Map<string, { nb: number; cdf: number; usd: number }>();
  await Promise.all(groupes.map(async (g, i) => {
    if (!groupePartiel(i, groupes.length, fen)) return;
    const { gte, lt } = bornesGroupe(periode, new Date(g.lignes[0].date));
    const a = await prisma.achatLegume.aggregate({ where: { date: { gte, lt } }, _count: true, _sum: { montantCDF: true, montantUSD: true } });
    totauxGroupes.set(g.cle, { nb: a._count, cdf: Number(a._sum.montantCDF ?? 0), usd: Number(a._sum.montantUSD ?? 0) });
  }));
  const totCDF = (ls: typeof achats) => ls.reduce((t, l) => t + Number(l.montantCDF ?? 0), 0);
  const totUSD = (ls: typeof achats) => ls.reduce((t, l) => t + Number(l.montantUSD ?? 0), 0);

  const onglets = [
    { k: "jour", label: "Par jour" },
    { k: "semaine", label: "Par semaine" },
    { k: "mois", label: "Par mois" },
  ];

  return (
    <div className="w-full space-y-5">
      <OngletsAchats />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Achats de légumes frais</h1>
          <p className="mt-1 text-sm text-muted-foreground">Achats du marché : montant en CDF, converti en USD au taux courant. Journal daté, hors stock (l&apos;inventaire n&apos;est pas touché).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MenuFichePdf libelle="Fiche d'achat (PDF)">
            <TelechargerLien href="/stock/legumes/fiche" className={classeLienFiche}>Fiche vierge</TelechargerLien>
            {/* Fiche remplie : formulaire GET, le PDF est récupéré en arrière-plan (l'écran ne bouge pas). */}
            <TelechargerFormulaire action="/stock/legumes/fiche" className="space-y-1.5 rounded-lg border p-2.5">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Remplie avec les achats du
                <input type="date" name="date" required defaultValue={jourCivilKinshasa(new Date()).toISOString().slice(0, 10)} className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <button type="submit" className={`${classeLienFiche} w-full`}>Fiche remplie</button>
            </TelechargerFormulaire>
          </MenuFichePdf>
          <BoutonRapport types={[{ value: "LEGUMES", label: "Légumes" }]} />
        </div>
      </div>

      <AchatLegumesForm taux={taux} estDirection={estDirection} />

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Historique des achats</span>
          <span className="text-muted-foreground">·</span>
          {onglets.map((o) => (
            <a key={o.k} href={`/stock/legumes?periode=${o.k}${demande.par !== PAR_DEFAUT ? `&par=${demande.par}` : ""}`} className={`rounded-full border px-3 py-1 ${periode === o.k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{o.label}</a>
          ))}
        </div>

        {groupes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat enregistré.</p>
        ) : (
          <div className="space-y-2">
            {groupes.map((g) => (
              <details key={g.cle} className="group overflow-hidden rounded-lg border">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/50 px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{g.titre} <span className="font-normal text-muted-foreground">· {totauxGroupes.get(g.cle)?.nb ?? g.lignes.length} achat(s){totauxGroupes.has(g.cle) ? ` · ${g.lignes.length} affiché(s)` : ""}</span></span>
                  <span className="font-normal text-muted-foreground">{cdf(totauxGroupes.get(g.cle)?.cdf ?? totCDF(g.lignes))} CDF · {usd(totauxGroupes.get(g.cle)?.usd ?? totUSD(g.lignes))}</span>
                </summary>
                <ul className="divide-y border-t text-sm">
                  {g.lignes.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1">
                      <span className="min-w-0 pr-2">
                        <span className="block truncate font-medium">{l.legume}</span>
                        {/* Téléphone : l'équivalent en USD passe sous le nom (sur ordinateur, il a sa colonne). */}
                        {l.montantUSD ? <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">≈ {usd(l.montantUSD)}</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span>{Number(l.quantite)} {l.unite ?? ""}</span>
                        <span className="text-muted-foreground">{l.montantCDF ? `${cdf(Number(l.montantCDF))} CDF` : "—"}</span>
                        <span className="hidden sm:inline">{l.montantUSD ? usd(l.montantUSD) : "—"}</span>
                        <SupprimerAchatBtn id={l.id} legume={l.legume} estDirection={estDirection} />
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <Pagination plafondTout={PLAFOND_TOUT} total={nbAchats} page={fen.page} par={demande.par} chemin="/stock/legumes" params={sp} libelle="achats" />
          </div>
        )}
      </div>
    </div>
  );
}
