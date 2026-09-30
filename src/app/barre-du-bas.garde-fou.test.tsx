// @vitest-environment happy-dom
//
// GARDE-FOU DE LA BARRE DU BAS (demande de la Direction, 2026-09-29) : sur téléphone, TOUS les
// espaces ont la même barre de navigation en bas — quatre écrans + « Menu » — et c'est UN SEUL
// composant (`@/components/barre-du-bas`). Ce fichier fait échouer la suite si :
//   1. une coquille d'espace (tout fichier `*-shell.tsx` sous src/app, énumérés sur le disque et
//      non tenus à la main) n'utilise pas le composant commun, garde un hamburger « Ouvrir le
//      menu » en haut, ou refabrique sa propre barre fixée en bas ;
//   2. une entrée de barre n'existe pas dans le menu de son espace, ou mène à une page absente
//      (lien mort), ou si un rôle de l'espace se retrouve avec moins de quatre entrées ;
//   3. monté pour de vrai, « Menu » n'ouvre pas le tiroir complet de l'espace (toutes ses entrées
//      + le bloc du compte), ou le badge d'une entrée n'apparaît pas dans la barre.
// Ce qu'il ne couvre PAS : le rendu à l'écran (hauteurs réelles, débordement à 375 px, PWA iOS) —
// cela se vérifie à l'œil, dans un navigateur.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { choisirBarreDuBas, ENTREES_BARRE_MAX, type CandidatBarre, type GroupeMenu } from "@/lib/navigation-espaces";
import * as navRH from "./(app)/navigation";
import * as navStock from "./(stock)/navigation";
import * as navExploitation from "./(exploitation)/navigation";
import { BARRE_DU_BAS as BARRE_SALARIE, LIENS_ESPACE } from "./espace/navigation";

const APP = __dirname;
const lire = (rel: string) => readFileSync(path.join(APP, rel), "utf8");

/** Toutes les coquilles d'espace du dépôt : les fichiers `*-shell.tsx` sous src/app. */
function coquilles(dir = APP): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...coquilles(p));
    else if (n.endsWith("-shell.tsx")) out.push(path.relative(APP, p));
  }
  return out.sort();
}

/** Un flou d'arrière-plan (classe Tailwind ou style) — les commentaires qui le proscrivent n'y répondent pas. */
const FLOU = /\bbackdrop-(?:blur|saturate|brightness|contrast|grayscale|hue-rotate|invert|opacity|sepia)\b|backdropFilter/;

const ESPACES: { nom: string; groupe: string; nav: { NAV_GROUPS: GroupeMenu[]; BARRE_DU_BAS: CandidatBarre[] }; roles: string[] }[] = [
  { nom: "RH", groupe: "(app)", nav: navRH, roles: ["ADMIN", "MANAGER", "VIEWER"] },
  { nom: "Stock", groupe: "(stock)", nav: navStock, roles: ["ADMIN", "STOCK", "EMPLOYE"] },
  { nom: "Exploitation", groupe: "(exploitation)", nav: navExploitation, roles: ["ADMIN", "COMPTA"] },
];

describe("barre du bas — chaque coquille utilise le composant commun", () => {
  const fichiers = coquilles();

  it("les quatre coquilles connues sont bien énumérées (plancher anti-silence)", () => {
    expect(fichiers.length).toBeGreaterThanOrEqual(4);
    for (const f of ["(app)/app-shell.tsx", "(stock)/stock-shell.tsx", "(exploitation)/exploitation-shell.tsx", "espace/espace-shell.tsx"]) {
      expect(fichiers).toContain(f);
    }
  });

  it.each(coquilles())("%s importe et rend <BarreDuBas>", (f) => {
    const src = lire(f);
    expect(src).toMatch(/import \{[^}]*\bBarreDuBas\b[^}]*\} from "@\/components\/barre-du-bas";/);
    expect(src).toMatch(/<BarreDuBas\b/);
  });

  it.each(coquilles())("%s n'a ni hamburger en haut ni barre du bas maison", (f) => {
    const src = lire(f);
    expect(src, "hamburger « Ouvrir le menu »").not.toContain("Ouvrir le menu");
    expect(src, "barre fixée en bas refabriquée").not.toMatch(/fixed[^"`]*\bbottom-0\b|bottom-0[^"`]*\bfixed\b/);
    expect(src, "flou sur un élément fixe (décroche en PWA iOS)").not.toMatch(FLOU);
  });

  it.each(coquilles())("%s : le tiroir porte l'id que « Menu » désigne", (f) => {
    const src = lire(f);
    const id = src.match(/menuId="([^"]+)"/)?.[1];
    expect(id, "menuId absent").toBeTruthy();
    expect(src).toContain(`id="${id}"`);
  });

  // Défilement du tiroir en PWA iOS (2026-09-29) : UN SEUL mécanisme (`@/components/tiroir-mobile`) pour
  // les quatre coquilles — sinon l'une d'elles redevient un tiroir qui laisse défiler la page derrière.
  it.each(coquilles())("%s : tiroir, voile et verrou viennent du composant commun", (f) => {
    const src = lire(f);
    expect(src).toMatch(/import \{[^}]*\bTiroir\b[^}]*\} from "@\/components\/tiroir-mobile";/);
    expect(src).toMatch(/useTiroir\(\)/);
    expect(src).toMatch(/<VoileTiroir\b/);
    expect(src).toMatch(/<Tiroir\b/);
    expect(src, "panneau refabriqué à la main").not.toMatch(/<aside\b/);
    expect(src, "voile refabriqué à la main").not.toMatch(/fixed inset-0[^"`]*bg-black/);
    expect(src, "état d'ouverture tenu à la main (sans verrou de la page)").not.toMatch(/useState\(false\)/);
  });

  it.each(coquilles())("%s : le menu n'est pas un second défileur imbriqué sur téléphone", (f) => {
    const src = lire(f);
    for (const [, cl] of src.matchAll(/<nav\b[^>]*className="([^"]*)"/g)) {
      expect(cl, "un <nav> qui défile dans le tiroir qui défile").not.toMatch(/(^|\s)overflow-y-auto/);
    }
  });

  it("le tiroir commun : défile seul, sans chaînage, en dvh, sans flou ; le voile ne défile pas", () => {
    const src = readFileSync(path.join(APP, "../components/tiroir-mobile.tsx"), "utf8");
    expect(src).toContain("flex-col overflow-y-auto overscroll-contain");
    expect(src).toContain("max-lg:h-dvh");
    expect(src).toContain("touch-none");
    expect(src).toContain("useLockBodyScroll");
    expect(src).not.toMatch(FLOU);
  });

  it("le verrou fige le body en position fixe (overflow:hidden seul ne suffit pas sur iOS)", () => {
    const src = readFileSync(path.join(APP, "../components/use-lock-body-scroll.ts"), "utf8");
    expect(src).toContain('corps.style.position = "fixed"');
    expect(src).toMatch(/corps\.style\.top = `-\$\{y\}px`/);
    expect(src).toContain("window.scrollTo");
  });

  it("le composant commun : fixé en bas, sans flou", () => {
    const src = readFileSync(path.join(APP, "../components/barre-du-bas.tsx"), "utf8");
    expect(src).toContain("fixed inset-x-0 bottom-0");
    expect(src).toContain("env(safe-area-inset-bottom)");
    expect(src).not.toMatch(FLOU);
  });
});

/** Tous les fichiers .tsx de src (hors tests). */
function sources(dir = path.join(APP, "..")): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (n.endsWith(".tsx") && !/\.test\.tsx$/.test(n)) out.push(p);
  }
  return out;
}

describe("barre du bas — rien de fixé en bas ne la recouvre", () => {
  it("aucun élément fixé en bas de l'écran par classe, hors la barre elle-même", () => {
    const fichiers = sources();
    expect(fichiers.length).toBeGreaterThan(100); // plancher anti-silence
    const fautifs = fichiers.filter((f) => {
      if (f.endsWith(path.join("components", "barre-du-bas.tsx"))) return false;
      return [...readFileSync(f, "utf8").matchAll(/(?:className=|`|")([^"`]*)/g)].some(([, cl]) => /(^|\s)fixed(\s|$)/.test(cl) && /(^|\s)(?:[a-z]+:)?bottom-/.test(cl));
    });
    expect(fautifs.map((f) => path.relative(APP, f))).toEqual([]);
  });

  it("le bandeau « Nouvelle version » se pose au-dessus de la barre (variable CSS réservée)", () => {
    const bandeau = readFileSync(path.join(APP, "../components/maj-banner.tsx"), "utf8");
    expect(bandeau).toContain('bottom: "var(--reserve-barre-du-bas, 0px)"');
    const css = lire("globals.css");
    expect(css).toMatch(/@media \(width < 64rem\) \{\s*:root:has\(\[data-barre-du-bas\]\) \{\s*--reserve-barre-du-bas: calc\(4rem \+ 1px \+ env\(safe-area-inset-bottom\)\);/);
  });
});

describe("barre du bas — chaque entrée existe dans la navigation de son espace", () => {
  it.each(ESPACES)("$nom : entrées du menu, pages présentes, libellés courts", ({ groupe, nav }) => {
    const menu = new Set(nav.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)));
    expect(nav.BARRE_DU_BAS.length).toBeGreaterThanOrEqual(ENTREES_BARRE_MAX);
    for (const c of nav.BARRE_DU_BAS) {
      expect(menu.has(c.href), `${c.href} absent du menu`).toBe(true);
      expect(existsSync(path.join(APP, groupe, c.href, "page.tsx")), `${c.href} : pas de page.tsx`).toBe(true);
      expect(c.court.length, c.court).toBeLessThanOrEqual(10);
    }
    expect(new Set(nav.BARRE_DU_BAS.map((c) => c.href)).size).toBe(nav.BARRE_DU_BAS.length);
  });

  it.each(ESPACES.flatMap((e) => e.roles.map((r) => ({ ...e, role: r }))))("$nom, rôle $role : quatre entrées", ({ nav, role }) => {
    expect(choisirBarreDuBas(nav.NAV_GROUPS, nav.BARRE_DU_BAS, role)).toHaveLength(ENTREES_BARRE_MAX);
  });

  it("espace salarié : chaque entrée de la barre est une entrée du menu", () => {
    const menu = new Set(LIENS_ESPACE.map((l) => l.href));
    expect(BARRE_SALARIE).toHaveLength(ENTREES_BARRE_MAX);
    for (const l of BARRE_SALARIE) expect(menu.has(l.href), l.href).toBe(true);
  });
});

// ── Montage réel des quatre coquilles : cliquer sur « Menu » ouvre le tiroir complet ──────────
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ back: () => {}, push: () => {}, prefetch: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/app/login/actions", () => ({ logout: async () => {} }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/bouton-retour", () => ({ BoutonRetour: () => null }));
vi.mock("@/app/(app)/push-toggle", () => ({ PushToggle: () => null }));
vi.mock("@/app/espace/cloche-salarie", () => ({ ClocheSalarie: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const commun = { userNom: "Direction", userRole: "ADMIN", maPhoto: null, autresEspaces: [{ href: "/espace", icone: "employes", label: "Mon espace salarié" }], notif: null, children: null };

async function monter(cas: string) {
  if (cas === "RH") {
    const { AppShell } = await import("./(app)/app-shell");
    nav.pathname = "/presences";
    act(() => racine.render(createElement(AppShell, { ...commun, employeeId: null, badges: { "/a-valider": 5, "/conges": 2 } })));
    return { labels: navRH.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label)), actif: "/presences", badge: ["/a-valider", "5"], sortie: "Déconnexion" };
  }
  if (cas === "Stock") {
    const { StockShell } = await import("./(stock)/stock-shell");
    nav.pathname = "/stock/legumes"; // un sous-onglet d'« Achats & mouvements »
    act(() => racine.render(createElement(StockShell, { ...commun, badges: { "/stock/catalogue": 3, "/stock/a-valider": 1 } })));
    return { labels: navStock.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label)), actif: "/stock/mouvements", badge: ["/stock/catalogue", "3"], sortie: "Déconnexion" };
  }
  if (cas === "Exploitation") {
    const { ExploitationShell } = await import("./(exploitation)/exploitation-shell");
    nav.pathname = "/exploitation";
    act(() => racine.render(createElement(ExploitationShell, { ...commun, badges: {} })));
    return { labels: navExploitation.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label)), actif: "/exploitation", badge: null, sortie: "Déconnexion" };
  }
  const { EspaceShell } = await import("./espace/espace-shell");
  nav.pathname = "/espace/conges";
  act(() => racine.render(createElement(EspaceShell, { nom: "Awa", matricule: "M1", photoUrl: null, notifs: { items: [], nonLues: 0 }, autresEspaces: commun.autresEspaces, children: null })));
  return { labels: LIENS_ESPACE.map((l) => l.label), actif: "/espace/conges", badge: null, sortie: "Se déconnecter" };
}

describe("barre du bas — montée dans chaque coquille", () => {
  it.each(["RH", "Stock", "Exploitation", "Salarié"])("%s : Menu ouvre le tiroir complet, entrée active et badge dans la barre", async (cas) => {
    const attendu = await monter(cas);
    const barre = conteneur.querySelector("nav[data-barre-du-bas]")!;
    expect(barre, "barre du bas absente").toBeTruthy();
    expect(barre.querySelectorAll("a")).toHaveLength(ENTREES_BARRE_MAX);
    expect([...barre.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"))).toEqual([attendu.actif]);
    if (attendu.badge) {
      const [href, n] = attendu.badge;
      expect(barre.querySelector(`a[href="${href}"] [data-badge]`)?.textContent).toBe(n);
    }

    const bouton = [...barre.querySelectorAll("button")].find((b) => b.textContent === "Menu")!;
    const tiroir = document.getElementById(bouton.getAttribute("aria-controls")!)!;
    expect(tiroir, "le tiroir désigné par Menu n'existe pas").toBeTruthy();
    expect(tiroir.className).toContain("-translate-x-full");
    act(() => bouton.click());
    expect(tiroir.className).not.toContain("-translate-x-full");
    expect(bouton.getAttribute("aria-expanded")).toBe("true");

    // Ouvert, la page derrière est figée ; un appui sur le voile ferme et la libère.
    expect(document.body.style.position).toBe("fixed");
    const voile = conteneur.querySelector("[data-voile-tiroir]")!;
    expect(voile, "voile absent").toBeTruthy();
    expect(tiroir.className).toContain("overscroll-contain");

    // Le tiroir garde TOUTES les entrées de l'espace + le bloc du compte.
    const texte = tiroir.textContent!;
    for (const l of attendu.labels) expect(texte, l).toContain(l);
    expect(texte).toContain("Mon espace salarié");
    expect(texte).toContain(attendu.sortie);
    // Plus de hamburger en haut : « Menu » le remplace.
    expect(conteneur.querySelector('[aria-label="Ouvrir le menu"]')).toBeNull();

    act(() => (voile as HTMLElement).click());
    expect(document.body.style.position).toBe("");
    expect(conteneur.querySelector("[data-voile-tiroir]")).toBeNull();
    expect(bouton.getAttribute("aria-expanded")).toBe("false");
  });
});
