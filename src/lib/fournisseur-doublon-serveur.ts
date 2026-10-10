import "server-only";
import type { Prisma } from "@prisma/client";
import { cleAlnum } from "@/lib/texte";
import { decisionFournisseur, doublonFournisseur, type DoublonFournisseur } from "@/lib/fournisseur-doublon";

type Db = Pick<Prisma.TransactionClient, "fournisseur" | "$queryRaw">;

/**
 * Verrou transactionnel sur la CLÉ du nom (le même que la Liste d'achat) : deux créations simultanées du même
 * nouveau nom se rangent l'une derrière l'autre, la seconde retrouve le fournisseur créé par la première.
 * `nom` n'est pas unique en base : ni upsert ni P2002 possibles.
 */
export async function verrouillerNomFournisseur(db: Db, nom: string): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fournisseur:${cleAlnum(nom)}`}))::text AS verrou`;
}

/**
 * Peut-on CRÉER un fournisseur de ce nom ? `null` = oui. Sinon la réponse de refus (rien n'est créé) :
 * nom identique à un fournisseur existant (refus sec), ou nom PROCHE (refus tant que `creerQuandMeme` n'est pas
 * donné). À appeler sous `verrouillerNomFournisseur`, dans la transaction qui crée.
 */
export async function refusCreationFournisseur(db: Db, nom: string, { creerQuandMeme = false }: { creerQuandMeme?: boolean } = {}): Promise<DoublonFournisseur | null> {
  const d = decisionFournisseur(nom, await db.fournisseur.findMany({ select: { id: true, nom: true }, orderBy: { nom: "asc" } }));
  if (d.type === "nouveau") return null;
  if (d.type === "choix" && d.creationPossible && creerQuandMeme) return null;
  return doublonFournisseur(nom, d);
}
