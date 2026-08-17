import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import {
  mettreAJourConfig,
  basculerEspaceEmploye,
  basculerSalairesEnNet,
  mettreAJourParametreLegal,
  mettreAJourTrancheIprCDF,
  ajouterJourFerie,
  supprimerJourFerie,
  mettreAJourEntreprise,
  mettreAJourModeleOnboarding,
} from "./actions";
import { UsersAdmin, type UserRow } from "./users-admin";
import { TypesCongesAdmin, type TypeCongeRow } from "./types-conges-admin";
import { ClotureStockSection } from "@/components/stock/cloture-stock-section";
import { entreprise as entrepriseDefaut } from "@/lib/pdf/theme";

export default async function ParametresPage({ searchParams }: { searchParams: Promise<{ erreur?: string; msg?: string }> }) {
  const user = await verifySession();
  const estAdmin = user.role === "ADMIN";
  const sp = await searchParams;

  const [config, exercice, joursFeries, users, typesConges, employesActifs, paramEnt, modeleOnboarding] = await Promise.all([
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
    prisma.paramEntreprise.findUnique({ where: { id: "singleton" } }),
    prisma.modeleTacheOnboarding.findMany({ orderBy: { ordre: "asc" } }),
  ]);
  // Valeur affichée = valeur saisie, sinon valeur par défaut (theme.ts).
  const ent = (k: keyof typeof entrepriseDefaut, saved?: string | null) => (saved ?? "") || (entrepriseDefaut[k] as string) || "";
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
        <h1 className="mb-2 text-xl font-semibold sm:text-2xl">Paramètres</h1>
        <p className="text-sm text-muted-foreground">
          Seul le directeur (compte ADMIN) peut consulter et modifier les paramètres.
        </p>
      </div>
    );
  }

  const nbAValider =
    (exercice?.parametres.filter((p) => p.statutValidation === "A_VALIDER").length ?? 0) +
    (exercice?.tranchesIpr.filter((t) => t.statutValidation === "A_VALIDER").length ?? 0);

  // Flag « salaires en net » : géré par un interrupteur DÉDIÉ (ci-dessous), donc retiré de la liste
  // brute des paramètres légaux pour éviter toute remise à 0 accidentelle par saisie d'un champ.
  const salairesEnNetActif =
    Number(exercice?.parametres.find((p) => p.cle === "salaires_saisis_en_net")?.valeur ?? 0) === 1;
  const parametresLegaux = (exercice?.parametres ?? []).filter((p) => p.cle !== "salaires_saisis_en_net");

  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-xl font-semibold sm:text-2xl">Paramètres</h1>

      {sp.erreur && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{sp.erreur}</div>}
      {sp.msg && <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{sp.msg}</div>}

      <Section title="Identité de l'entreprise & documents">
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
          Ces informations apparaissent sur l&apos;en-tête et le pied de page des documents générés (contrats, fiches de poste, bulletins…).
          Laissez un champ vide pour utiliser la valeur par défaut.
        </p>
        <form action={mettreAJourEntreprise} className="grid gap-3 sm:grid-cols-2">
          {[
            ["nom", "Raison sociale", paramEnt?.nom, "nom"],
            ["enseigne", "Enseigne", paramEnt?.enseigne, "enseigne"],
            ["rccm", "RCCM", paramEnt?.rccm, "rccm"],
            ["idNat", "Id. Nat.", paramEnt?.idNat, "idNat"],
            ["numImpot", "N° Impôt", paramEnt?.numImpot, "numImpot"],
            ["telephone", "Téléphone", paramEnt?.telephone, "telephone"],
            ["email", "E-mail", paramEnt?.email, "email"],
            ["site", "Site web", paramEnt?.site, "site"],
            ["adresse", "Siège social", paramEnt?.adresse, "adresse"],
            ["lieuTravail", "Lieu de travail (restaurant)", paramEnt?.lieuTravail, "lieuTravail"],
            ["pays", "Pays", paramEnt?.pays, "pays"],
            ["compteBancaire", "Compte bancaire", paramEnt?.compteBancaire, "compteEcobank"],
          ].map(([name, label, saved, defKey]) => (
            <label key={name as string} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {label as string}
              <input
                type="text"
                name={name as string}
                defaultValue={ent(defKey as keyof typeof entrepriseDefaut, saved as string | null | undefined)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
              />
            </label>
          ))}
          <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-0.5">Logo (en-tête des documents) — PNG/JPG
                <input type="file" name="logo" accept=".png,.jpg,.jpeg" className="text-sm text-foreground" />
                <span className="text-[11px]">{paramEnt?.logoNom ? `Actuel : ${paramEnt.logoNom}` : "Par défaut : logo Pâtes en Folie"}</span>
              </label>
              <label className="flex flex-col gap-0.5">Signature de la Direction — PNG/JPG
                <input type="file" name="signature" accept=".png,.jpg,.jpeg" className="text-sm text-foreground" />
                <span className="text-[11px]">{paramEnt?.signatureNom ? `Actuelle : ${paramEnt.signatureNom}` : "Par défaut : signature du projet"}</span>
              </label>
            </div>
          </div>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Enregistrer l&apos;identité</button>
          </div>
        </form>
      </Section>

      <Section title="Modèle d'intégration (onboarding)">
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
          Liste des tâches d&apos;intégration (une par ligne) — copiée automatiquement dans la fiche de chaque nouvel employé (onglet Dossier).
        </p>
        <form action={mettreAJourModeleOnboarding} className="space-y-2">
          <textarea
            name="taches"
            rows={8}
            defaultValue={modeleOnboarding.map((m) => m.libelle).join("\n")}
            placeholder={"Signer le contrat de travail\nRemettre le règlement intérieur\n…"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Enregistrer le modèle</button>
        </form>
      </Section>

      <Section title="Utilisateurs & accès">
        <UsersAdmin users={userRows} employes={employesActifs} monId={user.id} />
      </Section>

      <Section title="Types de congés & absences">
        <TypesCongesAdmin types={typeCongeRows} />
      </Section>

      <Section title="Espace salarié (self-service)">
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
          Ouvre un espace personnel aux salariés : ils se connectent avec leur <b>matricule</b> pour
          consulter leur <b>planning publié</b>, leur <b>dossier</b> et leurs <b>documents</b>, et
          déposer leurs <b>demandes de congé</b> (à valider par la Direction). Les comptes se créent
          ensuite sur chaque fiche employé. <b>Désactivé par défaut.</b>
        </p>
        <form action={basculerEspaceEmploye} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="actif" value={config.espaceEmployeActif ? "0" : "1"} />
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${config.espaceEmployeActif ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
            {config.espaceEmployeActif ? "● Activé" : "○ Désactivé"}
          </span>
          {estAdmin && (
            <button type="submit" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              {config.espaceEmployeActif ? "Désactiver l'espace salarié" : "Activer l'espace salarié"}
            </button>
          )}
        </form>
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
          <Field
            label="Jour de paie (1-31)"
            name="jourPaie"
            type="number"
            defaultValue={String(config.jourPaie)}
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

      <Section title="Salaires saisis en net">
        <p className="mb-3 text-xs text-muted-foreground">
          Quand c&apos;est activé, les salaires saisis sur les fiches sont considérés comme des
          montants <b>nets</b> à verser : le moteur reconstitue automatiquement le brut (CNSS + IPR
          à la charge du salarié) pour les bulletins. Les bulletins déjà validés/payés ne changent
          pas ; rouvrez la paie du mois pour recalculer les brouillons. À valider par un comptable.
        </p>
        <form action={basculerSalairesEnNet} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="actif" value={salairesEnNetActif ? "0" : "1"} />
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${salairesEnNetActif ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
            {salairesEnNetActif ? "● Activé (salaires en net)" : "○ Désactivé (salaires en brut)"}
          </span>
          <button type="submit" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
            {salairesEnNetActif ? "Désactiver" : "Activer les salaires en net"}
          </button>
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
          {parametresLegaux.map((p) => (
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

        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[24rem] text-sm">
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
        </div>
      </Section>

      <Section title="Clôture mensuelle du stock">
        {/* Onglet Paramètres UNIQUE (demande user) : la clôture du stock, jadis dans
            /stock/parametres, vit désormais ici ; /stock/parametres redirige vers cette page. */}
        <ClotureStockSection />
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
