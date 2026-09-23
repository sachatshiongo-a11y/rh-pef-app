# Pointage par QR code — conception

- **Date** : 2026-09-23
- **Lot** : 5 des sept arbitrés le 2026-09-22 (remonté en tête à la demande de la Direction).
- **Décisions de la Direction (2026-09-23)** :
  1. **QR + position, non bloquant** : un scan loin du restaurant, ou sans position, est
     ENREGISTRÉ mais marqué « à vérifier ». L'outil signale, la Direction tranche.
  2. **Deux scans par jour + pause tapée** : arrivée, puis départ avec saisie de la pause, comme
     aujourd'hui.
  3. **Une affiche imprimée**, pas de tablette : la position fait la preuve de présence. On
     **mesure** la part de pointages « à vérifier » ; si elle est trop forte, une tablette à code
     tournant viendra plus tard sans rien défaire.
  4. **Un seul restaurant**.
  5. **Création des comptes en lot**, avec une feuille à imprimer par salarié.
- **Remplace** le bouton de pointage actuel (« Pointer mon arrivée / mon départ »).

---

## 1. Contexte

Aujourd'hui un salarié pointe en appuyant sur un bouton, depuis n'importe où : rien ne prouve
qu'il est au restaurant. Mesuré en production le 2026-09-23 : l'espace salarié est **activé**,
**24 salariés actifs, dont 6 seulement ont un compte**, 4 pointages par l'application au total.

Le pointage alimente les présences et les heures (`appliquerAuxPresences` dans
`src/app/(app)/pointer/pointer-actions.ts`), donc la paie. Il n'existe **aucun** modèle de lieu.

## 2. Le parcours du salarié

1. Il ouvre l'application (PWA ou navigateur) → **Pointer**.
2. La **caméra s'ouvre dans l'application** et il vise l'affiche.
   - C'est le chemin principal parce que, sur iPhone, scanner avec l'appareil photo ouvre Safari,
     dont la session est **distincte** de celle de l'application installée : le salarié devrait se
     reconnecter à chaque pointage.
   - Scanner l'affiche avec l'appareil photo du téléphone marche aussi (l'affiche porte une
     adresse), en second recours. Sans session, on passe par la connexion puis on revient au scan.
   - Android : même comportement. Un salarié **sans smartphone** ne peut pas scanner : la Direction
     saisit ses heures à la main, comme aujourd'hui (hors périmètre : une borne à matricule + code).
3. Au même moment, le téléphone donne **sa position et sa précision**. L'heure retenue est
   **celle du serveur**, jamais celle du téléphone.
4. **Premier scan du jour → arrivée.** « Arrivée pointée à 8 h 02. »
5. **Second scan → départ.** L'écran demande la durée de pause ; le départ est horodaté à
   **l'instant du scan**, pas à l'instant où la pause est validée.
   - Si le second scan tombe **moins de 5 minutes** après l'arrivée (double scan par erreur),
     l'écran demande confirmation : « Vous avez pointé votre arrivée à 8 h 02. Pointer votre départ
     maintenant ? ».
   - Si la pause n'est jamais saisie, le Suivi de la Direction affiche « départ scanné, pause non
     saisie ».
6. **Troisième scan** → « Votre journée est déjà complète. »
7. Loin du restaurant, sans position, ou position trop floue : le pointage est **enregistré
   quand même**, et l'écran le dit franchement : « Pointage enregistré. Votre position n'a pas pu
   confirmer que vous êtes au restaurant : la Direction le vérifiera. »

Règles conservées de l'existant : paie du mois validée → refus ; congé approuvé ce jour → refus ;
une seule arrivée par jour.

## 3. La Direction

### Paramètres → Pointage (ADMIN)
- **Position du restaurant** : bouton « Utiliser ma position actuelle », à presser sur place.
  Refusé si la précision dépasse 100 m (« rapprochez-vous d'une fenêtre et réessayez »). Latitude,
  longitude et précision affichées.
  **Repli : saisie manuelle** des coordonnées (copiées depuis Google Maps, format
  `-4.3217, 15.3125`). Un ordinateur se positionne souvent par le Wi-Fi, peu cartographié à
  Kinshasa : sans ce repli, la position pourrait ne jamais être réglable.
- **Rayon toléré** : 150 m par défaut.
- **Imprimer l'affiche** : PDF A4 — logo, « Pointage », le QR en grand, trois lignes (« Ouvrez
  l'application · Appuyez sur Pointer · Visez ce code »). Impossible tant que la position n'est pas
  réglée.
- **Changer le code** : toutes les affiches déjà imprimées deviennent inutilisables (une photo
  circule, une affiche a été emportée). Confirmation obligatoire.

### Suivi des pointages
- Chaque pointage « à vérifier » porte son **motif lisible** : « à 2,3 km », « position refusée »,
  « position indisponible », « précision ±900 m ».
- **Cases + « Marquer vérifié »** en lot (préférence de la Direction : actions groupées partout).
- **Compteur de la semaine** : « 3 pointages à vérifier sur 41 (7 %) ». C'est la mesure qui dira si
  l'affiche suffit.
- La saisie manuelle des horaires reste inchangée.

### Comptes en lot
- Liste des salariés : filtre « sans compte », cases, bouton **« Créer les comptes »**.
- Réutilise la logique de `creerCompteEmploye` (un seul chemin de création, jamais recopié).
- Produit un **PDF à découper**, une fiche par salarié : nom, matricule, mot de passe temporaire,
  adresse de l'application et QR pour l'ouvrir.
- Les mots de passe temporaires n'existent **qu'une fois**, dans ce PDF, généré en mémoire, jamais
  stocké. L'écran prévient : « Ce document contient des mots de passe : remettez chaque fiche en
  main propre. »
- Idempotent : un salarié qui a déjà un compte est ignoré, jamais réinitialisé.

## 4. Données

- `Config` : `pointageLatitude`, `pointageLongitude` (décimaux, nuls tant que non réglés),
  `pointageRayonM` (entier, défaut 150), `pointageCode` (aléatoire, 32 octets en base64url, nul tant
  qu'aucune affiche n'a été produite).
- Nouveau modèle **`ScanPointage`** — l'historique de chaque scan, jamais réécrit :
  `pointageId`, `employeeId`, `moment` (ARRIVEE | DEPART), `instant` (serveur), `latitude?`,
  `longitude?`, `precisionM?`, `distanceM?`, `verdict` (AU_RESTAURANT | A_VERIFIER), `motif?`
  (LOIN | POSITION_REFUSEE | POSITION_INDISPONIBLE | PRECISION_INSUFFISANTE),
  `verifieParId?`, `verifieLe?`.
- **« À vérifier » se dérive** des scans (un scan A_VERIFIER sans `verifieLe`). Aucun booléen
  recopié sur `Pointage` — même règle que la signature électronique.
- `SourcePointage` gagne **`QR`**. Les pointages `APP` existants restent dans l'historique.

## 5. La règle de position — une seule fonction pure

`verdictPosition(position, restaurant)` où `position` est `{ lat, lng, precisionM }` ou une erreur
(`REFUSEE` | `INDISPONIBLE`) :

- erreur → A_VERIFIER, motif = l'erreur ;
- précision > **300 m** → A_VERIFIER, PRECISION_INSUFFISANTE (le point n'a plus de sens) ;
- distance (haversine) ≤ rayon + précision → AU_RESTAURANT (le cercle d'incertitude touche le
  restaurant : bénéfice du doute) ;
- sinon → A_VERIFIER, LOIN.

Rayon et plafond de précision sont des réglages, pas des vérités : chaque scan garde sa précision
et sa distance, pour les ajuster sur des mesures réelles.

## 6. Sécurité

- Le code de l'affiche est comparé en **temps constant**. Code absent, faux ou périmé → refus
  « Cette affiche n'est plus valable, demandez la nouvelle à la Direction. »
- Le scan exige une session **liée à une fiche employé** ; le pointage est toujours pour soi.
- La position vient du téléphone : un utilisateur technique peut la falsifier. Assumé au niveau
  choisi (non bloquant) ; le relais d'une photo de l'affiche est, lui, attrapé par la position.
- Le décodeur QR tourne **sans worker** (pas de fichier supplémentaire derrière le garde
  d'authentification — piège rencontré quatre fois dans cette famille de dépôts).
- Un QR scanné qui n'est pas l'affiche (autre site, autre contenu) est refusé : « Ce n'est pas
  l'affiche de pointage. »

## 7. Ce qui disparaît

- Les boutons « Pointer mon arrivée / mon départ » et les actions `pointerArrivee` /
  `pointerDepart`. Aucun chemin ne permet plus de pointer sans avoir scanné l'affiche.

## 8. Tests exigés

- `verdictPosition` et la distance : cas par cas, dont les bords (exactement au rayon, précision au
  plafond, erreurs).
- Action de scan (intégration, base relue) : arrivée ; départ en attente de pause puis clos à
  l'instant du scan ; troisième scan refusé ; double scan < 5 min qui exige confirmation ; code faux
  ou périmé refusé sans rien écrire ; paie validée et congé approuvé refusés ; scan lointain
  **enregistré** et marqué à vérifier ; scan d'un autre salarié impossible.
- Comptes en lot : ne crée que les manquants, n'en réinitialise aucun, rend un mot de passe par
  compte créé.
- Rendu PDF de l'affiche et des fiches : QR présent, aucune police de repli (piège de l'espace fine
  insécable et du « ⚠ »).
- Garde-fou : plus aucun appel à `pointerArrivee` / `pointerDepart`.
- Chaque garde-fou **falsifié** (rouge puis vert).

## 9. Hors périmètre

Tablette à code tournant ; plusieurs lieux ; service coupé (deux arrivées par jour) ; blocage des
scans lointains ; borne pour les salariés sans smartphone.

## 10. À vérifier sur place, après déploiement

Régler la position au restaurant ; imprimer et afficher ; créer les comptes et distribuer les
fiches ; un salarié pointe arrivée et départ sur **iPhone** et sur **Android** ; regarder la
précision relevée dans le Suivi pendant la première semaine.
