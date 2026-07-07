import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { calculerPaieDuMois, reinitialiserPaieDuMois, cloturerPaie } from "./actions";
import { tachesBloquantesCloture } from "@/lib/cloture-paie";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { TelechargerLien } from "@/components/telecharger-lien";
import { PaieBulk, type PaieRow } from "./paie-bulk";
import { BulletinsValidation } from "./bulletins-validation";
import { RemunerationElements, type LigneRemu } from "./remuneration-elements";
import { SuiviContrats, type ContratRow } from "./suivi-contrats";
import { FrisePaie, calculerEtapePaie } from "@/components/frise-paie";

export default async function PaiePage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; erreur?: string; msg?: string }>;
}) {
  const user = await verifySession();
  const sp = await searchParams;
  const vue = sp.vue ?? "bulletins";
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const estAdmin = user.role === "ADMIN";

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const annee = config?.anneeCourante ?? new Date().getFullYear();

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true }, orderBy: { employee: { nom: "asc" } } } },
  });

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const rows: PaieRow[] = (run?.lignes ?? []).map((l) => ({
    id: l.id,
    employeeId: l.employee.id,
    matricule: l.employee.matricule,
    nom: l.employee.nom,
    photoUrl: l.employee.photoUrl,
    categorie: l.employee.categorie,
    salBrutUSD: Number(l.salBrutUSD),
    salNetUSD: Number(l.salNetUSD),
    salNetCDF: Number(l.salNetCDF),
    statutPaiement: l.statutPaiement,
    // Moyen de paiement pré-rempli : virement si banque renseignée, sinon mobile money, sinon espèces.
    modePaiementDefaut: l.employee.banque
      ? "VIREMENT"
      : l.employee.mobileMoney
        ? "MOBILE_MONEY"
        : "ESPECES",
    baseUSD: Number(l.remuneration100) + Number(l.remuneration2_3),
    hsUSD: Number(l.hsValorisee),
    transportUSD: Number(l.transportUSD),
    primesUSD: Number(l.primesUSD),
    allocUSD: Number(l.allocFamilialeUSD),
    fraisMedUSD: Number(l.fraisMedicauxUSD),
    cnssUSD: Number(l.cnssSalarieUSD),
    iprUSD: Number(l.iprCalculeUSD),
    acompteUSD: Number(l.acompteUSD),
  }));
  const brigade = rows.filter((r) => r.categorie === "BRIGADE");
  const backoffice = rows.filter((r) => r.categorie === "BACKOFFICE");

  const taches = run ? await tachesBloquantesCloture(mois, annee) : [];
  const nbPasValide = rows.filter((r) => r.statutPaiement === "PAS_VALIDE").length;

  // Éléments de rémunération (détail par salarié), par type.
  const remuLignes: LigneRemu[] = (run?.lignes ?? []).map((l) => ({
    employeeId: l.employeeId,
    nom: l.employee.nom,
    photoUrl: l.employee.photoUrl,
    base: Number(l.remuneration100) + Number(l.remuneration2_3),
    hs: Number(l.hsValorisee),
    transport: Number(l.transportUSD),
    primes: Number(l.primesUSD),
    fraisMedicaux: Number(l.fraisMedicauxUSD),
    alloc: Number(l.allocFamilialeUSD),
    acompte: Number(l.acompteUSD),
    net: Number(l.salNetUSD),
  }));

  // Suivi des contrats du mois (entrées/sorties, échéances, périodes d'essai).
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const contratsDuMois = await prisma.contrat.findMany({
    where: {
      statut: "ACTIF",
      OR: [
        { dateDebut: { gte: debutMois, lte: finMois } },
        { dateFin: { gte: debutMois, lte: finMois } },
        { finPeriodeEssai: { gte: debutMois, lte: finMois } },
      ],
    },
    include: { employee: { select: { id: true, nom: true } } },
    orderBy: { dateFin: "asc" },
  });
  const contratRows: ContratRow[] = contratsDuMois.map((c) => ({
    id: c.id,
    employeeId: c.employee.id,
    nom: c.employee.nom,
    type: c.type,
    dateDebut: new Date(c.dateDebut).toLocaleDateString("fr-FR"),
    dateFin: c.dateFin ? new Date(c.dateFin).toLocaleDateString("fr-FR") : null,
    finPeriodeEssai: c.finPeriodeEssai ? new Date(c.finPeriodeEssai).toLocaleDateString("fr-FR") : null,
  }));

  const sousOnglets = [
    { cle: "bulletins", label: "Valider les bulletins" },
    { cle: "remuneration", label: "Éléments de la paie" },
    { cle: "contrats", label: `Suivi des contrats (${contratRows.length})` },
  ];

  // Frise chronologique jusqu'au jour de paie (le 30), couleur selon la proximité.
  const totalLignes = rows.length;
  const nbPaye = rows.filter((r) => r.statutPaiement === "PAYE").length;
  const nbValide = rows.filter((r) => r.statutPaiement === "VALIDE").length;
  const etapePaie = calculerEtapePaie({
    hasRun: !!run,
    total: totalLignes,
    nbPaye,
    nbValide,
    nbPasValide,
  });

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Paie</h1>
          <p className="text-sm capitalize text-muted-foreground">{periode}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run && (
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent sm:px-4 sm:py-2 [&::-webkit-details-marker]:hidden">
                Exporter
                <span aria-hidden className="text-xs transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-64 max-w-[calc(100vw_-_1.5rem)] overflow-y-auto rounded-lg border bg-background p-1 shadow-lg">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Livre de paie</p>
                <TelechargerLien href="/paie/export" className="block rounded px-3 py-2 text-sm hover:bg-accent">Livre de paie (Excel)</TelechargerLien>
                <TelechargerLien href="/paie/export-pdf" className="block rounded px-3 py-2 text-sm hover:bg-accent">Livre de paie (PDF)</TelechargerLien>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bulletins (un seul PDF)</p>
                <TelechargerLien href="/paie/bulletins-pdf?devise=USD" className="block rounded px-3 py-2 text-sm hover:bg-accent">Bulletins PDF ($)</TelechargerLien>
                <TelechargerLien href="/paie/bulletins-pdf?devise=CDF" className="block rounded px-3 py-2 text-sm hover:bg-accent">Bulletins PDF (CDF)</TelechargerLien>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bulletins séparés (ZIP)</p>
                <TelechargerLien href="/paie/bulletins-zip?devise=USD" className="block rounded px-3 py-2 text-sm hover:bg-accent">Bulletins séparés ZIP ($)</TelechargerLien>
                <TelechargerLien href="/paie/bulletins-zip?devise=CDF" className="block rounded px-3 py-2 text-sm hover:bg-accent">Bulletins séparés ZIP (CDF)</TelechargerLien>
              </div>
            </details>
          )}
          {peutGerer && (
            <form action={calculerPaieDuMois}>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Calculer la paie du mois
              </button>
            </form>
          )}
          {estAdmin && run && nbPasValide > 0 && taches.length === 0 && (
            <form action={cloturerPaie}>
              <ConfirmSubmitButton
                message={`Clôturer la paie de ${periode} ? Cela valide d'un coup les ${nbPasValide} bulletin(s) « pas validé ».`}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Clôturer la paie ({nbPasValide})
              </ConfirmSubmitButton>
            </form>
          )}
          {estAdmin && run && nbPasValide > 0 && taches.length > 0 && (
            <span
              title="Traitez d'abord les tâches en attente (voir la bannière)"
              className="cursor-not-allowed rounded-md border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 opacity-70"
            >
              Clôture bloquée ⚠
            </span>
          )}
          {estAdmin && run && (
            <form action={reinitialiserPaieDuMois}>
              <ConfirmSubmitButton
                message={`Supprimer la paie calculée pour ${periode} ? Cette action est irréversible (n'affecte pas les mois passés).`}
                className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive"
              >
                Réinitialiser
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>

      {/* Sous-onglets — COLLANTS (restent visibles au défilement) et COULISSANTS horizontalement
          sur mobile. Sur mobile ils se calent juste sous l'en-tête de l'app ; sur ordinateur en
          haut de la zone de contenu. */}
      <div className="sticky top-[calc(env(safe-area-inset-top)_+_52px)] z-10 -mx-4 mb-5 flex gap-2 overflow-x-auto border-b bg-background px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:top-0 lg:mx-0 lg:px-0">
        {sousOnglets.map((o) => (
          <Link
            key={o.cle}
            href={`/paie?vue=${o.cle}`}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${
              vue === o.cle ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </div>

      {vue === "bulletins" && (
      <>
      {run && (
        <div className="mb-5">
          <FrisePaie mois={mois} annee={annee} etape={etapePaie} compact />
        </div>
      )}

      {taches.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-800">
            Clôture de la paie bloquée — {taches.length} tâche(s) à traiter d&apos;abord :
          </p>
          <ul className="space-y-1 text-sm text-amber-800">
            {taches.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span aria-hidden>•</span>
                <Link href={`/employes/${t.employeeId}`} className="font-medium underline">
                  {t.nom}
                </Link>
                <span>— {t.detail}</span>
                {t.type === "ACOMPTE" && (
                  <Link href="/a-valider" className="text-xs underline">
                    (traiter)
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Vérifier les bulletins
          </h2>
          <BulletinsValidation rows={rows} peutValider={estAdmin} />
          <h2 className="mb-2 hidden text-sm font-semibold uppercase tracking-wide text-muted-foreground lg:block">
            Tableau détaillé &amp; actions groupées
          </h2>
        </>
      )}

      {/* Tableau détaillé large : ordinateur uniquement (dense, défilement horizontal). Sur mobile,
          la validation se fait via les cartes ci-dessus. */}
      <div className="hidden lg:block">
        <PaieBulk brigade={brigade} backoffice={backoffice} peutGerer={peutGerer} estAdmin={estAdmin} />
      </div>
      </>
      )}

      {vue === "remuneration" && <RemunerationElements lignes={remuLignes} />}

      {vue === "contrats" && (
        <SuiviContrats contrats={contratRows} peutGerer={peutGerer} estAdmin={estAdmin} />
      )}
    </div>
  );
}
