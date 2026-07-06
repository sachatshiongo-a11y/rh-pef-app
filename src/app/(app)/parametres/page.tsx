import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import {
  mettreAJourConfig,
  mettreAJourParametreLegal,
  mettreAJourTrancheIprCDF,
  ajouterJourFerie,
  supprimerJourFerie,
} from "./actions";
import { UsersAdmin, type UserRow } from "./users-admin";
import { TypesCongesAdmin, type TypeCongeRow } from "./types-conges-admin";

export default async function ParametresPage() {
  const user = await verifySession();
  const estAdmin = user.role === "ADMIN";

  const [config, exercice, joursFeries, users, typesConges, employesActifs] = await Promise.all([
    prisma.config.findUniqueOrThrow({ where: { id: "singleton" } }),
    prisma.exerciceFiscal.findFirst({
      where: { actif: true },
      include: {
        parametres: { orderBy: { cle: "asc" } },
        tranchesIpr: { orderBy: { ordre: "asc" } },
      },
    }),
    prisma.jourFerie.findMany({ orderBy: { date: "asc" } }),
    prisma.user.findMany({ orderBy: { nom: "asc" }, include: { employe: { select: { nom: true } } } }),
    prisma.typeConge.findMany({ orderBy: { ordre: "asc" } }),
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);
  const userRows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    nom: u.nom,
    role: u.role,
    actif: u.actif,
    employeeId: u.employeeId,
    employeNom: u.employe?.nom ?? null,
  }));
  const typeCongeRows: TypeCongeRow[] = typesConges.map((t) => ({ id: t.id, nom: t.nom, joursPayes: t.joursPayes, tauxPct: t.tauxPct, systeme: t.systeme, actif: t.actif }));

  if (!estAdmin) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">
          Seul le directeur (compte ADMIN) peut consulter et modifier les paramètres.
        </p>
      </div>
    );
  }

  const nbAValider =
    (exercice?.parametres.filter((p) => p.statutValidation === "A_VALIDER").length ?? 0) +
    (exercice?.tranchesIpr.filter((t) => t.statutValidation === "A_VALIDER").length ?? 0);

  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold">Paramètres</h1>

      <Section title="Utilisateurs & accès">
        <UsersAdmin users={userRows} employes={employesActifs} monId={user.id} />
      </Section>

      <Section title="Types de congés & absences">
        <TypesCongesAdmin types={typeCongeRows} />
      </Section>

      <Section title="Paramètres opérationnels">
        <form action={mettreAJourConfig} className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field
            label="Taux de change CDF/USD"
            name="tauxChangeCDF"
            type="number"
            step="0.01"
            defaultValue={config.tauxChangeCDF.toString()}
          />
          <Field
            label="Mois en cours (1-12)"
            name="moisCourant"
            type="number"
            defaultValue={String(config.moisCourant)}
          />
          <Field
            label="Année en cours"
            name="anneeCourante"
            type="number"
            defaultValue={String(config.anneeCourante)}
          />
          <div className="col-span-2 md:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </Section>

      <Section
        title={`Paramètres légaux — exercice ${exercice?.annee ?? "?"}`}
        badge={
          nbAValider > 0 ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              {nbAValider} valeur(s) À VALIDER par un comptable
            </span>
          ) : (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
              Toutes les valeurs validées
            </span>
          )
        }
      >
        <p className="mb-4 text-xs text-muted-foreground">
          Ces valeurs pilotent tous les calculs de paie. Elles sont versionnées par exercice
          fiscal et modifiables uniquement par le directeur. Cochez « Validé » une fois la valeur
          confirmée par votre comptable — toute modification non cochée repasse en « À VALIDER ».
        </p>
        {!exercice && (
          <p className="text-sm text-destructive">
            Aucun exercice fiscal actif — exécutez le script seed-legal-2026.ts.
          </p>
        )}
        <div className="space-y-1">
          {exercice?.parametres.map((p) => (
            <form
              key={p.id}
              action={mettreAJourParametreLegal.bind(null, p.id)}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-64 flex-1">
                <p className="font-medium">{p.libelle}</p>
                <p className="text-xs text-muted-foreground">
                  {p.cle}
                  {p.source ? ` · ${p.source}` : ""}
                  {p.commentaire ? ` — ${p.commentaire}` : ""}
                </p>
              </div>
              <input
                name="valeur"
                type="text"
                inputMode="decimal"
                defaultValue={p.valeur === null ? "" : p.valeur.toString()}
                placeholder="vide = inconnu"
                className="w-32 rounded-md border border-input bg-background px-2 py-1 text-right"
              />
              <span className="w-16 text-xs text-muted-foreground">{p.unite}</span>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  name="valider"
                  defaultChecked={p.statutValidation === "VALIDE"}
                />
                Validé
              </label>
              <StatutBadge statut={p.statutValidation} />
              <button type="submit" className="text-primary underline">
                Enregistrer
              </button>
            </form>
          ))}
        </div>
      </Section>

      <Section title="Barème IPR — DGI (tranches annuelles en CDF)">
        <p className="mb-3 text-xs text-muted-foreground">
          Barème progressif officiel DGI. Les plafonds sont annuels en francs congolais ; le
          moteur divise par 12 pour le calcul mensuel. Dernière tranche : plafond vide = « au-delà ».
        </p>
        <div className="space-y-1">
          {exercice?.tranchesIpr.map((t) => (
            <form
              key={t.id}
              action={mettreAJourTrancheIprCDF.bind(null, t.id)}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <span className="w-20 text-muted-foreground">Tranche {t.ordre}</span>
              <label className="flex items-center gap-1.5">
                Plafond annuel CDF
                <input
                  name="plafondAnnuelCDF"
                  type="text"
                  inputMode="numeric"
                  defaultValue={t.plafondAnnuelCDF?.toString() ?? ""}
                  placeholder="au-delà"
                  className="w-36 rounded-md border border-input bg-background px-2 py-1 text-right"
                />
              </label>
              <label className="flex items-center gap-1.5">
                Taux
                <input
                  name="taux"
                  type="text"
                  inputMode="decimal"
                  defaultValue={t.taux.toString()}
                  className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  name="valider"
                  defaultChecked={t.statutValidation === "VALIDE"}
                />
                Validé
              </label>
              <StatutBadge statut={t.statutValidation} />
              <button type="submit" className="text-primary underline">
                Enregistrer
              </button>
            </form>
          ))}
        </div>
      </Section>

      <Section title="Jours fériés">
        <form action={ajouterJourFerie} className="mb-4 flex items-end gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="date" className="font-medium">
              Date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              required
              className="rounded-md border border-input bg-background px-2 py-1.5"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="designation" className="font-medium">
              Désignation
            </label>
            <input
              id="designation"
              name="designation"
              required
              className="rounded-md border border-input bg-background px-2 py-1.5"
            />
          </div>
          <button type="submit" className="rounded-md border px-3 py-1.5 font-medium">
            Ajouter
          </button>
        </form>

        <table className="w-full text-sm">
          <tbody>
            {joursFeries.map((j) => (
              <tr key={j.id} className="border-t">
                <td className="px-2 py-1.5">{new Date(j.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-2 py-1.5">{j.designation}</td>
                <td className="px-2 py-1.5 text-right">
                  <form action={supprimerJourFerie.bind(null, j.id)}>
                    <button type="submit" className="text-destructive underline">
                      Supprimer
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 rounded-lg border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge}
      </div>
      {children}
    </div>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  return statut === "VALIDE" ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      VALIDÉ
    </span>
  ) : (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      À VALIDER
    </span>
  );
}

function Field({
  label,
  name,
  type = "text",
  step,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}
