import type {
  Contrat,
  DossierDisciplinaire,
  Evaluation,
  DocumentEmploye,
  HistoriqueSalaire,
  FinContrat,
} from "@prisma/client";
import {
  ajouterContrat,
  attacherFichierContrat,
  changerSalaire,
  ajouterDisciplinaire,
  ajouterEvaluation,
  ajouterDocument,
} from "./dossier-actions";
import { FinContratForm } from "./fin-contrat-form";
import { ContratViewerButton } from "./contrat-viewer";
import { creerPret, annulerPret } from "./pret-actions";
import { genererOnboarding, basculerTacheOnboarding } from "./onboarding-actions";
import { Icone } from "@/components/icones";
import { transformerContrat, prolongerContrat, prolongerEssai, modifierContrat } from "../../paie/contrat-actions";

const MOTIF_FIN: Record<string, string> = {
  LICENCIEMENT: "Licenciement (Art. 67 C.T.)",
  DEMISSION: "Démission (Art. 69 C.T.)",
  FIN_CDD: "Fin de CDD",
  RETRAITE: "Départ à la retraite",
  FAUTE_LOURDE: "Faute lourde (Art. 72 C.T.)",
  AUTRE: "Autre",
};
const money = (n: number) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

const STATUT_CONTRAT: Record<string, { label: string; classe: string }> = {
  ACTIF: { label: "Actif", classe: "bg-emerald-100 text-emerald-800" },
  EXPIRE: { label: "Expiré", classe: "bg-amber-100 text-amber-800" },
  RESILIE: { label: "Résilié", classe: "bg-red-100 text-red-800" },
  TRANSFORME: { label: "Transformé", classe: "bg-sky-100 text-sky-800" },
};
function StatutContratBadge({ statut }: { statut: string }) {
  const s = STATUT_CONTRAT[statut] ?? { label: statut, classe: "bg-muted text-muted-foreground" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.classe}`}>{s.label}</span>;
}

const BADGE_DISCIPLINAIRE: Record<string, { label: string; classe: string }> = {
  AVERTISSEMENT: { label: "Avertissement", classe: "bg-amber-100 text-amber-800" },
  SANCTION: { label: "Sanction", classe: "bg-red-100 text-red-800" },
  MISE_A_PIED: { label: "Mise à pied", classe: "bg-red-100 text-red-800" },
  MESURE: { label: "Mesure", classe: "bg-slate-200 text-slate-700" },
};
const BORDURE_DISCIPLINAIRE: Record<string, string> = {
  AVERTISSEMENT: "border-l-amber-400",
  SANCTION: "border-l-red-400",
  MISE_A_PIED: "border-l-red-500",
  MESURE: "border-l-slate-300",
};

const TYPE_DOC_LABEL: Record<string, string> = {
  CONTRAT: "Contrat",
  CARTE_IDENTITE: "Carte d'identité",
  DIPLOME: "Diplôme",
  PHOTO: "Photo",
  CV: "CV",
  CERTIFICAT_MEDICAL: "Certificat médical",
  AVERTISSEMENT: "Avertissement",
  LETTRE: "Lettre",
  AUTRE: "Autre",
};

function d(date: Date | null | undefined) {
  return date ? new Date(date).toLocaleDateString("fr-FR") : "—";
}

const TYPE_CONTRAT_LABEL: Record<string, string> = {
  CDI: "CDI — durée indéterminée",
  CDD: "CDD — durée déterminée",
  STAGE: "Stage",
  JOURNALIER: "Journalier",
  INTERIM: "Intérim",
};

// Dates relatives de la carte « Conditions actuelles » (« il y a 3 ans », « dans 6 mois »).
function ecartMois(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
function relatifPasse(date: Date) {
  const m = Math.max(0, ecartMois(date, new Date()));
  if (m >= 12) { const ans = Math.floor(m / 12); return `il y a ${ans} an${ans > 1 ? "s" : ""}`; }
  if (m >= 1) return `il y a ${m} mois`;
  return "ce mois-ci";
}
function relatifFutur(date: Date) {
  const m = ecartMois(new Date(), date);
  if (m < 0) return "échue";
  if (m >= 12) { const ans = Math.floor(m / 12); return `dans ${ans} an${ans > 1 ? "s" : ""}`; }
  if (m >= 1) return `dans ${m} mois`;
  return "ce mois-ci";
}

/** Encadré thématique de la carte contrat (Informations / Poste / Rémunération / Horaires) —
 *  icônes du jeu maison (mêmes tracés que le menu), pas d'emoji. */
function BlocContrat({ icone, titre, children }: { icone: string; titre: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icone nom={icone} className="shrink-0 text-muted-foreground" />
        {titre}
      </p>
      {children}
    </div>
  );
}

function Champ({ label, valeur, note, alerte }: { label: string; valeur: string; note?: string; alerte?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${alerte ? "text-amber-700" : ""}`}>{valeur}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const inputCls =
  "rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

export function DossierEmploye({
  vue,
  employeeId,
  poste,
  fichePosteExiste,
  fichePosteDescriptionPoste,
  fichePosteDescription,
  fichePosteFichierUrl,
  salaireMensuel,
  salaireJournalier,
  soldeConges,
  joursPresence,
  ancienneteMois,
  preavisDemission,
  preavisLicenciement,
  indemniteLicenciementJoursParAn,
  actif,
  joursModele = [],
  contrats,
  prets = [],
  tachesOnboarding = [],
  historique,
  disciplinaire,
  evaluations,
  documents,
  finContrats,
  peutModifier,
  estAdmin,
}: {
  vue: "contrats" | "fin" | "dossier";
  employeeId: string;
  poste: string;
  fichePosteExiste?: boolean;
  fichePosteDescriptionPoste?: string | null;
  fichePosteDescription?: string | null;
  fichePosteFichierUrl?: string | null;
  salaireMensuel: number;
  salaireJournalier: number;
  soldeConges: number;
  joursPresence: number;
  ancienneteMois: number;
  preavisDemission: number | null;
  preavisLicenciement: number | null;
  indemniteLicenciementJoursParAn: number | null;
  actif: boolean;
  joursModele?: number[]; // jours travaillés selon le modèle hebdo (0=dim … 6=sam)
  contrats: Contrat[];
  prets?: { id: string; montant: number; retenueMensuelle: number; motif: string | null; statut: string; dateAccord: Date; rembourse: number; solde: number; nbRetenues: number }[];
  tachesOnboarding?: { id: string; libelle: string; fait: boolean; faitLe: Date | null }[];
  historique: HistoriqueSalaire[];
  disciplinaire: DossierDisciplinaire[];
  evaluations: Evaluation[];
  documents: DocumentEmploye[];
  finContrats: FinContrat[];
  peutModifier: boolean;
  estAdmin: boolean;
}) {
  const aujourdhui = new Date();
  const dans30j = new Date(aujourdhui.getTime() + 30 * 86400000);

  return (
    <>
      {vue === "contrats" && (() => {
        // Le contrat COURANT (actif le plus récent) est mis en avant façon « Conditions actuelles » ;
        // les autres (transformés, expirés, résiliés…) forment l'historique replié en dessous.
        const courant = contrats.find((c) => c.statut === "ACTIF") ?? null;
        const anciens = contrats.filter((c) => c !== courant);
        return (
      <>
      {/* Conditions actuelles (contrat actif) */}
      <Section title="Conditions actuelles">
        {!courant ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucun contrat actif. {contrats.length > 0 ? "Consultez l'historique ci-dessous ou ajoutez un nouveau contrat." : "Ajoutez un premier contrat ci-dessous."}
          </p>
        ) : (() => {
          const c = courant;
          const expireBientot = c.dateFin && new Date(c.dateFin) <= dans30j && new Date(c.dateFin) >= aujourdhui;
          const essaiBientot = c.finPeriodeEssai && new Date(c.finPeriodeEssai) <= dans30j && new Date(c.finPeriodeEssai) >= aujourdhui;
          const essaiEnCours = c.finPeriodeEssai && new Date(c.finPeriodeEssai) >= aujourdhui;
          return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Effectives depuis le <b className="text-foreground">{d(c.dateDebut)}</b>
              </p>
              <StatutContratBadge statut={c.statut} />
            </div>

            {(expireBientot || essaiBientot) && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {expireBientot ? "⚠ Contrat arrivant à échéance (30 j)" : "⚠ Fin de période d'essai proche (30 j)"}
              </p>
            )}

            {/* Informations sur le contrat */}
            <BlocContrat icone="document" titre="Informations sur le contrat">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <Champ label="Date de début" valeur={d(c.dateDebut)} note={relatifPasse(new Date(c.dateDebut))} />
                <Champ label="Type de contrat" valeur={TYPE_CONTRAT_LABEL[c.type] ?? c.type} note={c.renouvellements > 0 ? `prolongé ${c.renouvellements} fois` : undefined} />
                <Champ
                  label="Date de fin"
                  valeur={c.dateFin ? d(c.dateFin) : "Indéterminée"}
                  note={c.dateFin ? relatifFutur(new Date(c.dateFin)) : undefined}
                  alerte={Boolean(expireBientot)}
                />
                <Champ
                  label="Période d'essai"
                  valeur={c.finPeriodeEssai ? `Jusqu'au ${d(c.finPeriodeEssai)}` : "—"}
                  note={essaiEnCours ? "en cours" : c.finPeriodeEssai ? "terminée" : undefined}
                  alerte={Boolean(essaiBientot)}
                />
              </div>
            </BlocContrat>

            {/* Poste */}
            <BlocContrat icone="mallette" titre="Poste">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <Champ label="Position actuelle" valeur={c.poste} />
                {c.agence && (
                  <div className="col-span-2 md:col-span-3">
                    <Champ
                      label="Agence d'intérim"
                      valeur={c.agence}
                      note={`${c.coutJourUSD ? `${Number(c.coutJourUSD).toLocaleString("fr-FR")} $/jour facturé — ` : ""}payé par l'agence (hors paie)`}
                    />
                  </div>
                )}
              </div>

              {/* Description du poste + Description des tâches, façon Factorial (deux colonnes, en prose). */}
              <div className="mt-4 border-t pt-3">
                {(fichePosteDescriptionPoste?.trim() || fichePosteDescription?.trim()) ? (
                  <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Missions principales du poste</p>
                      {fichePosteDescriptionPoste?.trim() ? (
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{fichePosteDescriptionPoste.trim()}</p>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">Non renseignées.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Activités et tâches principales</p>
                      {fichePosteDescription?.trim() ? (
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{fichePosteDescription.trim()}</p>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">Non renseignées.</p>
                      )}
                    </div>
                  </div>
                ) : fichePosteExiste ? (
                  <p className="text-sm text-muted-foreground">
                    La fiche de poste existe mais n&apos;a pas encore de description.{" "}
                    <a href="/fiches-poste" className="text-primary underline">La renseigner</a>
                    {fichePosteFichierUrl ? " ou consulter le document ci-dessous." : "."}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucune fiche de poste pour «&nbsp;{c.poste}&nbsp;».{" "}
                    <a href="/fiches-poste" className="text-primary underline">Créer la fiche de poste</a>
                  </p>
                )}
                {fichePosteFichierUrl && (
                  <a href={fichePosteFichierUrl} target="_blank" className="mt-2 inline-block text-xs text-primary underline">
                    Ouvrir la fiche de poste (fichier) →
                  </a>
                )}
              </div>
            </BlocContrat>

            {/* Rémunération */}
            <BlocContrat icone="billet" titre="Rémunération">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <Champ
                  label="Salaire brut"
                  valeur={`${Number(c.salaireMensuel).toLocaleString("fr-FR")} ${c.devise} / mois`}
                  note={`soit ${(Number(c.salaireMensuel) * 12).toLocaleString("fr-FR")} ${c.devise} / an`}
                />
                <Champ label="Politique de paie" valeur="Mensuelle (aux heures)" note="détail dans l'onglet Paie" />
              </div>
            </BlocContrat>

            {/* Horaires */}
            <BlocContrat icone="horloge" titre="Horaires">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <Champ label="Heures de travail" valeur={`${Number(c.heuresHebdo).toLocaleString("fr-FR")} h / semaine`} />
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Jours travaillés</p>
                  {joursModele.length > 0 ? (
                    <div className="mt-1 flex gap-1.5">
                      {["L", "M", "M", "J", "V", "S", "D"].map((lettre, i) => {
                        const jsJour = (i + 1) % 7; // 0=lun → jour JS 1 … 6=dim → jour JS 0
                        const travaille = joursModele.includes(jsJour);
                        return (
                          <span
                            key={i}
                            title={["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"][i]}
                            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                              travaille ? "bg-teal-600 text-white" : "border text-muted-foreground"
                            }`}
                          >
                            {lettre}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Modèle hebdo non défini — réglable dans Planning → Modèle hebdo.</p>
                  )}
                </div>
              </div>
            </BlocContrat>

            {/* Fichier du contrat + attestation + génération PDF */}
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <ContratViewerButton href={`/employes/${employeeId}/contrat/${c.id}`} titre={`Contrat — ${c.type} · ${c.poste}`} libelle="Générer le contrat (PDF)" className="text-sm font-medium text-primary underline" />
              {c.accepteLe && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800" title={c.pdfAccepteUrl ? "Le PDF servi est l'exemplaire figé au moment de l'acceptation — il fait foi." : undefined}>
                  Accepté par le salarié le {d(c.accepteLe)}{c.pdfAccepteUrl ? " · exemplaire figé" : ""}
                </span>
              )}
              {c.documentUrl && (
                <a href={c.documentUrl} target="_blank" className="text-sm text-primary underline">Ouvrir la pièce jointe →</a>
              )}
              {c.type === "STAGE" && (
                <a href={`/employes/${employeeId}/attestation-stage`} download className="text-sm font-medium text-primary underline">
                  Attestation de fin de stage →
                </a>
              )}
              <ContratViewerButton href={`/employes/${employeeId}/attestation/travail`} titre="Attestation de travail" libelle="Attestation de travail (PDF)" className="text-sm font-medium text-primary underline" />
              <ContratViewerButton href={`/employes/${employeeId}/attestation/salaire`} titre="Attestation de salaire" libelle="Attestation de salaire (PDF)" className="text-sm font-medium text-primary underline" />
              {estAdmin && (
                // Joindre / remplacer à tout moment le fichier d'un contrat déjà créé (PDF, Word…) — Direction.
                <form action={attacherFichierContrat.bind(null, employeeId, c.id)} className="flex flex-wrap items-center gap-2">
                  <input type="file" name="fichier" required accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="max-w-52 text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs" />
                  <button className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">{c.documentUrl ? "Remplacer" : "Joindre"}</button>
                </form>
              )}
            </div>

            {peutModifier && (() => {
              const iso = (x: Date | null | undefined) => (x ? new Date(x).toISOString().slice(0, 10) : "");
              return (
              <details className="rounded-lg border bg-muted/20">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">✎ Corriger les conditions actuelles</summary>
                <div className="p-3 pt-1">
                  <p className="mb-2 text-xs text-muted-foreground">Rectification directe du contrat actif (sans créer d&apos;historique). La fiche employé (type, poste, salaire) est mise à jour.</p>
                  <form action={modifierContrat.bind(null, c.id)} className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
                    <input type="hidden" name="retour" value={`/employes/${employeeId}`} />
                    <label className="flex flex-col gap-0.5">Type de contrat
                      <select name="type" defaultValue={c.type} className={inputCls}>
                        {["CDI", "CDD", "STAGE", "JOURNALIER", "INTERIM"].map((t) => <option key={t} value={t}>{TYPE_CONTRAT_LABEL[t] ?? t}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">Poste
                      <input type="text" name="poste" required defaultValue={c.poste} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Date de début
                      <input type="date" name="dateDebut" required defaultValue={iso(c.dateDebut)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Date de fin <span className="text-muted-foreground">(vide si CDI)</span>
                      <input type="date" name="dateFin" defaultValue={iso(c.dateFin)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Fin de période d&apos;essai
                      <input type="date" name="finPeriodeEssai" defaultValue={iso(c.finPeriodeEssai)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Heures / semaine
                      <input type="number" name="heuresHebdo" step="0.5" min="1" defaultValue={Number(c.heuresHebdo)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Salaire mensuel brut
                      <input type="number" name="salaireMensuel" step="0.01" min="0" required defaultValue={Number(c.salaireMensuel)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Devise
                      <select name="devise" defaultValue={c.devise} className={inputCls}>
                        {["USD", "CDF"].map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </label>
                    {c.type === "INTERIM" && (
                      <>
                        <label className="flex flex-col gap-0.5">Agence d&apos;intérim
                          <input type="text" name="agence" defaultValue={c.agence ?? ""} className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-0.5">Coût / jour facturé ($)
                          <input type="number" name="coutJourUSD" step="0.01" min="0" defaultValue={c.coutJourUSD ? Number(c.coutJourUSD) : ""} className={inputCls} />
                        </label>
                      </>
                    )}
                    <div className="col-span-2 md:col-span-3">
                      <button className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Enregistrer les corrections</button>
                    </div>
                  </form>
                </div>
              </details>
              );
            })()}

            {peutModifier && (
              <details className="rounded-lg border bg-muted/20">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">＋ Nouvelles conditions — transformer · prolonger · période d&apos;essai</summary>
                <div className="space-y-3 p-3 pt-1">
                  {/* Transformation historisée : l'ancien contrat reste lisible (statut TRANSFORMÉ). */}
                  <form action={transformerContrat.bind(null, c.id)} className="flex flex-wrap items-end gap-2 text-xs">
                    <input type="hidden" name="retour" value={`/employes/${employeeId}`} />
                    <label className="flex flex-col gap-0.5">Nouveau type
                      <select name="type" defaultValue={c.type === "CDI" ? "CDD" : "CDI"} className={inputCls}>
                        {["CDI", "CDD"].filter((t) => t !== c.type).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">Début du nouveau contrat
                      <input type="date" name="dateDebut" defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} />
                    </label>
                    <label className="flex flex-col gap-0.5">Fin (si CDD)
                      <input type="date" name="dateFin" className={inputCls} />
                    </label>
                    <button className="rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground">Transformer</button>
                    <span className="text-muted-foreground">L&apos;ancien contrat reste dans l&apos;historique.</span>
                  </form>
                  {c.dateFin && (
                    <form action={prolongerContrat.bind(null, c.id)} className="flex flex-wrap items-end gap-2 text-xs">
                      <input type="hidden" name="retour" value={`/employes/${employeeId}`} />
                      <label className="flex flex-col gap-0.5">Nouvelle date de fin
                        <input type="date" name="dateFin" required className={inputCls} />
                      </label>
                      <button className="rounded-md border px-2.5 py-1.5 font-medium hover:bg-accent">Prolonger le contrat</button>
                      {c.type === "CDD" && <span className="text-muted-foreground">Compté et borné (Code du travail — Barèmes).</span>}
                    </form>
                  )}
                  {c.finPeriodeEssai && (
                    <form action={prolongerEssai.bind(null, c.id)} className="flex flex-wrap items-end gap-2 text-xs">
                      <input type="hidden" name="retour" value={`/employes/${employeeId}`} />
                      <label className="flex flex-col gap-0.5">Nouvelle fin d&apos;essai
                        <input type="date" name="finPeriodeEssai" required className={inputCls} />
                      </label>
                      <button className="rounded-md border px-2.5 py-1.5 font-medium hover:bg-accent">Prolonger l&apos;essai</button>
                      <span className="text-muted-foreground">Bornée à la durée légale maximale.</span>
                    </form>
                  )}
                </div>
              </details>
            )}
          </div>
          );
        })()}
      </Section>

      {/* Historique des contrats (transformés, expirés, résiliés…) */}
      {anciens.length > 0 && (
        <Section title={`Historique (${anciens.length} contrat${anciens.length > 1 ? "s" : ""})`}>
          <div className="grid gap-3 md:grid-cols-2">
            {anciens.map((c) => (
              <div key={c.id} className="rounded-xl border bg-card p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.type} <span className="font-normal text-muted-foreground">· {c.poste}</span></p>
                    <p className="text-sm text-muted-foreground">
                      du {d(c.dateDebut)} {c.dateFin ? `au ${d(c.dateFin)}` : "(indéterminé)"}
                      {c.renouvellements > 0 ? ` · prolongé ${c.renouvellements} fois` : ""}
                    </p>
                    {c.agence && (
                      <p className="text-xs text-muted-foreground">
                        Agence : <b>{c.agence}</b>{c.coutJourUSD ? ` · ${Number(c.coutJourUSD).toLocaleString("fr-FR")} $/jour facturé` : ""} — payé par l&apos;agence (hors paie)
                      </p>
                    )}
                  </div>
                  <StatutContratBadge statut={c.statut} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Salaire mensuel</p>
                    <p className="font-medium">{Number(c.salaireMensuel).toLocaleString("fr-FR")} {c.devise}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fin de période d&apos;essai</p>
                    <p className="font-medium">{d(c.finPeriodeEssai)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-2">
                  <ContratViewerButton href={`/employes/${employeeId}/contrat/${c.id}`} titre={`Contrat — ${c.type} · ${c.poste}`} libelle="Générer le contrat (PDF)" className="text-sm font-medium text-primary underline" />
                  {c.accepteLe && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Accepté le {d(c.accepteLe)}</span>}
                  {c.documentUrl && (
                    <a href={c.documentUrl} target="_blank" className="text-sm text-primary underline">Pièce jointe →</a>
                  )}
                  {c.type === "STAGE" && (
                    <a href={`/employes/${employeeId}/attestation-stage`} download className="text-sm font-medium text-primary underline">
                      Attestation de fin de stage →
                    </a>
                  )}
                  {estAdmin && (
                    <form action={attacherFichierContrat.bind(null, employeeId, c.id)} className="flex flex-wrap items-center gap-2">
                      <input type="file" name="fichier" required accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="max-w-52 text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs" />
                      <button className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">{c.documentUrl ? "Remplacer" : "Joindre"}</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {peutModifier && (
      <Section title="Nouveau contrat">
          <details className="rounded-lg border bg-muted/20">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Ajouter / importer un contrat</summary>
            <form action={ajouterContrat.bind(null, employeeId)} className="grid grid-cols-1 gap-3 p-4 pt-0 sm:grid-cols-2 md:grid-cols-4">
              <LabeledInput name="type" label="Type" select defaultValue="CDD" options={["CDD", "CDI", "STAGE", "JOURNALIER", "INTERIM"]} />
              <LabeledInput name="poste" label="Poste" defaultValue={poste} required />
              <LabeledInput name="dateDebut" label="Début" type="date" required />
              <LabeledInput name="dateFin" label="Fin (CDD)" type="date" />
              <LabeledInput name="finPeriodeEssai" label="Fin période d'essai" type="date" />
              <LabeledInput name="salaireMensuel" label="Salaire mensuel" type="number" step="0.01" defaultValue={salaireMensuel} />
              <LabeledInput name="heuresHebdo" label="Heures / semaine" type="number" step="0.5" defaultValue="48" />
              <LabeledInput name="agence" label="Agence (intérim) — qui l'emploie et le paie" />
              <LabeledInput name="coutJourUSD" label="Coût / jour facturé $ (intérim)" type="number" step="0.01" />
              <div className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Fichier du contrat (PDF, Word… max 15 Mo)</span>
                <input type="file" name="fichier" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" className={inputCls} />
              </div>
              <LabeledInput name="documentUrl" label="…ou URL du contrat (optionnel)" />
              <div className="sm:col-span-2 md:col-span-4">
                <SubmitBtn>Ajouter / importer le contrat</SubmitBtn>
              </div>
            </form>
          </details>
      </Section>
      )}
      </>
        );
      })()}

      {vue === "dossier" && (
      <>
      {/* Prêts au personnel */}
      <Section title="Prêts au personnel">
        {prets.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun prêt.</p>
        ) : (
          <ul className="mb-4 divide-y">
            {prets.map((p) => {
              const pct = p.montant > 0 ? Math.min(100, Math.round((p.rembourse / p.montant) * 100)) : 0;
              return (
                <li key={p.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {p.montant.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $ · retenue {p.retenueMensuelle.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $/mois
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${p.statut === "SOLDE" ? "bg-emerald-100 text-emerald-800" : p.statut === "ANNULE" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800"}`}>
                          {p.statut === "SOLDE" ? "Soldé" : p.statut === "ANNULE" ? "Annulé" : "En cours"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">{p.motif ? `${p.motif} · ` : ""}accordé le {d(p.dateAccord)} · {p.nbRetenues} retenue(s)</p>
                    </div>
                    <div className="min-w-[9rem] text-right">
                      <p className="text-sm font-semibold">Solde : {p.solde.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $</p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    </div>
                  </div>
                  {estAdmin && p.statut === "EN_COURS" && (
                    <form action={annulerPret.bind(null, employeeId, p.id)} className="mt-1">
                      <button className="text-xs text-destructive underline">Annuler le prêt (arrête les retenues futures)</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {peutModifier && (
          <form action={creerPret.bind(null, employeeId)} className="flex flex-wrap items-end gap-2 border-t pt-3 text-xs">
            <label className="flex flex-col gap-0.5">Montant du prêt ($)
              <input type="number" name="montantUSD" step="0.01" min="0" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-0.5">Retenue mensuelle ($)
              <input type="number" name="retenueMensuelleUSD" step="0.01" min="0" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-0.5">Motif (optionnel)
              <input type="text" name="motif" placeholder="ex. avance médicale" className={inputCls} />
            </label>
            <SubmitBtn>Accorder le prêt</SubmitBtn>
          </form>
        )}
        <p className="mt-2 text-xs text-muted-foreground">La retenue est déduite automatiquement du salaire net chaque mois (ligne « Retenue prêt » sur le bulletin) jusqu&apos;au remboursement complet.</p>
      </Section>

      {/* Intégration (onboarding) */}
      <Section title="Intégration (onboarding)">
        {tachesOnboarding.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="mb-2">Aucune checklist d&apos;intégration pour ce salarié.</p>
            {peutModifier && (
              <form action={genererOnboarding.bind(null, employeeId)}>
                <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Générer la checklist d&apos;intégration</button>
              </form>
            )}
          </div>
        ) : (() => {
          const faites = tachesOnboarding.filter((t) => t.fait).length;
          const pct = Math.round((faites / tachesOnboarding.length) * 100);
          return (
            <>
              <div className="mb-3 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">{faites}/{tachesOnboarding.length} · {pct}%</span>
              </div>
              <ul className="divide-y">
                {tachesOnboarding.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <span className={t.fait ? "text-sm text-muted-foreground line-through" : "text-sm"}>{t.libelle}</span>
                    {peutModifier ? (
                      <form action={basculerTacheOnboarding.bind(null, employeeId, t.id)}>
                        <button className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${t.fait ? "border-emerald-300 text-emerald-700" : "text-primary hover:bg-accent"}`}>{t.fait ? "✓ Fait" : "Marquer fait"}</button>
                      </form>
                    ) : t.fait ? <span className="text-xs text-emerald-700">✓</span> : null}
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
      </Section>

      {/* Historique salarial */}
      <Section title="Historique salarial & promotions">
        {historique.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucun changement enregistré.
          </p>
        ) : (
          <ol className="relative mb-4 ml-2 border-l pl-6">
            {historique.map((h) => {
              const ancien = h.ancienSalaire != null ? Number(h.ancienSalaire) : null;
              const nouveau = Number(h.nouveauSalaire);
              const delta = ancien != null && ancien > 0 ? ((nouveau - ancien) / ancien) * 100 : null;
              return (
                <li key={h.id} className="mb-4 last:mb-0">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" aria-hidden />
                  <p className="text-xs text-muted-foreground">{d(h.date)}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{h.motif}</span>
                    <span className="text-sm font-medium">
                      {ancien != null ? `${money(ancien)} → ` : ""}{money(nouveau)}
                    </span>
                    {delta != null && delta !== 0 && (
                      <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${delta > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {delta > 0 ? "▲ +" : "▼ "}{delta.toFixed(1).replace(".", ",")} %
                      </span>
                    )}
                  </div>
                  {(h.ancienPoste || h.nouveauPoste) && h.ancienPoste !== h.nouveauPoste && (
                    <p className="text-xs text-muted-foreground">
                      {h.ancienPoste ?? "—"} → {h.nouveauPoste ?? "—"}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {estAdmin && (
          <form action={changerSalaire.bind(null, employeeId)} className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4">
            <p className="w-full text-sm font-medium">Changer le salaire / poste (tracé à l&apos;historique)</p>
            <input name="nouveauSalaire" type="number" step="0.01" placeholder="Nouveau salaire $" defaultValue={salaireMensuel} className={inputCls} required />
            <input name="nouveauPoste" placeholder="Nouveau poste (optionnel)" defaultValue={poste} className={inputCls} />
            <select name="motif" className={inputCls} defaultValue="Ajustement">
              <option>Ajustement</option>
              <option>Promotion</option>
              <option>Sanction</option>
            </select>
            <SubmitBtn>Enregistrer le changement</SubmitBtn>
          </form>
        )}
      </Section>

      {/* Dossier disciplinaire */}
      <Section title="Dossier disciplinaire">
        {disciplinaire.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucune sanction ni avertissement. ✔
          </p>
        ) : (
          <div className="mb-4 space-y-2">
            {disciplinaire.map((s) => (
              <div key={s.id} className={`flex flex-wrap items-start gap-3 rounded-xl border border-l-4 bg-card p-3 ${BORDURE_DISCIPLINAIRE[s.type] ?? "border-l-slate-300"}`}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_DISCIPLINAIRE[s.type]?.classe ?? "bg-muted"}`}>
                  {BADGE_DISCIPLINAIRE[s.type]?.label ?? s.type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.motif}</p>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                </div>
                <span className="text-xs text-muted-foreground">{d(s.date)}</span>
              </div>
            ))}
          </div>
        )}
        {peutModifier && (
          <form action={ajouterDisciplinaire.bind(null, employeeId)} className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-4 md:grid-cols-4">
            <p className="col-span-2 text-sm font-medium md:col-span-4">Ajouter un avertissement / une sanction</p>
            <select name="type" className={inputCls} defaultValue="AVERTISSEMENT">
              <option value="AVERTISSEMENT">Avertissement</option>
              <option value="SANCTION">Sanction</option>
              <option value="MISE_A_PIED">Mise à pied</option>
              <option value="MESURE">Mesure</option>
            </select>
            <LabeledInput name="date" label="Date" type="date" required />
            <input name="motif" placeholder="Motif" className={inputCls} required />
            <input name="documentUrl" placeholder="URL pièce" className={inputCls} />
            <input name="description" placeholder="Description (optionnel)" className={`${inputCls} col-span-2 md:col-span-3`} />
            <div className="col-span-2 md:col-span-4">
              <SubmitBtn>Ajouter</SubmitBtn>
            </div>
          </form>
        )}
      </Section>

      {/* Évaluations */}
      <Section title="Évaluations">
        {evaluations.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucune évaluation.
          </p>
        ) : (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {evaluations.map((e) => {
              const note = e.note !== null ? Number(e.note) : null;
              const couleurNote = note === null ? "" : note >= 70 ? "text-emerald-700" : note >= 40 ? "text-amber-700" : "text-red-700";
              const barre = note === null ? "" : note >= 70 ? "bg-emerald-500" : note >= 40 ? "bg-amber-500" : "bg-red-500";
              return (
                <div key={e.id} className="rounded-xl border bg-card p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{d(e.date)}{e.evaluateur ? ` · par ${e.evaluateur}` : ""}</span>
                    <span className={`text-lg font-bold ${couleurNote}`}>{note !== null ? `${note}/100` : "—"}</span>
                  </div>
                  {note !== null && (
                    <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${barre}`} style={{ width: `${note}%` }} />
                    </div>
                  )}
                  {e.commentaire && <p className="text-sm text-muted-foreground">{e.commentaire}</p>}
                </div>
              );
            })}
          </div>
        )}
        {peutModifier && (
          <form action={ajouterEvaluation.bind(null, employeeId)} className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4">
            <p className="w-full text-sm font-medium">Ajouter une évaluation</p>
            <LabeledInput name="date" label="Date" type="date" required />
            <input name="note" type="number" min="0" max="100" placeholder="Note /100" className={`${inputCls} w-24`} />
            <input name="evaluateur" placeholder="Évaluateur" className={inputCls} />
            <input name="commentaire" placeholder="Commentaire" className={`${inputCls} flex-1`} />
            <SubmitBtn>Ajouter</SubmitBtn>
          </form>
        )}
      </Section>

      {/* Documents */}
      <Section title="Documents">
        {documents.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucun document importé.
          </p>
        ) : (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((doc) => {
              const expire = doc.dateExpiration && new Date(doc.dateExpiration) <= dans30j;
              return (
                <a
                  key={doc.id}
                  href={doc.fichierUrl}
                  target="_blank"
                  className="group flex gap-3 rounded-xl border bg-card p-3 transition hover:border-primary hover:shadow-sm"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium group-hover:text-primary">{doc.nom}</p>
                    <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                      {TYPE_DOC_LABEL[doc.type] ?? doc.type}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {doc.dateEmission ? `Émis le ${d(doc.dateEmission)}` : "Sans date"}
                      {doc.dateExpiration && (
                        <span className={expire ? "font-semibold text-amber-700" : ""}> · exp. {d(doc.dateExpiration)}</span>
                      )}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        )}
        {peutModifier && (
          <form action={ajouterDocument.bind(null, employeeId)} className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-4 md:grid-cols-4">
            <p className="col-span-2 text-sm font-medium md:col-span-4">Importer un document</p>
            <select name="type" className={inputCls} defaultValue="CONTRAT">
              <option value="CONTRAT">Contrat</option>
              <option value="CARTE_IDENTITE">Carte d&apos;identité</option>
              <option value="DIPLOME">Diplôme</option>
              <option value="PHOTO">Photo</option>
              <option value="CV">CV</option>
              <option value="CERTIFICAT_MEDICAL">Certificat médical</option>
              <option value="AVERTISSEMENT">Avertissement</option>
              <option value="LETTRE">Lettre</option>
              <option value="AUTRE">Autre</option>
            </select>
            <input name="nom" placeholder="Nom du document" className={inputCls} required />
            <input
              type="file"
              name="fichier"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
              className={`${inputCls} col-span-2`}
            />
            <input name="fichierUrl" placeholder="…ou URL du fichier (optionnel)" className={inputCls} />
            <LabeledInput name="dateEmission" label="Émission" type="date" />
            <LabeledInput name="dateExpiration" label="Expiration" type="date" />
            <p className="col-span-2 text-xs text-muted-foreground md:col-span-4">
              Téléversez le fichier (contrat, pièce…) — PDF, image, Word ou Excel (max 15 Mo). Une URL
              externe reste possible.
            </p>
            <div className="col-span-2 md:col-span-4">
              <SubmitBtn>Ajouter le document</SubmitBtn>
            </div>
          </form>
        )}
      </Section>
      </>
      )}

      {/* Fin de contrat & solde de tout compte */}
      {vue === "fin" && (
      <Section title="Fin de contrat & solde de tout compte">
        {finContrats.length > 0 && (
          <div className="mb-4 max-h-[70vh] overflow-auto rounded-lg border">
            <table className="w-full text-sm [&_td]:px-3 [&_th]:px-3">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Date</th>
                  <th className="py-1">Motif</th>
                  <th className="py-1 text-right">Prorata</th>
                  <th className="py-1 text-right">Congés</th>
                  <th className="py-1 text-right">Préavis</th>
                  <th className="py-1 text-right">Licenciement</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {finContrats.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="py-1.5">{d(f.dateFin)}</td>
                    <td className="py-1.5">{MOTIF_FIN[f.motif] ?? f.motif}</td>
                    <td className="py-1.5 text-right">{money(Number(f.salaireProrataUSD))}</td>
                    <td className="py-1.5 text-right">{money(Number(f.indemniteCongesUSD))}</td>
                    <td className="py-1.5 text-right">{money(Number(f.indemnitePreavisUSD))}</td>
                    <td className="py-1.5 text-right">{money(Number(f.indemniteLicenciementUSD))}</td>
                    <td className="py-1.5 text-right font-semibold">{money(Number(f.totalUSD))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {estAdmin && actif ? (
          <FinContratForm
            employeeId={employeeId}
            salaireJournalier={salaireJournalier}
            soldeCongesInit={soldeConges}
            joursPresence={joursPresence}
            ancienneteMois={ancienneteMois}
            preavisDemission={preavisDemission}
            preavisLicenciement={preavisLicenciement}
            indemniteLicenciementJoursParAn={indemniteLicenciementJoursParAn}
          />
        ) : !actif ? (
          <p className="text-sm text-muted-foreground">Cet employé n&apos;est plus actif (contrat terminé).</p>
        ) : (
          <p className="text-sm text-muted-foreground">Seule la Direction peut clôturer un contrat.</p>
        )}
      </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-lg border p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function LabeledInput({
  name,
  label,
  type = "text",
  required,
  defaultValue,
  step,
  select,
  options,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  step?: string;
  select?: boolean;
  options?: string[];
}) {
  return (
    <label className="flex flex-col text-xs text-muted-foreground">
      {label}
      {select ? (
        <select name={name} defaultValue={defaultValue as string} className={inputCls}>
          {(options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input name={name} type={type} step={step} required={required} defaultValue={defaultValue} className={inputCls} />
      )}
    </label>
  );
}

function SubmitBtn({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
    >
      {children}
    </button>
  );
}
