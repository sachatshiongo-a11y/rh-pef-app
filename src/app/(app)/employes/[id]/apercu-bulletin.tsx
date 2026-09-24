import type { ApercuBulletin } from "@/lib/bulletin-live";
import { LBL_BULLETIN as L } from "@/lib/bulletin-format";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";
import { LIBELLE_SOURCE_REFERENCE } from "@/lib/paie-reference-libelles";

function fmtUSD(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}
function fmtCDF(n: number) {
  return Math.round(n).toLocaleString("fr-FR") + " CDF";
}
/** Durée en heures, arrondie à 2 décimales (évite 167.49999999999997 → « 167,5 »). */
function fmtH(n: number) {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

// Défini au niveau module (pas dans le rendu) : sinon React le voit comme un composant
// différent à chaque rendu et démonte/remonte tout le sous-arbre.
function Ligne({ label, usd, taux, signe }: { label: string; usd: number; taux: number; signe?: "+" | "-" }) {
  return (
    <div className="flex items-center justify-between border-t px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="font-medium">{signe ? `${signe} ` : ""}{fmtUSD(usd)}</span>
        <span className="ml-2 text-xs text-muted-foreground">{fmtCDF(usd * taux)}</span>
      </span>
    </div>
  );
}

/** Aperçu intégré (temps réel, pas PDF) du bulletin de la période — montants en USD ET CDF. */
/** `avecAvertissements` : alertes de GESTION (CDD échu, planning incomplet…) réservées à la Direction ;
 *  l'espace salarié rend la même carte sans elles. */
export function ApercuBulletinCard({ apercu, periode, avecAvertissements = true }: { apercu: ApercuBulletin; periode: string; avecAvertissements?: boolean }) {
  const l = apercu.ligne;
  const t = apercu.tauxChangeCDF;
  const totalRetenues = Number(l.cnssSalarieUSD) + Number(l.iprCalculeUSD) + Number(l.acompteUSD) + Number(l.retenuePretUSD ?? 0);
  // Salaire net hors transport (décision Direction 2026-09-22) : `l` (LignePaie) ne porte pas
  // transportUSD, exposé à part sur `apercu` — voir @/lib/bulletin-live.
  const ligneNet = { salNetUSD: l.salNetUSD, transportUSD: apercu.transportUSD };

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Bulletin de la période — aperçu temps réel</h3>
        <span className="text-xs capitalize text-muted-foreground">{periode} · 1 $ = {fmtCDF(t)}</span>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <div>
          <p className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase text-emerald-800">Gains</p>
          {/* Chaque montant vient du moteur, au centime, et s'additionne (2026-09-24) : gains hors
              transport → brut imposable (même définition que le bulletin PDF) → allocations et
              retenues → salaire net → + transport → total versé. Avant, les heures supp. n'étaient
              pas listées et « brut imposable » affichait le brut transport compris. */}
          <Ligne taux={t} label={L.base} usd={Number(l.remuneration100)} />
          {Number(l.remuneration2_3) > 0 && <Ligne taux={t} label={L.maladie} usd={Number(l.remuneration2_3)} />}
          {Number(l.hsValorisee) > 0 && <Ligne taux={t} label={L.hs} usd={Number(l.hsValorisee)} />}
          {/* Primes : une ligne par prime ; rien du tout s'il n'y en a aucune (pas de ligne « 0 »). */}
          {apercu.primes.map((p, i) => (
            <Ligne key={i} taux={t} label={p.nom} usd={p.montantUSD} />
          ))}
          <Ligne taux={t} label={`${L.brut} (hors transport)`} usd={Number(l.salBrutUSD) - Number(l.transportUSD)} />
          {/* Tout est conditionnel : une ligne n'apparaît que si son montant est non nul. */}
          {(Number(l.allocFamilialeUSD) > 0 || Number(l.fraisMedicauxUSD) > 0) && (
            <p className="mt-2 bg-blue-50 px-3 py-1.5 text-xs font-semibold uppercase text-blue-800">Allocations (non imposables)</p>
          )}
          {Number(l.allocFamilialeUSD) > 0 && <Ligne taux={t} label={L.alloc} usd={Number(l.allocFamilialeUSD)} signe="+" />}
          {Number(l.fraisMedicauxUSD) > 0 && <Ligne taux={t} label={L.fraisMedicaux} usd={Number(l.fraisMedicauxUSD)} signe="+" />}
        </div>
        <div className="border-l">
          <p className="bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase text-amber-800">Retenues</p>
          <Ligne taux={t} label={L.cnss} usd={Number(l.cnssSalarieUSD)} signe="-" />
          <Ligne taux={t} label={L.ipr} usd={Number(l.iprCalculeUSD)} signe="-" />
          {Number(l.acompteUSD) > 0 && <Ligne taux={t} label={L.acompte} usd={Number(l.acompteUSD)} signe="-" />}
          {Number(l.retenuePretUSD ?? 0) > 0 && <Ligne taux={t} label="Retenue prêt" usd={Number(l.retenuePretUSD)} signe="-" />}
          <Ligne taux={t} label="Total retenues" usd={totalRetenues} signe="-" />
          <p className="mt-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase text-muted-foreground">Heures</p>
          <div className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Travaillées · HS 30/60/100</span>
            <span className="font-medium">{fmtH(apercu.heuresTravaillees)}h · {fmtH(apercu.hs30)}/{fmtH(apercu.hs60)}/{fmtH(apercu.hs100)}</span>
          </div>
          {/* Référence d'heures du mois : la même que la ligne du lot de paie (spec 2026-09-23). */}
          <div className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">{LIBELLE_SOURCE_REFERENCE[apercu.reference.source]}</span>
            <span className="font-medium">{fmtH(apercu.reference.heuresReference)}h</span>
          </div>
          {avecAvertissements && apercu.reference.avertissements.length > 0 && (
            <ul className="mx-3 mb-2 space-y-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {apercu.reference.avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t bg-primary/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Salaire net</span>
          <span className="text-right">
            <span className="text-lg font-bold">{fmtUSD(salaireNetUSD(ligneNet))}</span>
            <span className="ml-2 text-sm text-muted-foreground">{fmtCDF(salaireNetCDF(ligneNet, t))}</span>
          </span>
        </div>
        {Number(apercu.transportUSD) > 0 && (
          <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
            <span>{L.transport} (non imposable)</span>
            <span>+ {fmtUSD(Number(apercu.transportUSD))}</span>
          </div>
        )}
        {Number(apercu.transportUSD) > 0 && (
          <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
            <span>Total versé (transport compris)</span>
            <span>{fmtUSD(totalVerseUSD(ligneNet))}</span>
          </div>
        )}
      </div>
    </div>
  );
}
