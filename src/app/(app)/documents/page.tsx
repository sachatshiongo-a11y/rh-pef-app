import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { prisma } from "@/lib/prisma";
import { COULEUR_STATUT, LIBELLE_STATUT } from "@/lib/paie-etats";
import { EmployeeName } from "@/components/employee-name";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ApercuDocumentBouton } from "@/components/apercu-document";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import type { PaymentStatus } from "@prisma/client";
import { normTexte } from "@/lib/texte";
import { salaireNetUSD } from "@/lib/paie-net";
import { formaterNombre } from "@/lib/montant";
import { chargerSignatures, etatSignature } from "@/lib/signature";
import { BoutonSigner } from "@/components/bouton-signer";
import { EtatSignatureLecture } from "@/components/etat-signature-lecture";
import { faireSignerDocument } from "../signature-actions";
import { classerContrats, libelleTypeContrat, type Classement } from "@/lib/contrats-classement";
import { LIBELLE_STATUT_ATTESTATION, LIBELLE_TYPE_ATTESTATION } from "@/lib/attestations-donnees";
import { chargerRegistre, filtresRegistre, ligneRegistre } from "../attestations/_registre";
import { exigerPageRH } from "@/lib/garde-page";

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
  TRANSFORME: "bg-sky-100 text-sky-800",
};
const COULEUR_ATTESTATION: Record<string, string> = {
  DEMANDEE: "bg-amber-100 text-amber-800",
  DELIVREE: "bg-green-100 text-green-800",
  REFUSEE: "bg-red-100 text-red-800",
};
const LIBELLE_STATUT_CONTRAT: Record<string, string> = {
  ACTIF: "Actif",
  EXPIRE: "Expiré",
  RESILIE: "Résilié",
  TRANSFORME: "Transformé",
};

function Badge({ classe, children }: { classe: string; children: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classe}`}>{children}</span>;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string; annee?: string; mois?: string; statut?: string; q?: string; type?: string }>;
}) {
  const user = await exigerPageRH();
  const peutFaireSigner = user.role === "ADMIN" || user.role === "MANAGER";
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
    prisma.contrat.findMany({ include: { employee: { select: { id: true, nom: true, photoUrl: true } } }, orderBy: [{ dateDebut: "desc" }, { createdAt: "desc" }], take: 1000 }),
    prisma.documentEmploye.findMany({ include: { employee: { select: { id: true, nom: true, photoUrl: true } } }, orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.leaveRequest.findMany({ include: { employee: { select: { id: true, nom: true, photoUrl: true } } }, orderBy: { dateEnreg: "desc" }, take: 1000 }),
    prisma.fichePoste.findMany({ orderBy: { poste: "asc" }, take: 1000 }),
  ]);

  // Toutes les fiches de poste (le PDF est générable pour chacune), filtrées par la recherche texte.
  const fiches = fichesAll.filter(
    (f) => !q || normTexte(f.poste).includes(normTexte(q)) || normTexte(f.fichierNom ?? "").includes(normTexte(q))
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

  // Signatures des bulletins affichés : UNE requête pour toute la liste filtrée. La colonne
  // « Signature » lit l'état DÉRIVÉ du document — un bulletin recalculé y repasse en « À resigner »
  // sans qu'aucun champ n'ait été écrit sur la ligne de paie.
  // (liste vide hors de l'onglet Bulletins : `chargerSignatures` rend la main sans requête)
  const sigBulletins = await chargerSignatures(
    prisma,
    "BULLETIN",
    onglet === "bulletins" ? bulletins.filter((b) => b.statutPaiement !== "PAS_VALIDE").map((b) => b.id) : []
  );

  // Onglet Contrats : même classement que « Mes contrats » (un CDD échu s'y lit « expiré le … »),
  // et l'état de signature avec le même composant que pour les bulletins.
  const sigContrats = await chargerSignatures(prisma, "CONTRAT", onglet === "contrats" ? contrats.map((c) => c.id) : []);
  const classementContrats = new Map<string, Classement>();
  if (onglet === "contrats") {
    const etats = new Map(contrats.map((c) => [c.id, etatSignature(sigContrats.get(c.id)).etat]));
    const maintenant = new Date();
    for (const e of new Set(contratsAll.map((c) => c.employeeId))) {
      for (const [id, cl] of classerContrats(contratsAll.filter((c) => c.employeeId === e), etats, maintenant)) classementContrats.set(id, cl);
    }
  }
  const statutContrat = (c: (typeof contrats)[number]) => {
    const cl = classementContrats.get(c.id);
    if (cl?.expireNonMarque) return { libelle: cl.motif ?? "Échu", classe: COULEUR_CONTRAT.EXPIRE };
    return { libelle: LIBELLE_STATUT_CONTRAT[c.statut] ?? c.statut, classe: COULEUR_CONTRAT[c.statut] ?? "" };
  };
  const signatureContrat = (c: (typeof contrats)[number]) => {
    const etat = etatSignature(sigContrats.get(c.id));
    const ancien = classementContrats.get(c.id)?.categorie === "ANCIEN";
    if (peutFaireSigner && !ancien && c.statut === "ACTIF") {
      return (
        <BoutonSigner
          cible="CONTRAT"
          cibleId={c.id}
          nomSalarie={c.employee.nom}
          libelleDocument={`Contrat ${libelleTypeContrat(c.type)} · ${c.poste} — ${c.employee.nom}`}
          cote="DIRECTION"
          action={faireSignerDocument}
          {...etat}
        />
      );
    }
    if (ancien && etat.etat === "A_SIGNER") return <span className="text-xs text-muted-foreground">—</span>;
    return <EtatSignatureLecture {...etat} />;
  };

  // Onglet Attestations : le registre (mêmes filtres que son export Excel).
  const filtresAtt = filtresRegistre({ get: (k: string) => (k === "type" ? sp.type ?? null : k === "statut" ? sp.statut ?? null : null) });
  const [attestations, nbAttestations] = await Promise.all([
    onglet === "attestations" ? chargerRegistre(filtresAtt) : Promise.resolve([]),
    prisma.attestation.count(),
  ]);
  const qsExport = `/attestations/export?${new URLSearchParams({ ...(filtresAtt.type ? { type: filtresAtt.type } : {}), ...(filtresAtt.statut ? { statut: filtresAtt.statut } : {}) })}`;

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
        : onglet === "attestations"
          ? (["DEMANDEE", "DELIVREE", "REFUSEE"] as const).map((v) => ({ v, label: LIBELLE_STATUT_ATTESTATION[v] }))
        : onglet === "contrats"
          ? [
              { v: "ACTIF", label: "Actif" },
              { v: "EXPIRE", label: "Expiré" },
              { v: "RESILIE", label: "Résilié" },
              { v: "TRANSFORME", label: "Transformé" },
            ]
          : [...new Set(documentsAll.map((d) => d.type))].map((t) => ({ v: t, label: t }));

  const onglets = [
    { cle: "bulletins", label: "Bulletins de paie", n: bulletins.length },
    { cle: "contrats", label: "Contrats", n: contrats.length },
    { cle: "documents", label: "Documents RH", n: documents.length },
    { cle: "conges", label: "Demandes de congé", n: conges.length },
    { cle: "fiches", label: "Fiches de poste", n: fiches.length },
    { cle: "attestations", label: "Attestations", n: onglet === "attestations" ? attestations.length : nbAttestations },
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
        {onglet === "attestations" && (
          <label className="flex flex-col gap-1 text-xs">
            Type
            <select name="type" defaultValue={sp.type ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
              <option value="">Tous</option>
              {(["TRAVAIL", "SALAIRE", "STAGE"] as const).map((t) => (<option key={t} value={t}>{LIBELLE_TYPE_ATTESTATION[t]}</option>))}
            </select>
          </label>
        )}
        {onglet !== "fiches" && (
        <>
        {onglet !== "attestations" && (
        <label className="flex flex-col gap-1 text-xs">
          Année
          <select name="annee" defaultValue={sp.annee ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Toutes</option>
            {annees.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
        )}
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
        {onglet === "attestations" && (
          <TelechargerLien href={qsExport} className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">Exporter (Excel)</TelechargerLien>
        )}
        {(annee || mois || statut || q || sp.type) && (
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
              <span className="font-semibold text-foreground">{formaterNombre(salaireNetUSD(b), { minimumFractionDigits: 2 })} $</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <TelechargerLien href={`/paie/bulletin/${b.id}?devise=USD&dl=1`} className="text-primary underline">Bulletin $</TelechargerLien>
              <TelechargerLien href={`/paie/bulletin/${b.id}?devise=CDF&dl=1`} className="text-primary underline">Bulletin CDF</TelechargerLien>
              {!peutFaireSigner && b.statutPaiement !== "PAS_VALIDE" && (
                <EtatSignatureLecture {...etatSignature(sigBulletins.get(b.id))} />
              )}
              {peutFaireSigner && b.statutPaiement !== "PAS_VALIDE" && (
                <BoutonSigner
                  cible="BULLETIN"
                  cibleId={b.id}
                  nomSalarie={b.employee.nom}
                  libelleDocument={`Bulletin ${new Date(b.payrollRun.annee, b.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} — ${b.employee.nom}`}
                  cote="DIRECTION"
                  action={faireSignerDocument}
                  {...etatSignature(sigBulletins.get(b.id))}
                />
              )}
            </div>
          </div>
        ))}
        {onglet === "contrats" && contrats.map((c) => (
          <div key={c.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <EmpLink id={c.employee.id} nom={c.employee.nom} photoUrl={c.employee.photoUrl} />
              <Badge classe={statutContrat(c).classe}>{statutContrat(c).libelle}</Badge>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{libelleTypeContrat(c.type)} · {fr(c.dateDebut)} → {fr(c.dateFin)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {signatureContrat(c)}
              <ContratViewerButton href={`/employes/${c.employee.id}/contrat/${c.id}`} titre={`Contrat — ${c.type} · ${c.poste}`} libelle="Aperçu" className="text-primary underline" />
              <TelechargerLien href={`/employes/${c.employee.id}/contrat/${c.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
              {c.documentUrl && <ApercuDocumentBouton href={c.documentUrl} titre={`Pièce jointe — Contrat ${c.type} · ${c.employee.nom}`} libelle="Pièce jointe" className="text-muted-foreground underline" />}
            </div>
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
              {d.fichierUrl && <ApercuDocumentBouton href={d.fichierUrl} titre={`${d.nom} — ${d.employee.nom}`} libelle="Ouvrir" className="text-primary underline" />}
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
            <span className="font-medium">{f.poste}</span>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <ContratViewerButton href={`/fiches-poste/${f.id}/pdf`} titre={`Fiche de poste — ${f.poste}`} libelle="Aperçu" className="text-primary underline" />
              <TelechargerLien href={`/fiches-poste/${f.id}/pdf?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
              {f.fichierUrl && (
                <TelechargerLien href={f.fichierUrl} nomFichier={f.fichierNom ?? undefined} className="text-muted-foreground underline">Pièce jointe</TelechargerLien>
              )}
            </div>
          </div>
        ))}
        {onglet === "attestations" && attestations.map((a) => (
          <div key={a.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <EmpLink id={a.employee.id} nom={a.employee.nom} photoUrl={a.employee.photoUrl} />
              <Badge classe={COULEUR_ATTESTATION[a.statut]}>{LIBELLE_STATUT_ATTESTATION[a.statut]}</Badge>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {LIBELLE_TYPE_ATTESTATION[a.type]}{a.numero ? ` · ${a.numero}` : ""} · {ligneRegistre(a)[a.statut === "DEMANDEE" ? 5 : 6]}
              {a.motifRefus ? ` · ${a.motifRefus}` : ""}
            </div>
            {a.statut === "DELIVREE" && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <ContratViewerButton href={`/attestations/${a.id}`} titre={`${LIBELLE_TYPE_ATTESTATION[a.type]} ${a.numero ?? ""}`} libelle="Aperçu" className="text-primary underline" />
                <TelechargerLien href={`/attestations/${a.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
              </div>
            )}
          </div>
        ))}
        {((onglet === "attestations" && attestations.length === 0) || (onglet === "bulletins" && bulletins.length === 0) || (onglet === "contrats" && contrats.length === 0) || (onglet === "documents" && documents.length === 0) || (onglet === "conges" && conges.length === 0) || (onglet === "fiches" && fiches.length === 0)) && (
          <EtatVide message="Rien à afficher." />
        )}
      </div>

      {/* Ordinateur : tableau. */}
      <div className="hidden overflow-x-auto rounded-xl border lg:block">
        <table className="w-full text-sm">
          {onglet === "bulletins" && (
            <>
              <Thead cols={["Période", "Matricule", "Employé", "Salaire net $", "Statut", "Bulletin", "Signature"]} />
              <tbody>
                {bulletins.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2 capitalize">{new Date(b.payrollRun.annee, b.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                    <td className="px-3 py-2 font-mono text-xs">{b.employee.matricule}</td>
                    <td className="px-3 py-2"><EmpLink id={b.employee.id} nom={b.employee.nom} photoUrl={b.employee.photoUrl} /></td>
                    <td className="px-3 py-2">{formaterNombre(salaireNetUSD(b), { minimumFractionDigits: 2 })} $</td>
                    <td className="px-3 py-2"><Badge classe={COULEUR_STATUT[b.statutPaiement]}>{LIBELLE_STATUT[b.statutPaiement]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <TelechargerLien href={`/paie/bulletin/${b.id}?devise=USD&dl=1`} className="text-primary underline">$</TelechargerLien>
                      {" · "}
                      <TelechargerLien href={`/paie/bulletin/${b.id}?devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {b.statutPaiement === "PAS_VALIDE" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : peutFaireSigner ? (
                        <BoutonSigner
                          cible="BULLETIN"
                          cibleId={b.id}
                          nomSalarie={b.employee.nom}
                          libelleDocument={`Bulletin ${new Date(b.payrollRun.annee, b.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} — ${b.employee.nom}`}
                          cote="DIRECTION"
                          action={faireSignerDocument}
                          {...etatSignature(sigBulletins.get(b.id))}
                        />
                      ) : (
                        <EtatSignatureLecture {...etatSignature(sigBulletins.get(b.id))} />
                      )}
                    </td>
                  </tr>
                ))}
                <Vide n={bulletins.length} cols={7} />
              </tbody>
            </>
          )}

          {onglet === "contrats" && (
            <>
              <Thead cols={["Employé", "Type", "Début", "Échéance", "Statut", "Signature", "Contrat (PDF)", "Pièce jointe"]} />
              <tbody>
                {contrats.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2"><EmpLink id={c.employee.id} nom={c.employee.nom} photoUrl={c.employee.photoUrl} /></td>
                    <td className="px-3 py-2">{libelleTypeContrat(c.type)}</td>
                    <td className="px-3 py-2">{fr(c.dateDebut)}</td>
                    <td className="px-3 py-2">{fr(c.dateFin)}</td>
                    <td className="px-3 py-2"><Badge classe={statutContrat(c).classe}>{statutContrat(c).libelle}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2">{signatureContrat(c)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <ContratViewerButton href={`/employes/${c.employee.id}/contrat/${c.id}`} titre={`Contrat — ${c.type} · ${c.poste}`} libelle="Aperçu" className="text-primary underline" />
                        <TelechargerLien href={`/employes/${c.employee.id}/contrat/${c.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
                      </div>
                    </td>
                    <td className="px-3 py-2">{c.documentUrl ? <ApercuDocumentBouton href={c.documentUrl} titre={`Pièce jointe — Contrat ${c.type} · ${c.employee.nom}`} libelle="Ouvrir" className="text-primary underline" /> : "—"}</td>
                  </tr>
                ))}
                <Vide n={contrats.length} cols={8} />
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
                    <td className="px-3 py-2">{d.fichierUrl ? <ApercuDocumentBouton href={d.fichierUrl} titre={`${d.nom} — ${d.employee.nom}`} libelle="Ouvrir" className="text-primary underline" /> : "—"}</td>
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

          {onglet === "attestations" && (
            <>
              <Thead cols={["Numéro", "Type", "Employé", "Statut", "Demandée le", "Délivrée / refusée le", "Par", "PDF"]} />
              <tbody>
                {attestations.map((a) => {
                  const l = ligneRegistre(a);
                  return (
                    <tr key={a.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{l[0]}</td>
                      <td className="px-3 py-2">{l[1]}</td>
                      <td className="px-3 py-2"><EmpLink id={a.employee.id} nom={a.employee.nom} photoUrl={a.employee.photoUrl} /></td>
                      <td className="px-3 py-2">
                        <Badge classe={COULEUR_ATTESTATION[a.statut]}>{l[2]}</Badge>
                        {a.motifRefus && <p className="mt-0.5 text-xs text-muted-foreground">{a.motifRefus}</p>}
                      </td>
                      <td className="px-3 py-2">{l[5]}</td>
                      <td className="px-3 py-2">{l[6]}</td>
                      <td className="px-3 py-2">{l[7]}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {a.statut === "DELIVREE" ? (
                          <TelechargerLien href={`/attestations/${a.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                <Vide n={attestations.length} cols={8} />
              </tbody>
            </>
          )}

          {onglet === "fiches" && (
            <>
              <Thead cols={["Poste", "Description", "Fiche de poste (PDF)", "Pièce jointe"]} />
              <tbody>
                {fiches.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{f.poste}</td>
                    <td className="max-w-md truncate px-3 py-2 text-muted-foreground">{f.descriptionPoste ?? f.description ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <ContratViewerButton href={`/fiches-poste/${f.id}/pdf`} titre={`Fiche de poste — ${f.poste}`} libelle="Aperçu" className="text-primary underline" />
                        <TelechargerLien href={`/fiches-poste/${f.id}/pdf?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {f.fichierUrl ? (
                        <TelechargerLien href={f.fichierUrl} nomFichier={f.fichierNom ?? undefined} className="text-primary underline">Ouvrir</TelechargerLien>
                      ) : "—"}
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
    <thead className="bg-muted text-left">
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
