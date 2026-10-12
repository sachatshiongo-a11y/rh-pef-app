import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { WHERE_LIGNE_SANS_PRIX, libelleTotalBon } from "@/lib/bon-commande-devise";
import { validerBonCommande } from "../commandes/actions";
import { BoutonApprouver, CLASSES_NEUTRE } from "@/components/action-buttons";
import { apercusDemandes } from "@/lib/validations-stock/apercu";
import { NATURE_LIBELLE } from "@/lib/validations-stock/charge";
import { DemandesAValider } from "./demandes-client";
import { totalAValiderStock } from "@/lib/a-valider-compteur";
import type { CurrentUser } from "@/lib/auth";
import type { BlocAValider } from "@/components/espaces-a-valider";
import type { RubriqueAValider } from "@/components/rubriques-a-valider";
import { DernieresDecisions } from "@/components/dernieres-decisions";

const quand = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Kinshasa" }) : "—");

/**
 * LES RUBRIQUES STOCK de la page « À valider » unique : bons de commande en brouillon, puis les demandes que la
 * Direction doit trancher (paiements de factures, réconciliations, modifications d'articles). Un compte qui n'est
 * pas la Direction y voit SES demandes (en attente, et les dernières décisions). Chargées et composées comme avant :
 * mêmes actions (`validerBonCommande`, `validerDemandes`…), mêmes droits. Appelée seulement pour un compte de l'espace
 * Stock (`espacesAValider`).
 */
export async function chargerRubriquesStock(user: CurrentUser): Promise<BlocAValider> {
  const estDirection = user.role === "ADMIN";
  const miennes = estDirection ? {} : { auteurId: user.id };

  const [brouillons, enAttente, decidees] = await Promise.all([
    prisma.bonDeCommande.findMany({
      where: { statut: "BROUILLON" },
      orderBy: [{ annee: "desc" }, { sequence: "desc" }],
      include: { fournisseur: { select: { id: true, nom: true } }, _count: { select: { lignes: true } }, lignes: { where: WHERE_LIGNE_SANS_PRIX, select: { id: true } } },
    }),
    apercusDemandes({ statut: "EN_ATTENTE", ...miennes }, { detail: true }),
    apercusDemandes({ statut: { not: "EN_ATTENTE" }, ...miennes }, { take: 15 }),
  ]);

  // Le MÊME total que la pastille du menu (`lib/a-valider-compteur.ts`).
  const total = totalAValiderStock({ bonsEnBrouillon: brouillons.length, demandes: enAttente.length });
  const rubriques: RubriqueAValider[] = [
    {
      id: "bons-de-commande", titre: "Bons de commande", nombre: brouillons.length,
      contenu: (
        <ul className="divide-y rounded-lg border">
          {brouillons.map((bc) => (
            <li key={bc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <Link href={`/stock/commandes/${bc.id}`} className="font-medium text-primary underline">{bc.numero}</Link>
                <span className="text-sm text-muted-foreground"> · {bc.fournisseur ? <Link href={`/stock/fournisseurs/${bc.fournisseur.id}`} className="text-primary hover:underline">{bc.fournisseur.nom}</Link> : "—"} · {bc._count.lignes} ligne(s) · {libelleTotalBon(bc, bc.lignes.length, bc._count.lignes)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/stock/commandes/${bc.id}`} className={CLASSES_NEUTRE}>Voir l&apos;aperçu</Link>
                {estDirection ? (
                  <form action={validerBonCommande.bind(null, bc.id)}>
                    <BoutonApprouver type="submit" />
                  </form>
                ) : (
                  <span className="text-xs text-amber-700">En attente Direction</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "demandes", titre: estDirection ? "Paiements, réconciliations et articles" : "Mes demandes", nombre: enAttente.length,
      contenu: <DemandesAValider demandes={enAttente} estDirection={estDirection} />,
    },
  ];

  const apres = (
    <DernieresDecisions
      titre={estDirection ? "Dernières décisions — Stock" : "Mes dernières demandes traitées — Stock"}
      decisions={decidees.map((d) => ({
        id: d.id,
        resume: d.resume,
        detail: `${NATURE_LIBELLE[d.nature]} · demandé par ${d.auteurNom} le ${quand(d.creeLe)}${d.decideLe ? ` · ${d.statut === "ANNULEE" ? "retirée" : `décidée par ${d.decideurNom ?? "—"}`} le ${quand(d.decideLe)}` : ""}`,
        statut: d.statut,
        motifRefus: d.motifRefus,
      }))}
    />
  );
  return { rubriques, total, apres };
}
