# Planning — fiabiliser la génération automatique

- **Date** : 2026-08-16
- **Statut** : Design validé (à implémenter)
- **Périmètre** : chantier **A** d'un découpage en trois. B (écart prévu/réalisé) et C (ergonomie de
  la grille) feront chacun l'objet de leur propre conception, dans l'ordre **A → C → B**.

---

## 1. Contexte & objectif

Le module planning est abouti — besoins par shift × poste × jour, génération « couverture d'abord »
avec équité, polyvalence, congés pris en compte, modèles hebdo semaine A/B, publication avec
notification aux salariés, échanges de créneaux à double validation, exports PDF/Excel.

Il souffre pourtant de quatre défauts, tous constatés par la Direction, et **aucun test ne le
couvre** : l'algorithme de génération (~320 lignes) vit à l'intérieur d'une server action, donc il
n'est ni testable sans base, ni corrigeable sans risque. C'est le seul gros morceau du dépôt sans
filet.

| Symptôme constaté | Cause dans le code actuel |
|---|---|
| Le mauvais shift est attribué | `shiftPourEmploye` cherche le shift par **expression régulière sur son nom** (`/caissi/`, `/cuisine/`, `/salle/`, `/journée 8h-17h/`). Renommer un shift change les affectations en silence ; tout poste non reconnu (plongeur, sécurité, livreur) tombe sur « Journée 8h-17h ». |
| Des trous de couverture restent | `aDeLaPlace` (plafond d'heures hebdo) filtre le vivier **avant** que la couverture soit satisfaite. Aucun rattrapage, et le rapport dit « manque 2 » sans dire pourquoi. |
| La répartition est inégale | L'équité ne trie que sur le **cumul d'heures**. Rien n'équilibre les jours pénibles (dimanches, fériés) ni l'alternance matin/soir. |
| Les jours tombés ne vont pas | **Aucune règle de repos** : rien n'empêche sept jours d'affilée. Les fériés sont une case tout-ou-rien. |

S'y ajoute un piège structurel : **deux algorithmes différents** cohabitent selon que des besoins
sont déclarés ou non (`if (besoins.length > 0) … else …`), avec des comportements distincts.

**Objectif** : rendre la génération corrigeable *et* explicable. Pas « produire un meilleur
planning » dans l'absolu, mais « pouvoir dire pourquoi ce planning-là, et le changer sans casser
autre chose ».

## 2. Décisions cadrantes (validées avec la Direction, 2026-08-16)

1. **Approche** — *extraction puis règles explicites*. Écartées : les correctifs ciblés sans
   extraction (ne règlent pas le problème de confiance) et un solveur sous contraintes
   (sur-dimensionné pour ~30 personnes, et rendrait le « pourquoi » plus opaque, pas moins).
2. **Shift par poste** — une **liste ordonnée de shifts acceptables**, pas un défaut unique.
3. **Repos** — **1 jour de repos par semaine, 6 jours consécutifs au maximum**, en dur (minimum légal
   RDC : 24 h consécutives). Pas de réglage : logiciel interne.
4. **Dépassement d'heures** — jamais automatique. Case décochée par défaut dans le formulaire.
5. **Historique pour l'équité** — **8 semaines glissantes**.

## 3. Architecture & frontière du module

Nouveau module `src/lib/planning-auto.ts`, **pur** : aucune I/O, aucun import de Prisma, uniquement
des valeurs en entrée et en sortie. Même convention que `src/lib/payroll.ts` et `src/lib/prets.ts`.

```
EntreesGeneration  →  genererPlanning()  →  ResultatGeneration
```

**Entrées** — exactement ce que la server action lit déjà, converti en valeurs simples :

- employés : `{ id, nom, poste, secteur, heuresParJour, heuresHebdomadaires }`
- shifts : `{ id, nom, dureeHeures }`
- besoins : `{ shiftId, poste, jourSemaine, nombreRequis }`
- shifts acceptables par poste : `{ poste, shiftId, ordre }` *(nouveau, cf. §4)*
- polyvalences : `{ posteSource, posteCible }`
- modèles hebdo : `{ employeeId, jour, semaine, shiftId }`
- congés approuvés : `{ employeeId, dateDebut, dateFin }`
- jours fériés : `Date[]`
- créneaux existants sur la période : `{ employeeId, date, shiftId }`
- **historique** : créneaux des 8 semaines précédant la période *(nouveau, cf. §6)*
- options du formulaire : `{ shiftId?, jours[], nbParSemaine, inclureFeries, modeles, ecraser, completer, autoriserDepassementHeures }`
- **`aujourdhui: Date`** — passé en paramètre, jamais `new Date()` dans le module, sinon les tests ne
  sont pas reproductibles et le module cesse d'être pur.

Les `Decimal` Prisma deviennent des `number`, les dates restent des `Date` : la conversion est le
travail de l'action, pas du moteur.

**Sorties** — `{ creneaux: { employeeId, date, shiftId }[], rapport: RapportGeneration }`. Aucune
écriture, aucun `revalidatePath`, aucune session.

**La server action** `genererPlanningAuto` se réduit à : vérifier le rôle → lire → appeler →
écrire → revalider. `actions.ts` passe d'environ 676 à ~350 lignes et redevient un fichier
d'actions plutôt qu'un moteur.

## 4. Le shift d'un poste devient une donnée

Les expressions régulières sur les noms de shifts disparaissent, remplacées par une liste ordonnée
de shifts acceptables par poste.

**Modèle Prisma** — dans la lignée de `BesoinShift` et `PolyvalencePoste` :

```prisma
model ShiftPoste {
  id        String   @id @default(uuid())
  poste     String   // correspond à Employee.poste
  shiftId   String
  shift     Shift    @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  ordre     Int      @default(0)
  createdAt DateTime @default(now())

  @@unique([poste, shiftId])
  @@index([poste])
  @@schema("public")
}
```

Le rattachement se fait sur la **chaîne `poste`**, comme `BesoinShift` et `PolyvalencePoste` — même
convention, pas de dépendance à l'existence d'une `FichePoste`.

**Édition** — depuis la configuration du planning, à côté des besoins et de la polyvalence : c'est
là qu'est la personne qui configure.

**Usage par le moteur** — dans la passe complémentaire, le moteur descend la liste dans l'ordre et
retient le premier shift où la personne est libre ce jour-là et où les contraintes dures passent.
L'ordre d'essai est modulé par l'équité de shift (§6, critère 3) pour que le premier de la liste ne
monopolise pas.

**Sans liste déclarée, on n'invente rien.** Le salarié n'est pas rempli par la passe
complémentaire, et le rapport le nomme. Un trou visible vaut mieux qu'un shift faux posé en
silence — même règle que partout ailleurs : l'outil signale, la Direction tranche.

**Reprise de l'existant (obligatoire).** Une migration de données ponctuelle écrit les
correspondances actuellement encodées en dur, pour les postes qui les vérifient au moment du
déploiement :

- poste contenant « caissi » → shift « Caisse »
- secteur « Cuisine » → shift « Matin cuisine »
- secteur « Salle » → shift « Matin/midi salle »
- les autres → shift « Journée 8h-17h »

Les shifts « Admin » et « Nuit » ne sont jamais écrits automatiquement, comme aujourd'hui. Sans
cette reprise, la première génération après déploiement changerait sans prévenir — exactement ce
que ce lot cherche à supprimer.

## 5. Ordre des décisions et contraintes

**Un seul algorithme.** « Aucun besoin déclaré » devient une étape 2 vide, au lieu d'un second code
au comportement différent.

1. **Modèles hebdo** — les affectations fixes se posent d'abord.
2. **Couverture des besoins** — jour par jour, besoin par besoin : titulaires du poste, puis
   polyvalence si le compte n'y est pas.
3. **Passe complémentaire** — remplir chacun jusqu'à ses heures via sa liste de shifts acceptables
   (seulement si l'option « compléter » est cochée, comportement actuel conservé).

**Contraintes dures** — jamais violées, à aucune étape :

- un seul shift par jour et par personne ;
- aucun créneau pendant un congé approuvé ;
- **au moins 1 jour de repos par semaine** (semaine calendaire lundi → dimanche) ;
- **au plus 6 jours consécutifs travaillés**, en tenant compte des créneaux existants et de
  l'historique immédiat (une série à cheval sur deux semaines doit être vue).

**Contrainte souple** — le plafond d'heures hebdomadaires. C'est la cause des trous de couverture :
aujourd'hui il est dur et bloque en silence. Il devient relâchable, **jamais tout seul** : case
`autoriserDepassementHeures` dans le formulaire, décochée par défaut. Sans elle, le besoin reste
découvert et le rapport dit précisément pourquoi. Le logiciel n'engage pas d'heures supplémentaires
de sa propre initiative.

Quand la case est cochée, la relaxation ne s'applique **que pour couvrir un besoin déclaré**
(étape 2), jamais dans la passe complémentaire : compléter quelqu'un au-delà de ses heures n'a
aucune justification.

## 6. Équité

L'équité est un **départage** entre candidats disponibles, jamais un veto : elle ne peut pas
empêcher de couvrir un besoin.

Critères, dans l'ordre :

1. **Heures cumulées** (période + historique) — critère actuel, conservé, principal.
2. **Dimanches et jours fériés déjà attribués** — pour faire tourner les jours pénibles.
3. **Pour le choix du shift** dans la liste acceptable : celui que la personne a le moins eu
   récemment, pour que matin et soir alternent.

Les critères 2 et 3 ne veulent rien dire sur une génération d'une seule semaine : un seul dimanche,
et pas la place d'alterner. D'où l'**historique de 8 semaines** en entrée du moteur — assez long
pour qu'une rotation s'installe, assez court pour qu'une nouvelle embauche ou un changement
d'organisation soit pris en compte vite.

## 7. Le rapport

Aujourd'hui : `{ crees, besoinsNonCouverts, detailNonCouverts (tronqué à 6), sousHeures }`. Le trou
est visible, jamais sa cause.

Le moteur élimine les candidats dans un ordre connu ; il suffit de retenir à quelle étape le vivier
s'est vidé.

```ts
type RaisonNonCouverture =
  | "AUCUN_TITULAIRE"      // personne à ce poste, ni en polyvalence
  | "TOUS_EN_CONGE"
  | "TOUS_DEJA_PRIS"       // déjà un shift ce jour-là
  | "TOUS_AU_REPOS"        // repos hebdomadaire ou 6 jours consécutifs
  | "TOUS_AU_PLAFOND"      // plafond d'heures — levable via l'option
```

`TOUS_AU_PLAFOND` mentionne explicitement que cocher « autoriser le dépassement » couvrirait le
besoin : c'est une décision qui coûte des heures supplémentaires, elle se pose devant la Direction.

Le rapport gagne deux entrées :

- **salariés sans liste de shifts acceptables** — nommés, puisqu'ils ne sont plus remplis en
  silence ;
- **dépassements d'heures réellement engagés**, si l'option était cochée — pour qu'engager des
  heures supplémentaires ne passe jamais inaperçu.

Le moteur renvoie la **liste complète**. C'est l'écran qui décide d'en afficher six et d'annoncer
« et 12 autres ». Aujourd'hui la troncature à six est dans le moteur, donc silencieuse.

## 8. Tests

Tests unitaires sur le module pur, sans base — c'est tout l'intérêt de l'extraction.

- **Une cause de non-couverture par test**, en vérifiant la **raison** rapportée, pas seulement le
  compte.
- **Contraintes dures** : jamais 7 jours d'affilée ; jamais plus de 6 consécutifs, y compris à
  cheval sur deux semaines ; jamais de créneau sur un congé approuvé ; modèles hebdo prioritaires.
- **Shifts acceptables** : descente dans l'ordre, repli sur le suivant, et absence de liste →
  aucun créneau posé + salarié nommé au rapport.
- **Dépassement d'heures** : sans l'option, besoin découvert avec `TOUS_AU_PLAFOND` ; avec
  l'option, besoin couvert et dépassement listé ; jamais de dépassement dans la passe
  complémentaire.
- **Équité** : sur 8 semaines d'historique, les dimanches tournent ; le premier shift de la liste
  ne monopolise pas.
- **Golden** : une brigade de référence réaliste, son planning attendu figé dans le dépôt — même
  convention que `src/lib/fiches/golden.integration.test.ts` et
  `src/lib/exploitation/golden-aout.integration.test.ts`. Son intérêt est de rendre visible tout
  changement de comportement futur, y compris non prévu.

## 9. Effet de bord assumé

**Les plannings générés vont changer dès la mise en service**, à cause des règles de repos qui
n'existaient pas et de la disparition du repli par expression régulière. Ce n'est pas un effet de
bord indésirable, c'est l'objet du lot — mais il faut le savoir avant de régénérer un mois déjà
validé. La reprise de l'existant (§4) limite le changement au strict nécessaire.

## 10. Hors périmètre

- **Écart prévu / réalisé** (chantier B) — comparer le planning au pointage.
- **Ergonomie de la grille** (chantier C) — saisie, lecture, téléphone.
- Toute modification des échanges de créneaux, de la publication de semaine ou des exports.
- Aucune modification de la paie : le planning alimente les taux horaires par shift, ce lot ne
  touche pas à ce chemin.
