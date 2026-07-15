import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { COULEUR_STATUT, LIBELLE_STATUT } from "@/lib/paie-etats";
import { EmployeeName } from "@/components/employee-name";
import { TelechargerLien } from "@/components/telecharger-lien";
import type { PaymentStatus } from "@prisma/client";
import { normTexte } from "@/lib/texte";

const fr = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const MOIS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// Codes couleur réutilisés (couleur + libellé, jamais la couleur seule — accessibilité).
const COULEUR_CONGE: Record<string, string> = {
  APPROUVE: "bg-green-100 text-green-800",
  REFUSE: "bg-red-100 text-red-800",
  EN_ATTENTE: "bg-amber-100 text-amber-800",
};
const COULEUR_CONTRAT: Record<string, string> = {
  ACTIF: "bg-green-100 text-green-800",
  EXPIRE: "bg-amber-100 text-amber-800",
  RESILIE: "bg-red-100 text-red-800",
};

function Badge({ classe, children }: { classe: string; children: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classe}`}>{children}</span>;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string; annee?: string; mois?: string; statut?: string; q?: string }>;
}) {
  await verifySession();
  const sp = await searchParams;
  const onglet = sp.onglet ?? "bulletins";
  const annee = sp.annee ? Number(sp.annee) : null;
  const mois = sp.mois ? Number(sp.mois) : null;
  const statut = sp.statut || null;
  const q = (sp.q ?? "").trim();

  const [bulletinsAll, contratsAll, documentsAll, congesAll, fichesAll] = await Promise.all([
    prisma.payrollLine.findMany({
      include: { employee: { select: { id: true, nom: true, matricule: true, photoUrl: true } }, payrollRun: true },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }, { employee: { nom: "asc" } }],
      take: 1000,
    }),
    prisma.contrat.findMany({ include: { employee: { select: { id: true, nom: true, photoUrl: true } } }, orderBy: { dateDebut: "desc" }, take: 1000 }),
    prisma.documentEmploye.findMany({ include: { employee: { select: { id: true, nom: true, photoUrl: true } } }, orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.leaveRequest.findMany({ include: { employee: { select: { id: true, nom: true, photoUrl: true } } }, orderBy: { dateEnreg: "desc" }, take: 1000 }),
    prisma.fichePoste.findMany({ orderBy: { poste: "asc" }, take: 1000 }),
  ]);

  // Fiches de poste documentées (fichier ou description), filtrées par la recherche texte.
  const fiches = fichesAll.filter(
    (f) => (f.fichierUrl || f.description) && (!q || normTexte(f.poste).includes(normTexte(q)) || normTexte(f.fichierNom ?? "").includes(normTexte(q)))
  );

  const annees = [
    ...new Set([
      ...bulletinsAll.map((b) => b.payrollRun.annee),
      ...contratsAll.map((c) => new Date(c.dateDebut).getFullYear()),
      ...documentsAll.map((d) => new Date(d.createdAt).getFullYear()),
      ...congesAll.map((c) => new Date(c.dateDebut).getFullYear()),
    ]),
  ].sort((a, b) => b - a);

  const bulletins = bulletinsAll.filter(
    (b) =>
      (!annee || b.payrollRun.annee === annee) &&
      (!mois || b.payrollRun.mois === mois) &&
      (!statut || b.statutPaiement === statut)
  );
  const contrats = contratsAll.filter(
    (c) => (!annee || new Date(c.dateDebut).getFullYear() === annee) && (!statut || c.statut === statut)
  );
  const documents = documentsAll.filter(
    (d) => (!annee || new Date(d.createdAt).getFullYear() === annee) && (!statut || d.type === statut)
  );
  const conges = congesAll.filter(
    (c) =>
      (!annee || new Date(c.dateDebut).getFullYear() === annee) &&
      (!mois || new Date(c.dateDebut).getMonth() + 1 === mois) &&
      (!statut || c.statut === statut)
  );

  // Options du filtre statut selon l'onglet actif.
  const optionsStatut: { v: string; label: string }[] =
    onglet === "bulletins"
      ? (["PAS_VALIDE", "VALIDE", "PAYE"] as PaymentStatus[]).map((s) => ({ v: s, label: LIBELLE_STATUT[s] }))
      : onglet === "conges"
        ? [
            { v: "EN_ATTENTE", label: "En attente" },
            { v: "APPROUVE", label: "Approuvé" },
            { v: "REFUSE", label: "Refusé" },
          ]
        : onglet === "contrats"
          ? [
              { v: "ACTIF", label: "Actif" },
              { v: "EXPIRE", label: "Expiré" },
              { v: "RESILIE", label: "Résilié" },
            ]
          : [...new Set(documentsAll.map((d) => d.type))].map((t) => ({ v: t, label: t }));

  const onglets = [
    { cle: "bulletins", label: "Bulletins de paie", n: bulletins.length },
    { cle: "contrats", label: "Contrats", n: contrats.length },
    { cle: "documents", label: "Documents RH", n: documents.length },
    { cle: "conges", label: "Demandes de congé", n: conges.length },
    { cle: "fiches", label: "Fiches de poste", n: fiches.length },
  ];
  const qs = (o: string) => `/documents?onglet=${o}${annee ? `&annee=${annee}` : ""}${mois ? `&mois=${mois}` : ""}`;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold sm:text-2xl">Documents &amp; archives</h1>
        <p className="text-sm text-muted-foreground">Tous les bulletins, contrats, documents et demandes</p>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto">
        {onglets.map((o) => (
          <Link
            key={o.cle}
            href={qs(o.cle)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-1.5 text-sm ${onglet === o.cle ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {o.label} <span className="opacity-70">({o.n})</span>
          </Link>
        ))}
      </div>

      {/* Filtres : période + statut (les options de statut dépendent de l'onglet) */}
      <form method="GET" className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <input type="hidden" name="onglet" value={onglet} />
        {onglet === "fiches" && (
          <label className="flex flex-col gap-1 text-xs">
            Rechercher un poste
            <input
              name="q"
              defaultValue={q}
              placeholder="Ex. cuisinier, serveur…"
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </label>
        )}
        {onglet !== "fiches" && (
        <>
        <label className="flex flex-col gap-1 text-xs">
          Année
          <select name="annee" defaultValue={sp.annee ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Toutes</option>
            {annees.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
        {(onglet === "bulletins" || onglet === "conges") && (
          <label className="flex flex-col gap-1 text-xs">
            Mois
            <select name="mois" defaultValue={sp.mois ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
              <option value="">Tous</option>
              {MOIS.map((m, i) => (<option key={m} value={i + 1}>{m}</option>))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs">
          Statut
          <select name="statut" defaultValue={sp.statut ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            {optionsStatut.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
          </select>
        </label>
        </>
        )}
        <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">Filtrer</button>
        {(annee || mois || statut || q) && (
          <Link href={`/documents?onglet=${onglet}`} className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">Réinitialiser</Link>
        )}
      </form>

      {/* Mobile : cartes par onglet. */}
      <div className="space-y-2 lg:hidden">
        {onglet === "bulletins" && bulletins.map((b) => (
          <div key={b.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <EmpLink id={b.employee.id} nom={b.employee.nom} photoUrl={b.employee.photoUrl} />
              <Badge classe={COULEUR_STATUT[b.statutPaiement]}>{LIBELLE_STATUT[b.statutPaiement]}</Badge>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="capitalize">{new Date(b.payrollRun.annee, b.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} · {b.employee.matricule}</span>
              <span className="font-semibold text-foreground">{Number(b.salNetUSD).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $</span>
            </div>
            <div className="mt-2 flex gap-3 text-sm">
              <TelechargerLien href={`/paie/bulletin/${b.id}?devise=USD&dl=1`} className="text-primary underline">Bulletin $</TelechargerLien>
              <TelechargerLien href={`/paie/bulletin/${b.id}?devise=CDF&dl=1`} className="text-primary underline">Bulletin CDF</TelechargerLien>
            </div>
          </div>
        ))}
        {onglet === "contrats" && contrats.map((c) => (
          <div key={c.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <EmpLink id={c.employee.id} nom={c.employee.nom} photoUrl={c.employee.photoUrl} />
              <Badge classe={COULEUR_CONTRAT[c.statut] ?? ""}>{c.statut}</Badge>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{c.type} · {fr(c.dateDebut)} → {fr(c.dateFin)}</div>
            {c.documentUrl && <div className="mt-2 text-sm"><a href={c.documentUrl} target="_blank" className="text-primary underline">Ouvrir la pièce</a></div>}
          </div>
        ))}
        {onglet === "documents" && documents.map((d) => (
          <div key={d.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <EmpLink id={d.employee.id} nom={d.employee.nom} photoUrl={d.employee.photoUrl} />
              <span className="shrink-0 text-xs text-muted-foreground">{d.type}</span>
            </div>
            <div className="mt-1 text-sm font-medium">{d.nom}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{d.dateExpiration ? `Expire le ${fr(d.dateExpiration)}` : "—"}</span>
              {d.fichierUrl && <a href={d.fichierUrl} target="_blank" className="text-primary underline">Ouvrir</a>}
            </div>
          </div>
        ))}
        {onglet === "conges" && conges.map((c) => (
          <div key={c.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <EmpLink id={c.employee.id} nom={c.employee.nom} photoUrl={c.employee.photoUrl} />
              <Badge classe={COULEUR_CONGE[c.statut] ?? ""}>{c.statut.replace("_", " ")}</Badge>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{c.type} · {fr(c.dateDebut)} → {fr(c.dateFin)}</span>
              <TelechargerLien href={`/conges/demande/${c.id}`} className="text-primary underline">PDF</TelechargerLien>
            </div>
          </div>
        ))}
        {onglet === "fiches" && fiches.map((f) => (
          <div key={f.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{f.poste}</span>
              {f.fichierUrl
                ? <TelechargerLien href={f.fichierUrl} nomFichier={f.fichierNom ?? undefined} className="text-sm text-primary underline">Télécharger</TelechargerLien>
                : <Link href="/fiches-poste" className="text-sm text-primary underline">Voir</Link>}
            </div>
            {(f.fichierNom || f.description) && <div className="mt-1 truncate text-xs text-muted-foreground">{f.fichierNom ?? f.description}</div>}
          </div>
        ))}
        {((onglet === "bulletins" && bulletins.length === 0) || (onglet === "contrats" && contrats.length === 0) || (onglet === "documents" && documents.length === 0) || (onglet === "conges" && conges.length === 0) || (onglet === "fiches" && fiches.length === 0)) && (
          <EtatVide message="Rien à afficher." />
        )}
      </div>

      {/* Ordinateur : tableau. */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-xl border lg:block">
        <table className="w-full text-sm">
          {onglet === "bulletins" && (
            <>
              <Thead cols={["Période", "Matricule", "Employé", "Net $", "Statut", "Bulletin"]} />
              <tbody>
                {bulletins.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2 capitalize">{new Date(b.payrollRun.annee, b.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                    <td className="px-3 py-2 font-mono text-xs">{b.employee.matricule}</td>
                    <td className="px-3 py-2"><EmpLink id={b.employee.id} nom={b.employee.nom} photoUrl={b.employee.photoUrl} /></td>
                    <td className="px-3 py-2">{Number(b.salNetUSD).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $</td>
                    <td className="px-3 py-2"><Badge classe={COULEUR_STATUT[b.statutPaiement]}>{LIBELLE_STATUT[b.statutPaiement]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <TelechargerLien href={`/paie/bulletin/${b.id}?devise=USD&dl=1`} className="text-primary underline">$</TelechargerLien>
                      {" · "}
                      <TelechargerLien href={`/paie/bulletin/${b.id}?devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
                    </td>
                  </tr>
                ))}
                <Vide n={bulletins.length} cols={6} />
              </tbody>
            </>
          )}

          {onglet === "contrats" && (
            <>
              <Thead cols={["Employé", "Type", "Début", "Échéance", "Statut", "Pièce"]} />
              <tbody>
                {contrats.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2"><EmpLink id={c.employee.id} nom={c.employee.nom} photoUrl={c.employee.photoUrl} /></td>
                    <td className="px-3 py-2">{c.type}</td>
                    <td className="px-3 py-2">{fr(c.dateDebut)}</td>
                    <td className="px-3 py-2">{fr(c.dateFin)}</td>
                    <td className="px-3 py-2"><Badge classe={COULEUR_CONTRAT[c.statut] ?? ""}>{c.statut}</Badge></td>
                    <td className="px-3 py-2">{c.documentUrl ? <a href={c.documentUrl} target="_blank" className="text-primary underline">Ouvrir</a> : "—"}</td>
                  </tr>
                ))}
                <Vide n={contrats.length} cols={6} />
              </tbody>
            </>
          )}

          {onglet === "documents" && (
            <>
              <Thead cols={["Employé", "Document", "Type", "Expiration", "Pièce"]} />
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="px-3 py-2"><EmpLink id={d.employee.id} nom={d.employee.nom} photoUrl={d.employee.photoUrl} /></td>
                    <td className="px-3 py-2">{d.nom}</td>
                    <td className="px-3 py-2">{d.type}</td>
                    <td className="px-3 py-2">{fr(d.dateExpiration)}</td>
                    <td className="px-3 py-2">{d.fichierUrl ? <a href={d.fichierUrl} target="_blank" className="text-primary underline">Ouvrir</a> : "—"}</td>
                  </tr>
                ))}
                <Vide n={documents.length} cols={5} />
              </tbody>
            </>
          )}

          {onglet === "conges" && (
            <>
              <Thead cols={["Employé", "Type", "Début", "Fin", "Statut", "PDF"]} />
              <tbody>
                {conges.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2"><EmpLink id={c.employee.id} nom={c.employee.nom} photoUrl={c.employee.photoUrl} /></td>
                    <td className="px-3 py-2">{c.type}</td>
                    <td className="px-3 py-2">{fr(c.dateDebut)}</td>
                    <td className="px-3 py-2">{fr(c.dateFin)}</td>
                    <td className="px-3 py-2"><Badge classe={COULEUR_CONGE[c.statut] ?? ""}>{c.statut.replace("_", " ")}</Badge></td>
                    <td className="px-3 py-2"><TelechargerLien href={`/conges/demande/${c.id}`} className="text-primary underline">PDF</TelechargerLien></td>
                  </tr>
                ))}
                <Vide n={conges.length} cols={6} />
              </tbody>
            </>
          )}

          {onglet === "fiches" && (
            <>
              <Thead cols={["Poste", "Document", "Description", "Pièce"]} />
              <tbody>
                {fiches.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{f.poste}</td>
                    <td className="px-3 py-2 text-muted-foreground">{f.fichierNom ?? "—"}</td>
                    <td className="max-w-md truncate px-3 py-2 text-muted-foreground">{f.description ?? "—"}</td>
                    <td className="px-3 py-2">
                      {f.fichierUrl ? (
                        <TelechargerLien href={f.fichierUrl} nomFichier={f.fichierNom ?? undefined} className="text-primary underline">Télécharger</TelechargerLien>
                      ) : (
                        <Link href="/fiches-poste" className="text-primary underline">Voir</Link>
                      )}
                    </td>
                  </tr>
                ))}
                <Vide n={fiches.length} cols={4} />
              </tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
}

function Thead({ cols }: { cols: string[] }) {
  return (
    <thead className="sticky top-0 z-10 bg-muted text-left">
      <tr>{cols.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr>
    </thead>
  );
}
function EmpLink({ id, nom, photoUrl }: { id: string; nom: string; photoUrl?: string | null }) {
  return <EmployeeName id={id} nom={nom} photoUrl={photoUrl} />;
}
function Vide({ n, cols }: { n: number; cols: number }) {
  if (n > 0) return null;
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-6 text-center text-muted-foreground">Rien à afficher.</td>
    </tr>
  );
}
