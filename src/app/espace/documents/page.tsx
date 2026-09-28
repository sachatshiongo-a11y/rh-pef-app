import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { TelechargerLien } from "@/components/telecharger-lien";
import { envoyerMonCertificat } from "../actions";
import { Icone } from "@/components/icones";
import { BulletinViewerButton } from "@/app/(app)/employes/[id]/bulletin-viewer";
import { salaireNetUSD } from "@/lib/paie-net";
import { formaterUSD } from "@/lib/montant";
import { libelleTypeDocument } from "@/lib/libelles-espace";
import { chargerSignatures, etatSignature } from "@/lib/signature";
import { BoutonSigner } from "@/components/bouton-signer";
import { signerMonDocument } from "../signature-actions";
import { STATUTS_BULLETIN_SALARIE } from "@/lib/bulletin-salarie";

const fr = (x: Date | null | undefined) => (x ? new Date(x).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");
const moisAnnee = (m: number, a: number) => new Date(a, m - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const inputCls = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default async function EspaceDocuments({ searchParams }: { searchParams: Promise<{ certif?: string; erreur?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;
  const [bulletins, documents] = await Promise.all([
    // Seuls les bulletins VALIDÉS ou PAYÉS sont montrés au salarié (pas les brouillons en préparation).
    prisma.payrollLine.findMany({
      where: { employeeId: s.employeeId, statutPaiement: { in: [...STATUTS_BULLETIN_SALARIE] } },
      include: { payrollRun: { select: { mois: true, annee: true } } },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
      take: 60,
    }),
    prisma.documentEmploye.findMany({ where: { employeeId: s.employeeId }, orderBy: { createdAt: "desc" } }),
  ]);

  // Les signatures des bulletins affichés, en UNE requête quel que soit le nombre de lignes —
  // jamais une requête par bulletin. C'est cette lecture qui détecte qu'un bulletin a bougé depuis
  // sa signature : rien n'est stocké sur le bulletin lui-même.
  const sigBulletins = await chargerSignatures(prisma, "BULLETIN", bulletins.map((b) => b.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mes bulletins et documents</h1>
        <p className="text-sm text-muted-foreground">Vos bulletins de paie, vos certificats et les documents de votre dossier.</p>
      </div>

      {/* Retour de l'envoi du certificat : en haut, là où la page se rouvre après l'envoi. */}
      {sp.certif && <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Certificat envoyé à la Direction. Il figure maintenant dans les documents de votre dossier.</p>}
      {sp.erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      <Section titre="Bulletins de paie">
        {bulletins.length === 0 ? (
          <Vide>Aucun bulletin pour le moment. Il apparaît ici dès que la Direction l&apos;a validé.</Vide>
        ) : (
          <ul className="divide-y">
            {bulletins.map((b) => {
              const periode = moisAnnee(b.payrollRun.mois, b.payrollRun.annee);
              return (
                <li key={b.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium first-letter:uppercase">{periode}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">Net {formaterUSD(salaireNetUSD(b))}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <BulletinViewerButton payrollLineId={b.id} nom={`bulletin ${periode}`} base="/espace/bulletin" libelle="Voir" />
                    <TelechargerLien href={`/espace/bulletin/${b.id}?devise=USD&dl=1`} className="text-primary underline">Télécharger en $</TelechargerLien>
                    <TelechargerLien href={`/espace/bulletin/${b.id}?devise=CDF&dl=1`} className="text-primary underline">Télécharger en CDF</TelechargerLien>
                    <BoutonSigner
                      cible="BULLETIN"
                      cibleId={b.id}
                      nomSalarie={s.nom}
                      libelleDocument={`Bulletin ${periode}`}
                      cote="SALARIE"
                      action={signerMonDocument}
                      {...etatSignature(sigBulletins.get(b.id))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Les demandes de congé acceptées se lisent et se signent à UN endroit : « Mes congés ».
          Elles étaient aussi listées ici, en double (lot 6). */}
      <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Vos demandes de congé acceptées se lisent et se signent dans{" "}
        <Link href="/espace/conges" className="text-primary underline">Mes congés</Link>. Vos contrats sont dans{" "}
        <Link href="/espace/contrats" className="text-primary underline">Mes contrats</Link>, vos attestations dans{" "}
        <Link href="/espace/attestations" className="text-primary underline">Mes attestations</Link>.
      </p>

      {/* Envoi d'un certificat médical à la Direction */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Icone nom="document" className="shrink-0 text-muted-foreground" /> Envoyer un certificat médical</h2>
        <p className="mb-3 text-sm text-muted-foreground">Absent pour maladie ? Prenez le certificat en photo ou joignez le PDF : il part directement à la Direction.</p>
        <form action={envoyerMonCertificat} className="grid gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2">Photo ou PDF du certificat
            <input type="file" name="certificat" required accept=".pdf,.png,.jpg,.jpeg,.webp" className={`${inputCls} file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2">Précision <span className="font-normal text-muted-foreground">(facultatif)</span>
            <input type="text" name="note" placeholder="ex. arrêt maladie du 14 au 16 juillet" className={inputCls} />
          </label>
          <div className="sm:col-span-2">
            <button className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground sm:w-auto sm:py-2">Envoyer le certificat</button>
          </div>
        </form>
      </div>

      <Section titre="Documents de mon dossier">
        {documents.length === 0 ? (
          <Vide>Aucun document dans votre dossier.</Vide>
        ) : (
          <ul className="divide-y">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium">{d.nom}</p>
                  <p className="text-xs text-muted-foreground">{libelleTypeDocument(d.type)}{d.dateExpiration ? ` · expire le ${fr(d.dateExpiration)}` : ""}</p>
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
