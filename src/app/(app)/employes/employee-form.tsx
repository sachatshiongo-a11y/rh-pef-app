"use client";

import { useState } from "react";
import type { Employee } from "@prisma/client";

function toDateInput(d: Date | string | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function EmployeeForm({
  employee,
  action,
  joursOuvrablesMois,
}: {
  employee?: Employee;
  action: (formData: FormData) => void;
  joursOuvrablesMois: number;
}) {
  return (
    <form action={action} className="grid max-w-3xl grid-cols-2 gap-4">
      <Field label="Matricule (auto si vide)" name="matricule" defaultValue={employee?.matricule} />
      <Field label="Nom et prénom" name="nom" defaultValue={employee?.nom} required />

      <Select
        label="Sexe"
        name="sexe"
        defaultValue={employee?.sexe ?? "M"}
        options={[
          { value: "M", label: "M" },
          { value: "F", label: "F" },
        ]}
      />
      <Select
        label="État civil"
        name="etatCivil"
        defaultValue={employee?.etatCivil ?? "Célibataire"}
        options={[
          { value: "Célibataire", label: "Célibataire" },
          { value: "Marié(e)", label: "Marié(e)" },
          { value: "Divorcé(e)", label: "Divorcé(e)" },
          { value: "Veuf(ve)", label: "Veuf(ve)" },
        ]}
      />

      <Field label="Poste" name="poste" defaultValue={employee?.poste} required />
      <Field label="Secteur" name="secteur" defaultValue={employee?.secteur} required />

      <Select
        label="Catégorie"
        name="categorie"
        defaultValue={employee?.categorie ?? "BRIGADE"}
        options={[
          { value: "BRIGADE", label: "Brigade" },
          { value: "BACKOFFICE", label: "Backoffice" },
        ]}
      />
      <Select
        label="Type"
        name="type"
        defaultValue={employee?.type ?? "NATIONAL"}
        options={[
          { value: "NATIONAL", label: "National" },
          { value: "EXPATRIE", label: "Expatrié" },
        ]}
      />

      <SalaireHoraire
        salaireMensuelInit={employee?.salaireMensuel?.toString() ?? ""}
        heuresParJourInit={employee?.heuresParJour?.toString() ?? "8"}
        joursOuvrablesMois={joursOuvrablesMois}
      />
      <Field
        label="Heures hebdomadaires"
        name="heuresHebdomadaires"
        type="number"
        step="0.5"
        defaultValue={employee?.heuresHebdomadaires?.toString() ?? "48"}
      />
      <Field
        label="ID pointeuse IVMS (optionnel)"
        name="idExterneIVMS"
        defaultValue={employee?.idExterneIVMS ?? ""}
      />

      <Field
        label="Transport / jour (CDF)"
        name="transportJourCDF"
        type="number"
        step="0.01"
        defaultValue={employee?.transportJourCDF?.toString()}
      />
      <Field
        label="Transport / mois (CDF)"
        name="transportMoisCDF"
        type="number"
        step="0.01"
        defaultValue={employee?.transportMoisCDF?.toString()}
      />
      <Field
        label="Transport / mois ($)"
        name="transportMoisUSD"
        type="number"
        step="0.01"
        defaultValue={employee?.transportMoisUSD?.toString()}
      />
      <Field
        label="CNSS $"
        name="cnssMontant"
        type="number"
        step="0.01"
        defaultValue={employee?.cnssMontant?.toString()}
      />
      <Field
        label="Frais médicaux du mois ($)"
        name="fraisMedicauxMoisCourant"
        type="number"
        step="0.01"
        defaultValue={employee?.fraisMedicauxMoisCourant?.toString() ?? "0"}
      />

      <Field
        label="Enfants"
        name="enfants"
        type="number"
        defaultValue={employee?.enfants?.toString() ?? "0"}
      />
      <Field label="Contrat" name="contrat" defaultValue={employee?.contrat ?? "CDD"} required />

      <Field
        label="Date d'embauche"
        name="dateEmbauche"
        type="date"
        defaultValue={toDateInput(employee?.dateEmbauche)}
        required
      />
      <Field
        label="Date d'anniversaire"
        name="dateNaissance"
        type="date"
        defaultValue={toDateInput(employee?.dateNaissance ?? undefined)}
      />

      <div className="col-span-2 mt-2 border-t pt-3 text-sm font-semibold text-muted-foreground">
        Coordonnées & informations de paiement
      </div>
      <Field label="Téléphone" name="telephone" defaultValue={employee?.telephone ?? ""} />
      <Field label="E-mail" name="email" type="email" defaultValue={employee?.email ?? ""} />
      <Field label="Adresse" name="adresse" defaultValue={employee?.adresse ?? ""} />
      <Field label="Banque" name="banque" defaultValue={employee?.banque ?? ""} />
      <Field label="Compte bancaire / IBAN" name="compteBancaire" defaultValue={employee?.compteBancaire ?? ""} />
      <Field label="Mobile Money" name="mobileMoney" defaultValue={employee?.mobileMoney ?? ""} />

      <div className="col-span-2 mt-2">
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Enregistrer
        </button>
      </div>
    </form>
  );
}

const champCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Salaire mensuel + heures/jour + taux horaire synchronisés. Le salaire mensuel reste la donnée
 * enregistrée ; le taux horaire = salaire mensuel ÷ (heures/jour × jours ouvrables/mois). Modifier
 * l'un recalcule l'autre en direct.
 */
function SalaireHoraire({
  salaireMensuelInit,
  heuresParJourInit,
  joursOuvrablesMois,
}: {
  salaireMensuelInit: string;
  heuresParJourInit: string;
  joursOuvrablesMois: number;
}) {
  const round2 = (n: number) => (Math.round(n * 100) / 100).toString();
  const round4 = (n: number) => (Math.round(n * 10000) / 10000).toString();

  const heuresMoisInit = (Number(heuresParJourInit) * joursOuvrablesMois || 0).toString();
  const tauxInit =
    Number(salaireMensuelInit) && Number(heuresMoisInit)
      ? round4(Number(salaireMensuelInit) / Number(heuresMoisInit))
      : "";

  const [mensuel, setMensuel] = useState(salaireMensuelInit);
  const [heuresJour, setHeuresJour] = useState(heuresParJourInit);
  const [heuresMois, setHeuresMois] = useState(heuresMoisInit);
  const [taux, setTaux] = useState(tauxInit);

  // Règles de synchronisation (salaire mensuel + heures/jour sont les données enregistrées).
  function onMensuel(v: string) {
    setMensuel(v);
    const hm = Number(heuresMois);
    if (Number(v) && hm) setTaux(round4(Number(v) / hm));
  }
  function onHeuresJour(v: string) {
    setHeuresJour(v);
    const hm = Number(v) * joursOuvrablesMois;
    setHeuresMois(hm ? round2(hm) : "");
    if (Number(mensuel) && hm) setTaux(round4(Number(mensuel) / hm));
  }
  function onHeuresMois(v: string) {
    setHeuresMois(v);
    const hm = Number(v);
    if (hm && joursOuvrablesMois) setHeuresJour(round2(hm / joursOuvrablesMois));
    if (Number(mensuel) && hm) setTaux(round4(Number(mensuel) / hm));
  }
  function onTaux(v: string) {
    setTaux(v);
    const hm = Number(heuresMois);
    if (Number(v) && hm) setMensuel(round2(Number(v) * hm));
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="salaireMensuel" className="text-sm font-medium">Salaire mensuel $</label>
        <input id="salaireMensuel" name="salaireMensuel" type="number" step="0.01" required value={mensuel} onChange={(e) => onMensuel(e.target.value)} className={champCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="heuresParJour" className="text-sm font-medium">Heures / jour</label>
        <input id="heuresParJour" name="heuresParJour" type="number" step="0.5" value={heuresJour} onChange={(e) => onHeuresJour(e.target.value)} className={champCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="heuresMois" className="text-sm font-medium">Heures / mois (modifiable)</label>
        <input id="heuresMois" type="number" step="1" value={heuresMois} onChange={(e) => onHeuresMois(e.target.value)} className={champCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tauxHoraire" className="text-sm font-medium">Taux horaire $/h (modifiable)</label>
        <input id="tauxHoraire" type="number" step="0.0001" value={taux} onChange={(e) => onTaux(e.target.value)} className={champCls} />
      </div>
      <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
        Heures/mois = heures/jour × {joursOuvrablesMois} jours ouvrables. Taux horaire = salaire mensuel
        ÷ heures/mois. Modifier l&apos;un de ces champs met les autres à jour (seuls le salaire mensuel
        et les heures/jour sont enregistrés).
      </p>
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  step,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        required={required}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function Select({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
