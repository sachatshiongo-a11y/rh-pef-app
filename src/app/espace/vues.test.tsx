import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Les vues de l'Accueil et de « Mes congés » (lot 6) rendues telles quelles : un salarié ne doit lire
// ni code d'énumération (« EN_ATTENTE », « APPROUVE »…) ni en-tête en capitales criées.
vi.mock("@/app/(app)/employes/[id]/contrat-viewer", () => ({ ContratViewerButton: ({ libelle }: { libelle: string }) => <button>{libelle}</button> }));

const { VueAccueil } = await import("./vue-accueil");
const { VueMesConges } = await import("./conges/vue");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const CODES_BRUTS = /\b(EN_ATTENTE|APPROUVE|REFUSE|ANNULE|A_SIGNER|A_RESIGNER|DEMANDE_CONGE)\b/;

describe("VueAccueil", () => {
  const rendu = (p: Partial<Parameters<typeof VueAccueil>[0]> = {}) =>
    texte(renderToStaticMarkup(
      <VueAccueil prenom="Awa" contratsASigner={0} echangesARepondre={0} congesEnAttente={1} soldeConge={7.5} prochainService={null} {...p} />,
    ));

  it("annonce ce qui attend un geste, et seulement s'il y en a", () => {
    expect(rendu()).not.toMatch(/à signer|à accepter/);
    const t = rendu({ contratsASigner: 1, echangesARepondre: 2 });
    expect(t).toContain("1 contrat à signer");
    expect(t).toContain("2 propositions d'échange à accepter ou refuser");
  });

  it("solde en clair, « — » sans service publié, tout l'espace rangé en trois groupes", () => {
    const t = rendu();
    expect(t).toContain("7,5 j");
    expect(t).toContain("Aucun service publié pour le moment.");
    for (const g of ["Mon travail", "Congés et paie", "Mes papiers"]) expect(t).toContain(g);
  });

  it("prochain service : horaire, nom et jour", () => {
    const t = rendu({ prochainService: { nom: "Matin", heureDebut: "07:00", heureFin: "15:00", date: jour("2026-10-05"), aujourdhui: false } });
    expect(t).toContain("07:00 – 15:00");
    expect(t).toMatch(/Matin · lundi 5 octobre/);
  });
});

describe("VueMesConges", () => {
  const base = {
    nomSalarie: "Awa Test",
    solde: { acquis: 18, pris: 5, solde: 13, typesDeduits: ["Congé annuel"] },
    annee: 2026,
    types: ["Congé annuel", "Maladie"],
    feries: [],
    aujourdhui: "2026-09-28",
    envoye: false,
    erreur: null,
    demanderConge: async () => {},
    signer: async () => undefined,
  };
  const demande = (id: string, statut: string, debut: string, fin: string) => ({
    id, type: "Congé annuel", nbJours: 3, dateDebut: jour(debut), dateFin: jour(fin), motif: null, statut,
    signature: statut === "APPROUVE" ? { etat: "A_SIGNER" as const, signeLeTexte: null } : null,
  });

  it("le solde, ce qui s'en déduit, et des statuts en clair", () => {
    const html = renderToStaticMarkup(
      <VueMesConges
        {...base}
        demandes={[
          demande("a", "EN_ATTENTE", "2026-10-12", "2026-10-14"),
          demande("b", "APPROUVE", "2026-10-01", "2026-10-03"),
          demande("c", "REFUSE", "2026-08-01", "2026-08-03"),
        ]}
      />,
    );
    const t = texte(html);
    expect(t).toMatch(/13 j Il vous reste/);
    expect(t).toContain("Pris en 2026");
    expect(t).toContain("Se déduisent de votre solde : Congé annuel.");
    expect(t).toContain("En attente");
    expect(t).toContain("Acceptée");
    expect(t).toContain("Refusée");
    expect(t).toContain("Voir le document");
    expect(t).not.toMatch(CODES_BRUTS);
    expect(html).not.toMatch(/uppercase/);
  });

  it("une erreur ouvre le formulaire pour corriger", () => {
    const html = renderToStaticMarkup(<VueMesConges {...base} erreur="La date de fin doit être après la date de début." demandes={[]} />);
    expect(html).toMatch(/<details[^>]*open/);
    expect(texte(html)).toContain("La date de fin doit être après la date de début.");
  });
});
