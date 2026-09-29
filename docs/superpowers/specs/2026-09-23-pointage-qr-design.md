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

---

## 11. Décision de la Direction du 2026-09-29 — « scanner = pointer » (état : CONFIRMÉE, livrée sur `feat/pointage-automatique`)

> « Le fait de scanner le QR code doit commencer le pointage, il ne faut pas d'étape
> intermédiaire. » — remplace l'appui obligatoire sur « Pointer maintenant » (§2).
>
> Confirmation explicite de Sacha (Direction), le 2026-09-29, à la question « Confirmez-vous que
> scanner l'affiche doit enregistrer le pointage tout seul, sans bouton “Pointer maintenant” ? » :
> **« Oui, pointage automatique »**. Même jour : **pause par défaut 30 min** ; mot de passe
> (6 caractères minimum) inchangé.

Ce paragraphe remplace, pour le parcours du salarié, les points 4 à 7 du §2 et la confirmation
« double scan » à 5 minutes.

### 11.1 Ce qui a été livré avant (branche `fix/scan-apres-mot-de-passe`)
- **Le scan survit au mot de passe temporaire** : `/scan?c=…` → `/espace/mot-de-passe?retour=…`
  → retour au scan. Retour validé par la liste blanche de `lib/retour-connexion.ts` (`/scan?…`
  seul) ; espace salarié fermé → message sur `/scan`, sans redirection.
- **Connexion depuis un scan** : champs 16 px (pas de zoom iOS), gros bouton, `autocomplete`
  `username` / `current-password`.
- **Durée de session** : le code ne l'écourte pas (cookies `@supabase/ssr` 0.12 : 400 jours,
  posés par le serveur, rafraîchis par le proxy à chaque navigation ; aucun délai d'inactivité
  dans le code). Seuls les réglages du tableau de bord Supabase peuvent la limiter (§11.3).

### 11.2 Le pointage automatique (branche `feat/pointage-automatique`)
1. **Envoi sans geste** — depuis le SCRIPT de la page, après son chargement, jamais depuis la
   requête GET : un aperçu de lien ou un préchargement n'exécute pas le script, rien n'est pointé
   (test : `app/scan/scan-get.integration.test.ts`, rendu serveur complet contre une vraie base →
   0 scan). Vaut pour `/scan?c=…` (appareil photo) comme pour le scanner intégré, dès que le code
   est décodé. Le code est retiré de l'adresse après lecture (un onglet restauré ne rejoue rien).
   La position est demandée en parallèle, **plafond 8 s** ; sans position, le pointage part quand
   même, « À vérifier : position non transmise » (loin ou trop floue : « … hors du restaurant »).
   Résultat en grand : « Arrivée enregistrée à 8 h 02 » / « Départ enregistré à 17 h 05 », à
   l'heure du serveur (mention « Heure du serveur, pas celle du téléphone »).
2. **Scan répété** — moins de **10 min** après le dernier pointage valable (arrivée OU départ) de
   la même personne : rien n'est écrit, le pointage déjà fait est réaffiché (« Arrivée déjà
   enregistrée à … — ce nouveau scan n'a rien changé »). Au-delà de 10 min après le départ :
   « Votre journée est déjà complète ». Remplace la confirmation « double scan » à 5 min.
3. **« Annuler ce pointage »** — **5 min**, le salarié lui-même seulement (même refus pour « d'un
   collègue » et « inexistant »), journalisé. **Forme retenue : colonnes `annuleLe` et
   `annuleParId` sur `ScanPointage`** (migration `20260929150000_pointage_annulation_pause_defaut`,
   purement additive, colonnes nullables). L'historique n'est jamais supprimé : un scan annulé reste
   en base, ignoré par le moteur et par chaque lecteur (`SCAN_VALABLE` / `POINTAGE_VALABLE` dans
   `lib/pointage-annulation.ts` : pointage du jour « Pointer », Suivi, compteur de la semaine,
   grille Présences & heures, « Marquer vérifié »).
   - Arrivée annulée : le pointage « n'existe plus » pour les écrans ; le scan suivant **refait
     l'arrivée** sur la même ligne (nouvelle heure). Refusée si un départ la suit.
   - Départ annulé : la journée est **rouverte**, et Présences + Heures reviennent à leur état
     d'AVANT la clôture (relu au journal d'audit de la clôture, jamais effacé à l'aveugle). Refusé
     si la Direction a corrigé la journée entre-temps.
4. **Pause par défaut 30 min** — le départ scanné **clôt la journée tout de suite** (heure de fin =
   instant du scan), avec une pause de 30 min marquée **« par défaut »** (`Pointage.pauseParDefaut`,
   même migration, faux pour toutes les lignes existantes). Le salarié peut saisir sa pause
   ensuite (facultatif, le jour même) : c'est alors **la sienne** qui compte, heures refaites. Une
   journée déjà close n'est jamais rechangée ; une journée **corrigée par la Direction** (heures ou
   code retouchés dans Présences & heures) n'est plus touchée ni par la pause saisie ni par
   l'annulation. Visible partout comme telle : « pause par défaut 30 min » (écran de scan,
   « Pointer », Suivi, Présences & heures — « p* » dans la case, en toutes lettres dans
   l'infobulle et sur mobile). Chaque clôture est journalisée (entité « Pointage », champ
   « cloture » : état des présences avant / après).
   - **Effet en argent** (analyse du moteur de paie, 2026-09-29) — back-office : aucun (salaire
     mensuel fixe, les heures n'entrent pas dans l'argent). Brigade : la quantité payée vient des
     heures POINTÉES (taux t = S / heures planifiées du mois, base = t × heures normales faites) ;
     les créneaux du planning ne retirent aucune pause. Chaque jour clos avec la pause par défaut
     compte donc 0,5 h de moins que la durée du créneau : −0,5 × t par jour hors heures supp.
     (≈ −4 % du salaire pour des créneaux de 12 h), et en semaine à heures supp., 0,5 h d'HS en
     moins (tranche +60 % d'abord). C'est le même effet qu'une pause de 30 min saisie (l'ancien
     écran proposait déjà 30 min pré-remplies). Par rapport à une journée laissée ouverte (rien
     écrit : la journée planifiée n'était pas payée du tout), la clôture automatique paie la
     journée. **Question pour la Direction** : faut-il retirer aussi 30 min des créneaux du
     planning (durée explicite), pour qu'une journée complète reste payée S ?
   - Un départ scanné avant la mise en service, jamais clos, est clos au rescan suivant avec la
     pause par défaut (ou avec la pause saisie).
5. **Affiche** — deux étapes : « 1 Scannez ce code avec l'appareil photo de votre téléphone » ;
   « 2 Votre pointage s'enregistre tout seul » (« La première fois : connectez-vous avec votre
   matricule »).

### 11.3 Réglages Supabase à vérifier (tableau de bord, NON modifiés)
Authentication → Sessions : « Time-box user sessions » et « Inactivity timeout » (vides = aucune
limite) ; « Detect and revoke potentially compromised refresh tokens » et « Refresh token reuse
interval ». Authentication → JWT : « Access token expiry » (1 h par défaut ; il se rafraîchit seul,
il ne déconnecte pas).
