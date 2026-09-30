import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Tableau de bord Stock par mois (demande de la Direction du 2026-09-30) : rendu de la VRAIE page
// sur une base éphémère, horloge fixée au mercredi 30 septembre 2026 (seule la date est simulée,
// les minuteries de Postgres restent vraies).
//  - mois courant : mêmes chiffres qu'avant le sélecteur (valeurs relevées sur l'ancienne page) ;
//  - août 2026 (clôturé) : blocs par période sur août, valeur du stock figée à la clôture, le reste
//    étiqueté « aujourd'hui » ;
//  - juillet 2026 (non clôturé) : valeur du stock d'aujourd'hui, dite comme telle ;
//  - liens des cartes : le mois suit quand la liste sait filtrer par mois.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "tdb@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Retire du HTML l'élément (et tout son contenu) qui porte l'attribut `attr` ; il doit être unique. */
function retirerElement(html: string, attr: string): { reste: string; retire: string } {
  const i = html.indexOf(attr);
  if (i < 0 || html.indexOf(attr, i + 1) >= 0) throw new Error(`${attr} : attendu une et une seule fois`);
  const debut = html.lastIndexOf("<", i);
  const balise = /^<([a-z0-9]+)/.exec(html.slice(debut))![1];
  const re = new RegExp(`<${balise}[\\s>]|</${balise}>`, "g");
  re.lastIndex = debut;
  let profondeur = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    profondeur += m[0].startsWith("</") ? -1 : 1;
    if (profondeur === 0) {
      const fin = m.index + m[0].length;
      return { reste: html.slice(0, debut) + html.slice(fin), retire: html.slice(debut, fin) };
    }
  }
  throw new Error(`${attr} : élément non refermé`);
}

async function rendreHtml(sp: { mois?: string } = {}): Promise<string> {
  const { default: StockDashboard } = await import("./page");
  return renderToStaticMarkup(await StockDashboard({ searchParams: Promise.resolve(sp) }));
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "tdb@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });

  const creer = async (designation: string, prix: string, quantite: string, stockMinimum: string) => {
    const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: prix } });
    await prisma.stock.create({ data: { articleId: a.id, quantite, stockMinimum } });
    return a;
  };
  // Aujourd'hui : 10 × 2,50 + 3 × 4,00 + 0 × 7,00 = 37,00. Urgent : Beurre. À réappro : Sel.
  const farine = await creer("Farine", "2.5", "10", "0");
  const sel = await creer("Sel", "4", "3", "5");
  await creer("Beurre", "7", "0", "2");

  // Clôture d'août : inventaire figé à 52,50 $ (21 kg de farine à 2,50).
  await prisma.clotureStock.create({
    data: {
      annee: 2026, mois: 8,
      snapshot: { valeurTotaleUSD: 52.5, lignes: [{ articleId: farine.id, code: "", designation: "Farine", domaine: "NOURRITURE", unite: "kg", categorie: "", fournisseur: "", quantite: 21, stockMinimum: 0, prixUnitaireUSD: 2.5 }] },
    },
  });

  // Factures : 120 à régler cette semaine (sept.), 80 échue non réglée (août), 500 réglée (sept.),
  // 60 réglée d'août.
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. Sept", montantUSD: 120, resteAPayerUSD: 120, mois: 9, annee: 2026, statut: "A_REGLER", dateEcheance: d("2026-09-30"), createdAt: new Date("2026-09-20T09:00:00Z") } });
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. Echue", montantUSD: 80, resteAPayerUSD: 80, mois: 8, annee: 2026, statut: "ECHUE_NON_REGLEE", createdAt: new Date("2026-08-05T09:00:00Z") } });
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. Reglee", montantUSD: 500, resteAPayerUSD: 0, mois: 9, annee: 2026, statut: "REGLEE", createdAt: new Date("2026-09-10T09:00:00Z") } });
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. Aout", montantUSD: 60, resteAPayerUSD: 0, mois: 8, annee: 2026, statut: "REGLEE", createdAt: new Date("2026-08-12T09:00:00Z") } });

  // Légumes : septembre 15,50 (1 achat) ; août 9,25 + 3,00 = 12,25 (2 achats).
  await prisma.achatLegume.create({ data: { date: d("2026-09-29"), legume: "Tomate", quantite: 5, montantUSD: 15.5 } });
  await prisma.achatLegume.create({ data: { date: d("2026-08-10"), legume: "Oignon", quantite: 3, montantUSD: 9.25 } });
  await prisma.achatLegume.create({ data: { date: d("2026-08-20"), legume: "Poivron", quantite: 1, montantUSD: 3 } });

  // Mouvements. Septembre : sorties 12,00 + 2 × 2,50 = 17,00 (2). Août : sortie 7,50 + perte de
  // 1 kg de sel sans montant (1 × 4,00) = 11,50 (2) ; une entrée ; un ajustement.
  const mvt = (articleId: string, type: "ENTREE" | "SORTIE" | "AJUSTEMENT", quantite: number, date: string, extra: Record<string, unknown> = {}) =>
    prisma.mouvementStock.create({ data: { articleId, type, quantite, date: d(date), createdAt: new Date(`${date}T12:00:00Z`), ...extra } });
  await mvt(farine.id, "SORTIE", 4, "2026-09-28", { montantUSD: 12 });
  await mvt(farine.id, "SORTIE", 2, "2026-09-29");
  await mvt(farine.id, "SORTIE", 3, "2026-08-14", { montantUSD: 7.5 });
  await mvt(sel.id, "SORTIE", 1, "2026-08-18", { categorieSortie: "PERTE", raisonSortie: "Sel humide août" });
  await mvt(farine.id, "ENTREE", 20, "2026-08-03");
  await mvt(sel.id, "AJUSTEMENT", 2, "2026-08-25");

  // Bons de commande : un en septembre, un en août.
  await prisma.bonDeCommande.create({ data: { numero: "001/PEF/SEPT/26", sequence: 1, annee: 2026, mois: 9, date: d("2026-09-02"), statut: "VALIDE", createdAt: new Date("2026-09-02T09:00:00Z") } });
  await prisma.bonDeCommande.create({ data: { numero: "009/PEF/AOUT/26", sequence: 9, annee: 2026, mois: 8, date: d("2026-08-07"), statut: "VALIDE", createdAt: new Date("2026-08-07T09:00:00Z") } });

  // Comptages : 31 août (3 articles) et 29 septembre (2 articles).
  await prisma.sessionComptage.create({ data: { date: d("2026-08-31"), nbArticles: 3, createdAt: new Date("2026-08-31T18:00:00Z") } });
  await prisma.sessionComptage.create({ data: { date: d("2026-09-29"), nbArticles: 2, createdAt: new Date("2026-09-29T18:00:00Z") } });
}, 120_000);

afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

// Texte de l'ANCIENNE page (sans sélecteur, 90133f9) rendue sur ce même jeu de données au 30/09/2026 :
// relevé avant la modification. La nouvelle page, au mois courant, doit le redonner à l'identique,
// au titre du sélecteur près.
const AVANT = " ST Bonjour Sacha Direction · mercredi 30 septembre 2026 · Stock & Achats Taux du jour 1 USD = 2 800 CDF Articles 3 Alertes urgentes 1 À réapprovisionner 1 Valeur du stock 37,00 $ Factures à payer 200,00 $ 2 facture(s) Commandes du mois 1 À régler cette semaine 120,00 $ 1 facture(s) Factures échues 80,00 $ 1 facture(s) Légumes frais du mois 15,50 $ 1 achat(s) Conso. du mois (sorties) ≈ 17,00 $ 2 sortie(s) valorisées Articles au seuil minimum (2) Tout voir Beurre 0 Sel 3 Derniers bons de commande Tout voir 001/PEF/SEPT/26 · — Validé 009/PEF/AOUT/26 · — Validé Dernières factures Tout voir Fourn. Sept · 120,00 $ À régler Fourn. Reglee · 500,00 $ Réglée Fourn. Aout · 60,00 $ Réglée Fourn. Echue · 80,00 $ Échue non réglée Dernières entrées & sorties Tout voir Farine · 29/09/2026 −2 Farine · 28/09/2026 −4 Sel · 18/08/2026 −1 Farine · 14/08/2026 −3 Farine · 03/08/2026 +20 Réconciliations récentes (ajustements) Tout voir Sel · 25/08/2026 2 Derniers comptages Tout voir 29/09/2026 · 2 article(s) 0 écart(s) 31/08/2026 · 3 article(s) 0 écart(s) Pertes récentes Tout voir Sel · 18/08/2026 −1 Sel humide août Articles les plus commandés Tout voir Aucune commande enregistrée. Fournisseurs les plus sollicités Tout voir Aucun bon de commande. 0 fournisseurs · 3 articles au catalogue. ";

describe("accueil Stock — mois courant inchangé", () => {
  it("sans ?mois= : exactement le texte d'avant, au titre du sélecteur et aux cartes « Entrées de stock » près", async () => {
    const html = await rendreHtml();
    // Les cartes « Entrées de stock » (autre chantier, même demande) : un seul bloc, repéré par
    // `data-cartes-entrees-stock`, posé juste après les cartes du mois et avant les listes.
    const { reste: sansCartes, retire } = retirerElement(html, "data-cartes-entrees-stock");
    expect(texte(retire)).toContain("Entrées de stock");
    expect(sansCartes).not.toContain("data-cartes-entrees-stock");
    // Le bloc « Plats (disponibilité selon le stock) » (demande du 2026-09-30) : repéré de même (un
    // rendu statique ne montre que le repli de son Suspense ; le contenu est testé plus bas) ; le
    // reste de la page n'a pas bougé.
    const { reste, retire: blocPlats } = retirerElement(sansCartes, "data-bloc-disponibilite-plats");
    expect(texte(blocPlats)).toContain("Plats : chargement…");
    const t = texte(reste);
    expect(t).toContain(" Le mois · septembre 2026 Mois Afficher");
    // Tout le reste : le texte d'avant, à l'identique et dans le même ordre.
    expect(t.replace(" Le mois · septembre 2026 Mois Afficher", "")).toBe(AVANT);
    const tt = texte(html);
    expect(tt.indexOf("Entrées de stock")).toBeGreaterThan(tt.indexOf("Conso. du mois (sorties)"));
    expect(tt.indexOf("Entrées de stock")).toBeLessThan(tt.indexOf("Articles au seuil minimum"));
  }, 60_000);

  it("?mois= du mois courant = adresse nue (même HTML), sans lien de retour ni étiquette « aujourd'hui »", async () => {
    const nu = await rendreHtml();
    expect(await rendreHtml({ mois: "2026-09" })).toBe(nu);
    expect(await rendreHtml({ mois: "2026-9" })).toBe(nu);
    expect(nu).not.toContain("data-retour-mois-courant");
    expect(nu).not.toContain("data-avertissement-instantane");
    expect(texte(nu)).not.toContain("aujourd'hui");
  }, 60_000);
});

describe("accueil Stock — sélecteur de mois", () => {
  it("mois courant par défaut, mois dans le champ, flèches vers les mois adjacents", async () => {
    const html = await rendreHtml();
    expect(html).toMatch(/<input type="month"[^>]* name="mois" value="2026-09"/);
    expect(html).toContain('href="/stock?mois=2026-08"');
    expect(html).toContain('href="/stock?mois=2026-10"');
  }, 60_000);

  it("un autre mois : lu dans l'URL, flèches recalculées, lien de retour au mois courant", async () => {
    const html = await rendreHtml({ mois: "2026-08" });
    expect(texte(html)).toContain("Le mois · août 2026");
    expect(html).toMatch(/<input type="month"[^>]* name="mois" value="2026-08"/);
    expect(html).toContain('href="/stock?mois=2026-07"');
    expect(html).toContain('href="/stock?mois=2026-09"');
    expect(html).toMatch(/<a [^>]*data-retour-mois-courant="true" href="\/stock">Revenir à septembre 2026<\/a>/);
  }, 60_000);

  it("mois invalide : mois courant ; mois futur : accepté, comme dans l'Exploitation", async () => {
    const nu = await rendreHtml();
    expect(await rendreHtml({ mois: "2026-13" })).toBe(nu);
    expect(await rendreHtml({ mois: "n'importe quoi" })).toBe(nu);
    const t = texte(await rendreHtml({ mois: "2026-10" }));
    expect(t).toContain("Le mois · octobre 2026");
    expect(t).toContain("Valeur du stock 37,00 $ aujourd'hui · aucun inventaire figé pour octobre 2026");
  }, 60_000);
});

describe("accueil Stock — un mois passé", () => {
  it("les blocs par période sont calculés sur le mois choisi", async () => {
    const t = texte(await rendreHtml({ mois: "2026-08" }));
    expect(t).toContain("Commandes du mois 1 ");
    expect(t).toContain("Légumes frais du mois 12,25 $ 2 achat(s)");
    expect(t).toContain("Conso. du mois (sorties) ≈ 11,50 $ 2 sortie(s) valorisées");
    expect(t).toContain("Derniers bons de commande · août 2026 Tout voir 009/PEF/AOUT/26");
    expect(t).not.toContain("001/PEF/SEPT/26");
    expect(t).toContain("Dernières factures · août 2026 Tout voir Fourn. Aout · 60,00 $ Réglée Fourn. Echue · 80,00 $ Échue non réglée Dernières");
    expect(t).toContain("Dernières entrées & sorties · août 2026 Tout voir Sel · 18/08/2026 −1 Farine · 14/08/2026 −3 Farine · 03/08/2026 +20 Réconciliations");
    expect(t).toContain("Réconciliations récentes (ajustements) · août 2026 Tout voir Sel · 25/08/2026 2 Derniers");
    expect(t).toContain("Derniers comptages · août 2026 Tout voir 31/08/2026 · 3 article(s) 0 écart(s) Pertes");
    expect(t).toContain("Pertes récentes · août 2026 Tout voir Sel · 18/08/2026 −1 Sel humide août");
    expect(t).not.toContain("29/09/2026");
    // Juillet : rien ce mois-là — « — » pour une somme vide, jamais « 0,00 $ » inventé.
    const juillet = texte(await rendreHtml({ mois: "2026-07" }));
    expect(juillet).toContain("Commandes du mois 0 ");
    expect(juillet).toContain("Légumes frais du mois — 0 achat(s)");
    expect(juillet).toContain("Derniers bons de commande · juillet 2026 Tout voir Aucun bon de commande.");
  }, 60_000);

  it("les blocs instantanés disent « aujourd'hui » ; la valeur du stock vient de la clôture quand elle existe", async () => {
    const t = texte(await rendreHtml({ mois: "2026-08" }));
    expect(t).toContain("Articles 3 aujourd'hui");
    expect(t).toContain("Alertes urgentes 1 aujourd'hui");
    expect(t).toContain("À réapprovisionner 1 aujourd'hui");
    expect(t).toContain("Valeur du stock 52,50 $ figée à la clôture d'août 2026");
    expect(t).toContain("Factures à payer 200,00 $ 2 facture(s) · aujourd'hui");
    expect(t).toContain("À régler cette semaine 120,00 $ 1 facture(s) · semaine en cours");
    expect(t).toContain("Factures échues 80,00 $ 1 facture(s) · aujourd'hui");
    expect(t).toContain("Articles au seuil minimum (2) · aujourd'hui");
    expect(t).toContain("Articles les plus commandés · tous mois confondus");
    expect(t).toContain("Fournisseurs les plus sollicités · tous mois confondus");
    expect(t).toContain("le stock du passé n'est pas reconstitué");
    // Juillet n'est pas clôturé : la valeur est celle d'aujourd'hui, dite comme telle.
    const juillet = texte(await rendreHtml({ mois: "2026-07" }));
    expect(juillet).toContain("Valeur du stock 37,00 $ aujourd'hui · aucun inventaire figé pour juillet 2026");
  }, 60_000);
});

describe("accueil Stock — les liens gardent le mois", () => {
  it("mois passé : Mouvements (mois, motif perte), Bons de commande (année + mois), Factures (année)", async () => {
    const html = await rendreHtml({ mois: "2026-08" });
    expect(html.match(/href="\/stock\/mouvements\?mois=2026-8"/g)).toHaveLength(2); // conso + entrées & sorties
    expect(html).toContain('href="/stock/mouvements?mois=2026-8&amp;motif=perte"');
    expect(html.match(/href="\/stock\/commandes\?annee=2026&amp;mois=8"/g)).toHaveLength(2); // carte + derniers BC
    expect(html).toContain('href="/stock/factures?annee=2026"');
    expect(html).not.toMatch(/href="\/stock\/mouvements"/);
    // Les listes d'aujourd'hui (impayés, alertes) ne prennent pas le mois.
    expect(html).toContain('href="/stock/factures?statut=du"');
    expect(html).toContain('href="/stock/catalogue?alerte=URGENT"');
  }, 60_000);

  it("mois courant : cartes du mois filtrées sur le mois, listes « derniers … » avec leurs liens d'avant", async () => {
    const html = await rendreHtml();
    expect(html).toContain('href="/stock/mouvements?mois=2026-9"');
    expect(html).toContain('href="/stock/commandes?annee=2026&amp;mois=9"');
    expect(html).toContain('href="/stock/mouvements"');
    expect(html).toContain('href="/stock/commandes"');
    expect(html).toContain('href="/stock/factures"');
  }, 60_000);
});

describe("accueil Stock — Plats (disponibilité selon le stock)", () => {
  beforeAll(async () => {
    // Farine : mouvementée les 28 et 29/09 (stock qui fait foi, 10 kg). Beurre : 0 kg, jamais mouvementé.
    const farine = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Farine" } });
    const beurre = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Beurre" } });
    const fiche = (nom: string, articleId: string, type: "PLAT" | "BAR" = "PLAT") =>
      prisma.ficheTechnique.create({ data: { nom, type, ingredients: { create: [{ articleId, unite: "kg", quantite: "0.1", ordre: 1 }] } } });
    await fiche("Pâtes fraîches", farine.id);
    await fiche("Gratin au beurre", beurre.id);
    await fiche("Mojito", farine.id, "BAR");
    await prisma.ficheTechnique.create({ data: { nom: "Tartine de pain de campagne" } }); // sans recette
  }, 60_000);

  // Le bloc chargé, rendu seul (le rendu statique de la page n'en montre que le repli).
  const blocCharge = async (periode?: string) => {
    const { BlocDisponibilitePlatsCharge } = await import("./_tableau-de-bord/bloc-disponibilite-plats");
    return renderToStaticMarkup(await BlocDisponibilitePlatsCharge({ periode }));
  };

  it("mêmes chiffres que l'Exploitation : le décompte vient de la fonction partagée, pas d'un second calcul", async () => {
    const { chargerDisponibilitePlats } = await import("./fiches/_data/disponibilite-plats");
    const { plats, bar } = await chargerDisponibilitePlats();
    // Sanity du jeu de données : un plat dispo, un plat non dispo, une recette à compléter, une fiche Bar.
    expect(plats.etats.DISPONIBLE).toBe(1);
    expect(plats.etats.RUPTURE + plats.etats.A_VERIFIER).toBe(1);
    expect(plats.recettesACompleter).toBe(1);
    expect(bar.nbVendues).toBe(1);
    const t = texte(await blocCharge());
    expect(t).toContain(`Plats en rupture ${plats.etats.RUPTURE} Plats à vérifier ${plats.etats.A_VERIFIER} Plats disponibles 1 Recettes à compléter 1`);
    expect(t).toContain(`Fiches Bar (à part des plats) ${bar.etats.DISPONIBLE} dispo. · ${bar.etats.RUPTURE} rupture · ${bar.etats.A_VERIFIER} à vérifier`);
  }, 60_000);

  it("chaque ligne mène à la liste des fiches filtrée ; le mois courant ne porte pas d'étiquette", async () => {
    const h = await blocCharge();
    expect(h).toContain('href="/stock/fiches?etat=RUPTURE"');
    expect(h).toContain('href="/stock/fiches?etat=A_VERIFIER"');
    expect(h).toContain('href="/stock/fiches?etat=DISPONIBLE"');
    expect(h).toContain('href="/stock/fiches?vue=boissons"');
    expect(h).toContain('href="/stock/fiches"'); // « Tout voir » et « Recettes à compléter »
    expect(h).not.toContain("data-periode");
  }, 60_000);

  // Props que la page donne au bloc (l'arbre React, sans le rendre : un rendu statique ne résout pas Suspense).
  const propsDuBloc = async (sp: { mois?: string }) => {
    const { default: StockDashboard } = await import("./page");
    const { BlocDisponibilitePlats } = await import("./_tableau-de-bord/bloc-disponibilite-plats");
    const trouves: { voit: boolean; periode?: string }[] = [];
    const parcourir = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(parcourir); return; }
      if (!n || typeof n !== "object" || !("props" in n)) return;
      const el = n as { type: unknown; props: { children?: unknown; voit?: boolean; periode?: string } };
      if (el.type === BlocDisponibilitePlats) trouves.push({ voit: el.props.voit as boolean, periode: el.props.periode });
      parcourir(el.props.children);
    };
    parcourir(await StockDashboard({ searchParams: Promise.resolve(sp) }));
    return trouves;
  };

  it("mois passé : la page donne « aujourd'hui » au bloc (et rien au mois courant) ; les chiffres, eux, ne dépendent pas du mois", async () => {
    expect(await propsDuBloc({})).toEqual([{ voit: true, periode: undefined }]);
    expect(await propsDuBloc({ mois: "2026-08" })).toEqual([{ voit: true, periode: "aujourd'hui" }]);
    const courant = texte(await blocCharge());
    const passe = texte(await blocCharge("aujourd'hui"));
    expect(passe).toContain("Plats (disponibilité selon le stock) · aujourd'hui Tout voir");
    expect(passe.replace(" · aujourd'hui", "")).toBe(courant);
  }, 60_000);

  it("rôles : Direction et Stock le voient, un salarié avec accès stock aussi (même garde que Fiches techniques) ; sans droit, rien n'est lu ni affiché", async () => {
    const { voitDisponibilitePlats, BlocDisponibilitePlats } = await import("./_tableau-de-bord/bloc-disponibilite-plats");
    expect(voitDisponibilitePlats({ role: "ADMIN" })).toBe(true);
    expect(voitDisponibilitePlats({ role: "STOCK" })).toBe(true);
    expect(voitDisponibilitePlats({ role: "EMPLOYE", accesStock: true })).toBe(true);
    expect(voitDisponibilitePlats({ role: "EMPLOYE", accesStock: false })).toBe(false);
    expect(voitDisponibilitePlats({ role: "COMPTA" })).toBe(false);
    expect(voitDisponibilitePlats({ role: "MANAGER" })).toBe(false);
    expect(BlocDisponibilitePlats({ voit: false })).toBeNull();
    // Rôle STOCK : la page rend le bloc.
    const avant = A.user.role;
    A.user.role = "STOCK";
    try { expect(await rendreHtml()).toContain("data-bloc-disponibilite-plats"); } finally { A.user.role = avant; }
  }, 60_000);
});
