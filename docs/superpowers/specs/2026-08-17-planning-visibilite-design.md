# Planning — visibilité d'ensemble (chantier C)

- **Date** : 2026-08-17
- **Statut** : Design validé (à implémenter)
- **Périmètre** : la vue **semaine** du planning. Les vues mois et modèle ne bougent pas.

---

## 1. Contexte & objectif

Le chantier C avait été abandonné faute de besoin constatable : la grille portait déjà actions
groupées, colonne des noms figée, en-tête collant et vue téléphone. Deux gênes précises l'ont
rouvert, exprimées par la Direction.

1. **Il faut faire défiler pour voir toute la brigade.** La grille est plafonnée à `74vh` et ses
   lignes mesurent environ 34 px : au-delà d'une vingtaine de salariés, on ne voit jamais l'équipe
   entière d'un coup. Or c'est précisément la vue d'ensemble qu'on cherche en ouvrant un planning.
2. **On ne peut pas lire le planning par shift.** La grille répond à « que fait Untel cette
   semaine ». Elle ne répond pas à « qui est en cuisine samedi », qui est pourtant la question
   d'exploitation.

S'y ajoute un manque plus simple : les lignes sont groupées en deux blocs figés — *Brigade* et
*Back-office* — alors que le regroupement utile au quotidien est le **poste**.

## 2. Décisions cadrantes (validées avec la Direction, 2026-08-17)

1. **C'est la semaine entière qui doit tenir**, pour toute la brigade, sans défilement vertical. Le
   mois reste tel quel : 31 colonnes lisibles en détail n'est pas un objectif.
2. **« Trier par shift » est une seconde lecture, pas un filtre** : une ligne par shift, et dans
   chaque case les personnes qui le tiennent ce jour-là.
3. **La densité se règle par des tailles CSS réelles, jamais par un zoom ou une mise à l'échelle.**
   Le menu de choix de shift est positionné en coordonnées absolues via un portail : une transformation
   d'échelle décalerait le menu de sa case. C'est une contrainte technique, pas une préférence.

## 3. Faire tenir la semaine

Deux leviers, cumulés.

**Libérer la hauteur.** Le plafond `max-h-[74vh]` est remplacé par une hauteur qui consomme l'espace
réellement disponible sous l'en-tête de page. La grille cesse de s'auto-limiter à trois quarts
d'écran alors qu'il reste de la place.

**Une densité réglable**, en trois crans, agissant sur des tailles réelles :

| Cran | Hauteur de ligne | Colonne jour | Avatar |
|---|---|---|---|
| Confort | ~34 px (l'actuel) | 132 px | oui |
| Compact | ~26 px | 112 px | oui |
| Très compact | ~20 px | 96 px | non, initiales seules |

Le cran choisi est **retenu d'une visite à l'autre** (stockage local du navigateur). Défaut :
*Compact* — c'est celui qui fait tenir une trentaine de salariés sur un écran d'ordinateur portable,
et le besoin exprimé est justement de tout voir.

**Ce que la densité ne touche pas** : les cases restent cliquables, le menu de shift s'ouvre
normalement, la colonne des noms reste figée et l'en-tête collant. On réduit la taille, jamais les
capacités.

Sur téléphone, rien ne change : la navigation jour par jour existante reste le bon traitement.

## 4. La lecture par shift

Un sélecteur de **lecture** dans la vue semaine : *Par personne* (l'actuelle, défaut) ou *Par shift*.

En lecture *Par shift* :

- **une ligne par couple shift × poste** réellement concerné sur la période — c'est-à-dire ayant
  soit un besoin déclaré, soit au moins une affectation. On n'affiche pas des lignes vides ;
- **dans chaque case, les personnes affectées** ce jour-là à ce shift et ce poste, en initiales
  quand la densité est haute, en noms sinon ;
- **le compte face au besoin** quand un besoin est déclaré : « 2/3 », avec la même couleur que le
  panneau de couverture actuel (complet en vert, incomplet en orange). Pas une autre convention pour
  la même information.

**Cette lecture est en consultation seule**, et l'écran doit le dire. Modifier une case reviendrait
à demander « laquelle des trois personnes ? » à chaque clic : la saisie reste dans la lecture *Par
personne*, qui est faite pour ça. Mieux vaut une vue qui assume d'être une vue qu'une saisie
ambiguë.

## 5. Grouper les lignes

Le regroupement des lignes devient un choix, au lieu des deux blocs figés :

- **Catégorie** — Brigade / Back-office, le comportement actuel, conservé comme défaut ;
- **Poste** — un bloc par intitulé de poste, c'est le regroupement demandé ;
- **Aucun** — une seule liste triée par nom, utile quand on cherche une personne.

Chaque bloc garde son en-tête avec son effectif, comme aujourd'hui. Le choix est retenu d'une visite
à l'autre, comme la densité.

En lecture *Par shift*, ce sélecteur est sans objet — les lignes sont déjà des shifts — et il
disparaît plutôt que de rester présent et inopérant.

## 6. Tests

Le gros du lot est de l'affichage, mais deux calculs méritent d'être purs et testés, dans
`src/app/(app)/planning/lecture-shift.ts` :

- **le regroupement des salariés** selon le critère choisi : un bloc par valeur, trié, effectif
  juste, et un salarié sans poste renseigné rangé dans un bloc explicite plutôt que perdu ;
- **le pivot par shift** : à partir des créneaux de la période, produire les lignes shift × poste
  avec, par jour, la liste des personnes et le compte face au besoin. Cas à couvrir : un shift sans
  aucun besoin déclaré mais avec des affectations ; un besoin déclaré que personne ne tient ; une
  personne en congé approuvé qui ne doit apparaître nulle part ; et un jour sans personne, qui doit
  produire une case vide et non une ligne manquante.

## 7. Hors périmètre

- Les vues **mois** et **modèle**, inchangées.
- Toute modification du moteur de génération ou de l'écart prévu/réalisé.
- La saisie depuis la lecture par shift (cf. §4).
- Le téléphone, dont le traitement jour par jour existant reste adapté.
