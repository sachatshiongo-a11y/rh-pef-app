import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { TelechargerLien } from "@/components/telecharger-lien";
import { envoyerMonCertificat } from "../actions";
import { Icone } from "@/components/icones";
import { BulletinViewerButton } from "@/app/(app)/employes/[id]/bulletin-viewer";
import { AccepterContrat } from "./accepter-contrat";

const fr = (x: Date | null | undefined) => (x ? new Date(x).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");
const moisAnnee = (m: number, a: number) => new Date(a, m - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default async function EspaceDocuments({ searchParams }: { searchParams: Promise<{ certif?: string; erreur?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;
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

      {/* Envoi d'un certificat médical à la Direction */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Icone nom="document" className="shrink-0 text-muted-foreground" /> Envoyer un certificat médical</h2>
        <p className="mb-3 text-sm text-muted-foreground">Transmettez votre certificat (justificatif d&apos;absence) à la Direction. Formats : PDF ou image.</p>
        {sp.certif && <p className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Certificat envoyé à la Direction. Merci !</p>}
        {sp.erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
        <form action={envoyerMonCertificat} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">Fichier du certificat
            <input type="file" name="certificat" required accept=".pdf,.png,.jpg,.jpeg,.webp" className={`${inputCls} file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs`} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">Précision (facultatif)
            <input type="text" name="note" placeholder="ex. arrêt maladie du 14 au 16 juillet" className={inputCls} />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Envoyer le certificat</button>
          </div>
        </form>
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
                <div className="flex items-center gap-3 text-sm">
                  <BulletinViewerButton payrollLineId={b.id} nom={`bulletin ${moisAnnee(b.payrollRun.mois, b.payrollRun.annee)}`} base="/espace/bulletin" />
                  <TelechargerLien href={`/espace/bulletin/${b.id}?devise=USD`} className="text-primary underline">$</TelechargerLien>
                  <TelechargerLien href={`/espace/bulletin/${b.id}?devise=CDF`} className="text-primary underline">CDF</TelechargerLien>
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
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.type} · {c.poste}</p>
                  <p className="text-xs text-muted-foreground">
                    {fr(c.dateDebut)} → {c.dateFin ? fr(c.dateFin) : "indéterminé"}
                    {c.accepteLe ? <span className="text-emerald-700"> · accepté le {fr(c.accepteLe)}</span> : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <a href={`/espace/contrat/${c.id}`} target="_blank" className="text-primary underline">Voir le contrat</a>
                  <a href={`/espace/contrat/${c.id}?dl=1`} className="text-primary underline">PDF</a>
                  {c.statut === "ACTIF" && !c.accepteLe && <AccepterContrat id={c.id} />}
                  {c.documentUrl && <a href={c.documentUrl} target="_blank" className="text-xs text-muted-foreground underline">pièce jointe</a>}
                </div>
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
