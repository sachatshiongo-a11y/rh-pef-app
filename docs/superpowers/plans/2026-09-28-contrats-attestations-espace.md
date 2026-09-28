# Lots 3 et 4 de l'espace salarié — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** « Mes contrats » (classement dérivé, signature, notification, clôture proposée à la création) et « Mes attestations » (demande du salarié, délivrance numérotée et figée par la Direction, registre), à la place du libre-service actuel.

**Architecture :** Le classement d'un contrat est une fonction PURE (`src/lib/contrats-classement.ts`) lue par l'espace salarié ET par les écrans de la Direction ; rien n'est écrit en base sans un clic de la Direction. Les attestations vivent dans une table `Attestation` et un compteur `CompteurAttestation` (une ligne par année, incrémentée par `INSERT … ON CONFLICT DO UPDATE … RETURNING`, donc sous verrou de ligne). Toute la logique d'attestation passe par `src/lib/attestations.ts`, qui reçoit le client Prisma en paramètre (idiome `lib/signature.ts`) ; les Server Actions et les routes ne font que la garde.

**Tech Stack :** Next.js 16 App Router, Server Actions, Prisma 7 + Postgres, React 19, Tailwind, `@react-pdf/renderer`, vitest + Postgres embarqué (`creerBaseTest`).

**Spec :** `docs/superpowers/specs/2026-09-28-contrats-attestations-espace-design.md` — à lire en entier avant toute tâche.

## Global Constraints

- Arbre `~/Projects/rh-pef-app/.claude/worktrees/lots-3-4`, branche `feat/contrats-attestations-espace`. Pas de `.env` : lancer les tests avec `DIRECT_URL="postgresql://factice@localhost:1/f" DATABASE_URL="postgresql://factice@localhost:1/f"` et `--maxWorkers=2`. Ne jamais toucher la production.
- « Aujourd'hui » = `jourCivilKinshasa(new Date())`, jamais l'UTC du serveur.
- Messages d'erreur renvoyés comme une valeur (`actionLisible` → `{ erreur }`, ou résultat par ligne), jamais levés jusqu'au navigateur.
- Actions groupées : cases à cocher + `BulkBar` ; boutons de `@/components/action-buttons` (`BoutonValider`, `BoutonRefuser`, `BoutonNeutre`…). Noms cliquables vers la fiche (`EmployeeName`). Aucun débordement horizontal à 375 px.
- Montants via `src/lib/montant.ts` ; dans les PDF, `formaterNombre` / `normaliserEspaces`, aucun caractère absent d'Optima.
- Migration Prisma additive, écrite à la main, `ENABLE ROW LEVEL SECURITY` sur chaque nouvelle table ; `src/lib/migrations.integration.test.ts` doit passer (il exige aussi un `migrate diff` vide : pas d'index partiel hors schéma).
- Chaque route ajoutée porte sa garde en PREMIÈRE instruction : salarié (`verifySession` + `espaceEmployeActif` + `estSalarie` + `employeeId`) sous `/espace`, `estRH` côté Direction. La branche `fix/securite-routes-rh` remplacera ces lignes par `exigerEspaceSalarie()` / `exigerEspaceRH()`.
- L'outil signale, la Direction tranche : aucune donnée réécrite automatiquement (pas de passage en `EXPIRE` sans clic).
- Textes exacts : « Un contrat vous attend pour signature » ; « En signant, vous acceptez ce contrat et ses conditions. » ; « Clôturer le contrat en cours (il passera en Transformé ou Résilié, à choisir) » ; « Aucun contrat à signer » ; « Votre attestation … est disponible ».
- Chaque garde-fou est FALSIFIÉ : copie du fichier, casse, test ROUGE, restauration depuis la copie, `cmp` silencieux.
- Un commit en français par tâche, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/contrats-classement.ts` (créé, pur) | `classerContrats`, `LIBELLE_TYPE_CONTRAT`, `rubriquesContrats` |
| `src/lib/contrats-notification.ts` (créé, serveur) | `notifierContratASigner` — création et passage « à resigner » |
| `src/app/espace/contrats/page.tsx` + `vue.tsx` (créés) | Page « Mes contrats » (vue testable à part) |
| `src/app/(app)/paie/contrat-actions.ts`, `employes/[id]/dossier-actions.ts` (modifiés) | Clôture proposée, « Marquer expiré », notifications |
| `prisma/schema.prisma` + `prisma/migrations/20260928090000_attestations/` (créés) | `Attestation`, `CompteurAttestation`, enums |
| `src/lib/attestations.ts` (créé, serveur, client en paramètre) | Éligibilité + instantané, demande, délivrance numérotée, refus |
| `src/lib/pdf/attestation.tsx`, `attestation-stage.tsx`, `attestation-buffer.ts` (modifiés/créé) | PDF depuis l'instantané, numéro + « délivrée le » |
| `src/app/espace/attestations/…` (créés) | Page salarié, action de demande, route de téléchargement (propriété) |
| `src/app/(app)/a-valider/attestations-inbox.tsx`, `src/app/(app)/attestations/…` (créés) | Délivrer / Refuser en lot, aperçu, téléchargement RH, export |

---

### Task 1 : Classement pur des contrats

**Files :** Create `src/lib/contrats-classement.ts`, `src/lib/contrats-classement.test.ts`.

**Interfaces — Produces :**
```ts
export type CategorieContrat = "A_SIGNER" | "EN_VIGUEUR" | "ANCIEN";
export type ContratClassable = { id: string; type: string; statut: string; dateDebut: Date; dateFin: Date | null; createdAt: Date };
export type Classement = { categorie: CategorieContrat; motif: string | null; expire: boolean };
export const LIBELLE_TYPE_CONTRAT: Record<string, string>; // CDI — durée indéterminée, …, Journalier, Intérim
export function libelleTypeContrat(type: string): string;   // jamais la valeur brute : « Autre contrat » en repli
export function classerContrats(contrats: ContratClassable[], etats: Map<string, "A_SIGNER" | "SIGNE" | "A_RESIGNER">, maintenant: Date): Map<string, Classement>;
```

- [ ] Tests rouges : en vigueur signé → EN_VIGUEUR ; en vigueur non signé / à resigner → A_SIGNER ; CDD ACTIF dont la fin est passée → ANCIEN « expiré le JJ/MM/AAAA », `expire: true` ; deux ACTIF → l'ancien « remplacé par le contrat du … » ; RESILIE → « résilié » ; TRANSFORME → « transformé » ; statut EXPIRE → « expiré le … » ; fin = aujourd'hui → encore en vigueur ; 23 h 30 UTC la veille de la fin + 1 = déjà le lendemain à Kinshasa → expiré ; égalité de `dateDebut` départagée par `createdAt` ; libellés : aucune valeur brute.
- [ ] Implémentation, vert. Falsifier la conversion Kinshasa (UTC brut) et le départage `createdAt`.
- [ ] Commit.

### Task 2 : Page « Mes contrats » de l'espace salarié

**Files :** Create `src/app/espace/contrats/page.tsx`, `src/app/espace/contrats/vue.tsx`, `src/app/espace/contrats/vue.test.tsx`. Modify `src/app/espace/layout.tsx` (menu), `src/app/espace/page.tsx` (pastille + accès rapide), `src/app/espace/dossier/page.tsx` (lien, libellé partagé), `src/app/espace/documents/page.tsx` (section Contrats retirée), `src/app/espace/signature-actions.ts` (revalide `/espace/contrats`), `src/components/bouton-signer.tsx` (texte CONTRAT).

**Interfaces — Consumes :** `classerContrats`, `libelleTypeContrat`. **Produces :** `VueMesContrats({ lignes, nomSalarie, action })`, `export function texteSignature(cible, cote): string` dans `bouton-signer.tsx`.

- [ ] Tests rouges (rendu `renderToStaticMarkup`) : rubriques « À signer », « En vigueur », « Anciens » dans cet ordre ; états vides (« Aucun contrat à signer »…) ; « CDI — durée indéterminée » et jamais `CDI`/`STAGE`/`ACTIF`/`EXPIRE` bruts ; pas de bouton Signer dans « Anciens » ; `texteSignature("CONTRAT","SALARIE")` = « En signant, vous acceptez ce contrat et ses conditions. », bulletin inchangé.
- [ ] Implémentation, vert ; falsifier l'ordre des rubriques et le texte CONTRAT.
- [ ] Commit.

### Task 3 : Notifier le salarié qu'un contrat attend sa signature

**Files :** Create `src/lib/contrats-notification.ts`, `src/app/(app)/paie/contrat-actions.integration.test.ts`. Modify `dossier-actions.ts` (`ajouterContrat`), `contrat-actions.ts` (`transformerContrat`, `modifierContrat`, `prolongerContrat`, `prolongerEssai`).

**Interfaces — Produces :** `notifierContratASigner(contratId: string): Promise<void>` (lit le compte salarié, notifie « Un contrat vous attend pour signature », lien `/espace/contrats`) ; `etatSignatureContrat(contratId)` avant/après pour ne notifier qu'au passage SIGNE → A_RESIGNER.

- [ ] Tests rouges (intégration, auth/notifications simulées) : création → 1 notification ; salarié sans compte → aucune ; modification d'un contrat signé qui change les conditions → notification ; contrat jamais signé modifié → aucune ; modification sans effet sur l'instantané → aucune.
- [ ] Implémentation, vert ; falsifier la condition « avant SIGNE ».
- [ ] Commit.

### Task 4 : Nouveau contrat — clôture proposée du contrat en cours

**Files :** Modify `dossier-actions.ts` (`ajouterContrat`), `src/app/(app)/employes/[id]/dossier.tsx` ; Create `src/app/(app)/employes/[id]/champs-nouveau-contrat.tsx` (case cochée si le type change) ; test dans `contrat-actions.integration.test.ts`.

- [ ] Tests rouges : case cochée + « TRANSFORME » → ancien contrat TRANSFORME, nouveau ACTIF, journal « cloture », le tout dans une transaction (échec de création → ancien intact) ; case décochée → ancien inchangé ; contrat d'un autre salarié → refus lisible.
- [ ] Implémentation, vert ; falsifier la transaction (création hors tx) et le filtre employé.
- [ ] Commit.

### Task 5 : Classement côté Direction et « Marquer expiré »

**Files :** Modify `contrat-actions.ts` (`marquerContratsExpires(ids)`), `src/app/(app)/paie/suivi-contrats.tsx` + `page.tsx` (expirés encore ACTIF listés, cases + `BulkBar`, état de signature), `dossier.tsx` (contrat courant = classement, motif des anciens, bouton unitaire), `src/app/(app)/documents/page.tsx` (onglet Contrats : statut dérivé + colonne Signature).

**Interfaces — Produces :** `marquerContratsExpires(ids: string[]): Promise<{ traites: number; refus: { id: string; message: string }[] }>`.

- [ ] Tests rouges : lot mixte → seuls les ACTIF dont la fin est passée passent en EXPIRE, un par ligne dans le journal, message par ligne pour les autres ; VIEWER refusé ; rien n'est touché sans appel.
- [ ] Implémentation, vert ; falsifier le filtre « fin passée ».
- [ ] Commit.

### Task 6 : Données des attestations — migration, numéro, éligibilité, PDF

**Files :** Modify `prisma/schema.prisma` ; Create `prisma/migrations/20260928090000_attestations/migration.sql`, `src/lib/attestations.ts`, `src/lib/attestations.integration.test.ts`, `src/lib/pdf/attestation-buffer.ts`, `src/lib/pdf/attestation.render.test.ts` ; Modify `src/lib/pdf/attestation.tsx`, `attestation-stage.tsx`.

**Interfaces — Produces :**
```ts
export type DonneesAttestation = { type: TypeAttestation; nom; sexe; matricule; poste; typeContrat; ... } // chaînes
export async function instantaneAttestation(db, employeeId, type, maintenant): Promise<{ ok: true; donnees; payrollLineId: string | null } | { ok: false; motif: string }>;
export async function demanderAttestation(db: PrismaClient, p: { employeeId; type; motif: string | null; parId }): Promise<{ ok: true; id } | { ok: false; motif }>;
export async function delivrerAttestation(db: PrismaClient, p: { attestationId?: string; employeeId?: string; type?: TypeAttestation; parId; maintenant?: Date }): Promise<{ ok: true; id; numero } | { ok: false; motif }>;
export async function refuserAttestation(db, p: { id; motif; parId }): Promise<{ ok: true } | { ok: false; motif }>;
export function numeroAttestation(annee: number, rang: number): string; // ATT-2026-0001
export async function rendreAttestationPdf(a: { donnees; numero; delivreeLe }): Promise<Buffer>;
```

- [ ] Tests rouges : numéros `ATT-2026-0001`, `-0002`, puis `ATT-2027-0001` ; deux délivrances simultanées → deux numéros distincts ; numéro jamais réutilisé après suppression ; salaire : dernière paie VALIDE/PAYE (brouillon plus récent ignoré), aucune → refus, stagiaire/intérimaire → refus ; travail : date d'embauche, en poste, sorti (date de sortie / fin du dernier contrat), aucune date → refus ; stage sans contrat de stage → refus ; une seule demande DEMANDEE par type (deux demandes simultanées) ; demande inéligible délivrée → REFUSEE avec motif ; PDF : numéro, « délivrée le », aucune police de repli, net et brut avec « au titre du mois de ».
- [ ] Migration écrite à la main + RLS ; `migrations.integration.test.ts` vert.
- [ ] Implémentation, vert ; falsifier le verrou (max+1 sans compteur), le filtre VALIDE/PAYE, le verrou de demande.
- [ ] Commit.

### Task 7 : Espace salarié — « Mes attestations », fin du libre-service

**Files :** Create `src/app/espace/attestations/page.tsx`, `actions.ts`, `[id]/route.ts`, `actions.integration.test.ts`, `[id]/route.integration.test.ts` ; Delete `src/app/espace/attestation/[type]/route.ts` ; Modify `layout.tsx`, `page.tsx`, `documents/page.tsx`.

- [ ] Tests rouges : demander → DEMANDEE, notification Direction ; deuxième demande du même type → message ; téléchargement de SON attestation délivrée → PDF ; celle d'un collègue → 403 ; demandée non délivrée → 404 ; `src/app/espace/attestation` n'existe plus et aucun lien n'y mène.
- [ ] Implémentation, vert ; falsifier le contrôle de propriété.
- [ ] Commit.

### Task 8 : Direction — délivrer, refuser, aperçu

**Files :** Create `src/app/(app)/attestations/actions.ts`, `src/app/(app)/a-valider/attestations-inbox.tsx`, `src/app/(app)/attestations/[id]/route.ts` (téléchargement RH), `src/app/(app)/attestations/[id]/apercu/route.ts`, tests d'intégration ; Modify `src/app/(app)/a-valider/page.tsx`.

**Interfaces — Produces :** `delivrerAttestations(ids): Promise<ResultatLot>`, `refuserAttestations(ids, motif): Promise<ResultatLot>`, `delivrerAttestationDirecte(employeeId, type)`, `type ResultatLot = { traites: number; refus: { id: string; nom: string; message: string }[] }`.

- [ ] Tests rouges : lot de trois dont un inéligible → deux délivrées numérotées, une REFUSEE avec message ; refus sans motif → message ; MANAGER/VIEWER ne délivrent pas ; salarié notifié « Votre attestation … est disponible ».
- [ ] Implémentation, vert ; falsifier le refus automatique.
- [ ] Commit.

### Task 9 : Registre, délivrance depuis la fiche, attestation de paie validée

**Files :** Modify `dossier.tsx` + `page.tsx` de la fiche (« Délivrer une attestation » + registre), `src/app/(app)/documents/page.tsx` (onglet Attestations, filtres type/statut, lien export), Create `src/app/(app)/attestations/export/route.ts` ; Modify `employes/[id]/attestation-paie/[ligneId]/route.ts` (VALIDE/PAYE) ; Delete `employes/[id]/attestation/[type]/route.ts`, `employes/[id]/attestation-stage/route.ts`.

- [ ] Tests rouges : attestation de paie d'une ligne PAS_VALIDE → refus ; routes libre-service Direction supprimées et plus aucun lien ; export : entêtes et une ligne par attestation.
- [ ] Implémentation, vert ; falsifier le contrôle VALIDE/PAYE.
- [ ] Suite complète, `npx tsc --noEmit`, `npm run build`. Commit.
