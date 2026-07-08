import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd } from "@/lib/stock";
import { validerBonCommande } from "../commandes/actions";

export default async function AValiderPage() {
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";

  const brouillons = await prisma.bonDeCommande.findMany({
    where: { statut: "BROUILLON" },
    orderBy: [{ annee: "desc" }, { sequence: "desc" }],
    include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Demandes à valider</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bons de commande en attente de validation par la Direction. Une fois validés, ils peuvent
          être exportés en PDF et envoyés au fournisseur.
        </p>
      </div>

      {brouillons.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">Aucune demande en attente.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {brouillons.map((bc) => (
            <li key={bc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <Link href={`/stock/commandes/${bc.id}`} className="font-medium text-primary underline">{bc.numero}</Link>
                <span className="text-sm text-muted-foreground"> · {bc.fournisseur?.nom ?? "—"} · {bc._count.lignes} ligne(s) · {usd(bc.totalUSD)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/stock/commandes/${bc.id}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Voir l&apos;aperçu</Link>
                {estDirection ? (
                  <form action={validerBonCommande.bind(null, bc.id)}>
                    <button className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">✓ Valider</button>
                  </form>
                ) : (
                  <span className="text-xs text-amber-700">En attente Direction</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
