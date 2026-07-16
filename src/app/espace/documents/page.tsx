import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { TelechargerLien } from "@/components/telecharger-lien";

const fr = (x: Date | null | undefined) => (x ? new Date(x).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");
const moisAnnee = (m: number, a: number) => new Date(a, m - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

export default async function EspaceDocuments() {
  const s = await chargerSalarie();
  const [bulletins, contrats, documents] = await Promise.all([
    // Seuls les bulletins VALIDÉS ou PAYÉS sont montrés au salarié (pas les brouillons en préparation).
    prisma.payrollLine.findMany({
      where: { employeeId: s.employeeId, statutPaiement: { in: ["VALIDE", "PAYE"] } },
      include: { payrollRun: { select: { mois: true, annee: true } } },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
      take: 60,
    }),
    prisma.contrat.findMany({ where: { employeeId: s.employeeId }, orderBy: { dateDebut: "desc" } }),
    prisma.documentEmploye.findMany({ where: { employeeId: s.employeeId }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mes documents</h1>
        <p className="text-sm text-muted-foreground">Vos bulletins de paie, contrats et documents personnels.</p>
      </div>

      <Section titre="Bulletins de paie">
        {bulletins.length === 0 ? (
          <Vide>Aucun bulletin disponible pour le moment.</Vide>
        ) : (
          <ul className="divide-y">
            {bulletins.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium capitalize">{moisAnnee(b.payrollRun.mois, b.payrollRun.annee)}</p>
                  <p className="text-xs text-muted-foreground">Net : {Number(b.salNetUSD).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $</p>
                </div>
                <div className="flex gap-3 text-sm">
                  <TelechargerLien href={`/espace/bulletin/${b.id}?devise=USD`} className="text-primary underline">Bulletin $</TelechargerLien>
                  <TelechargerLien href={`/espace/bulletin/${b.id}?devise=CDF`} className="text-primary underline">Bulletin CDF</TelechargerLien>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section titre="Contrats">
        {contrats.length === 0 ? (
          <Vide>Aucun contrat enregistré.</Vide>
        ) : (
          <ul className="divide-y">
            {contrats.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium">{c.type} · {c.poste}</p>
                  <p className="text-xs text-muted-foreground">{fr(c.dateDebut)} → {c.dateFin ? fr(c.dateFin) : "indéterminé"}</p>
                </div>
                {c.documentUrl ? (
                  <a href={c.documentUrl} target="_blank" className="text-sm text-primary underline">Ouvrir</a>
                ) : (
                  <span className="text-xs text-muted-foreground">Pas de fichier joint</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section titre="Autres documents">
        {documents.length === 0 ? (
          <Vide>Aucun document.</Vide>
        ) : (
          <ul className="divide-y">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium">{d.nom}</p>
                  <p className="text-xs text-muted-foreground">{d.type}{d.dateExpiration ? ` · expire le ${fr(d.dateExpiration)}` : ""}</p>
                </div>
                {d.fichierUrl && <a href={d.fichierUrl} target="_blank" className="text-sm text-primary underline">Ouvrir</a>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="mb-2 text-base font-semibold">{titre}</h2>
      {children}
    </div>
  );
}
function Vide({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
