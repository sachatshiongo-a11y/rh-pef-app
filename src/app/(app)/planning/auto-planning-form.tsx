"use client";

import { useState, useTransition } from "react";
import { genererPlanningAuto, type ResumeGeneration } from "./actions";

const LIBELLE_RAISON: Record<ResumeGeneration["trous"][number]["raison"], string> = {
  AUCUN_TITULAIRE: "personne à ce poste, ni en polyvalence",
  EFFECTIF_INSUFFISANT: "tous les disponibles ont été posés, il en manquait encore",
  TOUS_EN_CONGE: "tous en congé",
  TOUS_DEJA_PRIS: "tous déjà pris ce jour-là",
  TOUS_AU_REPOS: "tous au repos obligatoire",
  TOUS_AU_PLAFOND: "tous au plafond d'heures — cochez « autoriser le dépassement » pour couvrir",
};

const JOURS = [
  { v: 1, l: "Lun" },
  { v: 2, l: "Mar" },
  { v: 3, l: "Mer" },
  { v: 4, l: "Jeu" },
  { v: 5, l: "Ven" },
  { v: 6, l: "Sam" },
  { v: 0, l: "Dim" },
];

export function AutoPlanningForm({
  debut,
  fin,
  shifts,
}: {
  debut: string;
  fin: string;
  shifts: { id: string; nom: string }[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const [resume, setResume] = useState<ResumeGeneration | null>(null);
  const [isPending, start] = useTransition();

  return (
    <div className="relative">
      <button onClick={() => setOuvert((o) => !o)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
        Générer automatiquement
      </button>

      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border bg-card p-4 shadow-lg">
            <p className="mb-3 text-sm font-semibold">Paramètres de génération</p>
            <form
              action={(fd) => { setResume(null); start(async () => setResume(await genererPlanningAuto(debut, fin, fd))); }}
              className="space-y-3 text-sm"
            >
              {/* Le cœur : chaque employé reçoit TOUS les shifts de son modèle hebdo (rôle par jour,
                  semaine A/B), selon ses heures et infos. */}
              <label className="flex items-start gap-2 rounded-md bg-primary/5 p-2 text-xs">
                <input type="checkbox" name="modeles" value="on" defaultChecked className="mt-0.5" />
                <span>
                  <span className="font-medium">Suivre les modèles hebdomadaires</span> — affecte à chaque
                  employé ses rôles/shifts par jour (Caisse, Matin cuisine, Soir salle…), y compris
                  l&apos;alternance semaine A/B, d&apos;après son modèle et ses heures.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Shift par défaut — employés SANS modèle</span>
                <select name="shiftId" defaultValue="" className="rounded border border-input bg-background px-2 py-1.5">
                  <option value="">Automatique — selon la fiche (cuisine / salle / caisse)</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>{s.nom}</option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">
                  Automatique : chaque poste reçoit le shift déclaré pour lui dans « Shifts par poste »
                  (le premier de sa liste de préférence). Un poste sans shift déclaré n&apos;est pas
                  planifié automatiquement — configurez-le dans « Shifts par poste ».
                </span>
              </label>

              <div>
                <span className="text-xs text-muted-foreground">Jours à couvrir (repli sans modèle)</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {JOURS.map((j) => (
                    <label key={j.v} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                      <input type="checkbox" name="jours" value={j.v} defaultChecked={j.v !== 0} />
                      {j.l}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Jours / semaine sans modèle (0 = selon les heures)</span>
                <input name="nbParSemaine" type="number" min="0" max="7" defaultValue="0" className="w-16 rounded border border-input bg-background px-2 py-1" />
              </label>

              <label className="flex items-start gap-2 rounded-md bg-primary/5 p-2 text-xs">
                <input type="checkbox" name="completer" value="on" defaultChecked className="mt-0.5" />
                <span>
                  <span className="font-medium">Compléter jusqu&apos;aux heures (aucun creux)</span> — après la
                  couverture des besoins, chaque employé encore sous ses heures hebdo reçoit son shift par
                  défaut sur les jours vides (y compris les postes sans besoin déclaré).
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="inclureFeries" /> Couvrir aussi les jours fériés
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="ecraser" /> Écraser et régénérer toute la période
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" name="depassement" value="on" className="mt-0.5" />
                <span>
                  <span className="font-medium">Autoriser le dépassement d&apos;heures</span> — pour couvrir
                  un besoin resté découvert faute de monde sous son plafond hebdomadaire. Engage des
                  heures supplémentaires : chaque dépassement est listé dans le rapport.
                </span>
              </label>

              <button disabled={isPending} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {isPending ? "Génération…" : "Générer le planning"}
              </button>
              {resume && (
                <div className={`space-y-1.5 rounded-md border p-2 text-xs ${resume.trous.length > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
                  <p className="font-medium">{resume.crees} créneau(x) créé(s).</p>

                  {resume.trous.length === 0 && resume.crees > 0 && <p>Tous les besoins sont couverts ✅</p>}

                  {resume.trous.length > 0 && (
                    <div>
                      <p className="font-medium">{resume.trous.reduce((s, t) => s + t.manque, 0)} besoin(s) non couvert(s) :</p>
                      <ul className="ml-3 list-disc">
                        {resume.trous.slice(0, 6).map((t, i) => (
                          <li key={i}>{t.libelle} : manque {t.manque} — {LIBELLE_RAISON[t.raison]}</li>
                        ))}
                      </ul>
                      {resume.trous.length > 6 && <p className="italic">et {resume.trous.length - 6} autre(s).</p>}
                    </div>
                  )}

                  {resume.sansShiftPoste.length > 0 && (
                    <p>
                      {resume.sansShiftPoste.length} salarié(s) non planifié(s), faute de shift déclaré pour leur
                      poste : {resume.sansShiftPoste.slice(0, 4).map((s) => `${s.nom} (${s.poste})`).join(", ")}
                      {resume.sansShiftPoste.length > 4 ? "…" : ""}. À configurer dans « Shifts par poste ».
                    </p>
                  )}

                  {resume.depassements.length > 0 && (
                    <p className="font-medium">
                      ⚠ Heures supplémentaires engagées pour {resume.depassements.length} salarié(s) :{" "}
                      {resume.depassements.slice(0, 4).map((x) => `${x.nom} (${x.heuresPlanifiees} h au lieu de ${x.heuresContractuelles} h)`).join(", ")}
                      {resume.depassements.length > 4 ? "…" : ""}.
                    </p>
                  )}

                  {resume.sousHeures > 0 && <p>{resume.sousHeures} salarié(s) sous leurs heures hebdo (congés compris).</p>}

                  {resume.shiftsInconnus.length > 0 && (
                    <p>
                      {resume.shiftsInconnus.length} besoin(s) ou modèle(s) ignoré(s) : le shift n&apos;existe
                      plus ou a été désactivé ({resume.shiftsInconnus.slice(0, 4).join(", ")}
                      {resume.shiftsInconnus.length > 4 ? "…" : ""}).
                    </p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Sans « écraser », seuls les créneaux vides sont remplis (vos saisies sont conservées).
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
