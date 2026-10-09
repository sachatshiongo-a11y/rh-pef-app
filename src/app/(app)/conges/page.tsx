import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CalendrierAbsences, type SPCalendrier } from "./calendrier";
import { chargerSignatures, etatSignature } from "@/lib/signature";
import { exigerPageRH } from "@/lib/garde-page";
import { anneeCouranteKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { grouperParMois } from "@/lib/dates-fr";
import { Pagination } from "@/components/pagination";
import { PLAFOND_TOUT, fenetrePage, groupePartiel, lirePagination } from "@/lib/pagination";
import {
  ETATS, JOURS_A_VENIR, PLAFOND_SECTION, SECTIONS, TRI_PAR_MOIS, clauseAVenir, clauseConges, clauseEnCours, clauseSection, etatActif, filtreActif,
  lireFiltresConges, triSection, type CleSection, type LigneConge, type StatutConge,
} from "@/lib/conges-liste";
import type { Prisma } from "@prisma/client";
import { ListeConges, type GroupeMois, type SectionListe } from "./liste-conges";
import { FiltresConges } from "./filtres-conges";
import { NouvelleDemandeConge } from "./nouvelle-demande";

type SP = { statut?: string; type?: string; q?: string; quand?: string; mois?: string; du?: string; au?: string; groupe?: string; vue?: string; erreur?: string; erreurDecision?: string; page?: string; par?: string } & SPCalendrier;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const AVEC_SALARIE = { employee: true, approuvePar: true } satisfies Prisma.LeaveRequestInclude;
type LigneBase = Prisma.LeaveRequestGetPayload<{ include: typeof AVEC_SALARIE }>;

export default async function CongesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageRH();
  const sp = await searchParams;

  // Vue Calendrier (fusion de l'ancien onglet /absences) : même donnée, deux présentations.
  if (sp.vue === "calendrier") return <CalendrierAbsences sp={sp} />;
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const peutApprouver = user.role === "ADMIN";

  // Tout est lu CÔTÉ SERVEUR, filtre compris (clause SQL : il porte sur TOUTES les demandes) ; seuls les
  // « Passés » (et le regroupement par mois) sont lus PAR PAGE (count + skip/take) : plus de plafond silencieux.
  const f = lireFiltresConges(sp);
  const { page, par } = lirePagination(sp);
  const maintenant = new Date();
  const jourJ = jourCivilKinshasa(maintenant); // jour civil de Kinshasa : un congé du 12 au 12 est « en cours » le 12
  const anneeCourante = anneeCouranteKinshasa(maintenant);
  const parMois = f.groupe === "mois";
  const filtre = clauseConges(f, jourJ);
  const hasFiltre = filtreActif(f);

  const sectionsVivantes = SECTIONS.filter((s) => s.cle !== "PASSES");
  const clausePasses = { AND: [filtre, clauseSection("PASSES", jourJ)] };
  const nbListe = await prisma.leaveRequest.count({ where: parMois ? filtre : clausePasses });
  const fen = fenetrePage(nbListe, page, par, PLAFOND_TOUT);

  // Compteurs des pastilles : sur TOUT l'ensemble (pas sur la page). Ceux de l'état ignorent l'état choisi, ceux du type ignorent le type choisi.
  const sansEtat = clauseConges(f, jourJ, "etat");
  const sansType = clauseConges(f, jourJ, "type");
  const [employees, typesConge, feriesRows, parStatut, nEnCours, nAVenir, parType, typesExistants, vivantes, lignesListe] = await Promise.all([
    peutGerer ? prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" }, select: { id: true, nom: true } }) : Promise.resolve([]),
    peutGerer ? prisma.typeConge.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }) : Promise.resolve([]),
    peutGerer ? prisma.jourFerie.findMany({ select: { date: true } }) : Promise.resolve([]),
    prisma.leaveRequest.groupBy({ by: ["statut"], where: sansEtat, _count: { _all: true } }),
    prisma.leaveRequest.count({ where: { AND: [sansEtat, clauseEnCours(jourJ)] } }),
    prisma.leaveRequest.count({ where: { AND: [sansEtat, clauseAVenir(jourJ, JOURS_A_VENIR)] } }),
    prisma.leaveRequest.groupBy({ by: ["type"], where: sansType, _count: { _all: true } }),
    prisma.leaveRequest.groupBy({ by: ["type"] }),
    // Les trois sections « vivantes » : lues en entier (bornées), triées pour l'urgence.
    parMois
      ? Promise.resolve([] as { cle: CleSection; lignes: LigneBase[] }[])
      : Promise.all(sectionsVivantes.map(async (s) => ({
          cle: s.cle,
          lignes: await prisma.leaveRequest.findMany({ where: { AND: [filtre, clauseSection(s.cle, jourJ)] }, include: AVEC_SALARIE, orderBy: triSection(s.cle), take: PLAFOND_SECTION + 1 }),
        }))),
    // La liste PAGINÉE : les « Passés » (regroupement par état) ou toutes les demandes (regroupement par mois).
    prisma.leaveRequest.findMany({
      where: parMois ? filtre : clausePasses,
      include: AVEC_SALARIE,
      orderBy: parMois ? TRI_PAR_MOIS : triSection("PASSES"),
      skip: fen.skip,
      take: fen.take,
    }),
  ]);

  const feries = feriesRows.map((x) => iso(new Date(x.date)));
  const nStatut = (s: StatutConge) => parStatut.find((g) => g.statut === s)?._count._all ?? 0;
  const compteEtat = {
    tous: parStatut.reduce((n, g) => n + g._count._all, 0), // les trois statuts partitionnent l'ensemble
    EN_ATTENTE: nStatut("EN_ATTENTE"), "en-cours": nEnCours, "a-venir": nAVenir, APPROUVE: nStatut("APPROUVE"), REFUSE: nStatut("REFUSE"),
  };
  const etats = ETATS.map((e) => ({ cle: e.cle, n: compteEtat[e.cle] }));
  // Types : ceux qui existent, avec leur compteur dans l'ensemble filtré ; ceux à zéro disparaissent (sauf le type choisi, pour pouvoir le quitter).
  const nbParType = new Map(parType.map((g) => [g.type, g._count._all]));
  const nomsTypes = [...new Set([...typesExistants.map((g) => g.type), ...(f.type ? [f.type] : [])])].sort((a, b) => a.localeCompare(b, "fr"));
  const types = nomsTypes.map((nom) => ({ nom, n: nbParType.get(nom) ?? 0 })).filter((t) => t.n > 0 || t.nom === f.type);

  // Signatures des demandes approuvées affichées : UNE requête, jamais une par ligne.
  const affichees = [...vivantes.flatMap((s) => s.lignes.slice(0, PLAFOND_SECTION)), ...lignesListe];
  const sigConges = await chargerSignatures(prisma, "DEMANDE_CONGE", affichees.filter((d) => d.statut === "APPROUVE").map((d) => d.id));
  const enLigne = (d: LigneBase): LigneConge => ({
    id: d.id,
    employeeId: d.employee.id,
    nom: d.employee.nom,
    photoUrl: d.employee.photoUrl ?? null,
    type: d.type,
    debut: iso(d.dateDebut),
    fin: iso(d.dateFin),
    nbJours: Number(d.nbJours),
    statut: d.statut,
    approuveParNom: d.approuvePar?.nom ?? null,
    motifRefus: d.statut === "REFUSE" ? d.motifRefus : null,
    signature: d.statut === "APPROUVE" ? etatSignature(sigConges.get(d.id)) : null,
  });

  let sections: SectionListe[] = [];
  let groupes: GroupeMois[] = [];
  if (parMois) {
    groupes = grouperParMois(lignesListe.map(enLigne), (l) => l.debut).map((g, i, tous) => ({
      cle: g.cle, titre: g.titre, lignes: g.items, partiel: groupePartiel(i, tous.length, fen),
    }));
  } else {
    sections = [
      ...vivantes.map((s) => ({ cle: s.cle, lignes: s.lignes.slice(0, PLAFOND_SECTION).map(enLigne), total: Math.min(s.lignes.length, PLAFOND_SECTION), tronque: s.lignes.length > PLAFOND_SECTION })),
      { cle: "PASSES" as const, lignes: lignesListe.map(enLigne), total: nbListe, tronque: false },
    ];
  }

  const nbVivantes = sections.filter((s) => s.cle !== "PASSES").reduce((n, s) => n + s.total, 0);
  const rienDuTout = parMois ? nbListe === 0 : nbVivantes === 0 && nbListe === 0;
  // « Passés » s'ouvre d'office quand on a filtré, changé de page ou de taille, ou qu'il n'y a rien d'autre à voir.
  const passesOuvertParDefaut = hasFiltre || page > 1 || !!sp.page || !!sp.par || nbVivantes === 0;

  // Rendus dans l'URL de retour d'une décision en échec : la liste revient filtrée comme avant (page et taille comprises).
  const filtresListe = { statut: sp.statut, type: sp.type, q: sp.q, quand: sp.quand, mois: sp.mois, du: sp.du, au: sp.au, groupe: sp.groupe, page: sp.page, par: sp.par };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold sm:text-2xl">Congés &amp; absences</h1>
          <div className="flex overflow-hidden rounded-md border text-sm">
            <span className="bg-primary px-3 py-1.5 font-medium text-primary-foreground">Liste</span>
            <Link href="/conges?vue=calendrier" className="px-3 py-1.5 hover:bg-accent">Calendrier</Link>
          </div>
        </div>
        {peutGerer && <NouvelleDemandeConge employees={employees} types={typesConge.map((t) => t.nom)} feries={feries} erreur={sp.erreur} />}
      </div>

      <div className="mb-4">
        <FiltresConges params={filtresListe} etats={etats} etatActif={etatActif(f)} types={types} actif={hasFiltre} regroupement={f.groupe} />
      </div>

      {/* Échec d'une décision prise dans la liste : affiché ici, au-dessus de la liste, et non
          dans le panneau « Nouvelle demande » (qui a sa propre erreur, `?erreur=`). */}
      {sp.erreurDecision && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreurDecision}</p>
      )}

      <ListeConges
        regroupement={f.groupe}
        sections={sections}
        groupes={groupes}
        passesOuvertParDefaut={passesOuvertParDefaut}
        anneeCourante={anneeCourante}
        peutGerer={peutGerer}
        peutApprouver={peutApprouver}
        filtresRetour={filtresListe}
        vide={rienDuTout ? `Aucune demande de congé ${hasFiltre ? "pour ce filtre" : "enregistrée"}.` : null}
        pagination={<Pagination className="mt-1" plafondTout={PLAFOND_TOUT} total={nbListe} page={fen.page} par={par} chemin="/conges" params={filtresListe} libelle="demandes" />}
      />
    </div>
  );
}
