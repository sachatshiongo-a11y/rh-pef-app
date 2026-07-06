import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { calculerAlertes, type Alerte } from "@/lib/alertes";
import { Avatar } from "@/components/avatar";
import { FrisePaie, calculerEtapePaie } from "@/components/frise-paie";

function usd(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}
const STYLE_ALERTE: Record<Alerte["niveau"], string> = {
  urgent: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};
function libelleJour(date: Date): string {
  const j = Math.ceil(
    (new Date(new Date(date).toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000
  );
  if (j <= 0) return "Aujourd'hui";
  if (j === 1) return "Demain";
  return new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export default async function AccueilPage() {
  const user = await verifySession();
  const prenom = user.nom.split(" ")[0];
  const peutValider = user.role === "ADMIN";
  // Photo de profil = celle de la fiche employé liée au compte (si liée).
  const moi = await prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } });
  const maPhoto = moi?.employe?.photoUrl ?? null;
  const maintenant = new Date();
  const dans30j = new Date(Date.now() + 30 * 86_400_000);
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = config?.moisCourant ?? maintenant.getMonth() + 1;
  const annee = config?.anneeCourante ?? maintenant.getFullYear();
  const filtreRun = config ? { payrollRun: { mois, annee } } : {};

  const [
    effectifBrigade,
    effectifBackoffice,
    run,
    congesEnAttente,
    bulletinsPasValide,
    bulletinsValide,
    congesEnCours,
    alertes,
    absencesAVenir,
    runsHistorique,
  ] = await Promise.all([
    prisma.employee.count({ where: { categorie: "BRIGADE", actif: true } }),
    prisma.employee.count({ where: { categorie: "BACKOFFICE", actif: true } }),
    prisma.payrollRun.findUnique({ where: { mois_annee: { mois, annee } }, include: { lignes: true } }),
    prisma.leaveRequest.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.payrollLine.count({ where: { statutPaiement: "PAS_VALIDE", ...filtreRun } }),
    prisma.payrollLine.count({ where: { statutPaiement: "VALIDE", ...filtreRun } }),
    prisma.leaveRequest.count({ where: { statut: "APPROUVE", dateDebut: { lte: maintenant }, dateFin: { gte: maintenant } } }),
    calculerAlertes(),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateFin: { gte: maintenant }, dateDebut: { lte: dans30j } },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { dateDebut: "asc" },
      take: 10,
    }),
    prisma.payrollRun.findMany({ orderBy: [{ annee: "desc" }, { mois: "desc" }], take: 6, include: { lignes: { select: { salNetUSD: true, coutEmployeurUSD: true } } } }),
  ]);

  const lignes = run?.lignes ?? [];
  const etapePaie = calculerEtapePaie({
    hasRun: !!run,
    total: lignes.length,
    nbPaye: lignes.filter((l) => l.statutPaiement === "PAYE").length,
    nbValide: lignes.filter((l) => l.statutPaiement === "VALIDE").length,
    nbPasValide: lignes.filter((l) => l.statutPaiement === "PAS_VALIDE").length,
  });
  const masseNette = lignes.reduce((a, l) => a + Number(l.salNetUSD), 0);
  const coutTotal = lignes.reduce((a, l) => a + Number(l.coutEmployeurUSD), 0);
  const tempsTravail = lignes.reduce((a, l) => a + Number(l.heuresTravaillees), 0);
  const fraisMedicaux = lignes.reduce((a, l) => a + Number(l.fraisMedicauxUSD), 0);

  const historique = [...runsHistorique].reverse().map((r) => ({
    periode: new Date(r.annee, r.mois - 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    net: r.lignes.reduce((a, l) => a + Number(l.salNetUSD), 0),
    cout: r.lignes.reduce((a, l) => a + Number(l.coutEmployeurUSD), 0),
  }));
  // Variation en % du dernier mois par rapport au précédent.
  const variation = (cle: "net" | "cout"): number | null => {
    if (historique.length < 2) return null;
    const prec = historique[historique.length - 2][cle];
    const cur = historique[historique.length - 1][cle];
    if (prec === 0) return null;
    return ((cur - prec) / prec) * 100;
  };
  const varNet = variation("net");
  const varCout = variation("cout");
  const maxSerie = Math.max(1, ...historique.flatMap((h) => [h.net, h.cout]));

  const inbox: { texte: string; sousTexte: string; lien: string }[] = [];
  if (congesEnAttente > 0)
    inbox.push({ texte: `${congesEnAttente} demande(s) de congé ${peutValider ? "à valider" : "en attente"}`, sousTexte: "Congés", lien: "/a-valider" });
  if (peutValider && bulletinsPasValide > 0)
    inbox.push({ texte: `${bulletinsPasValide} bulletin(s) à valider`, sousTexte: "Paie", lien: "/a-valider" });
  if (peutValider && bulletinsValide > 0)
    inbox.push({ texte: `${bulletinsValide} bulletin(s) à payer`, sousTexte: "Paie", lien: "/a-valider" });

  const cartes = [
    { label: "Effectif brigade", value: String(effectifBrigade) },
    { label: "Effectif backoffice", value: String(effectifBackoffice) },
    { label: "Masse salariale nette", value: usd(masseNette) },
    { label: "Coût total employeur", value: usd(coutTotal) },
    { label: "Temps de travail (mois)", value: `${tempsTravail} h` },
    { label: "Frais médicaux (mois)", value: usd(fraisMedicaux) },
    { label: "Congés en cours", value: String(congesEnCours) },
    { label: "Taux CDF/USD", value: config ? `${Number(config.tauxChangeCDF)} CDF` : "—" },
  ];

  const dateDuJour = maintenant.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-6xl">
      {/* Bandeau d'accueil */}
      <div className="mb-6 flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-sm">
        <Avatar nom={user.nom} taille={56} photoUrl={maPhoto} />
        <div>
          <h1 className="text-2xl font-semibold">Bonjour {prenom}</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {user.role === "ADMIN" ? "Direction" : user.role === "MANAGER" ? "Responsable RH" : "Consultation"} ·{" "}
            {dateDuJour} · Paie de{" "}
            {new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Frise chronologique de la paie du mois */}
      {run && (
        <div className="mb-6">
          <FrisePaie mois={mois} annee={annee} etape={etapePaie} />
        </div>
      )}

      {/* Indicateurs */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cartes.map((c) => (
          <div key={c.label} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-xl font-semibold">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Colonne principale : à traiter + alertes + graphe */}
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">À traiter</h2>
              <Link href="/a-valider" className="text-xs text-primary underline">Ouvrir les demandes de validation →</Link>
            </div>
            {inbox.length === 0 && alertes.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Rien à traiter. Tout est à jour ✅</p>
            ) : (
              <ul className="divide-y">
                {inbox.map((it, i) => (
                  <li key={`i-${i}`}>
                    <Link href={it.lien} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{it.texte}</p>
                        <p className="text-xs text-muted-foreground">{it.sousTexte}</p>
                      </div>
                      <span className="text-muted-foreground">→</span>
                    </Link>
                  </li>
                ))}
                {alertes.map((a, i) => {
                  const contenu = (
                    <div className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STYLE_ALERTE[a.niveau]}`} aria-hidden />
                      <p className="min-w-0 flex-1 text-sm">{a.message}</p>
                      {a.lien && <span className="text-muted-foreground">→</span>}
                    </div>
                  );
                  return <li key={`a-${i}`}>{a.lien ? <Link href={a.lien}>{contenu}</Link> : contenu}</li>;
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Masse salariale &amp; coût employeur</h2>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/80" aria-hidden /> Net</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> Coût empl.</span>
              </div>
            </div>

            {/* Chiffres du mois + variation % vs mois précédent */}
            <div className="mb-4 grid grid-cols-2 gap-4">
              <VariationBloc label="Masse salariale nette" valeur={usd(masseNette)} variation={varNet} />
              <VariationBloc label="Coût total employeur" valeur={usd(coutTotal)} variation={varCout} />
            </div>

            {historique.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune paie enregistrée.</p>
            ) : (
              <div className="flex h-36 items-end gap-3">
                {historique.map((h) => (
                  <div key={h.periode} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-28 w-full items-end justify-center gap-1">
                      <div className="w-1/2 rounded-t bg-primary/80" style={{ height: `${Math.max(3, (h.net / maxSerie) * 112)}px` }} title={`Net ${h.periode} : ${usd(h.net)}`} />
                      <div className="w-1/2 rounded-t bg-amber-500" style={{ height: `${Math.max(3, (h.cout / maxSerie) * 112)}px` }} title={`Coût employeur ${h.periode} : ${usd(h.cout)}`} />
                    </div>
                    <span className="text-xs capitalize text-muted-foreground">{h.periode}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Colonne latérale : absences à venir + accès rapides */}
        <div className="space-y-5">
          <div className="rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-5 py-3"><h2 className="font-semibold">Absences à venir de l&apos;équipe</h2></div>
            {absencesAVenir.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucune absence prévue (30 j).</p>
            ) : (
              <ul className="divide-y">
                {absencesAVenir.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar nom={a.employee.nom} taille={32} photoUrl={a.employee.photoUrl} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/employes/${a.employee.id}`} className="block truncate text-sm font-medium hover:underline">{a.employee.nom}</Link>
                      <p className="text-xs text-muted-foreground">{a.type}</p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{libelleJour(new Date(a.dateDebut))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <LienCarte href="/documents" titre="Documents & archives" desc="Contrats, bulletins, congés" />
            <LienCarte href="/presences" titre="Présences & absences" desc="Historique et saisie" />
            <LienCarte href="/absences" titre="Calendrier des absences" desc="Vue annuelle et soldes" />
            <LienCarte href="/historique" titre="Historique de paie" desc="Masse salariale par mois" />
          </div>
        </div>
      </div>
    </div>
  );
}

function VariationBloc({ label, valeur, variation }: { label: string; valeur: string; variation: number | null }) {
  const hausse = (variation ?? 0) >= 0;
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{valeur}</p>
      {variation === null ? (
        <p className="mt-1 text-xs text-muted-foreground">— vs mois précédent</p>
      ) : (
        <p className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${hausse ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {hausse ? "▲" : "▼"} {hausse ? "+" : ""}{variation.toFixed(1).replace(".", ",")} % vs mois préc.
        </p>
      )}
    </div>
  );
}

function LienCarte({ href, titre, desc }: { href: string; titre: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{titre}</p>
        <p className="truncate text-xs text-muted-foreground">{desc}</p>
      </div>
      <span className="text-muted-foreground">→</span>
    </Link>
  );
}
