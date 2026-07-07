import type { ApercuBulletin } from "@/lib/bulletin-live";

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

/** Aperçu intégré (temps réel, pas PDF) du bulletin de la période — montants en USD ET CDF. */
export function ApercuBulletinCard({ apercu, periode }: { apercu: ApercuBulletin; periode: string }) {
  const l = apercu.ligne;
  const t = apercu.tauxChangeCDF;
  const totalRetenues = Number(l.cnssSalarieUSD) + Number(l.iprCalculeUSD) + Number(l.acompteUSD);

  const Ligne = ({ label, usd, signe }: { label: string; usd: number; signe?: "+" | "-" }) => (
    <div className="flex items-center justify-between border-t px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="font-medium">{signe ? `${signe} ` : ""}{fmtUSD(usd)}</span>
        <span className="ml-2 text-xs text-muted-foreground">{fmtCDF(usd * t)}</span>
      </span>
    </div>
  );

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Bulletin de la période — aperçu temps réel</h3>
        <span className="text-xs capitalize text-muted-foreground">{periode} · 1 $ = {fmtCDF(t)}</span>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <div>
          <p className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase text-emerald-800">Gains</p>
          <Ligne label="Rémunération" usd={Number(l.remuneration100) + Number(l.remuneration2_3)} />
          {/* Primes : une ligne par prime ; rien du tout s'il n'y en a aucune (pas de ligne « 0 »). */}
          {apercu.primes.map((p, i) => (
            <Ligne key={i} label={p.nom} usd={p.montantUSD} />
          ))}
          <Ligne label="Salaire brut imposable" usd={Number(l.salBrutUSD)} />
          <p className="mt-2 bg-blue-50 px-3 py-1.5 text-xs font-semibold uppercase text-blue-800">Allocations (non imposables)</p>
          <Ligne label="Allocation familiale" usd={Number(l.allocFamilialeUSD)} signe="+" />
          <Ligne label="Frais médicaux" usd={Number(l.fraisMedicauxUSD)} signe="+" />
        </div>
        <div className="border-l">
          <p className="bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase text-amber-800">Retenues</p>
          <Ligne label="CNSS — part salarié" usd={Number(l.cnssSalarieUSD)} signe="-" />
          <Ligne label="IPR" usd={Number(l.iprCalculeUSD)} signe="-" />
          <Ligne label="Acompte sur salaire" usd={Number(l.acompteUSD)} signe="-" />
          <Ligne label="Total retenues" usd={totalRetenues} signe="-" />
          <p className="mt-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase text-muted-foreground">Heures</p>
          <div className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Travaillées · HS 30/60/100</span>
            <span className="font-medium">{fmtH(apercu.heuresTravaillees)}h · {fmtH(apercu.hs30)}/{fmtH(apercu.hs60)}/{fmtH(apercu.hs100)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t bg-primary/5 px-4 py-3">
        <span className="font-semibold">Salaire net à payer</span>
        <span className="text-right">
          <span className="text-lg font-bold">{fmtUSD(Number(l.salNetUSD))}</span>
          <span className="ml-2 text-sm text-muted-foreground">{fmtCDF(Number(l.salNetCDF))}</span>
        </span>
      </div>
    </div>
  );
}
