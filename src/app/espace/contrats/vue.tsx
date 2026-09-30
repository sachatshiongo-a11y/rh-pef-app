import { BoutonSigner, type ActionSignature } from "@/components/bouton-signer";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ApercuDocumentBouton } from "@/components/apercu-document";
import { libelleTypeContrat, jourMetier, type Classement } from "@/lib/contrats-classement";
import type { EtatSignature } from "@/lib/signature";

// VUE de « Mes contrats » — séparée de la page (qui lit la base) pour être rendue telle quelle
// par un test : l'ordre des rubriques, les états vides et l'absence de valeur brute d'enum se
// vérifient sur le HTML produit, pas sur une intention.

export type LigneContrat = {
  id: string;
  type: string;
  poste: string;
  dateDebut: Date;
  dateFin: Date | null;
  classement: Classement;
  etat: EtatSignature;
  /** Pièce jointe du contrat (scan, Word…) déposée par la Direction. */
  documentUrl?: string | null;
};

export function rubriquesContrats(lignes: LigneContrat[]) {
  return {
    aSigner: lignes.filter((l) => l.classement.categorie === "A_SIGNER"),
    enVigueur: lignes.filter((l) => l.classement.categorie === "EN_VIGUEUR"),
    anciens: lignes.filter((l) => l.classement.categorie === "ANCIEN"),
  };
}

const periode = (l: LigneContrat) =>
  `du ${jourMetier(l.dateDebut)} ${l.dateFin ? `au ${jourMetier(l.dateFin)}` : "(durée indéterminée)"}${l.classement.aVenir && l.classement.motif ? ` · ${l.classement.motif}` : ""}`;

function PieceJointe({ l }: { l: LigneContrat }) {
  return l.documentUrl ? (
    <ApercuDocumentBouton href={l.documentUrl} titre={`Pièce jointe — ${libelleTypeContrat(l.type)} · ${l.poste}`} libelle="pièce jointe" className="text-xs text-muted-foreground underline" />
  ) : null;
}
const titre = (l: LigneContrat) => `${libelleTypeContrat(l.type)} · ${l.poste}`;

export function VueMesContrats({
  lignes,
  nomSalarie,
  action,
}: {
  lignes: LigneContrat[];
  nomSalarie: string;
  action: ActionSignature;
}) {
  const { aSigner, enVigueur, anciens } = rubriquesContrats(lignes);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mes contrats</h1>
        <p className="text-sm text-muted-foreground">Lisez puis signez vos contrats ; retrouvez ceux qui vous lient et les anciens.</p>
      </div>

      <Rubrique titre="À signer" vide="Aucun contrat à signer.">
        {aSigner.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{titre(l)}</p>
              <p className="text-xs text-muted-foreground">{periode(l)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
              <ContratViewerButton href={`/espace/contrat/${l.id}`} titre={`Contrat — ${titre(l)}`} libelle="Lire le contrat" className="text-primary underline" />
              <BoutonSigner
                cible="CONTRAT"
                cibleId={l.id}
                nomSalarie={nomSalarie}
                libelleDocument={`Contrat ${titre(l)}`}
                cote="SALARIE"
                tactile
                action={action}
                {...l.etat}
              />
              <PieceJointe l={l} />
            </div>
          </li>
        ))}
      </Rubrique>

      <Rubrique titre="En vigueur" vide="Aucun contrat en vigueur.">
        {enVigueur.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{titre(l)}</p>
              <p className="text-xs text-muted-foreground">{periode(l)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
              {l.etat.signeLeTexte && (
                <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  Signé le {l.etat.signeLeTexte}
                </span>
              )}
              <ContratViewerButton href={`/espace/contrat/${l.id}`} titre={`Contrat — ${titre(l)}`} libelle="Voir" className="text-primary underline" />
              <TelechargerLien href={`/espace/contrat/${l.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
              <PieceJointe l={l} />
            </div>
          </li>
        ))}
      </Rubrique>

      <Rubrique titre="Anciens" vide="Aucun ancien contrat.">
        {anciens.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{titre(l)}</p>
              <p className="text-xs text-muted-foreground">
                {periode(l)}
                {l.classement.motif ? ` · ${l.classement.motif}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-sm">
              <TelechargerLien href={`/espace/contrat/${l.id}?dl=1&exemplaire=fige`} className="text-primary underline">Télécharger</TelechargerLien>
              <PieceJointe l={l} />
            </div>
          </li>
        ))}
      </Rubrique>
    </div>
  );
}

function Rubrique({ titre, vide, children }: { titre: string; vide: string; children: React.ReactNode[] }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="mb-2 text-base font-semibold">{titre}</h2>
      {children.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{vide}</p>
      ) : (
        <ul className="divide-y">{children}</ul>
      )}
    </section>
  );
}
