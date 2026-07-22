import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfSignatureBox } from "./layout";
import { pdfColors, entreprise as entrepriseDefaut, formatMontant, type Devise } from "./theme";
import { labelCategoriePro } from "@/lib/categorie-professionnelle";
import { reconstituerBrutDepuisNet, type ParametresPaie } from "@/lib/payroll";

registerPdfFonts();

const WD = ["D", "L", "M", "M", "J", "V", "S"];

const fmtJour = (d: Date) => new Date(d).toLocaleDateString("fr-FR");
/** Jours ouvrables (hors dimanche ET hors jours fériés), bornes incluses — même règle que le reste de l'app. */
function joursOuvrables(debut: Date, fin: Date, feries: Set<string>): number {
  let n = 0;
  const cur = new Date(debut);
  while (cur <= new Date(fin)) {
    const iso = cur.toISOString().slice(0, 10);
    if (cur.getUTCDay() !== 0 && !feries.has(iso)) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 30,
    paddingBottom: 22,
    fontSize: 8,
    fontFamily: "Optima",
    color: pdfColors.text,
  },

  // Identité employeur / salarié
  identite: { flexDirection: "row", marginBottom: 8, border: `0.75 solid ${pdfColors.border}` },
  identiteCol: { flex: 1 },
  identiteColGauche: { borderRight: `0.75 solid ${pdfColors.border}` },
  bandeau: {
    backgroundColor: pdfColors.goldLight,
    paddingVertical: 3,
    paddingHorizontal: 8,
    fontSize: 7.5,
    fontWeight: 700,
    color: pdfColors.brownDark,
    textTransform: "uppercase",
  },
  ligneInfo: {
    flexDirection: "row",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderTop: `0.5 solid ${pdfColors.border}`,
  },
  ligneInfoLabel: { width: "42%", color: pdfColors.textMuted },
  ligneInfoValue: { flex: 1, fontWeight: 500 },

  // Bandeau récapitulatif du salarié
  recap: {
    flexDirection: "row",
    marginBottom: 8,
    border: `0.75 solid ${pdfColors.border}`,
  },
  recapCell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRight: `0.5 solid ${pdfColors.border}`,
  },
  recapLabel: { fontSize: 6, color: pdfColors.textMuted, textTransform: "uppercase" },
  recapValue: { fontSize: 8.5, fontWeight: 700, color: pdfColors.brownDark, marginTop: 1 },

  corps: { flexDirection: "row", gap: 8 },

  // Tableau principal
  tableWrap: { width: "73%", border: `0.75 solid ${pdfColors.border}` },
  th: {
    flexDirection: "row",
    backgroundColor: pdfColors.brownDark,
  },
  thCell: { color: "#ffffff", fontSize: 6.5, fontWeight: 700, paddingVertical: 3, paddingHorizontal: 3, textTransform: "uppercase" },
  tr: { flexDirection: "row", borderTop: `0.5 solid ${pdfColors.border}` },
  td: { fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  trTotal: { backgroundColor: pdfColors.goldLight },
  trSection: { backgroundColor: "#f3efe6" },
  tdBold: { fontWeight: 700, color: pdfColors.brownDark },

  // largeurs de colonnes
  cDesig: { width: "34%" },
  cBase: { width: "13%", textAlign: "right" },
  cTaux: { width: "11%", textAlign: "right" },
  cMontant: { width: "14%", textAlign: "right" },
  cSal: { width: "14%", textAlign: "right" },
  cEmp: { width: "14%", textAlign: "right" },

  // Calendrier
  calWrap: { width: "27%", border: `0.75 solid ${pdfColors.border}` },
  calHead: {
    backgroundColor: pdfColors.brownDark,
    color: "#ffffff",
    fontSize: 6.5,
    fontWeight: 700,
    paddingVertical: 3,
    paddingHorizontal: 4,
    textTransform: "uppercase",
    textAlign: "center",
  },
  calRow: { flexDirection: "row", borderTop: `0.4 solid ${pdfColors.border}`, paddingVertical: 1.2, paddingHorizontal: 4 },
  calRowDim: { backgroundColor: "#faf3ea" },
  calJour: { width: "55%", fontSize: 6.5, color: pdfColors.textMuted },
  calCode: { width: "45%", fontSize: 6.5, fontWeight: 700, textAlign: "right", color: pdfColors.brownDark },
  legende: { marginTop: 4, fontSize: 5.8, color: pdfColors.textMuted, lineHeight: 1.3 },

  totalBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: pdfColors.goldLight,
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 10.5, fontWeight: 700, color: pdfColors.brownDark },
  totalValue: { fontSize: 13, fontWeight: 700, color: pdfColors.brownDark },

  conservation: {
    marginTop: 4,
    fontSize: 6.5,
    fontStyle: "italic",
    color: pdfColors.textMuted,
    textAlign: "center",
  },
  fait: { marginTop: 3, fontSize: 7.5, fontStyle: "italic", color: pdfColors.textMuted },
  signatures: { marginTop: 5, flexDirection: "row", justifyContent: "space-between" },

  // Mentions bas de bulletin (congés pris, mode de paiement).
  mentions: {
    marginTop: 5,
    border: `0.5 solid ${pdfColors.border}`,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  mentionTitre: { fontSize: 7, fontWeight: 700, color: pdfColors.brownDark, textTransform: "uppercase" },
  mentionLigne: { fontSize: 7.5, marginTop: 1.5 },
  mentionLabel: { color: pdfColors.textMuted },
});

function InfoLigne({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ligneInfo}>
      <Text style={styles.ligneInfoLabel}>{label}</Text>
      <Text style={styles.ligneInfoValue}>{value}</Text>
    </View>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.recapCell}>
      <Text style={styles.recapLabel}>{label}</Text>
      <Text style={styles.recapValue}>{value}</Text>
    </View>
  );
}

/** Une ligne du tableau : désignation + jusqu'à 5 colonnes chiffrées. */
function Row({
  designation,
  base,
  taux,
  montant,
  partSal,
  partEmp,
  total,
  section,
}: {
  designation: string;
  base?: string;
  taux?: string;
  montant?: string;
  partSal?: string;
  partEmp?: string;
  total?: boolean;
  section?: boolean;
}) {
  const bold = total || section;
  const b = bold ? styles.tdBold : styles.td;
  return (
    <View style={[styles.tr, total ? styles.trTotal : section ? styles.trSection : styles.tr]}>
      <Text style={[styles.td, styles.cDesig, b]}>{designation}</Text>
      <Text style={[styles.td, styles.cBase, b]}>{base ?? ""}</Text>
      <Text style={[styles.td, styles.cTaux, b]}>{taux ?? ""}</Text>
      <Text style={[styles.td, styles.cMontant, b]}>{montant ?? ""}</Text>
      <Text style={[styles.td, styles.cSal, b]}>{partSal ?? ""}</Text>
      <Text style={[styles.td, styles.cEmp, b]}>{partEmp ?? ""}</Text>
    </View>
  );
}

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

type BulletinProps = {
  employee: Employee;
  ligne: PayrollLine;
  run: PayrollRun;
  devise: Devise;
  congesPeriode: { dateDebut: Date; dateFin: Date }[];
  feries?: string[]; // jours fériés (AAAA-MM-JJ) exclus du décompte des congés
  primes?: { nom: string; montantUSD: number }[]; // primes détaillées (une ligne chacune)
  codesParJour?: Record<number, string>; // jour du mois -> code de présence
  /** Identité de l'entreprise (Paramètres) ; par défaut les valeurs de theme.ts. */
  entreprise?: typeof entrepriseDefaut;
  logo?: ImageSrc;
  /** Paramètres de paie (2026-07-22) — sert UNIQUEMENT à reconstituer le brut du « Salaire de
   * base » affiché si `salairesSaisisEnNet` est actif (voir plus bas) ; optionnel pour ne pas
   * casser un appelant qui ne les chargerait pas encore — dans ce cas le montant stocké est
   * affiché tel quel (comportement historique). */
  params?: ParametresPaie;
};

/** Contenu d'UN bulletin (une page A4), mise en page tabulaire façon PayFit, fiscalité RDC. */
export function BulletinPage({ employee, ligne, run, devise, codesParJour = {}, congesPeriode = [], primes = [], feries = [], entreprise = entrepriseDefaut, logo, params }: BulletinProps) {
  const feriesSet = new Set(feries);
  const tauxChange = Number(run.tauxChangeUtilise);
  const m = (usd: number) => formatMontant(usd, devise, tauxChange);

  const periode = new Date(run.annee, run.mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const faitLe = new Date().toLocaleDateString("fr-FR");

  // Le mode de paiement n'est une information certaine qu'une fois le salaire effectivement payé.
  // Tant que le bulletin n'est pas au statut « Payé », la mention reste vide (pas de « Espèces »
  // par défaut sur un bulletin non validé/non payé).
  const estPaye = ligne.statutPaiement === "PAYE";
  const modePaiement = employee.banque
    ? `Virement — ${employee.banque}${employee.compteBancaire ? ` (${employee.compteBancaire})` : ""}`
    : employee.mobileMoney
      ? `Mobile Money — ${employee.mobileMoney}`
      : "Espèces";

  // Le détail des primes n'est affiché que s'il correspond au total inclus dans le brut calculé
  // (sinon on affiche le total stocké, pour ne pas montrer une prime absente du brut/net).
  const sommePrimes = primes.reduce((s, p) => s + Number(p.montantUSD), 0);
  const primesCoherentes = Math.abs(sommePrimes - Number(ligne.primesUSD)) < 0.01;

  const heuresTravaillees = Number(ligne.heuresTravaillees);
  const hs30 = Number(ligne.heuresSupp30);
  const hs60 = Number(ligne.heuresSupp60);
  const hs100 = Number(ligne.heuresSupp100);
  const totHS = hs30 + hs60 + hs100;
  const heuresNormales = heuresTravaillees - totHS;
  const heuresContractuelles = Number(ligne.heuresContractuelles);

  // Salaire de base affiché en BRUT (2026-07-22, décision client), cohérent avec « Salaire brut
  // imposable » plus bas. `employee.salaireMensuel` est la valeur SAISIE sur la fiche — un NET
  // cible si `params.salairesSaisisEnNet` est actif (sinon, comportement historique : c'est déjà
  // un brut, rien ne change). On reconstitue ici le brut de référence de CE montant contractuel
  // (indépendant des heures/absences du mois, comme l'était déjà cette case avant ce changement) ;
  // ce n'est PAS le même calcul que `ligne.remuneration100` (qui, lui, dépend des heures/absences
  // réellement enregistrées ce mois). Si `params` n'est pas fourni par l'appelant (rétrocompat.),
  // le montant stocké est affiché tel quel (pas de reconstitution possible sans les paramètres).
  const salaireBaseAffiche =
    params?.salairesSaisisEnNet
      ? reconstituerBrutDepuisNet(Number(employee.salaireMensuel), params, employee.enfants)
      : Number(employee.salaireMensuel);

  // Taux horaire dérivé du MÊME montant brut que « Salaire de base » ci-dessus (cohérence interne
  // de la case récap : Salaire de base ÷ Heures/mois = Taux horaire). Avant ce changement, ce taux
  // était déjà dérivé de `employee.salaireMensuel` (implicitement net si le flag est actif) — on le
  // dérive maintenant du même brut reconstitué pour rester un vrai « taux horaire brut », plutôt
  // que d'introduire un second libellé « taux net » à côté d'un « Salaire de base » en brut.
  const tauxHoraire = heuresContractuelles > 0 ? salaireBaseAffiche / heuresContractuelles : 0;

  const totalRetenuesSal =
    Number(ligne.cnssSalarieUSD) + Number(ligne.iprCalculeUSD) + Number(ligne.acompteUSD) + Number(ligne.retenuePretUSD ?? 0);
  const totalPatronal = Number(ligne.cnssPatronalUSD) + Number(ligne.inppUSD) + Number(ligne.onemUSD);
  const totalGains =
    Number(ligne.salBrutUSD) + Number(ligne.allocFamilialeUSD) + Number(ligne.fraisMedicauxUSD);

  const nbJours = new Date(Date.UTC(run.annee, run.mois, 0)).getUTCDate();
  const joursCal = Array.from({ length: nbJours }, (_, i) => {
    const jour = i + 1;
    const dow = new Date(Date.UTC(run.annee, run.mois - 1, jour)).getUTCDay();
    return { jour, dow, code: codesParJour[jour] ?? "" };
  });

  return (
    <Page size="A4" style={styles.page}>
      <PdfHeader title="Bulletin de paie" subtitle={periode} logo={logo} />

      <View style={styles.identite}>
        <View style={[styles.identiteCol, styles.identiteColGauche]}>
          <Text style={styles.bandeau}>Employeur</Text>
          <InfoLigne label="Nom" value={entreprise.nom} />
          <InfoLigne label="N° Impôt" value={entreprise.numImpot} />
          <InfoLigne label="N° Id. Nat." value={entreprise.idNat} />
          <InfoLigne label="RCCM" value={entreprise.rccm} />
          <InfoLigne label="Adresse" value={entreprise.adresse} />
        </View>
        <View style={styles.identiteCol}>
          <Text style={styles.bandeau}>Salarié</Text>
          <InfoLigne label="Matricule" value={employee.matricule} />
          <InfoLigne label="Nom et prénom" value={employee.nom} />
          <InfoLigne label="Poste" value={employee.poste} />
          {labelCategoriePro(employee.categorieProfessionnelle) ? <InfoLigne label="Catégorie prof." value={labelCategoriePro(employee.categorieProfessionnelle)!} /> : null}
          <InfoLigne label="Sexe" value={employee.sexe} />
          <InfoLigne label="Date d'embauche" value={new Date(employee.dateEmbauche).toLocaleDateString("fr-FR")} />
          <InfoLigne label="Adresse" value={employee.adresse ?? "—"} />
        </View>
      </View>

      {/* Récapitulatif */}
      <View style={styles.recap}>
        <Recap label="Catégorie" value={employee.categorie === "BRIGADE" ? "Brigade" : "Back-office"} />
        <Recap label="Salaire de base" value={m(salaireBaseAffiche)} />
        <Recap label="Taux horaire" value={m(tauxHoraire)} />
        <Recap label="Heures / mois" value={`${heuresContractuelles} h`} />
        <View style={[styles.recapCell, { borderRight: "0" }]}>
          <Text style={styles.recapLabel}>Personnes à charge</Text>
          <Text style={styles.recapValue}>{employee.enfants}</Text>
        </View>
      </View>

      <View style={styles.corps}>
        {/* Tableau des rubriques */}
        <View style={styles.tableWrap}>
          <View style={styles.th}>
            <Text style={[styles.thCell, styles.cDesig]}>Désignation</Text>
            <Text style={[styles.thCell, styles.cBase]}>Base</Text>
            <Text style={[styles.thCell, styles.cTaux]}>Taux</Text>
            <Text style={[styles.thCell, styles.cMontant]}>Montant</Text>
            <Text style={[styles.thCell, styles.cSal]}>Part sal.</Text>
            <Text style={[styles.thCell, styles.cEmp]}>Part empl.</Text>
          </View>

          {/* Scission lisible : heures travaillées d'un côté, jours payés non travaillés de
              l'autre (les montants de la ligne se recoupent enfin : base × taux = montant).
              Les bulletins figés d'avant la scission n'ont pas la part « jours payés » → ligne
              unique historique. */}
          {Number(ligne.remunerationJoursPayesUSD ?? 0) > 0 ? (
            <>
              <Row
                designation="Salaire de base (heures travaillées)"
                base={`${heuresNormales} h`}
                taux={m(tauxHoraire)}
                montant={m(Number(ligne.remuneration100) - Number(ligne.remunerationJoursPayesUSD))}
              />
              <Row
                designation="Jours payés non travaillés (congés, fériés, repos)"
                base={`${Number(ligne.joursPayesNonTravailles ?? 0)} j`}
                taux={m(tauxHoraire * Number(employee.heuresParJour))}
                montant={m(Number(ligne.remunerationJoursPayesUSD))}
              />
            </>
          ) : (
            <Row designation="Salaire de base" base={`${heuresNormales} h`} taux={m(tauxHoraire)} montant={m(Number(ligne.remuneration100))} />
          )}
          {Number(ligne.remuneration2_3) > 0 && (
            <Row designation="Indemnité maladie (2/3)" montant={m(Number(ligne.remuneration2_3))} />
          )}
          {totHS > 0 && (
            <Row designation="Heures supplémentaires" base={`${totHS} h`} montant={m(Number(ligne.hsValorisee))} />
          )}
          <Row designation="Frais de transport (non imposable, non cotisable)" montant={m(Number(ligne.transportUSD))} />
          {/* Primes détaillées (une ligne par prime) UNIQUEMENT si leur somme correspond au montant
              de primes réellement inclus dans le brut calculé. Sinon (bulletin figé alors qu'une
              prime a été ajoutée après, ou calcul non rafraîchi) on affiche le total stocké pour
              rester cohérent avec le brut/CNSS/IPR/net. */}
          {primesCoherentes && primes.length > 0
            ? primes.map((p, i) => (
                <Row key={`prime-${i}`} designation={p.nom} montant={m(Number(p.montantUSD))} />
              ))
            : Number(ligne.primesUSD) > 0 && (
                <Row designation="Primes" montant={m(Number(ligne.primesUSD))} />
              )}
          <Row designation="Salaire brut imposable" montant={m(Number(ligne.salBrutUSD))} section />

          <Row designation="CNSS" base={m(Number(ligne.salBrutUSD))} partSal={m(Number(ligne.cnssSalarieUSD))} partEmp={m(Number(ligne.cnssPatronalUSD))} />
          <Row designation="INPP" partEmp={m(Number(ligne.inppUSD))} />
          <Row designation="ONEM" partEmp={m(Number(ligne.onemUSD))} />
          <Row designation="IPR (impôt sur le revenu)" base={m(Number(ligne.netImposableUSD))} partSal={m(Number(ligne.iprCalculeUSD))} />
          {Number(ligne.acompteUSD) > 0 && (
            <Row designation="Acompte sur salaire" partSal={m(Number(ligne.acompteUSD))} />
          )}
          {Number(ligne.retenuePretUSD ?? 0) > 0 && (
            <Row designation="Retenue prêt au personnel" partSal={m(Number(ligne.retenuePretUSD))} />
          )}

          <Row designation="Allocation familiale (non imposable)" montant={m(Number(ligne.allocFamilialeUSD))} />
          {Number(ligne.fraisMedicauxUSD) > 0 && (
            <Row designation="Frais médicaux (remboursement)" montant={m(Number(ligne.fraisMedicauxUSD))} />
          )}

          <Row
            designation="Totaux"
            montant={m(totalGains)}
            partSal={m(totalRetenuesSal)}
            partEmp={m(totalPatronal)}
            total
          />
          <Row designation="Coût total employeur" partEmp={m(Number(ligne.coutEmployeurUSD))} section />
        </View>

        {/* Colonne calendrier */}
        <View style={styles.calWrap}>
          <Text style={styles.calHead}>Calendrier</Text>
          {joursCal.map((j) => (
            <View key={j.jour} style={[styles.calRow, j.dow === 0 ? styles.calRowDim : {}]}>
              <Text style={styles.calJour}>
                {WD[j.dow]} {String(j.jour).padStart(2, "0")}
              </Text>
              <Text style={styles.calCode}>{j.code}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.legende}>
        Légende présences : P présent · A absent · C congé · M maladie · F férié · O repos · N non payé.
      </Text>

      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>SALAIRE NET À PAYER</Text>
        <Text style={styles.totalValue}>{m(Number(ligne.salNetUSD))}</Text>
      </View>

      {/* Mentions : congés pris sur la période (toujours affichés s'il y en a) + mode de paiement
          (uniquement une fois le bulletin payé). La boîte n'est rendue que si l'une des deux existe. */}
      {(congesPeriode.length > 0 || estPaye) && (
        <View style={styles.mentions} wrap={false}>
          {congesPeriode.length > 0 && (
            <>
              <Text style={styles.mentionTitre}>Congés pris sur la période</Text>
              {congesPeriode.map((c, i) => (
                <Text key={i} style={styles.mentionLigne}>
                  • du {fmtJour(c.dateDebut)} au {fmtJour(c.dateFin)} — {joursOuvrables(c.dateDebut, c.dateFin, feriesSet)} jour(s) ouvrable(s)
                </Text>
              ))}
              <Text style={[styles.mentionLigne, { fontWeight: 700 }]}>
                Total congés : {congesPeriode.reduce((s, c) => s + joursOuvrables(c.dateDebut, c.dateFin, feriesSet), 0)} jour(s)
              </Text>
            </>
          )}
          {estPaye && (
            <Text style={[styles.mentionLigne, congesPeriode.length > 0 ? { marginTop: 3 } : {}]}>
              <Text style={styles.mentionLabel}>Mode de paiement : </Text>
              {modePaiement}
            </Text>
          )}
        </View>
      )}

      <Text style={styles.conservation}>
        Ce bulletin de paie doit être conservé par le salarié sans limitation de durée.
      </Text>

      <Text style={styles.fait}>Fait à Kinshasa, le {faitLe}</Text>

      <View style={styles.signatures} wrap={false}>
        <PdfSignatureBox label="Signature du salarié" signe={false} />
        <PdfSignatureBox label="Signature de la direction" signe={ligne.statutPaiement === "PAYE"} />
      </View>
    </Page>
  );
}

/** Un bulletin = un PDF (une page). */
export function BulletinDocument(props: BulletinProps) {
  return (
    <Document>
      <BulletinPage {...props} />
    </Document>
  );
}

/** Tous les bulletins d'un mois dans UN seul PDF (une page par employé). */
export function BulletinsDocument({ bulletins, devise }: { bulletins: Omit<BulletinProps, "devise">[]; devise: Devise }) {
  return (
    <Document>
      {bulletins.map((b) => (
        <BulletinPage key={b.ligne.id} {...b} devise={devise} />
      ))}
    </Document>
  );
}
