import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { TelechargerLien } from "@/components/telecharger-lien";
import { enregistrerFichePoste, supprimerFichePoste } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

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

  const avecFiche = postes.filter((p) => ficheParPoste.get(p)?.fichierUrl || ficheParPoste.get(p)?.description).length;

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
      <div className="mb-6">
        <h1 className="text-xl font-semibold sm:text-2xl">Fiches de poste</h1>
        <p className="text-sm text-muted-foreground">
          Une fiche par intitulé de poste — description et document (PDF ou Word). {avecFiche}/{postes.length} poste(s) documenté(s).
        </p>
      </div>

      {postes.length === 0 && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun poste enregistré (ajoutez d&apos;abord des employés avec un intitulé de poste).
        </div>
      )}

      <div className="space-y-3">
        {postes.map((poste) => {
          const fiche = ficheParPoste.get(poste);
          const effectif = effectifParPoste.get(poste) ?? 0;
          return (
            <div key={poste} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold">{poste}</h2>
                  <p className="text-xs text-muted-foreground">
                    {effectif > 0 ? `${effectif} employé(s)` : "aucun employé actif"}
                    {fiche?.fichierNom ? ` · 📎 ${fiche.fichierNom}` : ""}
                  </p>
                  {fiche?.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{fiche.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {fiche?.fichierUrl && (
                    <TelechargerLien
                      href={fiche.fichierUrl}
                      nomFichier={fiche.fichierNom ?? undefined}
                      className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                    >
                      Télécharger la fiche
                    </TelechargerLien>
                  )}
                  {!fiche && (
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
                    <textarea
                      name="description"
                      defaultValue={fiche?.description ?? ""}
                      rows={4}
                      placeholder="Description du poste : missions, responsabilités, compétences requises…"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
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
                  {estAdmin && fiche && (
                    <form action={supprimerFichePoste.bind(null, poste)} className="mt-2">
                      <ConfirmSubmitButton
                        message={`Supprimer la fiche du poste « ${poste} » ?`}
                        className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive"
                      >
                        Supprimer la fiche
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
