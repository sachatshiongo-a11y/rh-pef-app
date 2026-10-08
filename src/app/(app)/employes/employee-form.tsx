"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Employee } from "@prisma/client";
import { CATEGORIES_PRO } from "@/lib/categorie-professionnelle";
import type { ParametresPaie } from "@/lib/payroll";
import { MENTION_REFERENCE_PLANNING } from "@/lib/mention-reference-planning";
import { ChampNombre } from "@/components/champ-nombre";
import { conseilSaisie, lireNombreSaisi, versSaisie } from "@/lib/nombre";
import { SimulationSalaire, lireValeursSimulation, type ValeursSimulation } from "./simulation-salaire";
import { SommaireSections, SECTION_ANCREE } from "@/components/sommaire-sections";
import { fichesProches, identiteModifiee, CHAMP_DOUBLONS_ECARTES, type IdentiteFiche } from "@/lib/employe-doublon";
import { AlerteDoublons, type FicheDoublonClient } from "./alerte-doublons";

/** Nombre d'une colonne Decimal/Int de la base, écrit pour un champ (virgule décimale) ; undefined si absent. */
function versChamp(v: { toString(): string } | number | null | undefined): string | undefined {
  return v === null || v === undefined ? undefined : versSaisie(Number(v));
}

/** Champs de nombre du formulaire (nom → libellé du message) : relus avant l'envoi pour ne jamais enregistrer une saisie illisible. */
const CHAMPS_NOMBRE: { name: string; libelle: string; positif?: boolean; entier?: boolean }[] = [
  { name: "salaireMensuel", libelle: "Salaire mensuel" },
  { name: "heuresHebdomadaires", libelle: "Heures / semaine", positif: true },
  { name: "heuresParJour", libelle: "Heures / jour", positif: true },
  { name: "transportJourCDF", libelle: "Transport / jour (CDF)" },
  { name: "transportMoisCDF", libelle: "Transport / mois (CDF)" },
  { name: "transportMoisUSD", libelle: "Transport / mois ($)" },
  { name: "cnssMontant", libelle: "CNSS $" },
  { name: "fraisMedicauxMoisCourant", libelle: "Frais médicaux du mois ($)" },
  { name: "enfants", libelle: "Enfants", positif: true, entier: true },
];

/** Premier message d'erreur de saisie numérique du formulaire, ou null si tout est lisible. */
function erreurSaisieNombres(fd: FormData): string | null {
  for (const c of CHAMPS_NOMBRE) {
    const brut = String(fd.get(c.name) ?? "").trim();
    if (brut === "") continue;
    const n = lireNombreSaisi(brut);
    if (n === null) {
      const conseil = conseilSaisie(brut);
      return `${c.libelle} : « ${brut} » est illisible${conseil ? ` — ${conseil}` : " — virgule pour les décimales (1,5), point ou espace pour les milliers"}.`;
    }
    if (c.positif && n < 0) return `${c.libelle} : une valeur négative n'est pas permise.`;
    if (c.entier && !Number.isInteger(n)) return `${c.libelle} : un nombre entier est attendu.`;
  }
  return null;
}

function toDateInput(d: Date | string | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

/** Identifiant du formulaire : la barre du sommaire (hors du <form>) l'envoie par l'attribut `form`. */
export const FORMULAIRE_FICHE_EMPLOYE = "fiche-employe";

const SECTIONS = [
  { id: "identite", label: "Identité" },
  { id: "contrat", label: "Contrat & poste" },
  { id: "remuneration", label: "Rémunération" },
  { id: "coordonnees", label: "Coordonnées & paiement" },
];

/**
 * Fiche employé (création et modification) — écran de TRAVAIL réorganisé (2026-10-08) : sections
 * nommées avec un sommaire collant (ancres, `SommaireSections`) et « Enregistrer » toujours sous la
 * main ; simulation du bulletin collante à droite sur ordinateur, repliable sous la rémunération sur
 * téléphone. MÊMES champs, MÊMES noms, MÊME action qu'avant (cf. employee-form.envoi.test.tsx) :
 * seule la disposition change. `famille` (page Modifier) : section rendue APRÈS le formulaire —
 * elle a ses propres formulaires (ajout, retrait), qu'on ne peut pas imbriquer dans celui-ci.
 */
export function EmployeeForm({
  employee,
  action,
  joursOuvrablesMois,
  postes = [],
  parametres,
  impact,
  doublons,
  famille,
}: {
  employee?: Employee;
  action: (formData: FormData) => void;
  joursOuvrablesMois: number;
  postes?: string[];
  /** Fournis → simulation de bulletin en direct dans un panneau latéral. */
  parametres?: ParametresPaie;
  impact?: { netActuel: number; coutActuel: number; effectif: number; periode: string; actuel?: { net: number; cout: number } | null } | null;
  /** Fiches existantes (actives et inactives) pour signaler les fiches proches pendant la saisie. */
  doublons?: { fiches: FicheDoublonClient[]; ecartees: string[]; peutReactiver: boolean };
  /** Section « Famille » (page Modifier), hors du formulaire. */
  famille?: ReactNode;
}) {
  // Simulation en direct : recalculée à chaque frappe à partir des champs du formulaire.
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null);
  const [sim, setSim] = useState<ValeursSimulation>({
    salaireMensuel: Number(employee?.salaireMensuel ?? 0),
    categorie: employee?.categorie ?? "BRIGADE",
    contrat: employee?.contrat ?? "CDD",
    enfants: employee?.enfants ?? 0,
    heuresHebdomadaires: Number(employee?.heuresHebdomadaires ?? 48),
    heuresParJour: Number(employee?.heuresParJour ?? 8),
    transportJourCDF: Number(employee?.transportJourCDF ?? 0),
    transportMoisUSD: Number(employee?.transportMoisUSD ?? 0),
    transportMoisCDF: 0,
  });

  // Anti-doublon : identité suivie à la frappe ; fiches proches recalculées (règle partagée avec le serveur).
  const initiale = useMemo<IdentiteFiche>(
    () => ({ nom: employee?.nom ?? "", telephone: employee?.telephone ?? null, dateNaissance: employee?.dateNaissance ?? null }),
    [employee],
  );
  const [identite, setIdentite] = useState<IdentiteFiche>(initiale);
  const [ecartes, setEcartes] = useState<Set<string>>(new Set());
  const [doublonBloque, setDoublonBloque] = useState(false);
  const pairesEcartees = useMemo(() => new Set(doublons?.ecartees ?? []), [doublons]);
  const proches = useMemo(() => {
    if (!doublons) return [];
    // Modification : la question ne se repose que si l'identité change (même règle que le serveur).
    if (employee && !identiteModifiee(initiale, identite)) return [];
    return fichesProches(identite, doublons.fiches, { exclureId: employee?.id, ecartees: pairesEcartees });
  }, [doublons, employee, initiale, identite, pairesEcartees]);
  const idsEcartes = proches.filter((p) => ecartes.has(p.fiche.id)).map((p) => p.fiche.id);
  const nonTranches = proches.length - idsEcartes.length;

  const simulation = parametres ? <SimulationSalaire valeurs={sim} parametres={parametres} impact={impact ?? null} /> : null;
  const sections = famille ? [...SECTIONS, { id: "famille", label: "Famille" }] : SECTIONS;

  return (
    <div>
      <SommaireSections sections={sections} libelle="Sections de la fiche employé">
        <button type="submit" form={FORMULAIRE_FICHE_EMPLOYE} className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Enregistrer
        </button>
      </SommaireSections>

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <form
            id={FORMULAIRE_FICHE_EMPLOYE}
            action={action}
            onInput={(e) => {
              const fd = new FormData(e.currentTarget);
              if (parametres) setSim(lireValeursSimulation(fd));
              if (doublons) {
                setIdentite({ nom: String(fd.get("nom") ?? ""), telephone: String(fd.get("telephone") ?? ""), dateNaissance: String(fd.get("dateNaissance") ?? "") });
                setDoublonBloque(false);
              }
            }}
            onSubmit={(e) => {
              // Une saisie illisible n'est jamais enregistrée comme un zéro : on bloque ici (les champs restent remplis).
              const message = erreurSaisieNombres(new FormData(e.currentTarget));
              setErreurSaisie(message);
              if (message) {
                e.preventDefault();
                document.getElementById("erreur-saisie-fiche")?.scrollIntoView({ block: "center" });
                return;
              }
              // Fiche proche non tranchée : on montre le choix au lieu d'envoyer (le serveur refuserait).
              if (nonTranches > 0) {
                e.preventDefault();
                setDoublonBloque(true);
                document.getElementById("alerte-doublons")?.scrollIntoView({ block: "center" });
              }
            }}
            className="space-y-5"
          >
            <datalist id="postes-existants">
              {postes.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>

            <Section id="identite" titre="Identité">
              <Field label="Nom et prénom" name="nom" defaultValue={employee?.nom} required />
              <Field label="Matricule (auto si vide)" name="matricule" defaultValue={employee?.matricule} />
              {proches.length > 0 && doublons && (
                <AlerteDoublons
                  proches={proches}
                  ecartes={ecartes}
                  onEcarter={(ids) => { setEcartes((s) => new Set([...s, ...ids])); setDoublonBloque(false); }}
                  onAnnuler={() => setEcartes(new Set())}
                  peutReactiver={doublons.peutReactiver}
                  modification={Boolean(employee)}
                  bloque={doublonBloque}
                />
              )}
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
              <Field
                label="Date de naissance"
                name="dateNaissance"
                type="date"
                defaultValue={toDateInput(employee?.dateNaissance ?? undefined)}
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
            </Section>

            <Section id="contrat" titre="Contrat & poste">
              <Field label="Poste" name="poste" defaultValue={employee?.poste} required list="postes-existants" />
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
                label="Catégorie professionnelle (Code du travail RDC)"
                name="categorieProfessionnelle"
                defaultValue={employee?.categorieProfessionnelle ?? ""}
                options={[{ value: "", label: "— non définie —" }, ...CATEGORIES_PRO.map((c) => ({ value: c.value, label: c.label }))]}
              />
              <Select
                label="Contrat"
                name="contrat"
                defaultValue={employee?.contrat ?? "CDD"}
                options={[
                  { value: "CDD", label: "CDD" },
                  { value: "CDI", label: "CDI" },
                  { value: "STAGE", label: "Stage (indemnité, sans cotisations ni congés)" },
                  { value: "JOURNALIER", label: "Journalier" },
                  { value: "INTERIM", label: "Intérim (payé par l'agence — hors paie)" },
                ]}
              />
              <Field
                label="Date d'embauche"
                name="dateEmbauche"
                type="date"
                defaultValue={toDateInput(employee?.dateEmbauche)}
                required
              />
              <Field
                label="ID pointeuse IVMS (optionnel)"
                name="idExterneIVMS"
                defaultValue={employee?.idExterneIVMS ?? ""}
              />
            </Section>

            <Section id="remuneration" titre="Rémunération">
              <SalaireHoraire
                salaireMensuelInit={versChamp(employee?.salaireMensuel) ?? ""}
                heuresHebdoInit={versChamp(employee?.heuresHebdomadaires) ?? "48"}
                heuresParJourInit={versChamp(employee?.heuresParJour) ?? "8"}
                joursOuvrablesMois={joursOuvrablesMois}
                salaireEstNet={parametres?.salairesSaisisEnNet ?? false}
              />
              <Field
                label="Transport / jour (CDF)"
                name="transportJourCDF"
                nombre
                suffixe="CDF"
                defaultValue={versChamp(employee?.transportJourCDF)}
              />
              <Field
                label="Transport / mois (CDF)"
                name="transportMoisCDF"
                nombre
                suffixe="CDF"
                defaultValue={versChamp(employee?.transportMoisCDF)}
              />
              <Field
                label="Transport / mois ($)"
                name="transportMoisUSD"
                nombre
                suffixe="$"
                defaultValue={versChamp(employee?.transportMoisUSD)}
              />
              <Field
                label="CNSS $"
                name="cnssMontant"
                nombre
                suffixe="$"
                defaultValue={versChamp(employee?.cnssMontant)}
              />
              <Field
                label="Frais médicaux du mois ($)"
                name="fraisMedicauxMoisCourant"
                nombre
                suffixe="$"
                defaultValue={versChamp(employee?.fraisMedicauxMoisCourant) ?? "0"}
              />
              <Field
                label="Enfants à charge (retenus par la paie)"
                name="enfants"
                nombre
                defaultValue={employee?.enfants?.toString() ?? "0"}
              />
              {/* Téléphone : la simulation se replie sous la rémunération (sur ordinateur, elle est collée à droite). */}
              {simulation && (
                <details className="group sm:col-span-2 lg:hidden">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                    Simulation du bulletin
                  </summary>
                  <div className="mt-2">{simulation}</div>
                </details>
              )}
            </Section>

            <Section id="coordonnees" titre="Coordonnées & paiement">
              <Field label="Téléphone" name="telephone" type="tel" defaultValue={employee?.telephone ?? ""} />
              <Field label="E-mail" name="email" type="email" defaultValue={employee?.email ?? ""} />
              <div className="sm:col-span-2">
                <Field label="Adresse" name="adresse" defaultValue={employee?.adresse ?? ""} />
              </div>
              <Select
                label="Moyen de paiement du salaire"
                name="modePaiement"
                defaultValue={employee?.modePaiement ?? "ESPECES"}
                options={[
                  { value: "ESPECES", label: "Espèces" },
                  { value: "VIREMENT", label: "Virement bancaire" },
                  { value: "MOBILE_MONEY", label: "Mobile Money" },
                ]}
              />
              <Field label="Mobile Money" name="mobileMoney" defaultValue={employee?.mobileMoney ?? ""} />
              <Field label="Banque" name="banque" defaultValue={employee?.banque ?? ""} />
              <Field label="Compte bancaire / IBAN" name="compteBancaire" defaultValue={employee?.compteBancaire ?? ""} />
            </Section>

            {/* Fiches proches déclarées « autre personne » : relues par le serveur, qui revérifie. Absent sinon (envoi inchangé). */}
            {idsEcartes.length > 0 && <input type="hidden" name={CHAMP_DOUBLONS_ECARTES} value={idsEcartes.join(",")} />}

            {erreurSaisie && (
              <p id="erreur-saisie-fiche" role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erreurSaisie}
              </p>
            )}
            <div>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Enregistrer
              </button>
            </div>
          </form>

          {famille && (
            <Section id="famille" titre="Famille" grille={false}>
              {famille}
            </Section>
          )}
        </div>

        {/* Ordinateur : simulation collée à droite pendant toute la saisie (sous la barre du sommaire). */}
        {simulation && (
          <div className="hidden w-80 shrink-0 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
            {simulation}
          </div>
        )}
      </div>
    </div>
  );
}

/** Section nommée de la fiche (même carte que les sections de la fiche employé), cible d'une ancre du sommaire. */
function Section({ id, titre, grille = true, children }: { id: string; titre: string; grille?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className={`${SECTION_ANCREE} rounded-2xl border bg-card p-4 shadow-sm sm:p-5`}>
      <h2 id={`${id}-titre`} className="mb-4 text-base font-semibold">{titre}</h2>
      {grille ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div> : children}
    </section>
  );
}

const champCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Salaire mensuel + heures hebdo + heures/jour + taux horaire synchronisés.
 * Heures/mois = heures hebdo × jours ouvrables ÷ 6 (gère les temps partiels : Rachel 36h/sem,
 * Aimée 25h/sem). Taux horaire = salaire mensuel ÷ heures/mois. « Heures/jour » = seuil quotidien
 * d'heures supplémentaires (indépendant). Enregistrés : salaire mensuel, heures hebdo, heures/jour.
 */
function SalaireHoraire({
  salaireMensuelInit,
  heuresHebdoInit,
  heuresParJourInit,
  joursOuvrablesMois,
  salaireEstNet,
}: {
  salaireMensuelInit: string;
  heuresHebdoInit: string;
  heuresParJourInit: string;
  joursOuvrablesMois: number;
  /** true si les salaires saisis sont interprétés comme des NETS (flag `salaires_saisis_en_net`) :
      les libellés le reflètent alors, sinon on garde les libellés historiques (montant = brut). */
  salaireEstNet: boolean;
}) {
  // Les champs sont des textes à la française (« 1 250,5 ») : on les lit avec `lireNombreSaisi` (illisible ou vide → 0,
  // le calcul dérivé se tait), on les réécrit avec `versSaisie` (virgule décimale).
  const lire = (s: string) => lireNombreSaisi(s) ?? 0;
  const round2 = (n: number) => versSaisie(Math.round(n * 100) / 100);
  const round4 = (n: number) => versSaisie(Math.round(n * 10000) / 10000);
  const moisDepuisHebdo = (hebdo: number) => (hebdo * 52) / 12; // 52/12 semaines par mois (précis)

  const heuresMoisInit = round2(moisDepuisHebdo(lire(heuresHebdoInit)));
  const tauxInit =
    lire(salaireMensuelInit) && lire(heuresMoisInit)
      ? round4(lire(salaireMensuelInit) / lire(heuresMoisInit))
      : "";

  const [mensuel, setMensuel] = useState(salaireMensuelInit);
  const [hebdo, setHebdo] = useState(heuresHebdoInit);
  const [heuresMois, setHeuresMois] = useState(heuresMoisInit);
  const [taux, setTaux] = useState(tauxInit);

  function onMensuel(v: string) {
    setMensuel(v);
    const hm = lire(heuresMois);
    if (lire(v) && hm) setTaux(round4(lire(v) / hm));
  }
  function onHebdo(v: string) {
    setHebdo(v);
    const hm = moisDepuisHebdo(lire(v));
    setHeuresMois(hm ? round2(hm) : "");
    if (lire(mensuel) && hm) setTaux(round4(lire(mensuel) / hm));
  }
  function onHeuresMois(v: string) {
    setHeuresMois(v);
    const hm = lire(v);
    if (hm) setHebdo(round2((hm * 12) / 52));
    if (lire(mensuel) && hm) setTaux(round4(lire(mensuel) / hm));
  }
  function onTaux(v: string) {
    setTaux(v);
    const hm = lire(heuresMois);
    if (lire(v) && hm) setMensuel(round2(lire(v) * hm));
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="salaireMensuel" className="text-sm font-medium">{salaireEstNet ? "Salaire NET mensuel $" : "Salaire mensuel $"}</label>
        <ChampNombre id="salaireMensuel" name="salaireMensuel" suffixe="$" required value={mensuel} onChange={(e) => onMensuel(e.target.value)} className={champCls} classeConteneur="w-full" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="heuresHebdomadaires" className="text-sm font-medium">Heures / semaine</label>
        <ChampNombre id="heuresHebdomadaires" name="heuresHebdomadaires" suffixe="h" alerteMilliers value={hebdo} onChange={(e) => onHebdo(e.target.value)} className={champCls} classeConteneur="w-full" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="heuresMois" className="text-sm font-medium">Heures / mois (modifiable)</label>
        <ChampNombre id="heuresMois" suffixe="h" alerteMilliers value={heuresMois} onChange={(e) => onHeuresMois(e.target.value)} className={champCls} classeConteneur="w-full" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tauxHoraire" className="text-sm font-medium">{salaireEstNet ? "Taux horaire NET $/h (modifiable)" : "Taux horaire $/h (modifiable)"}</label>
        <ChampNombre id="tauxHoraire" suffixe="$/h" value={taux} onChange={(e) => onTaux(e.target.value)} className={champCls} classeConteneur="w-full" />
      </div>
      <Field label="Heures / jour (seuil heures supp.)" name="heuresParJour" nombre suffixe="h" alerteMilliers defaultValue={heuresParJourInit} />
      <details className="group -mt-1 text-xs text-muted-foreground sm:col-span-2">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-primary [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
          Comment ces montants et ces heures se calculent
        </summary>
        <p className="mt-1">
        Heures/mois = heures/semaine × 52/12 (≈ 4,33 semaines). Taux horaire = salaire mensuel ÷
        heures/mois. « Heures/jour » sert de seuil quotidien d&apos;heures supplémentaires. Enregistrés :
        salaire mensuel, heures/semaine, heures/jour. {MENTION_REFERENCE_PLANNING}
        {salaireEstNet && (
          <>
            <br />
            <b>Salaire NET</b> : le montant saisi ici est le NET réellement versé au salarié (à
            valider par un comptable) — le moteur de paie reconstitue automatiquement le brut de base
            (CNSS + IPR à sa charge) pour produire le bulletin. Le taux horaire ci-dessus est donc
            lui aussi un taux NET, dérivé du même montant.
          </>
        )}
        </p>
      </details>
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  nombre = false,
  suffixe,
  alerteMilliers,
  defaultValue,
  required,
  list,
}: {
  label: string;
  name: string;
  type?: string;
  /** Champ de nombre à la française (ChampNombre) au lieu d'un champ natif. */
  nombre?: boolean;
  suffixe?: string;
  alerteMilliers?: boolean;
  defaultValue?: string;
  required?: boolean;
  list?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {nombre ? (
        <ChampNombre
          id={name}
          name={name}
          suffixe={suffixe}
          alerteMilliers={alerteMilliers}
          defaultValue={defaultValue}
          required={required}
          className={champCls}
          classeConteneur="w-full"
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          defaultValue={defaultValue}
          required={required}
          list={list}
          className={champCls}
        />
      )}
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
