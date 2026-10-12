import { ContratViewerButton } from "./contrat-viewer";
import { BulletinViewerButton } from "./bulletin-viewer";
import { BoutonSigner } from "@/components/bouton-signer";
import { EtatSignatureLecture } from "@/components/etat-signature-lecture";
import { EtatVide } from "@/components/etat-vide";
import { Pagination } from "@/components/pagination";
import { PastillesFiltre } from "@/components/pastilles-filtre";
import { TelechargerLien } from "@/components/telecharger-lien";
import { refusAttestationPaie } from "@/lib/attestation-paie-regle";
import { anneesAvecDonnees, lienFicheAnnee, totauxAnnuelsPaie, type AnneeVue } from "@/lib/fiche-annees";
import { formaterNombre, montantSigne } from "@/lib/montant";
import { salaireNetCDF, salaireNetUSD } from "@/lib/paie-net";
import { tauxDeLigne } from "@/lib/paie-taux";
import { fenetrePage, tranche, type ParPage } from "@/lib/pagination";
import type { EtatSignature } from "@/lib/signature";
import { faireSignerDocument } from "../../signature-actions";
import { CorrigerPaiement } from "../../paie/corriger-paiement";
import { libelleModePaiement, jourFrancais } from "@/lib/correction-paiement";
import type { ModePaiement } from "@prisma/client";

/** Un bulletin de l'historique, prêt à afficher (montants déjà lus, taux de la ligne résolu par la page). */
export type LigneHistoriquePaie = {
  id: string;
  mois: number;
  annee: number;
  statutPaiement: "PAS_VALIDE" | "VALIDE" | "PAYE";
  /** Total versé stocké (net + transport). */
  salNetUSD: number;
  transportUSD: number;
  /** Taux du bulletin (`tauxDeLigne`) ; 0 = inconnu. */
  taux: number;
  /** Bulletins déjà remis, du plus ancien au plus récent. */
  versions: { numeroVersion: number; genereLe: Date }[];
  signature: EtatSignature;
  /** Jour de versement (`YYYY-MM-DD`) et moyen de paiement d'un bulletin payé ; absents = jamais renseignés. */
  datePaiement?: string | null;
  modePaiement?: ModePaiement | null;
};

type Montant = { toString(): string };
/** Une ligne de paie telle que Prisma la rend, vue pour l'historique (taux de la ligne : celui de sa validation si elle est figée). */
export function ligneHistoriquePaie(
  l: {
    id: string;
    statutPaiement: LigneHistoriquePaie["statutPaiement"];
    salNetUSD: Montant;
    transportUSD: Montant;
    tauxChangeFige: Montant | null;
    datePaiement?: Date | null;
    modePaiement?: ModePaiement | null;
    payrollRun: { mois: number; annee: number; tauxChangeUtilise: Montant };
    versionsBulletin: { numeroVersion: number; genereLe: Date }[];
  },
  signature: EtatSignature,
): LigneHistoriquePaie {
  return {
    id: l.id,
    mois: l.payrollRun.mois,
    annee: l.payrollRun.annee,
    statutPaiement: l.statutPaiement,
    salNetUSD: Number(l.salNetUSD),
    transportUSD: Number(l.transportUSD),
    taux: tauxDeLigne(l, l.payrollRun),
    versions: l.versionsBulletin,
    signature,
    datePaiement: l.datePaiement ? l.datePaiement.toISOString().slice(0, 10) : null,
    modePaiement: l.modePaiement ?? null,
  };
}

const libelleMois = (l: { mois: number; annee: number }) =>
  new Date(l.annee, l.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

function Usd({ valeur, className = "" }: { valeur: number | null; className?: string }) {
  if (valeur === null) return <span className={className}>—</span>;
  const m = montantSigne(valeur, "USD");
  return <span className={`${m.negatif ? "text-red-600" : ""} ${className}`}>{m.texte}</span>;
}

function Cdf({ valeur }: { valeur: number | null }) {
  if (valeur === null) return <span>—</span>;
  return <span className={valeur < 0 ? "text-red-600" : ""}>{valeur < 0 ? `(${formaterNombre(Math.abs(valeur))} CDF)` : `${formaterNombre(valeur)} CDF`}</span>;
}

const BADGES: Record<string, { classe: string; libelle: string }> = {
  PAYE: { classe: "bg-green-100 text-green-800", libelle: "Payé" },
  VALIDE: { classe: "bg-blue-100 text-blue-800", libelle: "Validé" },
  PAS_VALIDE: { classe: "bg-amber-100 text-amber-800", libelle: "Pas validé" },
};

function PaiementBadge({ statut }: { statut: string }) {
  const b = BADGES[statut];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b?.classe ?? ""}`}>{b?.libelle ?? statut}</span>;
}

/**
 * HISTORIQUE DE PAIE PAR ANNÉE (demande de la Direction, 2026-10-12) : pastilles des années (celle en cours par
 * défaut, « Toutes » pour tout voir), un bloc par année avec ses TOTAUX en tête, puis ses bulletins. Les totaux
 * sont ceux de l'année ENTIÈRE, même quand la pagination (« Toutes ») ne montre qu'une partie de ses lignes.
 * Colonnes et gestes inchangés : Aperçu, $, CDF, Attestation, Signer.
 */
export function HistoriquePaie({ employeeId, nomSalarie, peutModifier, peutCorrigerPaiement = false, lignes, annee, anneeCourante, page, par }: {
  employeeId: string;
  nomSalarie: string;
  peutModifier: boolean;
  /** Direction seule : « Corriger le paiement » (date de versement, moyen) sur les bulletins payés, de tous les mois. */
  peutCorrigerPaiement?: boolean;
  /** TOUS les bulletins du salarié, du plus récent au plus ancien. */
  lignes: LigneHistoriquePaie[];
  annee: AnneeVue;
  anneeCourante: number;
  page: number;
  par: ParPage;
}) {
  const annees = anneesAvecDonnees(lignes.map((l) => l.annee), anneeCourante);
  const effectifs: Record<string, number> = { toutes: lignes.length };
  for (const a of annees) effectifs[String(a)] = lignes.filter((l) => l.annee === a).length;
  const choisies = annee === "toutes" ? lignes : lignes.filter((l) => l.annee === annee);
  const f = fenetrePage(choisies.length, page, par);
  const visibles = tranche(choisies, f);
  // Groupes dans l'ordre d'affichage (années décroissantes) : un groupe = les lignes visibles d'une année.
  const groupes = annees.map((a) => ({ annee: a, visibles: visibles.filter((l) => l.annee === a) })).filter((g) => g.visibles.length > 0);

  return (
    <>
      <div className="mb-4">
        <PastillesFiltre
          libelle="Année de la paie"
          valeurs={[...annees.map((a) => [String(a), String(a)] as const), ["toutes", "Toutes"] as const]}
          actif={String(annee)}
          effectifs={effectifs}
          lien={(v) => lienFicheAnnee(employeeId, "paie", v === "toutes" ? "toutes" : Number(v))}
        />
      </div>

      {groupes.length === 0 && (
        <EtatVide message={lignes.length === 0 ? "Aucune paie calculée pour cet employé pour le moment." : `Aucun bulletin en ${annee}.`} />
      )}

      {groupes.map((g) => {
        const t = totauxAnnuelsPaie(lignes.filter((l) => l.annee === g.annee));
        // Le tableau ne montre qu'une partie de l'année (pagination) : les totaux, eux, restent ceux de l'année entière.
        const partiel = g.visibles.length < effectifs[String(g.annee)];
        return (
          <section key={g.annee} aria-label={`Paie ${g.annee}`} className="mb-6 last:mb-0">
            <h3 className="mb-2 text-sm font-semibold">{g.annee}</h3>
            <dl data-totaux-annee={g.annee} className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Salaire net $</dt>
                <dd className="text-lg font-semibold"><Usd valeur={t.netUSD} /></dd>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Salaire net CDF</dt>
                <dd className="text-lg font-semibold"><Cdf valeur={t.netCDF} /></dd>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Total versé $</dt>
                <dd className="text-lg font-semibold"><Usd valeur={t.verseUSD} /></dd>
                {t.restantAPayerUSD > 0 && (
                  <dd data-restant-a-payer className="text-xs text-muted-foreground">dont <Usd valeur={t.restantAPayerUSD} /> pas encore payés</dd>
                )}
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Bulletins</dt>
                <dd className="text-sm">
                  <span className="font-semibold">{t.payes}</span> payé{t.payes > 1 ? "s" : ""}
                  {t.valides > 0 && <> · <span className="font-semibold">{t.valides}</span> validé{t.valides > 1 ? "s" : ""}</>}
                  {" · "}<span className="font-semibold">{t.nonValides}</span> non validé{t.nonValides > 1 ? "s" : ""}
                </dd>
              </div>
            </dl>
            {(t.nonValides > 0 || partiel) && (
              <p className="-mt-1 mb-3 text-xs text-muted-foreground">
                Totaux des bulletins validés ou payés{t.nonValides > 0 ? " ; un bulletin non validé est provisoire et n'est pas additionné" : ""}
                {partiel ? ". Totaux de l'année entière : le tableau ci-dessous n'en montre qu'une partie" : ""}.
              </p>
            )}

            <div className="tableau-normal-xl rounded-lg border">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2">Période</th>
                    <th className="px-3 py-2 text-right">Salaire net $</th>
                    <th className="px-3 py-2 text-right">Salaire net CDF</th>
                    <th className="px-3 py-2 text-right">Total versé $</th>
                    <th className="px-3 py-2">Paiement</th>
                    <th className="px-3 py-2">Signature</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {g.visibles.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{libelleMois(l)}</td>
                      <td className="px-3 py-2 text-right"><Usd valeur={salaireNetUSD(l)} /></td>
                      <td className="px-3 py-2 text-right">
                        <Cdf valeur={l.taux > 0 ? Math.round(salaireNetCDF(l, l.taux)) : null} />
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground"><Usd valeur={l.salNetUSD} /></td>
                      <td className="px-3 py-2">
                        <PaiementBadge statut={l.statutPaiement} />
                        {l.statutPaiement === "PAYE" && (l.datePaiement || l.modePaiement) && (
                          <span className="block text-[11px] text-muted-foreground">
                            {l.datePaiement ? `le ${jourFrancais(l.datePaiement)}` : ""}{l.datePaiement && l.modePaiement ? " · " : ""}{l.modePaiement ? libelleModePaiement(l.modePaiement) : ""}
                          </span>
                        )}
                        {l.statutPaiement === "PAYE" && peutCorrigerPaiement && (
                          <CorrigerPaiement payrollLineId={l.id} datePaiement={l.datePaiement ?? null} modePaiement={l.modePaiement ?? null} nomDocument={libelleMois(l)} />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {l.statutPaiement === "PAS_VALIDE" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : peutModifier ? (
                          <BoutonSigner
                            cible="BULLETIN"
                            cibleId={l.id}
                            nomSalarie={nomSalarie}
                            libelleDocument={`Bulletin ${libelleMois(l)} — ${nomSalarie}`}
                            cote="DIRECTION"
                            action={faireSignerDocument}
                            {...l.signature}
                          />
                        ) : (
                          <EtatSignatureLecture {...l.signature} />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <BulletinViewerButton payrollLineId={l.id} nom={`${nomSalarie} — ${libelleMois(l)}`} />
                        {" · "}
                        <TelechargerLien href={`/paie/bulletin/${l.id}?devise=USD&dl=1`} className="text-primary underline">$</TelechargerLien>
                        {" · "}
                        <TelechargerLien href={`/paie/bulletin/${l.id}?devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
                        {/* Bulletins remis antérieurs (ligne rouverte, recalculée ou réinitialisée depuis) : l'archive
                            figée, jamais le bulletin recalculé. Le dernier remis d'une ligne validée = le bulletin ci-dessus. */}
                        {(l.statutPaiement === "PAS_VALIDE" ? l.versions : l.versions.slice(0, -1)).map((v) => (
                          <span key={v.numeroVersion} className="block text-[11px] text-muted-foreground">
                            Remis v{v.numeroVersion} ({new Date(v.genereLe).toLocaleDateString("fr-FR")}) :{" "}
                            <TelechargerLien href={`/paie/bulletin/${l.id}?version=${v.numeroVersion}&devise=USD&dl=1`} className="text-primary underline">$</TelechargerLien>
                            {" · "}
                            <TelechargerLien href={`/paie/bulletin/${l.id}?version=${v.numeroVersion}&devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
                          </span>
                        ))}
                        {/* Attestation de paie : délivrée une fois le bulletin PAYÉ (décision Direction 2026-10-12). */}
                        {l.statutPaiement === "PAYE" && " · "}
                        {l.statutPaiement === "PAYE" && (
                          <ContratViewerButton
                            href={`/employes/${employeeId}/attestation-paie/${l.id}`}
                            titre={`Attestation de paie — ${nomSalarie} — ${libelleMois(l)}`}
                            libelle="Attestation"
                            className="text-primary underline"
                          />
                        )}
                        {l.statutPaiement === "VALIDE" && (
                          <span className="block text-[11px] text-muted-foreground" title={refusAttestationPaie(l.statutPaiement) ?? undefined}>
                            Attestation : après paiement
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <Pagination
        className="mt-4"
        total={choisies.length}
        page={f.page}
        par={par}
        chemin={`/employes/${employeeId}`}
        params={{ tab: "paie", annee: String(annee) }}
        libelle="bulletins"
      />
    </>
  );
}
