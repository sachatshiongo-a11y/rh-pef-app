# Pointage par QR code — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Remplacer le bouton de pointage par le scan d'une affiche QR imprimée, avec position du téléphone enregistrée et pointages lointains signalés à la Direction — plus la création des comptes salariés en lot.

**Architecture :** Les règles (distance, verdict de position, lecture du QR, comparaison du code) sont des fonctions pures dans `src/lib/pointage-qr.ts`. L'écriture d'un scan passe par un module serveur testable (`src/lib/pointage-scan.ts`, qui prend le client Prisma en paramètre) appelé par des Server Actions minces. Chaque scan est gardé dans une table d'historique `ScanPointage` ; l'état « à vérifier » se DÉRIVE de ces scans, jamais recopié.

**Tech Stack :** Next.js App Router, Server Actions, Prisma 7 + Postgres, React 19, Tailwind, `@react-pdf/renderer`, vitest + Postgres embarqué (`creerBaseTest`). Nouvelles dépendances : `qrcode` (génération PNG côté serveur), `jsqr` (décodage côté navigateur, **sans worker**).

**Spec :** `docs/superpowers/specs/2026-09-23-pointage-qr-design.md` — à lire en entier avant toute tâche.

## Global Constraints

- Dépôt `~/Projects/rh-pef-app`, branche `feat/pointage-qr`. Ne jamais fusionner ni déployer : le contrôleur s'en charge.
- ⚠️ **Le `.env` pointe la base de PRODUCTION.** N'y écrire jamais ; ne JAMAIS lancer `prisma migrate dev`, `migrate deploy` ou `db push` sans `--url` explicite vers une base jetable. Les tests utilisent `creerBaseTest` (`src/lib/test/db.ts`).
- Les tests construisent leur base par `prisma db push` depuis le schéma : **le SQL de migration n'est exécuté par AUCUN test.** Toute migration se vérifie à part (Task 2, Step 4).
- Non bloquant : un scan loin du restaurant ou sans position est **enregistré** et marqué `A_VERIFIER`. Jamais refusé pour sa position.
- L'heure d'un pointage est **celle du serveur** au moment du scan. Jamais une heure envoyée par le téléphone.
- Rayon par défaut **150 m** ; plafond de précision **300 m** ; précision exigée pour régler la position du restaurant : **≤ 100 m** ; double scan : **moins de 5 minutes** après l'arrivée → confirmation.
- Le décodeur QR tourne **sans worker** (aucun fichier supplémentaire servi derrière le garde d'authentification).
- Tout texte qui finit dans un PDF passe par `formaterNombre()` / `normaliserEspaces()` de `@/lib/montant` (U+202F absent de la police → texte barré). Aucun symbole hors police (ex. « ⚠ »). Dans les fichiers de test, écrire `\u202F`, jamais le caractère littéral.
- Actions groupées partout où une liste le permet (cases + barre d'actions). Boutons de décision : composants de `@/components/action-buttons` (`BoutonValider`, `BoutonNeutre`, `BoutonDanger`, `CLASSES_NEUTRE`…), jamais de couleurs peintes à la main.
- Chaque garde-fou est **falsifié** : casser le code de production, montrer le test ROUGE en nommant le défaut, remettre, montrer VERT. Les deux sorties vont dans le rapport de tâche.
- Commits en français, à l'impératif, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Messages d'interface exacts (copiés de la spec) :
  - hors restaurant : « Pointage enregistré. Votre position n'a pas pu confirmer que vous êtes au restaurant : la Direction le vérifiera. »
  - code invalide : « Cette affiche n'est plus valable, demandez la nouvelle à la Direction. »
  - QR étranger : « Ce n'est pas l'affiche de pointage. »
  - journée complète : « Votre journée est déjà complète. »
  - précision insuffisante au réglage : « rapprochez-vous d'une fenêtre et réessayez »
  - fiches de connexion : « Ce document contient des mots de passe : remettez chaque fiche en main propre. »

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/pointage-qr.ts` (créé) | Règles pures : distance, verdict de position, lecture du QR, code d'affiche, coordonnées saisies, libellés de motif, résumé hebdomadaire |
| `src/lib/pointage-jour.ts` (créé) | Pur : `dateDuJourKinshasa`, `heuresNettes` (sortis de `pointer-actions.ts`) |
| `src/lib/pointage-presences.ts` (créé, serveur) | `appliquerAuxPresences(client, …)` et les refus communs (paie validée, congé), sortis de `pointer-actions.ts` |
| `src/lib/pointage-scan.ts` (créé, serveur) | `enregistrerScan`, `confirmerDepartScan` — logique du scan, client Prisma en paramètre |
| `src/app/pointage/actions.ts` (créé) | Server Actions minces : `scannerAffiche`, `confirmerDepart` |
| `src/app/scan/page.tsx` (créé) | Chemin « appareil photo du téléphone » : `/scan?c=CODE` |
| `src/components/pointage/scanner-affiche.tsx` (créé, client) | Caméra + jsQR + position + écrans de résultat, pause, confirmation |
| `src/app/(app)/parametres/pointage/…` (créé) | Réglages ADMIN, route PDF de l'affiche |
| `src/lib/pdf/affiche-pointage.tsx`, `src/lib/pdf/fiches-connexion.tsx` (créés) | Les deux PDF |
| `src/lib/comptes-salaries.ts` (créé, serveur) | `creerCompteSalarie(client, …)` — le SEUL chemin de création de compte |
| `src/app/(app)/pointer/suivi/…` (modifié) | Motifs « à vérifier », « Marquer vérifié » en lot, compteur de la semaine |

---

### Task 1 : Les règles pures

**Files :**
- Create : `src/lib/pointage-qr.ts`, `src/lib/pointage-qr.test.ts`, `src/lib/pointage-code.ts`
- Create : `src/lib/pointage-jour.ts`, `src/lib/pointage-jour.test.ts`
- Modify : `src/app/(app)/pointer/pointer-actions.ts` (importe `dateDuJourKinshasa`, `heuresNettes` au lieu de ses copies privées)

**Interfaces — Produces :**
```ts
// pointage-qr.ts — AUCUNE dépendance Node : il est importé par le composant client
export type Coordonnees = { lat: number; lng: number };
export type PositionScan = { lat: number; lng: number; precisionM: number } | { erreur: "REFUSEE" | "INDISPONIBLE" };
export type MotifVerification = "LOIN" | "POSITION_REFUSEE" | "POSITION_INDISPONIBLE" | "PRECISION_INSUFFISANTE";
export type VerdictPosition =
  | { verdict: "AU_RESTAURANT"; distanceM: number }
  | { verdict: "A_VERIFIER"; motif: MotifVerification; distanceM: number | null; precisionM?: number }; // precisionM porté si PRECISION_INSUFFISANTE
export const RAYON_DEFAUT_M = 150;
export const PRECISION_MAX_M = 300;
export const PRECISION_REGLAGE_MAX_M = 100;
export const DELAI_DOUBLE_SCAN_MS = 5 * 60_000;
export function distanceMetres(a: Coordonnees, b: Coordonnees): number;            // haversine, R = 6 371 000 m
export function verdictPosition(p: PositionScan, restaurant: Coordonnees, rayonM: number): VerdictPosition;
export function urlAffiche(origine: string, code: string): string;                  // `${origine}/scan?c=${encodeURIComponent(code)}`
export function lireCodeDepuisQr(contenu: string, origine: string): string | null;  // null si autre origine / autre chemin / pas de c
export function lireCoordonneesSaisies(texte: string): Coordonnees | null;          // "-4.3217, 15.3125" ; bornes lat ±90, lng ±180
export function libelleMotif(v: VerdictPosition): string;                           // « à 2,3 km », « position refusée »…
export function resumeSemaine(scans: { verdict: "AU_RESTAURANT" | "A_VERIFIER" }[]): { total: number; aVerifier: number; pourcent: number };

// pointage-code.ts — serveur (node:crypto), JAMAIS importé côté client
export function genererCodeAffiche(): string;                                       // 32 octets aléatoires, base64url
export function codesEgaux(a: string, b: string): boolean;                          // temps constant, faux si longueurs ≠

// pointage-jour.ts
export function dateDuJourKinshasa(d?: Date): Date;  // DATE à minuit UTC du jour de Kinshasa (UTC+1)
export function heuresNettes(debut: Date, fin: Date, pauseMinutes: number): number;
```

⚠️ `src/lib/heure-kinshasa.ts` exporte déjà un `jourKinshasa(d): string` (format d'affichage). Ne le confonds pas : la fonction qui produit une **DATE** s'appelle `dateDuJourKinshasa` et vit dans `pointage-jour.ts`.

- [ ] **Step 1 : les tests qui échouent** — `src/lib/pointage-qr.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  distanceMetres, verdictPosition, urlAffiche, lireCodeDepuisQr,
  lireCoordonneesSaisies, libelleMotif, resumeSemaine,
} from "./pointage-qr";
import { codesEgaux, genererCodeAffiche } from "./pointage-code";

const RESTO = { lat: -4.3217, lng: 15.3125 };

describe("distanceMetres", () => {
  it("vaut 0 au même point", () => expect(distanceMetres(RESTO, RESTO)).toBe(0));
  it("≈ 111 km pour un degré de latitude", () =>
    expect(distanceMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2));
});

describe("verdictPosition", () => {
  it("au restaurant quand la distance tient dans le rayon", () =>
    expect(verdictPosition({ ...RESTO, precisionM: 20 }, RESTO, 150).verdict).toBe("AU_RESTAURANT"));
  it("bénéfice du doute : distance ≤ rayon + précision", () => {
    // ≈ 200 m au nord, précision 60 m, rayon 150 → 200 ≤ 210
    const p = { lat: RESTO.lat + 0.0018, lng: RESTO.lng, precisionM: 60 };
    expect(verdictPosition(p, RESTO, 150).verdict).toBe("AU_RESTAURANT");
  });
  it("loin au-delà de rayon + précision", () => {
    const v = verdictPosition({ lat: RESTO.lat + 0.02, lng: RESTO.lng, precisionM: 30 }, RESTO, 150);
    expect(v).toMatchObject({ verdict: "A_VERIFIER", motif: "LOIN" });
  });
  it("précision au-delà du plafond → précision insuffisante, même au centre", () =>
    expect(verdictPosition({ ...RESTO, precisionM: 301 }, RESTO, 150))
      .toMatchObject({ verdict: "A_VERIFIER", motif: "PRECISION_INSUFFISANTE" }));
  it("précision exactement au plafond reste exploitable", () =>
    expect(verdictPosition({ ...RESTO, precisionM: 300 }, RESTO, 150).verdict).toBe("AU_RESTAURANT"));
  it("position refusée / indisponible → à vérifier, sans distance", () => {
    expect(verdictPosition({ erreur: "REFUSEE" }, RESTO, 150)).toEqual({ verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", distanceM: null });
    expect(verdictPosition({ erreur: "INDISPONIBLE" }, RESTO, 150)).toEqual({ verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE", distanceM: null });
  });
});

describe("code d'affiche", () => {
  it("génère des codes distincts, sûrs dans une URL", () => {
    const a = genererCodeAffiche(), b = genererCodeAffiche();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("compare en temps constant, faux si différents ou de longueurs différentes", () => {
    expect(codesEgaux("abc", "abc")).toBe(true);
    expect(codesEgaux("abc", "abd")).toBe(false);
    expect(codesEgaux("abc", "abcd")).toBe(false);
  });
});

describe("lecture du QR", () => {
  const O = "https://rh.patesenfolie.cd";
  it("relit le code de sa propre affiche", () =>
    expect(lireCodeDepuisQr(urlAffiche(O, "XyZ_-9"), O)).toBe("XyZ_-9"));
  it("refuse une autre origine, un autre chemin, un texte quelconque", () => {
    expect(lireCodeDepuisQr("https://exemple.com/scan?c=XyZ", O)).toBeNull();
    expect(lireCodeDepuisQr(`${O}/autre?c=XyZ`, O)).toBeNull();
    expect(lireCodeDepuisQr(`${O}/scan`, O)).toBeNull();
    expect(lireCodeDepuisQr("bonjour", O)).toBeNull();
  });
});

describe("coordonnées saisies", () => {
  it("lit le format copié depuis Google Maps", () =>
    expect(lireCoordonneesSaisies("-4.3217, 15.3125")).toEqual({ lat: -4.3217, lng: 15.3125 }));
  it("refuse hors bornes ou illisible", () => {
    expect(lireCoordonneesSaisies("95, 15")).toBeNull();
    expect(lireCoordonneesSaisies("-4.3, 190")).toBeNull();
    expect(lireCoordonneesSaisies("Kinshasa")).toBeNull();
  });
});

describe("libellés et résumé", () => {
  it("dit la distance en km au-delà de 1 000 m", () =>
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "LOIN", distanceM: 2300 })).toBe("à 2,3 km"));
  it("dit la distance en m en deçà", () =>
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "LOIN", distanceM: 480 })).toBe("à 480 m"));
  it("nomme les autres motifs", () => {
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", distanceM: null })).toBe("position refusée");
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE", distanceM: null })).toBe("position indisponible");
  });
  it("résume la semaine", () =>
    expect(resumeSemaine([{ verdict: "A_VERIFIER" }, { verdict: "AU_RESTAURANT" }, { verdict: "AU_RESTAURANT" }, { verdict: "AU_RESTAURANT" }]))
      .toEqual({ total: 4, aVerifier: 1, pourcent: 25 }));
  it("semaine vide : 0 %, jamais NaN", () =>
    expect(resumeSemaine([])).toEqual({ total: 0, aVerifier: 0, pourcent: 0 }));
});
```

`libelleMotif` pour PRECISION_INSUFFISANTE : `« précision ±900 m »` — pour cela `VerdictPosition` A_VERIFIER porte aussi `precisionM?: number` quand le motif est PRECISION_INSUFFISANTE ; ajoute le test correspondant. La virgule décimale française passe par `formaterNombre` (affichage écran uniquement ici, mais même fonction partout).

Et `src/lib/pointage-jour.test.ts` : `dateDuJourKinshasa(new Date("2026-09-22T23:30:00Z"))` vaut `2026-09-23T00:00:00.000Z` (il est 00 h 30 à Kinshasa) ; `heuresNettes` de 8 h à 17 h avec 60 min de pause vaut 8 ; une pause plus longue que la journée donne 0, jamais un négatif.

- [ ] **Step 2 :** `npx vitest run src/lib/pointage-qr.test.ts src/lib/pointage-jour.test.ts` → ROUGE (modules absents).
- [ ] **Step 3 : implémenter.** `codesEgaux` : `crypto.timingSafeEqual` sur des `Buffer` de même longueur, `false` sinon. `genererCodeAffiche` : `crypto.randomBytes(32).toString("base64url")`. `lireCodeDepuisQr` : `new URL(contenu)` dans un `try`, exiger `url.origin === origine` et `url.pathname === "/scan"`. `pointage-qr.ts` ne doit importer **aucun** module Node (le composant client l'importe) ; `pointage-code.ts` porte `node:crypto`.
- [ ] **Step 4 :** remplacer les copies privées de `pointer-actions.ts` par les imports. Tests verts ; `npx vitest run src/app` inchangé.
- [ ] **Step 5 : falsifier** (au moins : `≤ rayon + précision` → `≤ rayon` ; `codesEgaux` qui ignore la longueur ; `lireCodeDepuisQr` qui n'exige plus l'origine), puis commit `feat(pointage): les règles du pointage par QR, en fonctions pures`.

---

### Task 2 : Schéma et migration

**Files :**
- Modify : `prisma/schema.prisma`
- Create : `prisma/migrations/20260923120000_pointage_qr/migration.sql`

**Interfaces — Produces :**
```prisma
// Config
pointageLatitude  Decimal? @db.Decimal(9, 6)
pointageLongitude Decimal? @db.Decimal(9, 6)
pointageRayonM    Int      @default(150)
pointageCode      String?

enum MomentScan { ARRIVEE DEPART  @@schema("public") }
enum VerdictScan { AU_RESTAURANT A_VERIFIER  @@schema("public") }
enum MotifScan { LOIN POSITION_REFUSEE POSITION_INDISPONIBLE PRECISION_INSUFFISANTE  @@schema("public") }
// SourcePointage gagne QR

model ScanPointage {
  id          String       @id @default(uuid())
  pointageId  String
  pointage    Pointage     @relation(fields: [pointageId], references: [id], onDelete: Cascade)
  employeeId  String
  employee    Employee     @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  moment      MomentScan
  instant     DateTime
  latitude    Decimal?     @db.Decimal(9, 6)
  longitude   Decimal?     @db.Decimal(9, 6)
  precisionM  Int?
  distanceM   Int?
  verdict     VerdictScan
  motif       MotifScan?
  verifieParId String?
  verifiePar   User?       @relation("ScanVerifiePar", fields: [verifieParId], references: [id], onDelete: SetNull)
  verifieLe    DateTime?
  createdAt   DateTime     @default(now())

  @@index([pointageId])
  @@index([employeeId, instant])
  @@index([verdict, verifieLe])
  @@schema("public")
}
```
Relations inverses : `Pointage.scans ScanPointage[]`, `Employee.scansPointage ScanPointage[]`, `User.scansVerifies ScanPointage[] @relation("ScanVerifiePar")`. Recopie le style exact (`@@schema`, commentaires) du modèle `SignatureElectronique` et de sa migration `20260923090000_signature_electronique`.

- [ ] **Step 1 :** modifier le schéma ; `npx prisma validate` ; `npx prisma generate` (on est dans le dépôt principal, aucun autre arbre actif : autorisé ici).
- [ ] **Step 2 :** écrire `migration.sql` à la main, dans le style de la migration de signature : `ALTER TYPE "SourcePointage" ADD VALUE 'QR';`, les trois `CREATE TYPE`, `ALTER TABLE "Config" ADD COLUMN …`, `CREATE TABLE "ScanPointage"`, index, clés étrangères.
  ⚠️ Postgres interdit d'**utiliser** une valeur d'enum ajoutée par `ADD VALUE` dans la même transaction : la migration ne doit que l'ajouter, jamais l'employer.
- [ ] **Step 3 :** `npx vitest run src/lib/pointage` (les tests construisent leur base par `db push` : ils vérifient le SCHÉMA, pas la migration).
- [ ] **Step 4 : vérifier la MIGRATION elle-même.** Écris un script jetable (hors dépôt, dans le répertoire temporaire) qui démarre un Postgres embarqué comme `creerBaseTest`, y applique **toutes** les migrations par `npx prisma migrate deploy --url <jetable>` (vérifie la syntaxe exacte de Prisma 7 avec `--help`), puis `npx prisma migrate diff` entre cette base et `prisma/schema.prisma` : le diff doit être **vide**. Rapporte la sortie. Une migration qui ne correspond pas au schéma passe tous les tests et casse au déploiement — c'est la raison de cette étape.
- [ ] **Step 5 :** commit `feat(pointage): l'historique des scans et le réglage du restaurant`.

---

### Task 3 : Enregistrer un scan

**Files :**
- Create : `src/lib/pointage-presences.ts` (déplace `appliquerAuxPresences` et les deux refus communs depuis `pointer-actions.ts` ; `pointer-actions.ts` les importe)
- Create : `src/lib/pointage-scan.ts`, `src/lib/pointage-scan.integration.test.ts`
- Create : `src/app/pointage/actions.ts`

**Interfaces :**
- Consumes : `verdictPosition`, `codesEgaux`, `dateDuJourKinshasa`, `heuresNettes`, `DELAI_DOUBLE_SCAN_MS` (Task 1) ; `ScanPointage`, `Config.pointage*` (Task 2).
- Produces :
```ts
// pointage-presences.ts (serveur)
export async function refusSiPaieValideeOuConge(client: PrismaClient, employeeId: string, date: Date): Promise<void>; // lève Error lisible
export async function appliquerAuxPresences(client: PrismaClient, employeeId: string, date: Date, heures: number): Promise<void>;

// pointage-scan.ts (serveur)
export type ResultatScan =
  | { etat: "ARRIVEE"; heure: string; verdict: VerdictPosition }
  | { etat: "DEPART_A_CONFIRMER"; scanId: string; heure: string; arriveeA: string; verdict: VerdictPosition }
  | { etat: "DEPART_TROP_TOT"; arriveeA: string }          // < 5 min : rien n'est écrit
  | { etat: "COMPLETE" };
export async function enregistrerScan(client: PrismaClient, p: {
  employeeId: string; userId: string; code: string; position: PositionScan;
  confirmerDepartRapide?: boolean; maintenant?: Date;      // `maintenant` : injection pour les tests UNIQUEMENT
}): Promise<ResultatScan>;
export async function confirmerDepartScan(client: PrismaClient, p: {
  employeeId: string; scanId: string; pauseMinutes: number;
}): Promise<{ heureFin: string; heures: number }>;

// app/pointage/actions.ts ("use server") — mince : session → employé lié → appel du module
export const scannerAffiche: (entree: { code: string; position: PositionScan; confirmerDepartRapide?: boolean }) => Promise<ResultatScan>;
export const confirmerDepart: (entree: { scanId: string; pauseMinutes: number }) => Promise<{ heureFin: string; heures: number }>;
```

Règles de `enregistrerScan`, dans cet ordre :
1. Code : `Config.pointageCode` nul ou `!codesEgaux(code, config.pointageCode)` → `Error("Cette affiche n'est plus valable, demandez la nouvelle à la Direction.")`. **Rien n'est écrit.**
2. `refusSiPaieValideeOuConge`.
3. Verdict par `verdictPosition(position, restaurant, config.pointageRayonM)`.
4. Pas de pointage du jour → crée `Pointage` (`source: "QR"`, `heureDebut: maintenant`, `creeParId: userId`) ET `ScanPointage` ARRIVEE, **dans une transaction** → `ARRIVEE`.
5. Pointage avec `heureFin` → `COMPLETE`, rien d'écrit.
6. Pointage ouvert et un scan DEPART existe déjà pour lui → renvoie `DEPART_A_CONFIRMER` avec CE scan (idempotent, aucune nouvelle ligne).
7. Pointage ouvert, `maintenant − heureDebut < DELAI_DOUBLE_SCAN_MS` et pas `confirmerDepartRapide` → `DEPART_TROP_TOT`, rien d'écrit.
8. Sinon crée `ScanPointage` DEPART → `DEPART_A_CONFIRMER`.

`confirmerDepartScan` : le scan appartient à `employeeId`, est un DEPART, son pointage est ouvert → `heureFin = scan.instant` (PAS l'heure de la confirmation), `pauseMinutes` borné 0-600, `appliquerAuxPresences`. Sinon Error lisible.

`scannerAffiche` / `confirmerDepart` : `verifySession()`, compte lié à un employé (message existant de `moiEmploye`), puis appel. `actionLisible` comme les autres actions du dépôt. `revalidatePath` : `/pointer`, `/espace/pointer`, `/pointer/suivi`, et pour le départ confirmé les mêmes que `pointerDepart` aujourd'hui.

- [ ] **Step 1 : tests d'intégration** (`creerBaseTest`, base RELUE après chaque refus), un `it` par ligne :
  arrivée au restaurant → 1 pointage QR + 1 scan AU_RESTAURANT ; arrivée à 2 km → pointage créé ET scan A_VERIFIER motif LOIN ; position refusée → enregistré, POSITION_REFUSEE ; code faux → Error exacte, **0 pointage, 0 scan** ; code périmé (config changée entre deux) → idem ; aucun code en config → idem ; second scan à +3 min → DEPART_TROP_TOT, 0 scan DEPART ; même chose avec `confirmerDepartRapide` → DEPART_A_CONFIRMER ; second scan à +8 h → DEPART_A_CONFIRMER ; troisième scan avant confirmation → même `scanId`, toujours 1 seul scan DEPART ; `confirmerDepartScan` 25 min après le scan → `heureFin` = instant du SCAN ; heures nettes appliquées aux présences ; scan après journée complète → COMPLETE ; paie validée → refus, rien d'écrit ; congé approuvé → refus, rien d'écrit ; confirmer le scan d'un collègue → refus.
- [ ] **Step 2 :** ROUGE. **Step 3 :** implémenter. **Step 4 :** VERT, puis `npx vitest run src/app/(app)/pointer` inchangé.
- [ ] **Step 5 : falsifier** au moins : l'heure de fin prise à la confirmation ; le code vérifié APRÈS l'écriture ; l'idempotence du DEPART ; la transaction de l'arrivée. Commit `feat(pointage): enregistrer un scan d'arrivée ou de départ`.

---

### Task 4 : Le scanner dans l'application

**Files :**
- Create : `src/components/pointage/scanner-affiche.tsx`, `src/components/pointage/scanner-affiche.logic.ts`, `…logic.test.ts`
- Create : `src/app/scan/page.tsx`
- Modify : `src/app/espace/pointer/page.tsx`, `src/app/(app)/pointer/page.tsx`, `src/app/(app)/pointer/pointer-client.tsx` (garde l'affichage de l'état du jour, perd ses boutons)
- Modify : `src/app/login/actions.ts`, `src/app/login/login-form.tsx`, `src/app/login/page.tsx` (retour après connexion, limité à `/scan`)
- `npm install jsqr qrcode` et `npm install -D @types/qrcode` (vérifie si `jsqr` embarque ses types).

**Interfaces :**
- Consumes : `scannerAffiche`, `confirmerDepart`, `ResultatScan` (Task 3) ; `lireCodeDepuisQr`, `libelleMotif` (Task 1).
- Produces : `<ScannerAffiche codeInitial?: string />` — sans `codeInitial` il ouvre la caméra ; avec (chemin `/scan`), il saute la caméra et passe directement à la position.

Comportement :
1. `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })`, `<video playsInline muted>`, lecture d'images sur un `<canvas>` caché ~5 fois par seconde et `jsQR(données, largeur, hauteur)` **sur le fil principal**. Arrêter toutes les pistes de la caméra dès qu'un code est lu, au démontage, et quand la page passe en arrière-plan.
2. QR lu → `lireCodeDepuisQr(contenu, window.location.origin)` ; `null` → « Ce n'est pas l'affiche de pointage. » et on continue de viser.
3. En parallèle, `navigator.geolocation.getCurrentPosition` (`enableHighAccuracy: true`, `timeout: 10000`, `maximumAge: 0`) → `PositionScan` (`code 1` → REFUSEE, autres → INDISPONIBLE).
4. `scannerAffiche({ code, position })`, puis un écran par état : ARRIVEE (« Arrivée pointée à 8 h 02 » + message hors restaurant si A_VERIFIER), DEPART_TROP_TOT (confirmation → rappel avec `confirmerDepartRapide: true`, même code et même position), DEPART_A_CONFIRMER (saisie de la pause, défaut 30 min comme aujourd'hui → `confirmerDepart`), COMPLETE, erreur lisible.
5. Caméra refusée ou absente : message expliquant de scanner l'affiche avec l'appareil photo du téléphone. **Aucun bouton de pointage sans scan.**
6. Toute la logique de décision (texte à afficher pour chaque `ResultatScan`, conversion d'une erreur de géolocalisation) dans `scanner-affiche.logic.ts`, pure et testée : ce dépôt n'a pas de DOM en test.

`/scan?c=CODE` (page serveur) : `verifySession()` ; sans session, rediriger vers `/login?retour=` + le chemin encodé. Compte non lié à un employé → le message existant. Sinon `<ScannerAffiche codeInitial={c} />`. La connexion n'honore `retour` que s'il commence par `/scan?` (**jamais** une autre adresse : pas de redirection ouverte) — test pur sur la fonction de validation.

- [ ] Steps : tests purs ROUGES → implémentation → VERTS → `npm run typecheck`, `npm run build` (le composant client ne doit rien importer de serveur : vérifie que `pointage-code.ts` n'y est pas tiré) → falsifier (retour vers une adresse externe accepté ; QR étranger accepté) → commit `feat(pointage): scanner l'affiche depuis l'application`.

---

### Task 5 : Les réglages et l'affiche (Direction)

**Files :**
- Create : `src/app/(app)/parametres/pointage-actions.ts`, `src/app/(app)/parametres/pointage-reglages.tsx` (client), section « Pointage » dans `src/app/(app)/parametres/page.tsx`
- Create : `src/lib/pdf/affiche-pointage.tsx`, `src/app/(app)/parametres/pointage/affiche/route.ts`, `src/lib/pdf/affiche-pointage.render.test.ts`
- Create : `src/app/(app)/parametres/pointage-actions.integration.test.ts`

**Interfaces — Produces :**
```ts
export const reglerPositionRestaurant: (e: { lat: number; lng: number; precisionM: number | null }) => Promise<void>; // precisionM null = saisie manuelle
export const reglerRayon: (rayonM: number) => Promise<void>;          // borné 50 – 1000
export const changerCodeAffiche: () => Promise<void>;                 // nouveau genererCodeAffiche()
```
- Toutes : `requireRole(user, ["ADMIN"])`, `journaliser(...)` comme `compte-actions.ts`.
- `reglerPositionRestaurant` refuse `precisionM > PRECISION_REGLAGE_MAX_M` avec « rapprochez-vous d'une fenêtre et réessayez ». La saisie manuelle passe par `lireCoordonneesSaisies`.
- Route de l'affiche : ADMIN ; refuse tant que la position n'est pas réglée ; si `pointageCode` est nul, en crée un. PDF A4 : logo (celui des bulletins), « Pointage », QR (`qrcode` → PNG, correction d'erreur « M », au moins 12 cm de côté), trois lignes : « Ouvrez l'application · Appuyez sur Pointer · Visez ce code ». `urlAffiche(origine, code)` avec l'origine de la requête.
- Écran : position actuelle (lat, lng, précision) ; « Utiliser ma position actuelle » ; champ de saisie manuelle ; rayon ; « Imprimer l'affiche » ; « Changer le code » par `ConfirmSubmitButton` (message : les affiches déjà imprimées ne marcheront plus).

- [ ] Tests : non-ADMIN refusé sans écriture (base relue) ; précision 150 m refusée ; saisie manuelle acceptée ; changer le code invalide l'ancien (enchaîner avec `enregistrerScan` de la Task 3 : l'ancien code est refusé) ; rendu du PDF : **une image** présente, le texte attendu présent, **aucune police de repli** (reprends la méthode de `src/lib/pdf/glyphes-manquants.test.ts`). Falsifier chacun. Commit `feat(pointage): régler le restaurant et imprimer l'affiche`.

---

### Task 6 : Le suivi par la Direction

**Files :**
- Modify : `src/app/(app)/pointer/suivi/page.tsx` (+ composant client de sélection si nécessaire)
- Create : `src/app/(app)/pointer/suivi/actions.ts`, `…actions.integration.test.ts`

**Interfaces — Produces :**
```ts
export const marquerVerifies: (pointageIds: string[]) => Promise<{ scansVerifies: number }>; // ADMIN, MANAGER
```
- Chaque pointage du jour affiché montre ses scans : heure, source (« QR », « manuel », « appli (ancien) »), badge « À vérifier · à 2,3 km » tant qu'un scan A_VERIFIER n'est pas vérifié (`libelleMotif`), et « départ scanné, pause non saisie » quand un DEPART existe sur un pointage ouvert.
- Cases + barre groupée « Marquer vérifié » (`BoutonValider`) : pose `verifieParId`/`verifieLe` sur les scans A_VERIFIER non vérifiés des pointages cochés. Idempotent.
- Compteur en tête : « Cette semaine : 3 pointages à vérifier sur 41 (7 %) » — semaine du lundi au dimanche en heure de Kinshasa (même découpage que le reste du dépôt), via `resumeSemaine`.
- [ ] Tests : EMPLOYE refusé sans écriture ; seuls les scans A_VERIFIER non vérifiés sont touchés ; deuxième appel = 0 ; le compteur exclut les autres semaines. Falsifier. Commit `feat(pointage): la Direction voit et vérifie les pointages hors restaurant`.

---

### Task 7 : Les comptes en lot

**Files :**
- Create : `src/lib/comptes-salaries.ts` (serveur), `src/lib/comptes-salaries.integration.test.ts`
- Modify : `src/app/(app)/employes/compte-actions.ts` (`creerCompteEmploye` appelle `creerCompteSalarie` — plus de copie de la logique)
- Create : `src/app/(app)/parametres/comptes-lot-actions.ts`, `src/app/(app)/parametres/comptes-lot.tsx` (client), dans la section « Espace salarié » de Paramètres
- Create : `src/lib/pdf/fiches-connexion.tsx`, `src/lib/pdf/fiches-connexion.render.test.ts`

**Interfaces — Produces :**
```ts
export async function creerCompteSalarie(client: PrismaClient, p: { employeeId: string; auteurId: string }):
  Promise<{ employeeId: string; nom: string; matricule: string; motDePasse: string }>;   // lève Error lisible (inactif, compte existant…)
export const creerComptesEnLot: (employeeIds: string[]) => Promise<{
  pdfBase64: string | null;                       // null si aucun compte créé
  crees: { nom: string; matricule: string }[];
  ignores: { nom: string; raison: string }[];     // déjà un compte, inactif, échec d'un compte
}>;
```
- `creerComptesEnLot` : ADMIN, espace salarié activé. Crée compte par compte ; **un échec n'arrête pas le lot** et n'annule pas les comptes déjà créés (ils ne pourraient plus être retrouvés : leur mot de passe n'existe que dans ce PDF). Le PDF est généré **en mémoire**, renvoyé une seule fois, **jamais stocké** ; les mots de passe ne sont jamais journalisés.
- Le PDF : une fiche par salarié, découpable (plusieurs par page A4), nom, matricule, mot de passe temporaire, adresse de l'application, QR vers l'application, la mention « à changer à la première connexion ».
- Écran : la liste des salariés **actifs sans compte**, cases, « Tout cocher », bouton « Créer les comptes et imprimer les fiches », avertissement exact des Global Constraints, téléchargement du PDF par le mécanisme de `TelechargerLien` (blob → feuille de partage sur mobile, lien sur ordinateur).
- Mock de `@/lib/securite-connexion` dans les tests (comme le font les tests existants du dépôt — cherche `creerUtilisateurAuth` dans `src/**/*.test.ts`).
- [ ] Tests : ne crée que les manquants ; un salarié qui a déjà un compte est ignoré et **pas réinitialisé** ; un échec au milieu du lot laisse les autres créés et les nomme dans `ignores` ; `creerCompteEmploye` (unitaire) donne le même résultat qu'avant (tests existants verts) ; le PDF contient chaque matricule et chaque mot de passe, sans police de repli. Falsifier (dont : échec qui arrête le lot). Commit `feat(comptes): créer les comptes salariés en lot et imprimer les fiches`.

---

### Task 8 : Retirer le bouton, suite complète, relecture

**Files :** `src/app/(app)/pointer/pointer-actions.ts` (supprime `pointerArrivee`, `pointerDepart` ; garde `saisirHoraireManuel`), `pointer-client.tsx`, garde-fou `src/app/pointage/aucun-bouton.test.ts`.

- [ ] **Step 1 :** supprimer les deux actions et tout ce qui les appelle.
- [ ] **Step 2 :** garde-fou qui lit `src/` et échoue si `pointerArrivee` ou `pointerDepart` réapparaît ailleurs que dans un commentaire. Falsifier.
- [ ] **Step 3 :** `npm run typecheck`, `npx eslint` sur les fichiers touchés (prouver par `git stash` ce qui préexiste), `npx vitest run --maxWorkers=2` (collision de ports possible dans `src/lib/test/db.ts` : relancer seul un test d'intégration qui rougit au hasard avant de conclure), `npm run build`.
- [ ] **Step 4 : relecture finale** (contrôleur) sur `git diff origin/main...HEAD` : aucun chemin ne pointe sans scan ; un scan ne peut pas être attribué à un autre salarié ; code comparé en temps constant et vérifié AVANT toute écriture ; heure serveur partout ; mots de passe jamais stockés ni journalisés ; migration vérifiée par diff vide ; `/scan` et `retour` sans redirection ouverte ; décodeur sans worker. Verdict « fusionnable » exigé.
- [ ] **Step 5 : fusion et déploiement** (contrôleur).

---

## Couverture de la spec

| Spec | Tâche |
|---|---|
| §2 parcours salarié, heure serveur, 2 scans + pause, double scan, 3ᵉ scan, message hors restaurant | 3, 4 |
| §2 scanner dans l'app, chemin appareil photo, retour après connexion | 4 |
| §3 position (bouton + saisie manuelle), rayon, affiche, changer le code | 5 |
| §3 suivi, motifs, vérification en lot, compteur | 6 |
| §3 comptes en lot + fiches | 7 |
| §4 données, « à vérifier » dérivé, source QR | 2, 3, 6 |
| §5 règle de position | 1 |
| §6 sécurité | 1, 3, 4, 8 |
| §7 retrait du bouton | 8 |
| §8 tests | toutes |
