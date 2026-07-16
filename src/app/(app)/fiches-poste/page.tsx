import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { TelechargerLien } from "@/components/telecharger-lien";
import { enregistrerFichePoste, supprimerFichePoste, importerFichesEnMasse, creerPoste, renommerPoste, supprimerPoste } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";

export default async function FichesPostePage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; msg?: string }>;
}) {
  const sp = await searchParams;
  const user = await verifySession();
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const estAdmin = user.role === "ADMIN";

  // Postes distincts issus des employés (avec effectif) + fiches déjà enregistrées.
  const [employes, fiches] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true } }),
    prisma.fichePoste.findMany(),
  ]);

  const effectifParPoste = new Map<string, number>();
  for (const e of employes) {
    const p = e.poste.trim();
    if (p) effectifParPoste.set(p, (effectifParPoste.get(p) ?? 0) + 1);
  }
  const ficheParPoste = new Map(fiches.map((f) => [f.poste, f]));

  // Union des postes (employés + fiches orphelines), triée.
  const postes = [...new Set([...effectifParPoste.keys(), ...ficheParPoste.keys()])].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  const avecFiche = postes.filter((p) => {
    const f = ficheParPoste.get(p);
    return f?.fichierUrl || f?.description || f?.descriptionPoste;
  }).length;

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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Fiches de poste</h1>
          <p className="text-sm text-muted-foreground">
            Une fiche par intitulé de poste — description et document (PDF ou Word).
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">{avecFiche} documenté(s)</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">{postes.length - avecFiche} à faire</span>
        </div>
      </div>

      {peutGerer && (
        <div className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">➕ Créer un poste</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajoutez un nouvel intitulé de poste, même sans employé encore affecté. Il apparaîtra ci-dessous (à documenter)
            et sera proposé lors de la création d&apos;un employé.
          </p>
          <form action={creerPoste} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="poste"
              required
              placeholder="Ex. Commis de cuisine"
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground">
              Créer le poste
            </button>
          </form>
        </div>
      )}

      {peutGerer && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">📥 Importer des fiches en masse</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sélectionnez plusieurs fichiers d&apos;un coup : le logiciel reconnaît le poste concerné d&apos;après le nom du fichier
            (ex. « <span className="font-medium">Fiche cuisinier.pdf</span> » → poste « Cuisinier »). Les fichiers non reconnus sont signalés.
          </p>
          <form action={importerFichesEnMasse} className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="fichiers"
              multiple
              accept=".pdf,.doc,.docx"
              required
              className="text-xs"
            />
            <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground">
              Importer
            </button>
          </form>
        </div>
      )}

      {postes.length === 0 && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun poste enregistré (ajoutez d&apos;abord des employés avec un intitulé de poste).
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {postes.map((poste) => {
          const fiche = ficheParPoste.get(poste);
          const effectif = effectifParPoste.get(poste) ?? 0;
          const documente = Boolean(fiche?.fichierUrl || fiche?.description || fiche?.descriptionPoste);
          return (
            <div key={poste} className={`rounded-xl border bg-card p-4 ${documente ? "" : "border-dashed"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold">{poste}</h2>
                  <p className="text-xs text-muted-foreground">
                    {effectif > 0 ? `${effectif} employé(s)` : "aucun employé actif"}
                    {fiche?.fichierNom ? ` · 📎 ${fiche.fichierNom}` : ""}
                  </p>
                  {(fiche?.descriptionPoste || fiche?.description) && (
                    <details className="group mt-2">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
                        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                        Voir la description
                      </summary>
                      {fiche?.descriptionPoste && (
                        <>
                          <p className="mt-2 text-xs font-semibold text-muted-foreground">Description du poste</p>
                          <p className="whitespace-pre-line text-sm text-foreground/90">{fiche.descriptionPoste}</p>
                        </>
                      )}
                      {fiche?.description && (
                        <>
                          <p className="mt-2 text-xs font-semibold text-muted-foreground">Description des tâches</p>
                          <p className="whitespace-pre-line text-sm text-foreground/90">{fiche.description}</p>
                        </>
                      )}
                    </details>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {fiche && (
                    <ContratViewerButton
                      href={`/fiches-poste/${fiche.id}/pdf`}
                      titre={`Fiche de poste — ${poste}`}
                      libelle="Générer la fiche (PDF)"
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                    />
                  )}
                  {fiche?.fichierUrl && (
                    <TelechargerLien
                      href={fiche.fichierUrl}
                      nomFichier={fiche.fichierNom ?? undefined}
                      className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                    >
                      Télécharger le document
                    </TelechargerLien>
                  )}
                  {!documente && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      À documenter
                    </span>
                  )}
                </div>
              </div>

              {peutGerer && (
                <details className="group mt-3 border-t pt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                    {fiche ? "Modifier la fiche" : "Renseigner la fiche"}
                  </summary>
                  <form action={enregistrerFichePoste} className="mt-3 space-y-2">
                    <input type="hidden" name="poste" value={poste} />
                    <label className="block text-xs font-medium text-muted-foreground">Description du poste <span className="font-normal">(mission, rôle, positionnement)</span></label>
                    <textarea
                      name="descriptionPoste"
                      defaultValue={fiche?.descriptionPoste ?? ""}
                      rows={3}
                      placeholder="En quelques phrases : la mission du poste, son rôle dans l'équipe, son positionnement…"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                    <label className="block text-xs font-medium text-muted-foreground">Description des tâches — missions principales <span className="font-normal">(une par ligne)</span></label>
                    <textarea
                      name="description"
                      defaultValue={fiche?.description ?? ""}
                      rows={5}
                      placeholder="Les missions / responsabilités du poste, une par ligne…"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />

                    {/* Champs du générateur de fiche de poste (PDF). */}
                    <p className="mt-2 border-t pt-2 text-xs font-semibold text-muted-foreground">Informations pour la fiche de poste (PDF)</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Type de contrat
                        <input type="text" name="typeContrat" defaultValue={fiche?.typeContrat ?? ""} placeholder="ex. CDD à temps partiel" className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Échelle salariale
                        <input type="text" name="echelleSalariale" defaultValue={fiche?.echelleSalariale ?? ""} placeholder="ex. 100 USD" className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Supérieur hiérarchique direct
                        <input type="text" name="superieurHierarchique" defaultValue={fiche?.superieurHierarchique ?? ""} placeholder="ex. Contrôleur de gestion" className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Temps de travail
                        <input type="text" name="tempsTravail" defaultValue={fiche?.tempsTravail ?? ""} placeholder="ex. 10 heures/semaine" className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground" />
                      </label>
                    </div>
                    <p className="text-[11px] text-muted-foreground">La classe / catégorie professionnelle et le lieu de travail se remplissent automatiquement (catégorie des salariés du poste ; restaurant Pâtes en Folie).</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Compétences techniques <span className="font-normal">(une par ligne)</span>
                        <textarea name="competencesTechniques" defaultValue={fiche?.competencesTechniques ?? ""} rows={3} className="rounded-md border bg-background px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Savoir-être, soft skills <span className="font-normal">(une par ligne)</span>
                        <textarea name="savoirEtre" defaultValue={fiche?.savoirEtre ?? ""} rows={3} className="rounded-md border bg-background px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Formations requises
                        <textarea name="formationsRequises" defaultValue={fiche?.formationsRequises ?? ""} rows={2} className="rounded-md border bg-background px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Diplômes requis
                        <textarea name="diplomesRequis" defaultValue={fiche?.diplomesRequis ?? ""} rows={2} className="rounded-md border bg-background px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs text-muted-foreground sm:col-span-2">Expériences exigées
                        <textarea name="experiencesExigees" defaultValue={fiche?.experiencesExigees ?? ""} rows={2} className="rounded-md border bg-background px-3 py-2 text-sm text-foreground" />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="file"
                        name="fichier"
                        accept=".pdf,.doc,.docx"
                        className="text-xs"
                      />
                      <span className="text-xs text-muted-foreground">PDF ou Word (max 15 Mo)</span>
                      <button
                        type="submit"
                        className="ml-auto rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      >
                        Enregistrer
                      </button>
                    </div>
                  </form>
                  {/* Renommer le poste (répercuté sur employés, contrats, besoins, polyvalences). */}
                  <form action={renommerPoste} className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    <input type="hidden" name="poste" value={poste} />
                    <input
                      type="text"
                      name="nouveau"
                      required
                      defaultValue={poste}
                      aria-label={`Nouveau nom pour le poste ${poste}`}
                      className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                    />
                    <ConfirmSubmitButton
                      message={`Renommer le poste « ${poste} » ? Le changement s'applique à tous les employés, contrats et plannings concernés.`}
                      className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      Renommer
                    </ConfirmSubmitButton>
                  </form>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {estAdmin && fiche && (
                      <form action={supprimerFichePoste.bind(null, poste)}>
                        <ConfirmSubmitButton
                          message={`Supprimer la fiche du poste « ${poste} » ? (Le poste et ses employés sont conservés.)`}
                          className="rounded-md border border-destructive/60 px-3 py-1 text-xs font-medium text-destructive"
                        >
                          Supprimer la fiche
                        </ConfirmSubmitButton>
                      </form>
                    )}
                    {estAdmin && (
                      effectif === 0 ? (
                        <form action={supprimerPoste.bind(null, poste)}>
                          <ConfirmSubmitButton
                            message={`Supprimer définitivement le poste « ${poste} » ? La fiche, les besoins de planning et les polyvalences liés seront supprimés.`}
                            className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive"
                          >
                            Supprimer le poste
                          </ConfirmSubmitButton>
                        </form>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Pour supprimer ce poste, réaffectez d&apos;abord ses {effectif} salarié(s).
                        </span>
                      )
                    )}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
