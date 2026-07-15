"use client";

import {
  calculerPaieBrigade,
  calculerPaieBackoffice,
  calculerPaieStage,
  type ParametresPaie,
  type LignePaie,
} from "@/lib/payroll";

// Simulation de bulletin EN DIRECT dans le formulaire employé : mois « type » (heures
// contractuelles, sans heures supp. ni absences), avec le VRAI moteur de paie (CNSS, barème
// IPR, allocations, charges patronales). Montre aussi l'impact sur la masse salariale.

const SEMAINES_PAR_MOIS = 52 / 12;

export type ValeursSimulation = {
  salaireMensuel: number;
  categorie: string;
  contrat: string;
  enfants: number;
  heuresHebdomadaires: number;
  heuresParJour: number;
  transportJourCDF: number;
  transportMoisUSD: number;
  transportMoisCDF: number;
};

/** Extrait du formulaire les champs qui influencent la paie. */
export function lireValeursSimulation(fd: FormData): ValeursSimulation {
  const n = (name: string) => {
    const v = Number(String(fd.get(name) ?? "").replace(",", "."));
    return Number.isFinite(v) ? v : 0;
  };
  return {
    salaireMensuel: n("salaireMensuel"),
    categorie: String(fd.get("categorie") ?? "BRIGADE"),
    contrat: String(fd.get("contrat") ?? "CDD"),
    enfants: n("enfants"),
    heuresHebdomadaires: n("heuresHebdomadaires") || 48,
    heuresParJour: n("heuresParJour") || 8,
    transportJourCDF: n("transportJourCDF"),
    transportMoisUSD: n("transportMoisUSD"),
    transportMoisCDF: n("transportMoisCDF"),
  };
}

const usd = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const cdf = (v: number) => Math.round(v).toLocaleString("fr-FR") + " CDF";

export function SimulationSalaire({
  valeurs,
  parametres,
  impact,
}: {
  valeurs: ValeursSimulation;
  parametres: ParametresPaie;
  impact: {
    netActuel: number;
    coutActuel: number;
    effectif: number;
    periode: string;
    /** Bulletin ACTUEL de cet employé dans la paie de référence (mode « modification » :
     *  l'impact affiché est le DELTA, pas un ajout à l'effectif). */
    actuel?: { net: number; cout: number } | null;
  } | null;
}) {
  const v = valeurs;

  if (v.contrat === "INTERIM") {
    return (
      <Panneau titre="Simulation du bulletin">
        <p className="text-sm text-muted-foreground">
          Un <b>intérimaire</b> est salarié de l&apos;agence d&apos;intérim : il n&apos;a{" "}
          <b>aucun bulletin ici</b>{" "}et n&apos;entre pas dans la masse salariale — le coût passe par
          la facture de l&apos;agence (renseignez l&apos;agence et le coût/jour sur son contrat).
        </p>
      </Panneau>
    );
  }

  if (v.salaireMensuel <= 0) {
    return (
      <Panneau titre="Simulation du bulletin">
        <p className="text-sm text-muted-foreground">
          Renseignez le <b>salaire mensuel</b> pour voir le bulletin projeté (net, cotisations,
          impôt) et l&apos;impact sur la masse salariale — calculé avec le vrai moteur de paie.
        </p>
      </Panneau>
    );
  }

  // Transport d'un mois type : brigade = par jour de présence (jours ouvrables), sinon mensuel.
  const taux = parametres.tauxChangeCDF || 1;
  const transportUSD =
    v.categorie === "BRIGADE"
      ? (v.transportJourCDF * parametres.joursOuvrablesMois) / taux
      : v.transportMoisUSD || v.transportMoisCDF / taux;

  let ligne: LignePaie;
  let mode: string;
  if (v.contrat === "STAGE") {
    mode = "Indemnité de stage — sans cotisations ni impôt (défaut à valider)";
    ligne = calculerPaieStage({ indemniteUSD: v.salaireMensuel, transportUSD }, parametres);
  } else if (v.categorie === "BRIGADE") {
    mode = "Brigade — payé aux heures (mois type : heures contractuelles, sans heures supp.)";
    const heuresMois = v.heuresHebdomadaires * SEMAINES_PAR_MOIS;
    const salaireHoraire = v.salaireMensuel / heuresMois;
    ligne = calculerPaieBrigade(
      {
        salaireJournalier: salaireHoraire * v.heuresParJour,
        salaireHoraire,
        heuresNormales: heuresMois,
        joursPayesNonTravailles: 0,
        joursPayes2_3: 0,
        hsValorisee: 0,
        transportMoisUSD: transportUSD,
        enfants: v.enfants,
        fraisMedicauxUSD: 0,
      },
      parametres
    );
  } else {
    mode = "Back-office — salaire mensuel fixe";
    ligne = calculerPaieBackoffice(
      { salaireBaseUSD: v.salaireMensuel, transportUSD, enfants: v.enfants, fraisMedicauxUSD: 0 },
      parametres
    );
  }

  const chargesPatronales = ligne.cnssPatronalUSD + ligne.inppUSD + ligne.onemUSD;

  return (
    <Panneau titre="Simulation du bulletin (mois type)">
      <p className="mb-2 text-[11px] text-muted-foreground">{mode}</p>
      <dl className="space-y-1 text-sm tabular-nums">
        <Ligne label="Base + transport (brut)" val={usd(ligne.salBrutUSD)} gras />
        {ligne.cnssSalarieUSD > 0 && <Ligne label="CNSS salarié" val={`− ${usd(ligne.cnssSalarieUSD)}`} rouge />}
        {ligne.iprCalculeUSD > 0 && <Ligne label="IPR (impôt)" val={`− ${usd(ligne.iprCalculeUSD)}`} rouge />}
        {ligne.allocFamilialeUSD > 0 && (
          <Ligne label={`Allocations familiales (${v.enfants} enf.)`} val={`+ ${usd(ligne.allocFamilialeUSD)}`} vert />
        )}
        <div className="border-t pt-1">
          <Ligne label="Net à payer" val={usd(ligne.salNetUSD)} gras vert />
          <p className="text-right text-[11px] text-muted-foreground">≈ {cdf(ligne.salNetCDF)}</p>
        </div>
        <div className="border-t pt-1">
          <Ligne label="Charges patronales (CNSS + INPP + ONEM)" val={`+ ${usd(chargesPatronales)}`} />
          <Ligne label="Coût employeur total" val={usd(ligne.coutEmployeurUSD)} gras />
        </div>
      </dl>

      {impact && impact.effectif > 0 && (() => {
        // Création : le simulé S'AJOUTE. Modification : le simulé REMPLACE le bulletin actuel.
        const deltaNet = ligne.salNetUSD - (impact.actuel?.net ?? 0);
        const deltaCout = ligne.coutEmployeurUSD - (impact.actuel?.cout ?? 0);
        const pct = (d: number, base: number) => `${d >= 0 ? "+" : "−"}${((Math.abs(d) / base) * 100).toFixed(1)} %`;
        return (
          <div className="mt-3 rounded-md bg-muted/40 p-2.5 text-xs">
            <p className="mb-1 font-semibold">
              {impact.actuel ? `Impact de la modification (réf. ${impact.periode})` : `Impact sur la paie (${impact.periode})`}
            </p>
            {impact.actuel && (
              <p>
                Net de l&apos;employé : {usd(impact.actuel.net)} → <b>{usd(ligne.salNetUSD)}</b>{" "}
                <span className={deltaNet >= 0 ? "text-emerald-700" : "text-red-700"}>
                  ({deltaNet >= 0 ? "+" : "−"}{usd(Math.abs(deltaNet))})
                </span>
              </p>
            )}
            <p>
              Masse nette : {usd(impact.netActuel)} → <b>{usd(impact.netActuel + deltaNet)}</b>{" "}
              <span className="text-muted-foreground">({pct(deltaNet, impact.netActuel)})</span>
            </p>
            <p>
              Coût employeur : {usd(impact.coutActuel)} → <b>{usd(impact.coutActuel + deltaCout)}</b>{" "}
              <span className="text-muted-foreground">({pct(deltaCout, impact.coutActuel)})</span>
            </p>
            {!impact.actuel && (
              <p className="text-muted-foreground">Effectif payé : {impact.effectif} → {impact.effectif + 1}</p>
            )}
          </div>
        );
      })()}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Estimation d&apos;un mois « type » : heures contractuelles, sans heures supp., absences,
        primes ni acomptes. Le bulletin réel suivra les présences saisies.
      </p>
    </Panneau>
  );
}

function Panneau({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <aside className="h-fit rounded-xl border bg-card p-4 lg:sticky lg:top-4">
      <h2 className="mb-2 text-sm font-semibold">{titre}</h2>
      {children}
    </aside>
  );
}

function Ligne({ label, val, gras, rouge, vert }: { label: string; val: string; gras?: boolean; rouge?: boolean; vert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`${gras ? "font-semibold" : "text-muted-foreground"}`}>{label}</dt>
      <dd className={`${gras ? "font-semibold" : ""} ${rouge ? "text-red-700" : ""} ${vert ? "text-emerald-700" : ""}`}>{val}</dd>
    </div>
  );
}
