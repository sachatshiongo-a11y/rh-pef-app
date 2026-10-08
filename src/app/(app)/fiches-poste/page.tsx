import { prisma } from "@/lib/prisma";
import { creerPoste, importerFichesEnMasse } from "./actions";
import { exigerPageRH } from "@/lib/garde-page";
import { lignesFichesPoste } from "@/lib/fiches-poste-liste";
import { ListeFichesPoste } from "./liste-fiches-poste";

/**
 * Fiches de poste — une ligne par intitulé, rangée par département (2026-10-08). L'en-tête garde
 * les deux gestes rares (créer un poste, importer en masse) compacts, pour que la LISTE — ce qu'on
 * consulte — commence dans le premier écran ; recherche, filtre, actions groupées et édition en
 * pleine largeur vivent dans `ListeFichesPoste`. Contenu des fiches, PDF et droits inchangés.
 */
export default async function FichesPostePage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; msg?: string; poste?: string }>;
}) {
  const user = await exigerPageRH();
  const sp = await searchParams;
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const estAdmin = user.role === "ADMIN";

  // Postes distincts issus des employés actifs (avec effectif et département) + fiches déjà enregistrées.
  const [employes, fiches] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { id: true, nom: true, photoUrl: true, poste: true, secteur: true } }),
    prisma.fichePoste.findMany({
      select: {
        id: true, poste: true, descriptionPoste: true, description: true, typeContrat: true, echelleSalariale: true, categorieProfessionnelle: true,
        superieurHierarchique: true, tempsTravail: true, competencesTechniques: true, savoirEtre: true, formationsRequises: true, diplomesRequis: true,
        experiencesExigees: true, fichierUrl: true, fichierNom: true,
      },
    }),
  ]);
  const lignes = lignesFichesPoste(employes, fiches);
  const documentees = lignes.filter((l) => l.documentee).length;

  return (
    <div>
      {sp.erreur && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {sp.erreur}
        </div>
      )}
      {sp.msg && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {sp.msg}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Fiches de poste</h1>
          <p className="text-sm text-muted-foreground">
            Une fiche par intitulé de poste — description et document (PDF ou Word). {documentees} documentée(s) sur {lignes.length}.
          </p>
        </div>
      </div>

      {peutGerer && (
        <div className="mb-5 rounded-xl border bg-card p-3 sm:p-4">
          <form action={creerPoste} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
              Créer un poste (même sans employé : il sera proposé à la création d&apos;un employé)
              <input type="text" name="poste" required placeholder="Ex. Commis de cuisine" className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground" />
            </label>
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Créer le poste
            </button>
          </form>
          <details className="group mt-3 border-t pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
              Importer des fiches en masse
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Sélectionnez plusieurs fichiers d&apos;un coup : le logiciel reconnaît le poste concerné d&apos;après le nom du fichier
              (ex. « <span className="font-medium">Fiche cuisinier.pdf</span> » → poste « Cuisinier »). Les fichiers non reconnus sont signalés.
            </p>
            <form action={importerFichesEnMasse} className="mt-2 flex flex-wrap items-center gap-3">
              <input type="file" name="fichiers" multiple accept=".pdf,.doc,.docx" required className="text-xs" />
              <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">
                Importer
              </button>
            </form>
          </details>
        </div>
      )}

      <ListeFichesPoste lignes={lignes} peutGerer={peutGerer} estAdmin={estAdmin} posteOuvert={sp.poste} />
    </div>
  );
}
