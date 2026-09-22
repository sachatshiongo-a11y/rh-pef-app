# Congés — jours ouvrables saisis, solde de congé annuel seul (lot 1)

- **Date** : 2026-09-22
- **Statut** : Design validé (à implémenter)
- **Périmètre** : la demande de congé (formulaire Direction *et* espace salarié) et le calcul du
  solde affiché. Le calendrier, l'approbation, les codes de présence posés à l'approbation ne
  bougent pas.
- **Suite** : premier des sept lots arbitrés le 2026-09-22 (signature électronique, contrats de
  l'espace salarié, attestations, pointage par QR, ergonomie de l'espace salarié, revue des
  fonctions). Chaque lot a sa propre spec.

---

## 1. Contexte & objectif

Deux gênes exprimées par la Direction.

1. **On raisonne en jours, pas en dates.** Un congé se négocie « douze jours à partir du 6 » ; le
   formulaire, lui, demande une date de fin, et c'est à la personne de compter à rebours en sautant
   dimanches et fériés. L'écran affiche bien le décompte *après coup*, mais ne laisse pas le saisir.
2. **Le solde mélange ce qui ne devrait pas l'être.** « Jours disponibles » se veut le solde de
   congé annuel ; or la règle qui décide quel congé s'en déduit est une **liste de mots-clés** dans
   le code (`matern`, `patern`, `naiss`, `enfant`, `maladie`, `accident`) complétée par « taux de
   rémunération à 0 % ». Un type nommé autrement — « Repos compensateur », « Congé exceptionnel » —
   se déduit du solde annuel sans que personne l'ait décidé. Et personne ne peut le changer sans
   toucher au code.

## 2. Décisions cadrantes (validées avec la Direction, 2026-09-22)

1. **Trois champs, deux sens de calcul.** Début · Jours ouvrables · Fin. Les jours et la fin se
   recalculent l'un l'autre ; le dernier des deux touché a raison.
2. **Jours entiers seulement.** Comme aujourd'hui : le calcul des jours ouvrables ne connaît pas la
   demi-journée, et la colonne `nbJours` n'en a jamais porté. La demi-journée n'est pas dans ce lot.
3. **Le solde ne compte que le congé annuel**, par une **case sur le type de congé**, réglable dans
   Paramètres. La liste de mots-clés disparaît. Les autres types restent demandables ; ils ne
   touchent simplement pas au solde.
4. **Le serveur reste juge.** Il recalcule les jours depuis les dates, comme aujourd'hui, et refuse
   un nombre soumis qui diffère : un écran resté sur une vieille valeur ne peut pas enregistrer un
   congé faux.

## 3. Saisie : début, jours ouvrables, fin

### 3.1 Le composant partagé

Les deux formulaires — `(app)/conges/page.tsx` côté Direction, `espace/conges/page.tsx` côté
salarié — passent déjà par **un seul composant**, `components/champs-dates-conge.tsx`, qui rend
deux champs de dates et le décompte en direct. Il rend désormais **trois** champs. Une modification,
deux formulaires.

Le champ *Jours ouvrables* est un `<input type="number" name="nbJours" min="1" step="1">`, placé
**entre** le début et la fin — c'est l'ordre dans lequel on pense.

### 3.2 La règle de recalcul

Un seul état interne : `{ debut, fin, jours, dernierTouche: "jours" | "fin" | null }`.

| Ce que l'utilisateur touche | Ce qui se recalcule |
|---|---|
| **Jours** | la **fin** : à partir du début, compter `jours` jours ouvrables (début inclus s'il est ouvrable) ; la fin est le dernier jour compté. `dernierTouche = "jours"`. |
| **Fin** | les **jours** : décompte actuel (dimanches et fériés exclus). `dernierTouche = "fin"`. |
| **Début** | si `dernierTouche === "jours"` et des jours sont saisis : la fin suit. Sinon, si une fin est saisie : les jours se recalculent. Sinon rien. |

Cas limites, tous déterministes :
- **Début un dimanche ou un férié** : ce jour ne compte pas ; le premier jour compté est le premier
  jour ouvrable qui suit. La fin calculée ne tombe jamais sur un dimanche ni un férié.
- **Jours = 0 ou vide** : la fin n'est pas calculée ; le décompte sous la fin disparaît.
- **Fin avant début** (saisie manuelle) : les jours s'affichent vides, le formulaire ne s'envoie
  pas (`min` HTML, et refus serveur de toute façon).
- **Fériés** : la liste `feries` (AAAA-MM-JJ) que reçoit déjà le composant ; elle couvre la fenêtre
  chargée par la page. Un congé qui déborderait de cette fenêtre est recompté par le serveur avec la
  liste complète — c'est lui qui a raison (cf. 3.4).

### 3.3 Le calcul, fonction pure

Le composant porte aujourd'hui sa propre copie de `joursOuvrables(debut, fin, feries)`, doublon
client de `calculerJoursOuvrables` (`lib/payroll.ts`). Ce lot ajoute le sens inverse et **range les
deux sens au même endroit** : un module `lib/jours-ouvrables.ts`, sans dépendance, importable par
le client comme par le serveur :

- `compterJoursOuvrables(debut, fin, feries): number` — l'existant, déplacé ;
- `finApresJoursOuvrables(debut, jours, feries): Date | null` — le nouveau ; `null` si `jours < 1`.

`calculerJoursOuvrables` de `lib/payroll.ts` devient un simple réexport, pour ne pas toucher ses
appelants (paie, contrats). Le composant importe le module au lieu de recopier la boucle.

### 3.4 Côté serveur

`demanderConge` (Direction) et `demanderMonConge` (salarié) lisent aujourd'hui `dateDebut` et
`dateFin`, recalculent `nbJours` avec les fériés de la base, refusent `nbJours <= 0`. Ils lisent
en plus `nbJours` soumis et **refusent si différent** du recalcul, avec un message qui dit quoi
faire : « Le nombre de jours ne correspond plus aux dates (12 saisis, 11 recalculés) — vérifiez la
date de fin. » Le nombre enregistré est toujours celui du serveur.

Pourquoi ne pas simplement ignorer le champ : parce qu'un écart est un signal (fériés chargés
partiellement, formulaire resté ouvert la veille d'un férié ajouté), et qu'enregistrer en silence
un nombre différent de celui affiché est exactement ce qu'un utilisateur ne pardonne pas.

## 4. Solde : le congé annuel seul

### 4.1 Le drapeau

`TypeConge` reçoit `compteDansSolde Boolean @default(false)`. Migration Prisma :

```sql
ALTER TABLE "TypeConge" ADD COLUMN "compteDansSolde" BOOLEAN NOT NULL DEFAULT false;
UPDATE "TypeConge" SET "compteDansSolde" = true WHERE lower(nom) LIKE '%annuel%';
```

Le `UPDATE` reproduit l'intention d'aujourd'hui (le congé annuel se déduit) sans rien deviner
d'autre. Si aucun type ne contient « annuel », la migration ne coche rien et le solde affiché
devient « acquis − 0 » : visible immédiatement dans Paramètres, où la Direction coche le bon type.
Aucun script de correction ne vient compléter : l'outil signale, la Direction tranche.

### 4.2 Paramètres → Types de congé

Une colonne de plus dans le tableau, une case à cocher « Compte dans le solde », éditable en ligne
comme `joursPayes` et `tauxPct` (`typeconge-actions.ts` lit un champ de plus). Les types `systeme`
la portent aussi. Un texte d'aide sous le tableau : « Seuls les types cochés se déduisent du solde de
congé annuel. Les autres restent demandables. »

### 4.3 La règle

`congeDeductibleDuSolde(type, tauxPct)` dans `lib/payroll.ts` devient
`congeDeductibleDuSolde(type, compteDansSolde: boolean | undefined): boolean` et se réduit à
`compteDansSolde === true`. La constante `MOTS_CONGES_NON_DEDUCTIBLES` est supprimée. La règle
« taux à 0 % » disparaît aussi : un type non payé qui devrait compter se coche ; un type payé qui ne
doit pas compter se décoche. La case dit tout.

Les **six appelants** (fiche employé et son export PDF, PDF de la demande, calendrier de l'onglet
Congés, page Congés du salarié, accueil du salarié) construisent aujourd'hui une carte
`tauxParType` depuis `TypeConge` pour la passer à la fonction. Ils construisent
`compteDansSoldeParType` à la place — changement mécanique, même forme. Le type d'une demande est
du texte libre (`LeaveRequest.type`) : un type introuvable dans la table ne compte pas, comme
aujourd'hui un type sans taux connu était traité prudemment.

### 4.4 Le libellé

Partout où le solde s'affiche, « Jours disponibles » / « Solde » devient **« Solde de congé
annuel »** (carte de l'espace salarié, accueil, fiche employé, onglet Congés). Le sous-texte du
formulaire salarié rappelle : « Seul le congé annuel se déduit de ce solde. »

## 5. Hors périmètre

- La demi-journée.
- Le calendrier, l'approbation, le refus, les codes de présence posés/retirés à l'approbation.
- L'acquisition (1,5 j/mois plafonné à 18, mois révolus) : inchangée.
- La signature de la demande approuvée par le salarié : lot 2.

## 6. Tests

**`lib/jours-ouvrables.test.ts`** (fonction pure, sans base) :
- `finApresJoursOuvrables` : 1 jour un lundi → ce lundi ; 6 jours un lundi → samedi ; 7 jours un
  lundi → lundi suivant (le dimanche sauté) ; début un dimanche, 1 jour → lundi ; férié en plein
  milieu → fin décalée d'un jour ; férié LE jour de début → non compté ; `jours = 0` → `null`.
- Aller-retour : pour une centaine de couples (début, jours) tirés au sort avec quelques fériés,
  `compterJoursOuvrables(debut, finApresJoursOuvrables(debut, jours)) === jours`.
- `calculerJoursOuvrables` de `lib/payroll` donne les mêmes résultats qu'avant sur les cas déjà
  couverts par `payroll.test.ts` (le réexport ne change rien).

**Composant** (`champs-dates-conge.test.tsx`, rendu React) : taper 12 jours affiche la fin ;
changer la fin recalcule les jours ; changer le début après avoir tapé des jours déplace la fin ;
changer le début après avoir tapé une fin recalcule les jours.

**Serveur** (`conges/actions.integration.test.ts`, Postgres embarqué) : une demande avec
`nbJours` cohérent s'enregistre ; avec `nbJours` incohérent est refusée avec le message attendu ;
le nombre enregistré est celui du serveur.

**Solde** (`payroll.test.ts`) : type coché → déduit ; type décoché → non déduit, y compris un type
nommé « Congé annuel » décoché (la case prime sur le nom) et un type nommé « Congé maladie »
décoché (non-régression de l'ancien comportement) ; type inconnu de la table → non déduit.

**Migration** : test d'intégration (Postgres embarqué) qui insère « Congé annuel », « Congé
maladie », « Repos », exécute le `UPDATE` de la migration tel quel, et vérifie que seul le premier
est coché.
