# Planning — écart prévu / réalisé (chantier B)

- **Date** : 2026-08-17
- **Statut** : Design validé (à implémenter)
- **Périmètre** : chantier **B** du découpage planning. A est livré. **C est abandonné en l'état** — voir §7.

---

## 1. Contexte & objectif

Le planning se fait, le pointage se fait, et **rien ne rapproche les deux**. C'est le deuxième point de douleur nommé par la Direction : « on ne sait pas si le planning a été tenu ».

Aujourd'hui, l'onglet Présences affiche déjà, sous chaque code du jour, l'horaire planifié — utile case par case, mais il faut lire trente lignes sur trente-et-un jours pour se faire une idée. Aucune vue ne dit « il manquait quelqu'un en salle samedi » ni « Untel a été planifié 48 h et en a fait 41 ».

**Objectif** : répondre à deux questions, et seulement deux.

1. **La couverture a-t-elle tenu ?** Jour par jour et shift par shift : combien de personnes étaient prévues, combien ont réellement travaillé, et **pourquoi** les autres n'y étaient pas.
2. **Les heures prévues ont-elles été faites ?** Par salarié : heures planifiées contre heures réellement travaillées, et l'écart.

**Non-objectif** : juger. L'écran constate et donne la raison quand elle est connue. Il ne dit jamais qu'un salarié est fautif, et il ne corrige rien tout seul.

## 2. Les données existent déjà

Aucune donnée nouvelle n'est nécessaire — c'est ce qui rend ce chantier court.

| Question | Source |
|---|---|
| Ce qui était prévu | `PlanningCreneau` (employé × date × shift) ; durée via `Shift` |
| Qui a réellement travaillé | `Attendance.code` (le code du jour) et `Pointage` (horodatage self-service) |
| Combien d'heures réellement faites | `OvertimeEntry.heuresTravaillees` (une ligne par employé et par jour) |
| Le poste couvert | `Employee.poste` |

## 3. Décisions cadrantes

1. **Un créneau planifié est « tenu » si le code du jour est `P`** (présence). Tout autre code signifie non tenu, et **le code lui-même est la raison** : `M` maladie, `A` absence justifiée, `C` congé, `S` sans solde, `N` absence injustifiée, `O` repos, `F` férié.
2. **Un créneau planifié sans aucun code saisi n'est PAS compté comme absence.** Il est rapporté à part, comme *non renseigné* : c'est un trou de saisie, pas un défaut du salarié. Les confondre accuserait quelqu'un d'une négligence administrative.
3. **Les heures réalisées viennent d'`OvertimeEntry`**, seule source horaire fiable (alimentée par l'import IVMS, l'auto-pointage et la saisie manuelle). Un jour codé `P` sans heures saisies compte **0 heure réalisée** et est signalé — c'est le défaut déjà connu que `tachesBloquantesCloture` surveille pour la paie.
4. **Le travail non planifié compte aussi.** Quelqu'un qui a travaillé un jour où rien n'était prévu apparaît en écart positif. Ne montrer que le manquant donnerait une image fausse de la charge réelle.
5. **Aucune écriture.** L'écran lit et calcule. Corriger une présence se fait dans l'onglet Présences, qui est fait pour ça.

## 4. Architecture

Module **pur** `src/lib/planning-ecart.ts`, même convention que `src/lib/planning-auto.ts` : aucune I/O, aucun import de Prisma ni de `src/app/`, dates en UTC.

```
EntreesEcart  →  calculerEcarts()  →  ResultatEcart
```

**Entrées** : créneaux planifiés de la période, codes de présence, heures réalisées, employés (id, nom, poste), shifts (id, nom, durée), jours fériés.

**Sorties** :

```ts
type IssueCreneau = "TENU" | "ABSENT" | "NON_RENSEIGNE";

type LigneCouverture = {
  date: Date;
  shiftId: string;
  poste: string;
  prevus: number;
  tenus: number;
  /** Détail des créneaux non tenus : qui, et le code qui l'explique (null = non renseigné). */
  manquants: { employeeId: string; code: string | null }[];
};

type LigneHeures = {
  employeeId: string;
  heuresPlanifiees: number;
  heuresRealisees: number;
  ecart: number;              // réalisé − planifié ; négatif = manque
  joursPlanifies: number;
  joursTenus: number;
  joursTravaillesHorsPlanning: number;
  /** Jours codés « P » sans aucune heure saisie — la paie les valorisera à 0. */
  joursPresenceSansHeures: number;
};
```

Plus un `total` : nombre de créneaux prévus, tenus, absents, non renseignés, et les heures agrégées.

## 5. L'écran

Une vue de plus dans la page Planning (`?vue=ecart`), à côté de *semaine*, *mois* et *modèle* — même sélecteur, même en-tête de période. Elle n'est visible que pour les rôles qui voient déjà le planning.

Deux blocs, dans cet ordre :

**Couverture** — une ligne par jour et par shift où quelque chose n'a pas tenu, la plus grave d'abord. « samedi 11 · Matin/midi salle × Serveur : 2 tenus sur 3 — Untel (maladie) ». Les jours entièrement tenus ne sont pas listés ; un compteur les résume, sinon la liste devient illisible sur un mois.

**Heures par salarié** — un tableau : nom, jours prévus, jours tenus, heures planifiées, heures réalisées, écart. Trié par écart croissant, donc les plus gros manques en tête. Écart négatif en rouge, positif en vert, conformément à la convention des montants du dépôt (le rouge est un signal, jamais une décoration).

Un bandeau ambre si des créneaux sont **non renseignés** ou si des jours `P` n'ont **pas d'heures** : ce sont des trous de saisie qui faussent la lecture, il faut les voir avant de conclure quoi que ce soit.

Export Excel, comme les autres vues du planning.

## 6. Tests

Module pur, donc tests unitaires — c'est tout l'intérêt du découpage.

- un créneau codé `P` est tenu ; un créneau codé `M`/`A`/`C`/`N`/`S` est absent avec sa raison ;
- un créneau **sans code** n'est pas compté comme absence mais comme non renseigné ;
- un jour travaillé **hors planning** apparaît en écart positif et n'est jamais compté comme couverture d'un besoin ;
- un jour `P` **sans heures** compte 0 heure réalisée et est signalé ;
- les heures planifiées suivent la durée réelle des shifts, pas un forfait ;
- une période à cheval sur deux mois est traitée sans perte ;
- un golden sur la même brigade de référence que `planning-auto.golden.test.ts`, pour rendre visible tout glissement.

## 7. Chantier C — abandonné en l'état, et pourquoi

Le chantier C visait « la saisie et la lecture au quotidien ». La lecture du code (`planning-semaine.tsx`) montre que l'essentiel existe déjà : sélection multiple avec barre d'actions groupées (affecter, vider), colonne des noms figée au défilement, en-tête collant, navigation jour par jour sur téléphone, panneau de couverture repliable, menu de shift au clic.

Construire une refonte sur un besoin qu'on ne peut pas constater serait du travail inventé. **Un seul défaut concret a été trouvé**, par la revue finale du chantier A, et il est traité ici :

> L'écran « Shifts par poste » ne permet pas de **réordonner** la liste. L'ordre est pourtant le cœur de la fonction — c'est lui qui décide quel shift le moteur essaie en premier. Pour changer une préférence, il faut aujourd'hui tout retirer et re-saisir. Et après un retrait, deux lignes peuvent porter le même `ordre`, le tri devenant alors dépendant de la base.

Correctif : des flèches monter/descendre sur chaque ligne, et une renumérotation compacte après chaque retrait pour que l'ordre reste strictement séquentiel.

Si un point de gêne précis se manifeste à l'usage, il fera l'objet de sa propre conception. Pas avant.

## 8. Hors périmètre

- Toute modification du moteur de génération (chantier A, livré).
- Toute correction de présence depuis cet écran : elle se fait dans l'onglet Présences.
- Tout lien avec la paie : cet écran ne calcule aucun montant.
