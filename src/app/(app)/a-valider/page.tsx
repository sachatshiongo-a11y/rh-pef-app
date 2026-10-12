import Link from "next/link";
import { tauxDeLigne } from "@/lib/paie-taux";
import { prisma } from "@/lib/prisma";
import { separerHorsCalcul } from "@/lib/paie-hors-calcul";
import { CongesInbox, type CongeRow } from "./conges-inbox";
import { BulletinsInbox, type BulletinRow } from "./bulletins-inbox";
import { libellePeriode } from "@/lib/changement-mois";
import { jetonLigne } from "@/lib/paie-jeton";
import { AcomptesInbox, type AcompteRow } from "./acomptes-inbox";
import { AttestationsInbox, type AttestationRow } from "./attestations-inbox";
import { FichesInbox, type FicheRow } from "./fiches-inbox";
import { lireChangements, ligneChangement } from "@/lib/fiche-sensible";
import { lignesCreation } from "@/lib/creation-fiche-donnees";
import { nomsAnciennesFiches } from "@/lib/creation-fiche";
import { LIBELLE_TYPE_ATTESTATION } from "@/lib/attestations-donnees";
import { jourKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { ShiftsInbox } from "./shifts-inbox";
import { salaireNetUSD } from "@/lib/paie-net";
import { lireAvertissements } from "@/lib/paie-avertissements";
import { rafraichirPaieAffichee } from "@/lib/paie-refresh";
import { exigerPageRH } from "@/lib/garde-page";
import { totalAValiderRH } from "@/lib/a-valider-compteur";
import { RubriquesAValider, type RubriqueAValider } from "@/components/rubriques-a-valider";
import { DernieresDecisions } from "@/components/dernieres-decisions";
import { AussiEnAttente } from "@/components/aussi-en-attente";
import { chargerAttenteDirection } from "@/lib/a-valider-chargeurs";
import { chargerMesDemandesFicheTraitees } from "@/lib/mes-demandes-fiche";

/**
 * Les rubriques d'un rôle qui n'est pas la Direction : SES demandes de fiche (le badge du menu compte
 * les mêmes) et, pour le Responsable RH, les bulletins validés qu'il paie. Le reste de la file —
 * congés, acomptes, attestations, shifts, bulletins à valider — est celle des salariés et de la
 * Direction (V1, annexe D : jamais les demandes des autres).
 */
const RUBRIQUES_DU_PERSONNEL = new Set(["modifications-fiches", "bulletins-a-payer"]);

function joursAvant(date: Date): number {
  // Échéances stockées à minuit UTC (jour civil) : l'écart se mesure au jour civil de Kinshasa.
  return Math.round((new Date(date).getTime() - jourCivilKinshasa(new Date()).getTime()) / 86_400_000);
}
function echeanceInfo(date: Date): { texte: string; classe: string } {
  const j = joursAvant(date);
  if (j < 0) return { texte: `en retard (${-j} j)`, classe: "text-red-600 font-medium" };
  if (j === 0) return { texte: "aujourd'hui", classe: "text-red-600 font-medium" };
  if (j <= 3) return { texte: `dans ${j} j`, classe: "text-amber-600 font-medium" };
  return { texte: `dans ${j} j`, classe: "text-muted-foreground" };
}
function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export default async function AValiderPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await exigerPageRH();
  // Refus renvoyé par une approbation (planning verrouillé par une paie validée ou payée).
  const { erreur } = await searchParams;
  const peutValider = user.role === "ADMIN";
  const estDirection = peutValider;
  // Chaque requête de la file des autres n'est lancée que pour la Direction ; un autre rôle ne lit que ses demandes.
  const pourDirection = <T,>(requete: () => Promise<T[]>): Promise<T[]> => (estDirection ? requete() : Promise.resolve([]));
  // La RH paie les bulletins que la Direction a validés (2026-10-01) ; elle voit ceux qui attendent
  // la Direction, sans bouton.
  const peutPayer = user.role === "ADMIN" || user.role === "MANAGER";
  const siPeutPayer = <T,>(requete: () => Promise<T[]>): Promise<T[]> => (peutPayer ? requete() : Promise.resolve([]));
  const peutPlanning = user.role === "ADMIN" || user.role === "MANAGER"; // qui peut acter un changement de shift

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  // Comme /paie, et par la MÊME fonction : les lignes non figées du mois sont recalculées avant
  // d'être listées. Sinon « À valider » montrait des montants d'un /paie ouvert il y a longtemps, que
  // la validation refusait ensuite (6 lignes sur 24, mesuré le 2026-09-24).
  if (config && estDirection) await rafraichirPaieAffichee(config.moisCourant, config.anneeCourante);
  const filtreRun = config
    ? { payrollRun: { mois: config.moisCourant, annee: config.anneeCourante } }
    : {};

  const miennes = estDirection ? {} : { auteurId: user.id };
  const [conges, prepare, valide, acomptes, changements, echanges, attestations, modifsFiche, creationsFiche] = await Promise.all([
    pourDirection(() => prisma.leaveRequest.findMany({
      where: { statut: "EN_ATTENTE" },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { dateDebut: "asc" },
    })),
    pourDirection(() => prisma.payrollLine.findMany({
      where: { statutPaiement: "PAS_VALIDE", ...filtreRun },
      include: { employee: { select: { id: true, nom: true, matricule: true, photoUrl: true } }, payrollRun: { select: { tauxChangeUtilise: true } } },
      orderBy: { employee: { nom: "asc" } },
    })),
    // À PAYER : tous les bulletins validés, QUEL QUE SOIT LEUR MOIS. La clôture fait passer l'espace RH
    // au mois suivant (2026-10-08) : les bulletins de septembre validés mais pas encore payés restent
    // dus et se paient d'ici (une ligne validée compte toujours, paie-hors-calcul.ts). Plus anciens d'abord.
    // Bulletins validés à payer : la Direction et le Responsable RH (qui les paie), pas la consultation.
    siPeutPayer(() => prisma.payrollLine.findMany({
      where: { statutPaiement: "VALIDE" },
      include: { employee: { select: { id: true, nom: true, matricule: true, photoUrl: true } }, payrollRun: { select: { tauxChangeUtilise: true, mois: true, annee: true } } },
      orderBy: [{ payrollRun: { annee: "asc" } }, { payrollRun: { mois: "asc" } }, { employee: { nom: "asc" } }],
    })),
    pourDirection(() => prisma.acompteSalaire.findMany({
      where: { statut: "EN_ATTENTE" },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { dateDemande: "asc" },
    })),
    // Demandes de changement de shift en attente (avec noms de shifts).
    pourDirection(() => prisma.demandeChangementShift.findMany({
      where: { statut: "EN_ATTENTE" },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { date: "asc" },
    })),
    // Échanges de créneau en attente (avec noms des deux salariés).
    pourDirection(() => prisma.echangeCreneau.findMany({
      where: { statut: "EN_ATTENTE" },
      include: { demandeur: { select: { nom: true, photoUrl: true } }, collegue: { select: { nom: true } } },
      orderBy: { createdAt: "desc" },
    })),
    pourDirection(() => prisma.attestation.findMany({
      where: { statut: "DEMANDEE" },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { demandeLe: "asc" },
    })),
    // Modifications de champs sensibles d'une fiche (salaire, contrat, versement…) saisies par la RH.
    // Un autre rôle que la Direction ne lit que les SIENNES.
    prisma.demandeModifFiche.findMany({
      where: { statut: "EN_ATTENTE", ...miennes },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // Créations de fiches saisies par la RH : rien n'existe encore dans les employés.
    prisma.demandeCreationFiche.findMany({ where: { statut: "EN_ATTENTE", ...miennes }, orderBy: { createdAt: "asc" } }),
  ]);
  const anciennes = await nomsAnciennesFiches(creationsFiche.map((d) => d.donnees));
  const creationRows: FicheRow[] = creationsFiche.map((d) => {
    const ancienneId = (d.donnees as { ancienneFicheId?: string | null }).ancienneFicheId ?? null;
    return {
      id: d.id, employeeId: null, creation: true, reembauche: Boolean(ancienneId), nom: d.nom, photoUrl: null,
      lignes: lignesCreation(d.donnees, ancienneId ? anciennes.get(ancienneId) : null),
      auteurNom: d.auteurNom, demandeLe: jourKinshasa(d.createdAt), motif: null,
    };
  });
  const ficheRows: FicheRow[] = [...creationRows, ...modifsFiche.map((d) => {
    let lignes: string[];
    try { lignes = lireChangements(d.changements).map(ligneChangement); } catch { lignes = ["Demande illisible : refusez-la."]; }
    return {
      id: d.id, employeeId: d.employee.id, nom: d.employee.nom, photoUrl: d.employee.photoUrl, lignes,
      auteurNom: d.auteurNom, demandeLe: jourKinshasa(d.createdAt), motif: d.motif,
    } as FicheRow;
  })];
  const attestationRows: AttestationRow[] = attestations.map((a) => ({
    id: a.id,
    employeeId: a.employee.id,
    nom: a.employee.nom,
    photoUrl: a.employee.photoUrl,
    typeLibelle: LIBELLE_TYPE_ATTESTATION[a.type],
    motif: a.motif,
    demandeLe: jourKinshasa(a.demandeLe),
  }));
  const shiftsMap = new Map(
    changements.length > 0 || echanges.length > 0
      ? (await prisma.shift.findMany({ select: { id: true, nom: true } })).map((sh) => [sh.id, sh.nom])
      : [],
  );
  const frDate = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

  const congeRows: CongeRow[] = conges.map((d) => {
    const ech = echeanceInfo(d.dateDebut);
    return {
      id: d.id,
      employeeId: d.employee.id,
      nom: d.employee.nom,
      photoUrl: d.employee.photoUrl,
      type: d.type,
      du: new Date(d.dateDebut).toLocaleDateString("fr-FR"),
      au: new Date(d.dateFin).toLocaleDateString("fr-FR"),
      jours: Number(d.nbJours),
      echeanceTexte: ech.texte,
      echeanceClasse: ech.classe,
    };
  });

  const toRow = (l: (typeof prepare)[number]): BulletinRow => ({
    id: l.id,
    employeeId: l.employee.id,
    matricule: l.employee.matricule,
    nom: l.employee.nom,
    photoUrl: l.employee.photoUrl,
    montant: money(salaireNetUSD(l)),
    statutPaiement: l.statutPaiement,
    avertissements: lireAvertissements(l.avertissementsPaie),
    jeton: jetonLigne(l, tauxDeLigne(l, l.payrollRun)), // taux du bulletin compris (figé si validé)
  });
  // Une ligne HORS CALCUL (ligne rouverte d'un salarié sorti du calcul) ne se valide pas : elle est
  // montrée à part sur l'écran Paie, pas ici (paie-hors-calcul.ts).
  const { comptees: prepareComptees, horsCalcul: prepareHorsCalcul } = await separerHorsCalcul(prisma, prepare);
  const prepareRows = prepareComptees.map(toRow);
  const valideRows = valide.map((l): BulletinRow => ({
    ...toRow(l),
    periode: config && (l.payrollRun.mois !== config.moisCourant || l.payrollRun.annee !== config.anneeCourante) ? libellePeriode(l.payrollRun) : null,
  }));
  const acompteRows: AcompteRow[] = acomptes.map((a) => ({
    id: a.id,
    employeeId: a.employee.id,
    nom: a.employee.nom,
    photoUrl: a.employee.photoUrl,
    montant: money(Number(a.montantUSD)),
    periode: `${String(a.mois).padStart(2, "0")}/${a.annee}`,
    motif: a.motif ?? null,
    demandeLe: new Date(a.dateDemande).toLocaleDateString("fr-FR"),
  }));
  // Le MÊME total que le badge du menu (`lib/a-valider-compteur.ts`), bulletins du mois à valider compris.
  const total = totalAValiderRH({
    conges: congeRows.length, fiches: ficheRows.length, acomptes: acompteRows.length, attestations: attestationRows.length,
    echanges: echanges.length, changements: changements.length, bulletinsAValider: prepareRows.length, bulletinsAPayer: valideRows.length,
  });
  const toutesLesRubriques: RubriqueAValider[] = [
    { id: "conges", titre: "Demandes de congé", nombre: congeRows.length, contenu: <CongesInbox rows={congeRows} peutValider={peutValider} /> },
    { id: "modifications-fiches", titre: estDirection ? "Modifications de fiches" : "Mes demandes de fiche", nombre: ficheRows.length, contenu: <FichesInbox rows={ficheRows} peutValider={peutValider} /> },
    { id: "acomptes", titre: "Demandes d'acompte sur salaire", nombre: acompteRows.length, contenu: <AcomptesInbox rows={acompteRows} peutValider={peutValider} /> },
    { id: "attestations", titre: "Demandes d'attestation", nombre: attestationRows.length, contenu: <AttestationsInbox rows={attestationRows} peutValider={peutValider} /> },
    {
      id: "echanges", titre: "Échanges de shift entre salariés", nombre: echanges.length,
      contenu: (
        <ShiftsInbox
          type="echange"
          peutPlanning={peutPlanning}
          rows={echanges.map((e) => ({
            id: e.id,
            salaries: [{ id: e.demandeurId, nom: e.demandeur.nom }, { id: e.collegueId, nom: e.collegue.nom }],
            photoUrl: e.demandeur.photoUrl,
            detail: `${e.demandeur.nom} cède ${frDate(e.demandeurDate)} (${shiftsMap.get(e.demandeurShiftId) ?? "—"}) · prend ${frDate(e.collegueDate)} (${shiftsMap.get(e.collegueShiftId) ?? "—"})${e.motif ? ` · ${e.motif}` : ""}`,
            accordCollegue: e.reponseCollegue === "ACCEPTE",
          }))}
        />
      ),
    },
    {
      id: "changements", titre: "Changements de shift", nombre: changements.length,
      contenu: (
        <ShiftsInbox
          type="changement"
          peutPlanning={peutPlanning}
          rows={changements.map((dem) => ({
            id: dem.id,
            salaries: [{ id: dem.employeeId, nom: dem.employee.nom }],
            photoUrl: dem.employee.photoUrl,
            detail: `${new Date(dem.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · ${dem.shiftActuelId ? `${shiftsMap.get(dem.shiftActuelId) ?? "—"} → ` : "→ "}${shiftsMap.get(dem.shiftDemandeId) ?? "—"}${dem.motif ? ` · ${dem.motif}` : ""}`,
          }))}
        />
      ),
    },
    ...(peutPayer ? [
      {
        id: "bulletins-a-valider", titre: "Bulletins à valider", nombre: prepareRows.length,
        contenu: peutValider
          ? <BulletinsInbox rows={prepareRows} cible="VALIDE" actionLabel="Valider" />
          : <BulletinsInbox rows={prepareRows} cible="VALIDE" actionLabel="Valider" lectureSeule="En attente de validation par la Direction" />,
      },
      { id: "bulletins-a-payer", titre: "Bulletins à payer", nombre: valideRows.length, contenu: <BulletinsInbox rows={valideRows} cible="PAYE" actionLabel="Marquer payé" /> },
    ] : []),
  ];
  // La Direction voit toute la file ; un autre rôle, ses demandes (et les bulletins qu'il paie) — pas celles des autres.
  const rubriques = estDirection ? toutesLesRubriques : toutesLesRubriques.filter((r) => RUBRIQUES_DU_PERSONNEL.has(r.id));
  // Les autres boîtes de la Direction (Stock, Exploitation) : la ligne « Aussi en attente » (V11).
  const [ailleurs, mesDecisions] = await Promise.all([
    estDirection ? chargerAttenteDirection({ id: user.id, role: user.role }, "rh") : Promise.resolve(null),
    estDirection ? Promise.resolve([]) : chargerMesDemandesFicheTraitees(user.id),
  ]);

  return (
    <div className="max-w-5xl">
      {erreur && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>
      )}
      {/* En-tête : titre à gauche, compteur à droite (le même chiffre que le badge du menu) */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">À valider</h1>
          <p className="text-sm text-muted-foreground">{estDirection ? "Demandes et bulletins en attente d'action" : "Vos demandes en attente de la Direction"}</p>
        </div>
        <div className="rounded-xl border bg-card px-6 py-4 shadow-sm" title={estDirection ? "Même chiffre que la pastille du menu : demandes en attente, bulletins du mois à valider et bulletins validés à payer." : undefined}>
          <p className="text-xs text-muted-foreground">En attente</p>
          <p className="mt-1 text-3xl font-bold">{total}</p>
        </div>
      </div>

      {ailleurs && <div className="mb-4"><AussiEnAttente courant="rh" attente={ailleurs} /></div>}

      {!peutValider && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {peutPayer
            ? "Rien n'est modifié tant que la Direction n'a pas validé vos demandes. Vous marquez payés les bulletins qu'elle a validés."
            : "Rien n'est modifié tant que la Direction n'a pas validé vos demandes."}
        </p>
      )}

      <RubriquesAValider rubriques={rubriques} />

      {mesDecisions.length > 0 && <div className="mt-8"><DernieresDecisions titre="Mes dernières demandes traitées" decisions={mesDecisions} /></div>}

      {peutPayer && prepareHorsCalcul.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {prepareHorsCalcul.length} ligne(s) hors calcul (salarié sorti du calcul après réouverture) : voir l&apos;écran <Link href="/paie" className="text-primary underline">Paie</Link>.
        </p>
      )}
    </div>
  );
}
