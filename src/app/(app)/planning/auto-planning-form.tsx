"use client";

import { useState, useTransition } from "react";
import { genererPlanningAuto, type ResumeGeneration } from "./actions";

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
                  Automatique : secteur Cuisine → Matin cuisine · Salle → Matin/midi salle · Caissière →
                  Caisse · autres → Journée 8h-17h. Le shift Admin n&apos;est jamais affecté automatiquement
                  (réservé, via le modèle d&apos;Aimée).
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

              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="inclureFeries" /> Couvrir aussi les jours fériés
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="ecraser" /> Écraser et régénérer toute la période
              </label>

              <button disabled={isPending} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {isPending ? "Génération…" : "Générer le planning"}
              </button>
              {resume && (
                <div className={`space-y-1 rounded-md border p-2 text-xs ${resume.besoinsNonCouverts > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
                  <p className="font-semibold">{resume.crees} créneau(x) créé(s)</p>
                  {resume.besoinsNonCouverts > 0 && (
                    <>
                      <p>{resume.besoinsNonCouverts} besoin(s) NON couvert(s) :</p>
                      <ul className="list-inside list-disc">{resume.detailNonCouverts.map((l, i) => <li key={i}>{l}</li>)}</ul>
                    </>
                  )}
                  {resume.sousHeures > 0 && <p>{resume.sousHeures} salarié(s) sous leurs heures hebdo (congés compris).</p>}
                  {resume.besoinsNonCouverts === 0 && resume.crees > 0 && <p>Tous les besoins sont couverts ✅</p>}
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
