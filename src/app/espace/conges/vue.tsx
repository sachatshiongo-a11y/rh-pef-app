import { Icone } from "@/components/icones";
import { ChampsDatesConge } from "@/components/champs-dates-conge";
import { BoutonSigner, type ActionSignature } from "@/components/bouton-signer";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import { formaterNombre } from "@/lib/montant";
import { statutDemande } from "@/lib/libelles-espace";
import type { EtatSignature } from "@/lib/signature";
import type { SoldeConge } from "@/lib/solde-conge-salarie";

// VUE de « Mes congés » — séparée de la page (qui lit la base) pour être rendue par un test.

export type DemandeConge = {
  id: string;
  type: string;
  nbJours: number;
  dateDebut: Date;
  dateFin: Date;
  motif: string | null;
  statut: string;
  /** Motif d'un refus (null sur une demande refusée avant que le motif existe). */
  motifRefus?: string | null;
  /** État de signature — seulement pour une demande APPROUVÉE (seule à se signer). */
  signature: EtatSignature | null;
};

const MOIS_ABBR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const jourLong = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const jours = (n: number) => `${formaterNombre(n, { maximumFractionDigits: 1 })} jour${n > 1 ? "s" : ""}`;
const inputCls = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm";

export function VueMesConges({
  nomSalarie,
  solde,
  annee,
  types,
  feries,
  aujourdhui,
  envoye,
  erreur,
  demandes,
  demanderConge,
  signer,
}: {
  nomSalarie: string;
  solde: SoldeConge;
  annee: number;
  types: string[];
  feries: string[];
  aujourdhui: string;
  envoye: boolean;
  erreur: string | null;
  demandes: DemandeConge[];
  demanderConge: (formData: FormData) => void | Promise<void>;
  signer: ActionSignature;
}) {
  // À venir : ce qui n'est pas refusé et pas encore terminé, le plus proche d'abord.
  const aVenir = demandes.filter((l) => l.statut !== "REFUSE" && iso(l.dateFin) >= aujourdhui).reverse();
  const passees = demandes.filter((l) => iso(l.dateFin) < aujourdhui);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mes congés</h1>
        <p className="text-sm text-muted-foreground">Votre solde, vos demandes et vos absences.</p>
      </div>

      {/* Le chiffre qui compte d'abord ; les deux autres l'expliquent. */}
      <section className="rounded-2xl border bg-card p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat n={solde.solde} label="Il vous reste" accent />
          <Stat n={solde.acquis} label="Acquis" />
          <Stat n={solde.pris} label={`Pris en ${annee}`} />
        </div>
        {solde.typesDeduits.length > 0 && (
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            Se déduisent de votre solde : {solde.typesDeduits.join(", ")}. Les autres types d&apos;absence ne le diminuent pas.
          </p>
        )}
      </section>

      {envoye && (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Votre demande est envoyée. Vous serez prévenu(e) dès que la Direction aura répondu.
        </p>
      )}
      {erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {/* Nouvelle demande (repliée pour aérer ; ouverte d'office après une erreur, pour corriger). */}
      <details className="group rounded-2xl border bg-card" open={!!erreur}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icone nom="parasol" /></span>
          <span className="flex-1">Demander un congé</span>
          <Icone nom="chevronDroit" className="shrink-0 text-muted-foreground transition group-open:rotate-90" />
        </summary>
        <form action={demanderConge} className="grid gap-4 border-t p-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2">
            Type de congé
            <select name="type" required className={inputCls} defaultValue={types[0] ?? ""}>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {/* Dates + décompte EN DIRECT des jours ouvrables (dimanches et fériés exclus). */}
          <ChampsDatesConge feries={feries} min={aujourdhui} labelDebut="Premier jour d'absence" labelFin="Dernier jour d'absence" labelJours="Nombre de jours" inputClassName={inputCls} />
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2">
            <span>Motif <span className="font-normal text-muted-foreground">(facultatif)</span></span>
            <input type="text" name="motif" placeholder="ex. raison familiale" className={inputCls} />
          </label>
          <div className="sm:col-span-2">
            <button className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground sm:w-auto sm:py-2">Envoyer la demande</button>
            <p className="mt-2 text-xs text-muted-foreground">La Direction accepte ou refuse ; la réponse arrive dans vos notifications.</p>
          </div>
        </form>
      </details>

      <SectionAbsences titre="À venir" items={aVenir} vide="Aucune absence à venir." nomSalarie={nomSalarie} signer={signer} />
      <SectionAbsences titre="Passées" items={passees} vide="Aucune absence passée." nomSalarie={nomSalarie} signer={signer} />
    </div>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`text-2xl font-semibold tabular-nums sm:text-3xl ${accent ? "text-primary" : ""}`}>
        {formaterNombre(n, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
        <span className="ml-0.5 text-sm font-medium">j</span>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionAbsences({
  titre,
  items,
  vide,
  nomSalarie,
  signer,
}: {
  titre: string;
  items: DemandeConge[];
  vide: string;
  nomSalarie: string;
  signer: ActionSignature;
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{titre}</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{vide}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((l) => {
            const b = statutDemande(l.statut);
            return (
              <li key={l.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-3">
                  <span className="flex shrink-0 items-center gap-1" aria-label={`du ${jourLong(l.dateDebut)} au ${jourLong(l.dateFin)}`}>
                    <ChipDate date={l.dateDebut} />
                    <span aria-hidden className="text-muted-foreground">→</span>
                    <ChipDate date={l.dateFin} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{l.type}</p>
                    <p className="text-xs text-muted-foreground">{jours(l.nbJours)}{l.motif ? ` · ${l.motif}` : ""}</p>
                    {l.statut === "REFUSE" && <p className="text-xs text-muted-foreground">Motif du refus : {l.motifRefus ?? "—"}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                </div>
                {/* Le document AVANT le geste : on ne demande jamais de signer ce qu'on ne peut pas
                    lire. Présent dès que la demande est approuvée, signée ou non. */}
                {l.signature && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
                    <ContratViewerButton
                      href={`/espace/conges/demande/${l.id}`}
                      titre={`Demande de congé — ${l.type}`}
                      libelle="Voir le document"
                      className="text-primary underline"
                    />
                    <BoutonSigner
                      cible="DEMANDE_CONGE"
                      cibleId={l.id}
                      nomSalarie={nomSalarie}
                      libelleDocument={`${l.type} du ${jourLong(l.dateDebut)}`}
                      cote="SALARIE"
                tactile
                      action={signer}
                      {...l.signature}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ChipDate({ date }: { date: Date }) {
  const d = new Date(date);
  return (
    <span className="flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-lg border text-center leading-none">
      <span className="w-full bg-primary/10 py-0.5 text-[10px] font-semibold text-primary">{MOIS_ABBR[d.getUTCMonth()]}</span>
      <span className="py-1 text-base font-semibold tabular-nums">{d.getUTCDate()}</span>
    </span>
  );
}
