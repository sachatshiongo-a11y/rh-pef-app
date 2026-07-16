import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";

const d = (x: Date | null | undefined) => (x ? new Date(x).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");

const TYPE_CONTRAT: Record<string, string> = {
  CDI: "CDI — durée indéterminée", CDD: "CDD — durée déterminée", STAGE: "Stage", JOURNALIER: "Journalier", INTERIM: "Intérim",
};

export default async function EspaceDossier() {
  const s = await chargerSalarie();
  const [emp, contrat] = await Promise.all([
    prisma.employee.findUniqueOrThrow({
      where: { id: s.employeeId },
      select: { nom: true, matricule: true, poste: true, categorie: true, dateEmbauche: true, telephone: true, email: true, salaireMensuel: true, heuresHebdomadaires: true },
    }),
    prisma.contrat.findFirst({ where: { employeeId: s.employeeId, statut: "ACTIF" }, orderBy: { dateDebut: "desc" } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mon dossier</h1>
        <p className="text-sm text-muted-foreground">Vos informations personnelles et contractuelles (lecture seule).</p>
      </div>

      <Bloc titre="Identité">
        <Champ label="Nom" valeur={emp.nom} />
        <Champ label="Matricule" valeur={emp.matricule} />
        <Champ label="Poste" valeur={emp.poste} />
        <Champ label="Secteur" valeur={emp.categorie === "BRIGADE" ? "Brigade" : "Back-office"} />
        <Champ label="Date d'embauche" valeur={d(emp.dateEmbauche)} />
      </Bloc>

      <Bloc titre="Contrat en cours">
        {contrat ? (
          <>
            <Champ label="Type" valeur={TYPE_CONTRAT[contrat.type] ?? contrat.type} />
            <Champ label="Début" valeur={d(contrat.dateDebut)} />
            <Champ label="Fin" valeur={contrat.dateFin ? d(contrat.dateFin) : "Indéterminée"} />
            <Champ label="Poste au contrat" valeur={contrat.poste} />
            <Champ label="Heures / semaine" valeur={`${Number(contrat.heuresHebdo).toLocaleString("fr-FR")} h`} />
          </>
        ) : (
          <p className="col-span-full text-sm text-muted-foreground">Aucun contrat actif enregistré. Rapprochez-vous de la Direction.</p>
        )}
      </Bloc>

      <Bloc titre="Rémunération">
        <Champ label="Salaire brut" valeur={`${Number(emp.salaireMensuel).toLocaleString("fr-FR")} $ / mois`} />
        <Champ label="Heures / semaine" valeur={`${Number(emp.heuresHebdomadaires).toLocaleString("fr-FR")} h`} />
      </Bloc>

      <Bloc titre="Coordonnées">
        <Champ label="Téléphone" valeur={emp.telephone || "—"} />
        <Champ label="E-mail" valeur={emp.email || "—"} />
      </Bloc>

      <p className="text-xs text-muted-foreground">Une information est incorrecte ? Signalez-la à la Direction — vous ne pouvez pas la modifier vous-même.</p>
    </div>
  );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="mb-3 text-base font-semibold">{titre}</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">{children}</dl>
    </div>
  );
}
function Champ({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{valeur}</dd>
    </div>
  );
}
