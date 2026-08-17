// Génère le MODÈLE WORD du contrat de travail (pour relecture par le juriste) :
//   ~/Documents/Contrat-modele-PEF.docx
// Les champs [SURLIGNÉS EN JAUNE] sont ceux que le logiciel remplit automatiquement.
// ⚠️ À GARDER SYNCHRONE avec src/lib/pdf/contrat.tsx (le contrat réellement généré par l'app).
// Utilisation :  npm i docx --no-save && node scripts/contrat-word.js
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType, ShadingType,
  Header, Footer, ImageRun,
} = require("docx");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BROWN = "8B5E3C";
const GREY = "666666";

// Logo Pâtes en Folie (wordmark) pour l'en-tête. 612×210 px → 190×65 dans l'en-tête.
// (À remplacer par le logo TOLYA quand il sera fourni en HD.)
const LOGO = fs.readFileSync(path.join(__dirname, "..", "public", "logo-pates-en-folie.png"));

// En-tête : logo centré + filet brun.
const enTete = new Header({
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new ImageRun({ data: LOGO, type: "png", transformation: { width: 190, height: 65 } })],
    }),
    new Paragraph({ border: { bottom: { color: BROWN, size: 10, style: BorderStyle.SINGLE, space: 1 } }, spacing: { after: 0 } }),
  ],
});

// Pied de page identique à celui des bulletins Pâtes en Folie : filet brun + 2 colonnes de coordonnées.
const footLine = (t) => new Paragraph({ spacing: { after: 10 }, children: [new TextRun({ text: t, size: 14, color: GREY })] });
const piedPage = new Footer({
  children: [
    new Paragraph({ border: { top: { color: BROWN, size: 12, style: BorderStyle.SINGLE, space: 1 } }, spacing: { before: 0, after: 60 } }),
    new Table({
      columnWidths: [4700, 4500], width: { size: 9200, type: WidthType.DXA },
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
      rows: [
        new TableRow({
          children: [
            new TableCell({ width: { size: 4700, type: WidthType.DXA }, children: [
              footLine("Téléphone : +243 (0) 83 000 34 23"),
              footLine("E-mail : info@patesenfolie.cd - www.patesenfolie.cd"),
              footLine("Adresse : 31, avenue Comité Urbain - Gombe - Kinshasa"),
              footLine("République Démocratique du Congo"),
            ] }),
            new TableCell({ width: { size: 4500, type: WidthType.DXA }, children: [
              footLine("Numéro de compte Ecobank USD : 350 800 593 68 - 25 US$"),
              footLine("RCCM : CD/KNG/RCCM/18-B-01373"),
              footLine("Id. Nat. : 01-F4300-N74832J"),
              footLine("N. Impôt : A1820933"),
            ] }),
          ],
        }),
      ],
    }),
  ],
});

// Placeholder surligné en jaune (variable auto-remplie par le logiciel).
const ph = (t) => new TextRun({ text: `[${t}]`, highlight: "yellow", bold: true });
const b = (t) => new TextRun({ text: t, bold: true });
const r = (t) => new TextRun({ text: t });

const para = (children, opts = {}) =>
  new Paragraph({ spacing: { after: 140, line: 300 }, alignment: AlignmentType.JUSTIFIED, children: Array.isArray(children) ? children : [r(children)], ...opts });

const article = (titre, children) => [
  new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: titre, bold: true, color: BROWN, size: 22 })],
  }),
  para(children),
];

const hr = () => new Paragraph({ border: { bottom: { color: BROWN, size: 8, style: BorderStyle.SINGLE, space: 1 } }, spacing: { after: 200 } });

// Bloc "Entre les parties" employeur (données fixes de TOLYA SARL).
const empl = (label, val) =>
  new TableRow({
    children: [
      new TableCell({ width: { size: 2600, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: "F5EFE6" }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, color: BROWN })] })] }),
      new TableCell({ width: { size: 6600, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: val, size: 18 })] })] }),
    ],
  });

const doc = new Document({
  creator: "Pâtes en Folie — TOLYA SARL",
  title: "Contrat de travail — modèle",
  styles: { default: { document: { run: { font: "Calibri", size: 21, color: "222222" } } } },
  sections: [
    {
      properties: { page: { margin: { top: 1400, bottom: 1700, left: 1100, right: 1100 } } },
      headers: { default: enTete },
      footers: { default: piedPage },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 40 }, children: [new TextRun({ text: "CONTRAT DE TRAVAIL", bold: true, size: 34 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "République Démocratique du Congo — soumis au Code du travail en vigueur", italics: true, size: 18, color: GREY })] }),
        // Bandeau d'avertissement pour le juriste (à retirer avant usage).
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: "FFF4CC" },
          spacing: { before: 80, after: 160 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D9A24E" }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9A24E" }, left: { style: BorderStyle.SINGLE, size: 4, color: "D9A24E" }, right: { style: BorderStyle.SINGLE, size: 4, color: "D9A24E" } },
          children: [new TextRun({ text: "MODÈLE À FAIRE VALIDER PAR UN JURISTE. Les champs surlignés en jaune [ainsi] sont remplis automatiquement par le logiciel depuis la fiche de l'employé. Ce bandeau et les surlignages sont à retirer avant remise au salarié.", italics: true, size: 17, color: "8A6D1B" })],
        }),
        hr(),

        para([r("Le présent contrat est conclu entre les soussignés, sous l'empire de la législation du travail en vigueur en République Démocratique du Congo (Code du travail) :")], { spacing: { after: 120 } }),

        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "ENTRE LES PARTIES", bold: true, size: 20, color: BROWN })] }),
        // Prose (identique au contrat généré par le logiciel — le tableau a été retiré).
        para([
          b("TOLYA SARL"), r(", exploitant l'enseigne « Pâtes en Folie », immatriculée au RCCM sous le numéro CD/KNG/RCCM/18-B-01373, Id. Nat. 01-F4300-N74832J, N° Impôt A1820933, dont le siège est situé 31, avenue Comité Urbain - Gombe - Kinshasa, ci-après dénommée « "),
          b("l'Employeur"), r(" », d'une part ;"),
        ], { alignment: AlignmentType.LEFT }),
        para([
          r("Et "), b("Madame / Monsieur "), ph("NOM ET PRÉNOM DU SALARIÉ"),
          r(", né(e) le "), ph("DATE DE NAISSANCE"), r(" et de nationalité "), ph("NATIONALITÉ"),
          r(", matricule "), ph("MATRICULE"), r(", tél. "), ph("TÉLÉPHONE"),
          r(", demeurant à "), ph("ADRESSE DU SALARIÉ"),
          r(", ci-après dénommé(e) « "), b("le Salarié / la Salariée"), r(" », d'autre part.")
        ], { alignment: AlignmentType.LEFT }),

        new Paragraph({ spacing: { before: 120, after: 120 }, children: [new TextRun({ text: "IL A ÉTÉ CONVENU CE QUI SUIT :", bold: true, size: 20, color: BROWN })] }),

        ...article("Article 1 — Engagement et fonctions", [
          r("L'Employeur engage le Salarié, qui accepte, en qualité de "), ph("POSTE"),
          r(". Le Salarié exercera ses fonctions sous l'autorité et selon les directives de l'Employeur, et s'engage à les accomplir avec diligence et loyauté."),
        ]),
        para([
          r("À ce titre, il assure notamment les missions suivantes : "), ph("MISSIONS PRINCIPALES DE LA FICHE DE POSTE"),
        ]),
        ...article("Article 2 — Nature et durée du contrat", [
          r("Le présent contrat est un contrat de travail "), ph("TYPE : CDI / CDD / STAGE / JOURNALIER / INTÉRIM"),
          r(". Il prend effet le "), ph("DATE DE DÉBUT"),
          r(", et "), ph("[CDD : prend fin le DATE DE FIN] / [CDI : est conclu pour une durée indéterminée]"), r("."),
        ]),
        ...article("Article 3 — Période d'essai", [
          r("Les parties conviennent d'une période d'essai courant jusqu'au "), ph("FIN DE PÉRIODE D'ESSAI"),
          r(", conformément à l'article 43 de la loi n°15/2002 du 16 octobre 2002 portant Code du travail, durant laquelle chacune des parties peut mettre fin au contrat sans préavis ni indemnité. "),
          new TextRun({ text: "(Article omis automatiquement s'il n'y a pas de période d'essai.)", italics: true, color: GREY, size: 17 }),
        ]),
        ...article("Article 4 — Lieu et durée du travail", [
          r("Le Salarié exercera principalement ses fonctions au restaurant « Pâtes en Folie », sis 10, avenue Wagenia — CTC Mall — Kinshasa. La durée du travail est fixée à "),
          ph("HEURES / SEMAINE"), r(" heures par semaine, réparties selon le planning établi par l'Employeur."),
        ]),
        ...article("Article 5 — Rémunération", [
          r("En contrepartie de son travail, le Salarié percevra une rémunération mensuelle brute de "),
          ph("SALAIRE MENSUEL + DEVISE"),
          r(", payable à terme échu, sous déduction des cotisations et impôts légaux (CNSS, IPR). S'y ajoutent, le cas échéant, les indemnités et primes prévues par la politique de l'établissement (transport, allocations, heures supplémentaires) conformément à la réglementation."),
        ]),
        ...article("Article 6 — Congés et sécurité sociale", [
          r("Après douze (12) mois de service ininterrompu, le Salarié bénéficie de congés payés à hauteur de "), ph("DROITS DE CONGÉS / AN"),
          r(" jours ouvrables, acquis dans les conditions prévues par le Code du travail. Il est affilié à la Caisse Nationale de Sécurité Sociale (CNSS) et bénéficie de la couverture correspondante."),
        ]),
        ...article("Article 7 — Soins médicaux", [
          r("L'Employeur assure au Salarié les soins médicaux et pharmaceutiques dans les limites et aux conditions fixées par les articles 177 à 184 de la loi n°15/2002 du 16 octobre 2002 portant Code du travail et ses textes d'application. Les membres de la famille effectivement à charge et n'exerçant pas d'activité lucrative bénéficient des mêmes avantages."),
        ]),
        ...article("Article 8 — Rupture et préavis", [
          r("Le contrat peut être rompu par l'une ou l'autre des parties dans les conditions et formes prévues par le Code du travail, moyennant un préavis de "),
          ph("PRÉAVIS DÉMISSION"), r(" jours en cas de démission et de "), ph("PRÉAVIS LICENCIEMENT"),
          r(" jours en cas de licenciement. En cas de faute lourde — notamment vol, fraude, malversation, divulgation d'informations confidentielles, ou tout acte portant gravement atteinte à la réputation ou aux intérêts de l'établissement — le contrat peut être rompu immédiatement, sans préavis ni indemnité, conformément au Code du travail."),
        ]),
        ...article("Article 9 — Obligations et confidentialité", [
          r("Le Salarié s'engage à respecter le règlement intérieur, à consacrer pendant les heures de service son activité professionnelle à l'Employeur, et à faire preuve d'une discrétion absolue. Il s'interdit de divulguer ou d'utiliser à son profit ou au profit de tiers les informations confidentielles de l'établissement, aussi bien pendant la durée du contrat que pendant une (1) année après sa cessation, quelle qu'en soit la cause. Tout manquement constitue une faute lourde."),
        ]),
        ...article("Article 10 — Aptitude médicale", [
          r("L'aptitude physique du Salarié à l'emploi est constatée conformément à l'article 38 de la loi n°15/2002 du 16 octobre 2002 portant Code du travail, préalablement à sa prise de fonction."),
        ]),
        ...article("Article 11 — Litiges et dispositions diverses", [
          r("Pour tout ce qui n'est pas expressément prévu au présent contrat, et en cas de litige, les parties se réfèrent aux dispositions de la loi n°15/2002 du 16 octobre 2002 portant Code du travail de la République Démocratique du Congo et à ses textes d'application. Le présent contrat est établi en deux exemplaires originaux, chacune des parties reconnaissant en avoir reçu un."),
        ]),

        para([r("Le Salarié reconnaît avoir reçu, au moins deux jours ouvrables avant la signature, un exemplaire du projet de contrat dont il déclare avoir pris parfaite connaissance. La signature est précédée de la mention manuscrite « Lu et approuvé »."), r("")], { spacing: { before: 160, after: 120 } }),

        para([r("Fait à Kinshasa, le "), ph("DATE")], { alignment: AlignmentType.RIGHT, spacing: { before: 120, after: 300 } }),

        new Table({
          columnWidths: [4600, 4600], width: { size: 9200, type: WidthType.DXA },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: 4600, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 40 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: "333333" } }, children: [new TextRun({ text: "L'Employeur", bold: true })] })] }),
              new TableCell({ width: { size: 4600, type: WidthType.DXA }, children: [
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: "Lu et approuvé", italics: true, size: 18 })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 40 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: "333333" } }, children: [new TextRun({ text: "Le Salarié / la Salariée", bold: true })] }),
              ] }),
            ] }),
          ],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const sortie = path.join(os.homedir(), "Documents", "Contrat-modele-PEF.docx");
  fs.writeFileSync(sortie, buf);
  console.log("Word écrit :", sortie, "—", buf.length, "octets");
});
