import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";

// LOT 8 (plan d'ergonomie, V5) — « DÉCIDER UN BULLETIN SE FAIT DANS À VALIDER, JAMAIS DEPUIS PAIE ». Preuve sur une
// base éphémère, avec les VRAIES pages (Paie et À valider), les VRAIS chargeurs de compteurs et les VRAIES actions
// serveur ; seule la session est simulée (gardes de rôle et d'espace : les vrais prédicats).
//
//  1. PAIE : ni bouton, ni formulaire, ni case, ni barre d'actions groupées pour les bulletins — quel que soit le
//     rôle ; à la place, des liens « N bulletins à valider / à payer → À valider » aux MÊMES chiffres que le badge.
//  2. À VALIDER : tous les gestes qu'avait Paie y sont — valider, payer (moyen de paiement, date de versement),
//     rouvrir (ligne et lot), annuler un paiement — chacun au rôle qui l'avait (Direction ; la RH ne paie que).
//  3. SERVEUR : les droits par rôle n'ont pas bougé ; le refus d'« annuler un paiement » revient sur À valider.
//  4. SOURCE : aucun écran autre qu'À valider n'appelle les deux actions de décision.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => A.user }));
// L'aperçu « temps réel » recalcule les lignes non figées (et change leurs identifiants) : hors sujet ici.
vi.mock("@/lib/paie-refresh", async (orig) => ({ ...(await orig<typeof import("@/lib/paie-refresh")>()), rafraichirPaieAffichee: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const PAIE = await import("../paie/actions");
const CHARGEURS = await import("@/lib/a-valider-chargeurs");
const PAGE_PAIE = (await import("../paie/page")).default;
const PAGE_A_VALIDER = (await import("./page")).default;

let prisma: PrismaClient;
let fermer: () => Promise<void>;
type Compte = "DIR" | "MGR" | "VIEW" | "STK";
const COMPTES: Record<Compte, { role: Role; nom: string }> = {
  DIR: { role: "ADMIN", nom: "Direction" },
  MGR: { role: "MANAGER", nom: "Responsable RH" },
  VIEW: { role: "VIEWER", nom: "Consultation" },
  STK: { role: "STOCK", nom: "Magasinier" },
};
const ids = {} as Record<Compte, string>;
const S = {} as { aValider: string; aPayer: string; aPayer2: string; paye: string };

const en = (c: Compte) => { A.user = { id: ids[c], email: `${c}@pef.test`, nom: COMPTES[c].nom, role: COMPTES[c].role, accesStock: false, employeeId: null }; };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const paie = async (vue = "bulletins") => renderToStaticMarkup(await PAGE_PAIE({ searchParams: Promise.resolve({ vue }) }));
const aValider = async () => renderToStaticMarkup(await PAGE_A_VALIDER({ searchParams: Promise.resolve({}) }));

/** Le refus d'une action : valeur `{ erreur }`, `?erreur=` de redirection (avec sa page) ou erreur levée ; null si elle a réussi. */
async function tenter(fn: () => Promise<unknown>): Promise<{ page: string | null; message: string } | null> {
  try {
    const r = await fn();
    if (typeof r === "object" && r !== null && "erreur" in r) return { page: null, message: String((r as { erreur: unknown }).erreur) };
    return null;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url !== undefined) { const m = /^([^?]*)\?erreur=(.*)$/.exec(url); return m ? { page: m[1], message: decodeURIComponent(m[2]) } : { page: url, message: "" }; }
    return { page: null, message: e instanceof Error ? e.message : String(e) };
  }
}
const statut = async (id: string) => (await prisma.payrollLine.findUniqueOrThrow({ where: { id } })).statutPaiement;

let seq = 0;
async function employe(nom: string) {
  return (await prisma.employee.create({
    data: { matricule: `B-${++seq}`, nom, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" },
  })).id;
}
const ligne = (payrollRunId: string, employeeId: string, statutPaiement: "PAS_VALIDE" | "VALIDE" | "PAYE", extra: Record<string, unknown> = {}) => prisma.payrollLine.create({
  data: {
    payrollRunId, employeeId, statutPaiement, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0,
    salNetUSD: 270, salNetCDF: 756000, cnssPatronalUSD: 30, coutEmployeurUSD: 330, coutEmployeurCDF: 924000, ...extra,
  },
});

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const c of Object.keys(COMPTES) as Compte[]) ids[c] = (await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: COMPTES[c].nom, role: COMPTES[c].role } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const run = await prisma.payrollRun.create({ data: { mois: 10, annee: 2026, tauxChangeUtilise: 2800 } });
  S.aValider = (await ligne(run.id, await employe("Salarie Marque A-valider"), "PAS_VALIDE")).id;
  S.aPayer = (await ligne(run.id, await employe("Salarie Marque A-payer"), "VALIDE")).id;
  S.aPayer2 = (await ligne(run.id, await employe("Salarie Marque A-payer Deux"), "VALIDE")).id;
  S.paye = (await ligne(run.id, await employe("Salarie Marque Paye"), "PAYE", { datePaiement: new Date("2026-10-03"), modePaiement: "VIREMENT", payeParId: ids.DIR })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("Paie : plus aucun geste de décision sur les bulletins, quel que soit le rôle", () => {
  const GESTES = /Valider\b|Marquer payé|Rouvrir|Annuler le paiement|name="versStatut"|type="checkbox"|Tout sélectionner|actions groupées|sélectionné/;

  it.each(["DIR", "MGR", "VIEW"] as Compte[])("%s : la liste des bulletins s'affiche (noms, statuts, téléchargements) sans bouton ni case ni formulaire de décision", async (c) => {
    en(c);
    const html = await paie();
    for (const nom of ["Salarie Marque A-valider", "Salarie Marque A-payer", "Salarie Marque Paye"]) expect(html, nom).toContain(nom);
    expect(html).toContain("Pas validé");
    expect(html).toContain("Validé");
    expect(html).toContain("Payé");
    expect(html).toContain("/paie/bulletin/"); // le téléchargement reste
    // « Valider les bulletins » / « Payer les bulletins » : l'onglet s'appelle désormais « Bulletins ».
    expect(html).not.toMatch(/Valider les bulletins|Payer les bulletins/);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(GESTES);
    expect(html).not.toContain('name="versStatut"');
  });

  it("Direction : ce qui reste à Paie reste là (calcul, clôture, exports, réinitialisation)", async () => {
    en("DIR");
    const html = await paie();
    expect(html).toContain("Calculer la paie du mois");
    expect(html).toContain("Clôturer la paie");
    expect(html).toContain("Exporter");
    expect(html).toContain("Réinitialiser");
  });

  it("liens vers À valider, aux MÊMES chiffres que le badge : Direction « 1 à valider » et « 2 à payer »", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    en("DIR");
    const html = await paie();
    expect(html).toContain('href="/a-valider#bulletins-a-valider"');
    expect(html).toContain('href="/a-valider#bulletins-a-payer"');
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("1 bulletin à valider → À valider");
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("2 bulletins à payer → À valider");
    // Même source que le badge du menu : les éléments de la file, lus par le chargeur.
    const { elements } = await CHARGEURS.chargerAValiderRH({ id: ids.DIR, role: "ADMIN" });
    expect([elements.bulletinsAValider, elements.bulletinsAPayer]).toEqual([1, 2]);
    expect((await CHARGEURS.chargerBadgesRH({ id: ids.DIR, role: "ADMIN" }))["/paie"]).toBe(3);
  });

  it("Responsable RH : seulement « à payer » (la validation n'est pas la sienne) ; consultation : aucun lien", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    en("MGR");
    const rh = (await paie()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(rh).toContain("2 bulletins à payer → À valider");
    expect(rh).not.toContain("à valider → À valider");
    en("VIEW");
    const vue = await paie();
    expect(vue).not.toContain('href="/a-valider#');
    expect(vue.replace(/<[^>]+>/g, " ")).not.toMatch(/→ À valider/);
  });
});

describe("À valider : tous les gestes de Paie y sont, au rôle qui les avait", () => {
  const texte = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("Direction : valider, payer (moyen de paiement + date de versement), rouvrir (ligne et lot), cases, annuler un paiement", async () => {
    en("DIR");
    const html = await aValider();
    const t = texte(html);
    expect(t).toContain("Salarie Marque A-valider");
    expect(t).toContain("Bulletins à valider (1)");
    expect(t).toContain("Bulletins à payer (2)");
    expect(t).toMatch(/✓ Valider|Valider/); // valider (ligne)
    expect(t).toContain("Marquer payé");
    expect(t).toContain("↩ Rouvrir");
    expect(html).toContain('type="checkbox"'); // lots
    expect(html).toContain('aria-label="Moyen de paiement"'); // « Auto (selon la fiche) » par défaut, modifiable AVANT de payer une ligne
    expect(t).toContain("Auto (selon la fiche)");
    expect(t).toContain("Versement le");
    // Annuler un paiement : à part des files, Direction seule.
    expect(html).toContain('id="bulletins-payes"');
    expect(t).toContain("Bulletins payés du mois (1) — annuler un paiement");
    expect(t).toContain("Salarie Marque Paye");
    expect(t).toContain("payé le 03/10/2026 · virement");
    expect(html).toContain('name="versStatut" value="VALIDE"');
    expect(html).toContain('name="retour" value="/a-valider"');
    expect(t).toContain("↩ Annuler le paiement");
    // Le bulletin se télécharge en $ et en CDF depuis À valider.
    expect(html).toContain(`/paie/bulletin/${S.aPayer}?devise=USD&amp;dl=1`);
    expect(html).toContain(`/paie/bulletin/${S.aPayer}?devise=CDF&amp;dl=1`);
  });

  it("Responsable RH : « Marquer payé » seulement — ni valider, ni rouvrir, ni annuler un paiement ; les bulletins à valider lui sont cachés", async () => {
    en("MGR");
    const html = await aValider();
    const t = texte(html);
    expect(t).toContain("Salarie Marque A-payer");
    expect(t).toContain("Marquer payé");
    expect(t).toContain("Auto (selon la fiche)");
    expect(t).not.toMatch(/Rouvrir|Annuler le paiement/);
    expect(html).not.toContain('id="bulletins-payes"');
    expect(t).not.toContain("Salarie Marque A-valider");
    expect(t).not.toContain("Salarie Marque Paye");
    expect(t).not.toMatch(/✓ Valider|\bValider\b/);
  });

  it("consultation : rien du tout", async () => {
    en("VIEW");
    const html = await aValider();
    expect(html).not.toContain('type="checkbox"');
    expect(texte(html)).not.toMatch(/Marquer payé|Rouvrir|Annuler le paiement|Valider|Salarie Marque/);
  });
});

describe("À valider : les gestes marchent, aux droits d'avant (actions serveur)", () => {
  it("payer en lot depuis À valider : la RH le peut, avec le moyen de paiement et la date choisis ; l'état et le journal suivent", async () => {
    en("MGR");
    const jetons = { [S.aPayer]: await jetonDe(prisma, S.aPayer) };
    expect(await tenter(() => PAIE.changerStatutEnLot([S.aPayer], "PAYE", "MOBILE_MONEY", jetons, "2026-10-05"))).toBeNull();
    const l = await prisma.payrollLine.findUniqueOrThrow({ where: { id: S.aPayer } });
    expect(l.statutPaiement).toBe("PAYE");
    expect(l.modePaiement).toBe("MOBILE_MONEY");
    expect(l.datePaiement?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(l.payeParId).toBe(ids.MGR);
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: S.aPayer, versStatut: "PAYE" } })).toBe(1);
  });

  it("rouvrir : la RH et la consultation sont refusées (rien n'est écrit) ; la Direction rouvre une ligne validée", async () => {
    for (const c of ["MGR", "VIEW", "STK"] as Compte[]) {
      en(c);
      expect(await tenter(() => PAIE.changerStatutEnLot([S.aPayer2], "PAS_VALIDE", null, {})), c).not.toBeNull();
    }
    expect(await statut(S.aPayer2)).toBe("VALIDE");
    en("DIR");
    expect(await tenter(() => PAIE.changerStatutEnLot([S.aPayer2], "PAS_VALIDE", null, {}))).toBeNull();
    expect(await statut(S.aPayer2)).toBe("PAS_VALIDE");
    // …et la revalide « à la main » pour la suite (la validation et son contrôle du montant ont leurs tests : paie-validation-controle).
    await prisma.payrollLine.update({ where: { id: S.aPayer2 }, data: { statutPaiement: "VALIDE" } });
  });

  it("annuler un paiement : refusé à la RH et à la consultation (rien n'est écrit)", async () => {
    for (const c of ["MGR", "VIEW", "STK"] as Compte[]) {
      en(c);
      expect(await tenter(() => PAIE.changerStatutPaie(S.paye, fd({ versStatut: "VALIDE", retour: "/a-valider" }))), c).not.toBeNull();
    }
    expect(await statut(S.paye)).toBe("PAYE");
  });

  it("un refus de l'action revient sur l'écran d'où part le geste : À valider si le formulaire le dit, Paie sinon (liste fermée)", async () => {
    en("DIR");
    // Valider sans les montants affichés (jeton) : refus lisible, rien n'est écrit — le retour dit où le montrer.
    const refus = await tenter(() => PAIE.changerStatutPaie(S.aValider, fd({ versStatut: "VALIDE", retour: "/a-valider" })));
    expect(refus).not.toBeNull();
    expect(refus!.page).toBe("/a-valider");
    expect(refus!.message.length).toBeGreaterThan(10);
    for (const retour of ["https://exemple.test/hameçon", "//exemple.test", "/employes", ""]) {
      expect((await tenter(() => PAIE.changerStatutPaie(S.aValider, fd({ versStatut: "VALIDE", retour }))))!.page, retour).toBe("/paie");
    }
    // Sans le champ (l'ancien formulaire, les appels directs) : Paie, comme avant.
    expect((await tenter(() => PAIE.changerStatutPaie(S.aValider, fd({ versStatut: "VALIDE" }))))!.page).toBe("/paie");
    expect(await statut(S.aValider)).toBe("PAS_VALIDE");
  });

  it("annuler un paiement : la Direction le fait depuis À valider (Payé → Validé), la ligne redevient payable", async () => {
    en("DIR");
    expect(await tenter(() => PAIE.changerStatutPaie(S.paye, fd({ versStatut: "VALIDE", retour: "/a-valider" })))).toBeNull();
    expect(await statut(S.paye)).toBe("VALIDE");
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: S.paye, deStatut: "PAYE", versStatut: "VALIDE" } })).toBe(1);
  });

  it("en lot, « valider » ne vaut jamais « annuler un paiement » (une ligne payée cochée par mégarde reste payée)", async () => {
    en("DIR");
    expect(await tenter(() => PAIE.changerStatutEnLot([S.aPayer], "VALIDE", null, {}))).toBeNull(); // ignorée, pas d'erreur
    expect(await statut(S.aPayer)).toBe("PAYE");
  });

  it("les compteurs se relisent à neuf après un geste (cache vidé) : Paie annonce les chiffres d'après", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    en("DIR");
    const avant = (await CHARGEURS.chargerAValiderRH({ id: ids.DIR, role: "ADMIN" })).elements;
    expect([avant.bulletinsAValider, avant.bulletinsAPayer]).toEqual([0 + 1, 2]); // 1 à valider ; payer2 + « paye » annulé = 2 à payer
    en("MGR");
    const jetons = { [S.paye]: await jetonDe(prisma, S.paye) };
    expect(await tenter(() => PAIE.changerStatutEnLot([S.paye], "PAYE", null, jetons, "2026-10-06"))).toBeNull();
    en("DIR");
    const apres = (await CHARGEURS.chargerAValiderRH({ id: ids.DIR, role: "ADMIN" })).elements; // aucun reset manuel : l'action l'a fait
    expect(apres.bulletinsAPayer).toBe(1);
    expect(texteLiens(await paie())).toContain("1 bulletin à payer → À valider");
  });
});

const texteLiens = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// RELECTURE DU LOT 8 (2026-10-12) : « À valider » liste les bulletins à payer de TOUS les mois, et y offrait
// « Rouvrir » sur chacun. Rouvert, le bulletin validé-impayé d'un mois clôturé devient « hors calcul »
// (paie-hors-calcul.ts) : il sort des totaux et des déclarations de son mois, n'est plus revalidable nulle part
// (la file « à valider » ne suit que le mois courant), et son échéance de prêt comme ses frais médicaux
// reviennent à la fiche du mois en cours. Sur l'écran Paie (mois courant seulement) le geste n'existait pas.
describe("Rouvrir : le bulletin du mois en cours seulement, jamais celui d'un mois clôturé", () => {
  let sept = "";
  beforeAll(async () => {
    const run = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2750, statut: "VALIDE" } });
    sept = (await ligne(run.id, await employe("Salarie Septembre Impaye"), "VALIDE", { tauxChangeFige: 2750 })).id;
  });

  it("l'écran : la ligne de septembre est à payer, sans « Rouvrir » ; celle du mois en cours le garde", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    en("DIR");
    const html = await aValider();
    const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).toContain("Salarie Septembre Impaye");
    expect(t).toContain("Paie de septembre 2026");
    // Deux lignes à payer (octobre : « A-payer Deux » ; septembre) mais un seul « Rouvrir » de ligne.
    expect(t).toContain("Bulletins à payer (2)");
    expect(t.match(/↩ Rouvrir/g)).toHaveLength(1);
  });

  it("le serveur refuse, à l'unité comme en lot, et n'écrit rien (statut, taux figé, transitions)", async () => {
    en("DIR");
    const lot = await tenter(() => PAIE.changerStatutEnLot([sept], "PAS_VALIDE", null, {}));
    expect(lot?.message).toMatch(/Salarie Septembre Impaye : ce bulletin appartient à la paie de septembre 2026, qui n'est plus le mois en cours/);
    // Un lot mêlant une ligne du mois et une de septembre est refusé EN ENTIER.
    const mixte = await tenter(() => PAIE.changerStatutEnLot([S.aPayer2, sept], "PAS_VALIDE", null, {}));
    expect(mixte?.message).toMatch(/septembre 2026/);
    expect(await statut(S.aPayer2)).toBe("VALIDE");
    const unite = await tenter(() => PAIE.changerStatutPaie(sept, fd({ versStatut: "PAS_VALIDE", retour: "/a-valider" })));
    expect(unite?.page).toBe("/a-valider");
    expect(unite?.message).toMatch(/n'est plus le mois en cours/);
    const l = await prisma.payrollLine.findUniqueOrThrow({ where: { id: sept } });
    expect(l.statutPaiement).toBe("VALIDE");
    expect(Number(l.tauxChangeFige)).toBe(2750);
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: sept } })).toBe(0);
  });

  it("il reste payable : la RH le marque payé depuis À valider (taux figé conservé)", async () => {
    en("MGR");
    const jetons = { [sept]: await jetonDe(prisma, sept) };
    expect(await tenter(() => PAIE.changerStatutEnLot([sept], "PAYE", null, jetons, "2026-10-07"))).toBeNull();
    const l = await prisma.payrollLine.findUniqueOrThrow({ where: { id: sept } });
    expect(l.statutPaiement).toBe("PAYE");
    expect(Number(l.tauxChangeFige)).toBe(2750);
  });
});
