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
  changerSalaire,
  ajouterDisciplinaire,
  ajouterEvaluation,
  ajouterDocument,
} from "./dossier-actions";
import { FinContratForm } from "./fin-contrat-form";

const MOTIF_FIN: Record<string, string> = {
  DEMISSION: "Démission",
  LICENCIEMENT: "Licenciement",
  FIN_CDD: "Fin de CDD",
  AUTRE: "Autre",
};
const money = (n: number) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

const STATUT_CONTRAT: Record<string, { label: string; classe: string }> = {
  ACTIF: { label: "Actif", classe: "bg-emerald-100 text-emerald-800" },
  EXPIRE: { label: "Expiré", classe: "bg-amber-100 text-amber-800" },
  RESILIE: { label: "Résilié", classe: "bg-red-100 text-red-800" },
};
function StatutContratBadge({ statut }: { statut: string }) {
  const s = STATUT_CONTRAT[statut] ?? { label: statut, classe: "bg-muted text-muted-foreground" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.classe}`}>{s.label}</span>;
}

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

const inputCls =
  "rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

export function DossierEmploye({
  vue,
  employeeId,
  poste,
  salaireMensuel,
  salaireJournalier,
  soldeConges,
  joursPresence,
  ancienneteMois,
  preavisDemission,
  preavisLicenciement,
  indemniteLicenciementJoursParAn,
  actif,
  contrats,
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
  salaireMensuel: number;
  salaireJournalier: number;
  soldeConges: number;
  joursPresence: number;
  ancienneteMois: number;
  preavisDemission: number | null;
  preavisLicenciement: number | null;
  indemniteLicenciementJoursParAn: number | null;
  actif: boolean;
  contrats: Contrat[];
  historique: HistoriqueSalaire[];
  disciplinaire: DossierDisciplinaire[];
  evaluations: Evaluation[];
  documents: DocumentEmploye[];
  finContrats: FinContrat[];
  peutModifier: boolean;
  estAdmin: boolean;
}) {
  const dans30j = new Date(Date.now() + 30 * 86400000);
  const aujourdhui = new Date();

  return (
    <>
      {vue === "contrats" && (
      <>
      {/* Contrats */}
      <Section title="Contrats">
        {contrats.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucun contrat enregistré.
          </p>
        ) : (
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            {contrats.map((c) => {
              const expireBientot = c.dateFin && new Date(c.dateFin) <= dans30j && new Date(c.dateFin) >= aujourdhui;
              const essaiBientot = c.finPeriodeEssai && new Date(c.finPeriodeEssai) <= dans30j && new Date(c.finPeriodeEssai) >= aujourdhui;
              return (
                <div key={c.id} className="rounded-xl border bg-card p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{c.type} <span className="font-normal text-muted-foreground">· {c.poste}</span></p>
                      <p className="text-sm text-muted-foreground">
                        du {d(c.dateDebut)} {c.dateFin ? `au ${d(c.dateFin)}` : "(indéterminé)"}
                      </p>
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
                      <p className={`font-medium ${essaiBientot ? "text-amber-700" : ""}`}>{d(c.finPeriodeEssai)}</p>
                    </div>
                  </div>
                  {(expireBientot || essaiBientot) && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                      {expireBientot ? "Contrat arrivant à échéance (30 j)" : "Fin de période d'essai proche (30 j)"}
                    </p>
                  )}
                  <div className="mt-3 border-t pt-2">
                    {c.documentUrl ? (
                      <a href={c.documentUrl} target="_blank" className="text-sm font-medium text-primary underline">Ouvrir le contrat →</a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Aucun fichier joint</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {peutModifier && (
          <form action={ajouterContrat.bind(null, employeeId)} className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-4 md:grid-cols-4">
            <p className="col-span-2 text-sm font-medium md:col-span-4">Ajouter / importer un contrat</p>
            <select name="type" className={inputCls} defaultValue="CDD">
              <option value="CDD">CDD</option>
              <option value="CDI">CDI</option>
              <option value="STAGE">Stage</option>
              <option value="JOURNALIER">Journalier</option>
            </select>
            <input name="poste" placeholder="Poste" defaultValue={poste} className={inputCls} required />
            <LabeledInput name="dateDebut" label="Début" type="date" required />
            <LabeledInput name="dateFin" label="Fin (CDD)" type="date" />
            <LabeledInput name="finPeriodeEssai" label="Fin période d'essai" type="date" />
            <input name="salaireMensuel" type="number" step="0.01" placeholder="Salaire" defaultValue={salaireMensuel} className={inputCls} />
            <input name="heuresHebdo" type="number" step="0.5" placeholder="H/sem" defaultValue={48} className={inputCls} />
            <div className="col-span-2 flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">Fichier du contrat (PDF, Word… max 15 Mo)</span>
              <input type="file" name="fichier" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" className={inputCls} />
            </div>
            <input name="documentUrl" placeholder="…ou URL du contrat (optionnel)" className={inputCls} />
            <div className="col-span-2 md:col-span-4">
              <SubmitBtn>Ajouter / importer le contrat</SubmitBtn>
            </div>
          </form>
        )}
      </Section>
      </>
      )}

      {vue === "dossier" && (
      <>
      {/* Historique salarial */}
      <Section title="Historique salarial & promotions">
        <table className="mb-3 w-full text-sm [&_td]:px-3 [&_th]:px-3">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Date</th>
              <th className="py-1">Motif</th>
              <th className="py-1">Ancien poste</th>
              <th className="py-1">Nouveau poste</th>
              <th className="py-1 text-right">Ancien salaire</th>
              <th className="py-1 text-right">Nouveau salaire</th>
            </tr>
          </thead>
          <tbody>
            {historique.map((h) => (
              <tr key={h.id} className="border-t">
                <td className="py-1.5">{d(h.date)}</td>
                <td className="py-1.5">{h.motif}</td>
                <td className="py-1.5">{h.ancienPoste ?? "—"}</td>
                <td className="py-1.5">{h.nouveauPoste ?? "—"}</td>
                <td className="py-1.5 text-right">
                  {h.ancienSalaire ? Number(h.ancienSalaire).toLocaleString("fr-FR") + " $" : "—"}
                </td>
                <td className="py-1.5 text-right">{Number(h.nouveauSalaire).toLocaleString("fr-FR")} $</td>
              </tr>
            ))}
            {historique.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-muted-foreground">
                  Aucun changement enregistré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {estAdmin && (
          <form action={changerSalaire.bind(null, employeeId)} className="flex flex-wrap items-end gap-2">
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
        <table className="mb-3 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Date</th>
              <th className="py-1">Type</th>
              <th className="py-1">Motif</th>
              <th className="py-1">Description</th>
            </tr>
          </thead>
          <tbody>
            {disciplinaire.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-1.5">{d(s.date)}</td>
                <td className="py-1.5">{s.type}</td>
                <td className="py-1.5">{s.motif}</td>
                <td className="py-1.5">{s.description ?? "—"}</td>
              </tr>
            ))}
            {disciplinaire.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-muted-foreground">
                  Aucune sanction ni avertissement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {peutModifier && (
          <form action={ajouterDisciplinaire.bind(null, employeeId)} className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
        <table className="mb-3 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Date</th>
              <th className="py-1 text-right">Note</th>
              <th className="py-1">Évaluateur</th>
              <th className="py-1">Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="py-1.5">{d(e.date)}</td>
                <td className="py-1.5 text-right">{e.note !== null ? `${e.note}/100` : "—"}</td>
                <td className="py-1.5">{e.evaluateur ?? "—"}</td>
                <td className="py-1.5">{e.commentaire ?? "—"}</td>
              </tr>
            ))}
            {evaluations.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-muted-foreground">
                  Aucune évaluation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {peutModifier && (
          <form action={ajouterEvaluation.bind(null, employeeId)} className="flex flex-wrap items-end gap-2">
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
          <div className="mb-4 overflow-x-auto rounded-lg border">
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
  type,
  required,
}: {
  name: string;
  label: string;
  type: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col text-xs text-muted-foreground">
      {label}
      <input name={name} type={type} required={required} className={inputCls} />
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
