# Paie brigade sur heures planifiées — note de conception (Nagi, 2026-09-23)

Décision Direction (Sacha, 2026-09-23) : « Qui fait tout son planning touche exactement son net. »
Portée de cette note : conception + simulation en LECTURE SEULE (dépôt `feat/rls-partout`, code paie
identique à `main` ; base de production lue en transaction `READ ONLY`). Aucun fichier du dépôt modifié.

Validation de la simulation : le moteur actuel rejoué hors base (`calculerHeuresSupp` +
`calculerPaieBrigade` de `src/lib/payroll.ts`, paramètres de l'exercice actif, taux 2 300) redonne
les 17 lignes brigade de septembre stockées en `PayrollLine` à ±0,01 $ près. La colonne « après » est
donc calculée par le même moteur, pas par une réimplémentation.

---

## 0. Ce que la mesure change au diagnostic de départ

1. **Rachel Lunda n'est PAS un cas du défaut de référence.** Son planning de septembre = 13 créneaux
   Caisse × 12 h = **156 h, soit exactement la référence contrat (36 × 52/12 = 156)**. Ses +30,77 $
   viennent de **2 jours codés P à 12 h sans aucun créneau** (lun. 28/09 et mer. 30/09) : 24 h ×
   1,2821 = 30,77. La nouvelle règle ne les supprime pas : ce sont des « heures faites en plus → payées ».
   Or ces deux jours sont **dans le futur** (on est le 23/09) : ils ont été créés en lot le 22/09 à
   12:52, le même jour où Rachel a une demande de **congé maternité EN_ATTENTE à partir du 28/09**. À
   vérifier par la Direction, pas par une formule.
2. **Tout septembre est pré-rempli d'avance.** Codes et heures du 24 au 30/09 ont été créés le 22/09
   entre 12:51 et 12:52. Ensuite, le planning de Jeannette Bongota et Thérèse Moleka (21→30/09) a été
   **modifié à 15:09 et 15:13** : les heures pré-remplies ne suivent pas (6/8 inversés par rapport à 8/6).
   Avec l'ancienne règle, c'était invisible (les totaux restaient égaux au contrat). Avec la nouvelle, ça
   se traduit en argent : Jeannette −3,80 $, Thérèse +2,78 $. **Ce sont des défauts de saisie, pas des
   écarts réels.**
3. **Les trois « curiosités » s'expliquent sans défaut de moteur** (détail au §10).
4. **Août n'a aucun `PayrollRun`** et son planning est trop incomplet pour servir de référence
   (0 salarié brigade sur 17 avec un créneau dans chaque semaine). Juin et juillet ont des lignes
   `PAS_VALIDE` : la nouvelle règle ne doit pas s'y appliquer en douce (§8).

---

## 1. Source des heures planifiées : `PlanningCreneau`, pas `PlanningModele`

**Décision : la référence du mois se lit dans `PlanningCreneau` (le planning réel du mois).** Le
modèle ne sert qu'en repli, pour chiffrer la durée d'un jour payé non travaillé qui n'a pas de créneau
de travail (§3).

Pourquoi :
- La Direction parle des « heures planifiées pour ce salarié **ce mois-là** ». Le modèle est un gabarit ;
  le mois réel s'en écarte. Exemple mesuré : **Esther Nsundi** a un modèle « samedi en semaine A
  seulement (9 h) », alors que son planning de septembre a un samedi **chaque** semaine, en alternance
  9 h / 3,5 h (Admin) → 223 h planifiées. Lire le modèle la paierait sur un mois qui n'a pas existé.
- **8 salariés brigade sur 17 n'ont aucun modèle** (Tyty, Jeannette, Myriam, Prisca, Thérèse, Syntyche,
  Caprice, Lydia) : le modèle ne peut pas être la source.
- Les échanges de créneaux et les changements de shift approuvés (`EchangeCreneau`,
  `DemandeChangementShift`) écrivent dans `PlanningCreneau`, jamais dans le modèle.
- L'écran existant « Écart prévu / réalisé » (`src/lib/planning-ecart.ts` + `src/app/(app)/planning/ecart-data.ts`)
  lit déjà `PlanningCreneau` : la paie doit raconter la même histoire que cet écran.

**Durée d'un créneau** : `dureeShift()` (`src/app/(app)/planning/creneaux.ts`) — `dureeHeures` si
renseigné, sinon `heureFin − heureDebut` (gère la nuit). C'est déjà la fonction utilisée par le
pré-remplissage des heures (`presences/actions.ts`) et par l'écran d'écart. Elle doit être **déplacée
dans `src/lib/`** (module pur) pour que le moteur de paie ne dépende pas de `src/app/` (même piège déjà
présent dans `conges-couverture.ts`). Aucune durée n'est à inventer : ce qui est posé au planning est
ce qui est payé. Conséquence à connaître : les durées de shift ne retirent aucune pause (« Journée
08:00–22:30 » = 14,5 h, « Caisse 10:30–22:30 » = 12 h). C'était déjà le cas dans les heures
pré-remplies ; désormais c'est aussi la base du forfait.

**Créneaux système (Repos / Congé / Férié)** : durée 0 → **aucune heure de travail planifiée**. Ils
comptent en revanche pour dire « cette semaine a été planifiée » (§1 bis). Un jour Congé ou Férié posé
en créneau système n'est pas perdu pour autant : il est traité comme jour payé non travaillé (§3).

**Créneau un dimanche** : ses heures ne vont **jamais** dans la référence (règle B1 : tout dimanche
travaillé est en `hs100`, hors forfait).

### 1 bis. Planning absent ou incomplet : repli sur l'ancienne référence, visible

Le vrai danger n'est pas le mois sans aucun créneau, c'est le mois **à moitié publié**. Exemple :
seule la 1re semaine est posée (48 h) alors que le salarié en fait 208. Si la référence était 48 h, le
taux horaire du mois serait de 200/48 = 4,17 $/h et le salarié toucherait environ **866 $ au lieu de
200 $**. Un contrôle « le mois a-t-il au moins un créneau ? » ne suffit donc pas.

**Décision — un contrôle de complétude par semaine, un repli pour tout le mois :**
- Une semaine (lundi → dimanche, restreinte au mois) est **planifiée** si elle contient au moins un
  créneau pour ce salarié (créneaux système compris : une semaine posée en « Repos » est une semaine
  planifiée à zéro heure, pas une semaine oubliée), **ou** si tous ses jours ouvrables du mois portent
  un code d'absence (C, A, M, O, F, S). Sans cette exception, Syntyche Kanku, en congé du 21 au 30
  sans créneau, basculerait à tort en repli.
- Semaines antérieures à la date d'embauche : voir plus bas (repli complet).
- **Une seule semaine non planifiée → le mois entier retombe sur l'ancienne référence**
  (`heuresHebdomadaires × 52/12`, exactement le calcul d'aujourd'hui). Je ne fais pas d'hybride semaine
  par semaine : compléter une semaine vide à partir du modèle, ce serait inventer un planning, et la
  valeur inventée finirait sur un bulletin opposable.
- **Mois d'embauche** (date d'embauche postérieure au 1er du mois) → repli également. Sinon, un salarié
  embauché le 15 qui fait son demi-mois toucherait le salaire complet. Il faudrait une règle de prorata
  (jours ouvrables ou calendaires ?) ; elle est **à valider par un comptable congolais** et je ne
  l'invente pas. Aucun cas en septembre.
- Rendre le repli visible, sans bloquer la validation (la Direction tranche) :
  - nouvelle colonne `PayrollLine.sourceReference` (`PLANNING` | `CONTRAT_REPLI`) + `motifReference`
    (texte, par ex. « semaine du 21/09 sans créneau », « embauche le 15/09 ») ;
  - écran Paie : badge « Réf. contrat (repli) » avec le motif ; même liste dans la boîte de dialogue de
    validation ;
  - bulletin : le récapitulatif affiche « Heures planifiées » ou « Heures contrat (repli) » ;
  - le figé `VersionBulletin` fige aussi la source.

Mesure sur la production : septembre = **17/17 salariés brigade complets** (aucun repli) ; octobre =
16/17 à ce jour (Syntyche : 3 semaines sur 5, elle est en congé jusqu'au 10/10, ce que l'exception
couvre dès que les codes C seront posés) ; août = 0/17.

---

## 2. La formule

Notations, pour un salarié de la brigade et un mois donné :
- `S` = salaire mensuel saisi (NET cible, `Employee.salaireMensuel`) ;
- `H` = heures hebdomadaires du contrat (seuil des heures supplémentaires, inchangé) ;
- `t0 = S / (H × 52/12)` = taux horaire **contractuel** (celui d'aujourd'hui) ;
- `hp(j)` = durée du créneau de **travail** du jour j (0 si aucun créneau ou créneau système) ;
- `hdu(j)` = durée due du jour j = `hp(j)` si > 0, sinon la durée du modèle pour ce jour (couche de
  parité A/B, sinon la couche « chaque semaine » ; 0 si le salarié a un modèle qui ne prévoit rien ce
  jour-là), sinon `heuresParJour` si le salarié n'a aucun modèle. C'est l'ordre de priorité déjà
  appliqué par le pré-remplissage des heures.

**Référence du mois R** (en heures) :
1. On passe les créneaux de travail du mois dans **la même fonction** `calculerHeuresSupp` que les
   heures faites (mêmes semaines lundi → dimanche, même seuil `H`), puis on retient
   `Rn = planifié − hs30 − hs60 − hs100 planifiés`. Autrement dit : les heures planifiées au-delà du
   contrat sont des heures supplémentaires **planifiées**, pas des heures de forfait, et les heures
   planifiées un dimanche ou un férié sont hors forfait.
2. `R = Rn + Σ hdu(j)` sur :
   - les jours ouvrables codés C, A, O ou M **sans créneau de travail** (s'ils ont un créneau de
     travail, leurs heures sont déjà dans Rn) ;
   - les jours fériés (hors dimanche), pour leur `hdu` (§3).

**Taux horaire du mois : `t = S / R`.** Il varie d'un mois à l'autre, c'est voulu : le salaire mensuel
paie le planning du mois, quelle que soit la longueur du mois (le principe de la mensualisation).

**Base payée** (net cible, avant reconstitution du brut) :
`t × (heures normales faites + heures des jours payés non travaillés) + t × ⅔ × heures des jours de maladie`,
- où les heures normales faites sortent de `calculerHeuresSupp` appliqué aux heures faites (inchangé) ;
- les jours payés non travaillés comptent pour **leur `hdu` en heures**, et non plus
  « jours × heuresParJour » (§3) ;
- un jour avec des heures faites n'est jamais compté aussi comme jour payé non travaillé (règle
  d'aujourd'hui, conservée).

**Heures supplémentaires** : `calculerHeuresSupp` inchangé, valorisé au taux contractuel `t0` (§4).

**Propriétés garanties** (à verrouiller par des tests) :
- Planning fait exactement (sans absence) → heures normales faites = Rn → base = `t × R = S`.
- Absence non payée (N, S) sur un jour planifié → retenue de `hp × t` (au prorata exact).
- Jour échangé (on manque un jour planifié, on travaille un jour non planifié de même durée) → neutre.
- Mois entièrement en congé → base = S. Mois entièrement en absence injustifiée → 0.

### Démonstration « planning fait = net exact » (production, septembre)

Contrôle : les heures planifiées sont passées comme heures faites dans `calculerPaieBrigade`,
reconstitution net → brut active (`salaires_saisis_en_net = 1`) ; résultat = net hors transport moins
allocation familiale.

| Salarié | S | R (h) | t ($/h) | brut reconstitué | CNSS 5 % | IPR | **net obtenu** |
|---|---|---|---|---|---|---|---|
| Martine Mutombo | 400 | 216 | 1,85185 | 481,9061 | 24,0953 | 57,8107 | **400,000150** |
| Esther Nsundi (base) | 300 | 220,92 | 1,35796 | 358,9371 | 17,9469 | 40,9885 | **300,001715** |
| Rachel Lunda | 200 | 156 | 1,28205 | 237,2131 | 11,8607 | 25,3507 | **200,001780** |

L'écart de moins de 0,002 $ vient de la convention de la dichotomie (`reconstituerBrutDepuisNet` renvoie
la borne haute : on ne sous-paie jamais). Arrondi au centime : exactement 400 / 300 / 200.

**Esther : attention.** Son planning dépasse son contrat la semaine du 14 au 20/09 (54 h planifiées
contre 51,92 h au contrat) → 2,08 h supplémentaires **imposées par le planning lui-même**. Si elle fait
exactement son planning, elle touche donc 300 $ **plus** 3,51 $ d'heures supplémentaires. C'est juste
au regard de la règle HS (dépassement du contrat), mais ce n'est pas « exactement son net ». Son contrat
à 51,92 h est une valeur réglée à la main pour tomber juste sous l'ancienne règle ; avec la nouvelle
règle, ce réglage n'a plus d'objet et ne sert plus que de seuil HS. Question à la Direction (§11).
Même situation, en plus petit, pour Aimée Mutita (contrat 42,69 h, +0,93 h planifiée au-delà).

---

## 3. Congés, fériés, repos, maladie : ni payés deux fois, ni retenus

**Règle : un jour payé mais non travaillé entre, pour les mêmes heures (`hdu`), dans la référence R ET
dans la base payée.** Il est donc neutre quand le reste du planning est fait, quelle que soit la façon
dont le planificateur l'a marqué : créneau de travail laissé en place, créneau système « Congé » ou
« Férié », ou rien du tout.

Le piège qu'il faut éviter (mesuré sur **Syntyche Kanku**, septembre) : elle a travaillé 102 h
(17 jours × 6 h), puis est en congé du 21 au 30 (9 jours ouvrables codés C, **sans créneau**).
- Formule naïve « taux = S / heures des créneaux » + jours payés à part : t = 200/102 = 1,961 $/h →
  102 h × 1,961 = 200 $ **plus** 9 j × 6 h × 1,961 = 105,88 $ → **305,88 $. Le congé est payé deux fois.**
- Règle retenue : R = 102 + 9 × 6 (pas de modèle → `heuresParJour` = 6) = 156 h → t = 1,2821 →
  (102 + 54) × 1,2821 = **200,00 $**.

Cas inverse mesuré sur **Marie Samwel** : ses 12 jours de congé (1er → 14/09, codés C) ont gardé leur
créneau de travail de 8 h au planning. Leurs 96 h sont déjà dans les heures planifiées (208 h) : on ne
les rajoute pas dans R, on les paie une fois → (112 faites + 96 congé) × 200/208 = **200,00 $**.

Exemple chiffré hypothétique (**Martine**, planning de septembre de 216 h, t = 1,85185) : elle pose
2 jours de congé le jeudi 17 et le vendredi 18.
- Créneaux laissés en « Journée 9 h » : R = 216 ; payé = (198 + 18) × t = **400 $**.
- Créneaux remplacés par « Congé » (0 h) : hdu = modèle du jeudi/vendredi = 9 h → R = 198 + 18 = 216 →
  **400 $**. Même résultat.
- Ancienne règle, pour comparaison : 198 × 1,7094 + 2 × 9 × 1,7094 = 369,23 $ de base nette.

**Maladie (M, payée aux ⅔)** : `hdu` entre dans R ; la base en paie ⅔ → retenue d'un tiers, comme
aujourd'hui.

**Repos payé (O)** : un O posé un jour **planifié en travail** paie ce jour (pas de retenue). Un O posé
un jour de repos du modèle a hdu = 0 : il ne change rien. Aujourd'hui, un O non travaillé ajoute une
journée de salaire, où qu'il soit posé ; avec la nouvelle règle, coder O les jours de repos ne gonfle
plus la paie.

**Jours fériés (hors dimanche)** — chômés et payés (principe légal RDC ; le détail des jours et de leur
indemnisation est à confirmer par un juriste) :
- Un férié qui tombe **un jour dû** (hdu > 0) est un jour payé : il entre dans R et dans la base pour
  hdu, **qu'il soit codé F ou non**. C'est un changement volontaire : aujourd'hui, un férié oublié (non
  codé F) n'est pas payé, ce qui fait perdre la journée au salarié.
- **Férié travaillé un jour dû** : la base reste payée par le forfait ; les heures travaillées sont en
  `hs100` et ne rapportent que **la prime** (`hs100 × hsMajDimancheFerie × t0`) jusqu'à hdu, puis base +
  prime au-delà. Résultat : **payé double, pas triple** (règle B1).
- **Férié qui tombe un jour de repos** (hdu = 0) : rien dans R. S'il est travaillé : base + prime
  (`(1 + maj) × t0`), comme un dimanche.
- **Dimanche** : jamais dans R. S'il est travaillé : `hs100` à `(1 + maj) × t0`, sans changement.

Remarque sur B1 : le code actuel (`payroll.ts`, `calculerHeuresSupp`) valorise `hs100 × (1 + maj)` et
retire les `hs100` des heures normales. Le résultat est bien « double », même si la formulation
« prime seule » ne décrit pas cette décomposition. **Il ne faut pas « corriger » ce `1 +`** dans
l'ancienne règle : un dimanche ne serait plus payé qu'une fois. Dans la nouvelle règle, « prime seule »
devient littéralement vrai, mais uniquement pour un férié travaillé un jour dû. Aucun férié en
septembre 2026 : ce point n'a pas d'impact sur la simulation, mais il faut des tests.

---

## 4. Heures supplémentaires

- **On garde `calculerHeuresSupp` tel quel** : semaines lundi → dimanche, seuil = horaire hebdomadaire
  du **contrat**, 6 premières heures à +30 %, le reste à +60 %, dimanche et férié isolés.
- **Taux de valorisation des HS : `t0`, le taux contractuel, inchangé.** Trois raisons. Le seuil HS est
  contractuel, donc sa valeur l'est aussi. Le taux ne bouge pas selon la longueur du mois. Et c'est la
  décision déjà documentée le 2026-07-22 (« prime calculée sur la base contractuelle »), sur laquelle la
  Direction ne revient pas : elle a changé la référence des heures normales, pas le prix des HS. La
  variante « HS au taux du mois t » est chiffrée au §10 : seul Coco Lala change vraiment (−10,03 $).
- **Heure faite au-delà du planning mais sous le seuil HS** : payée au **taux du mois t**, sans
  majoration. C'est la condition pour qu'un échange de jour soit neutre (l'heure manquée est retenue au
  taux t, l'heure en plus doit être payée au même taux).
- **Pas de double paiement de la même heure** : `calculerHeuresSupp` classe chaque heure faite dans une
  seule catégorie (normale, 30, 60 ou 100). La base ne paie que les heures normales. Les heures
  planifiées au-delà du contrat sont exclues de R (§2), donc jamais comptées à la fois comme forfait et
  comme HS.
- Anomalie à signaler (pas à corriger en silence) : si `t > 1,3 × t0` (planning inférieur à 77 % du
  contrat), une heure à +30 % vaut moins qu'une heure normale. Badge sur la ligne de paie. Aucun cas en
  septembre (le rapport le plus élevé est celui de Martine, t/t0 = 1,083).
- **Le défaut connu des semaines à cheval sur deux mois** (documenté dans `paie-batch.ts` l.81-98) pèse
  maintenant sur R, pas seulement sur les HS. Coco Lala a une semaine 1 de 5 jours (mar. → sam.) avec
  56 h planifiées : 48 h comptent comme heures de forfait, alors que, sur une semaine entière, une
  partie serait des HS. Correction : le lot dédié déjà décrit (attribution chronologique jour par jour),
  **à livrer avec ou avant cette règle**. Pour septembre, elle ne changerait rien : le 31/08 n'a ni
  heures ni créneau dans l'outil.

---

## 5. Taux de rôle (`Shift.tauxHoraireUSD`)

- Mesure : **aucun des 18 shifts n'a de taux renseigné.** L'« Option A » est inactive en production ;
  impact nul aujourd'hui.
- Elle n'est pas compatible telle quelle avec un forfait : la moyenne pondérée actuelle remplacerait
  t et casserait « planning fait = S ». Un taux de rôle **inférieur** à t ferait même toucher moins que
  le salaire à quelqu'un qui fait tout son planning, en tenant le poste que l'employeur lui a donné. Ce
  serait une baisse unilatérale du salaire contractuel (risque juridique ; à confirmer par un juriste).
- **Décision de conception** : avec la nouvelle règle, la base est payée à t, et le taux de rôle ne
  détermine plus la base. Tant que la Direction n'a pas tranché, un créneau dont le shift porte un taux
  déclenche un **avertissement visible** sur la ligne de paie, et le taux est ignoré. Si la Direction
  veut un supplément pour un poste mieux payé : un différentiel `(taux du rôle − t) × heures faites
  dans ce rôle`, **uniquement s'il est positif**. C'est une question à la Direction (§11).

---

## 6. Reconstitution net → brut et salaire journalier

- **Reconstitution net → brut : mécanisme inchangé.** `calculerPaieBrigade` reçoit la base nette
  (`t × heures…`) et `reconstituerBrutDepuisNet` la grossit. Si le planning est fait exactement, la base
  nette vaut S : le brut est celui d'un back-office à S (Martine : 481,91 $) et le net retombe sur S. Les
  HS restent grossies au même facteur ρ (approximation linéaire déjà marquée « à valider comptable »).
- **Le salaire journalier disparaît du calcul brigade.** Les jours payés non travaillés sont valorisés
  **en heures** (`hdu × t`), et non plus en « jours × heuresParJour × taux ». `heuresParJour` ne sert plus
  qu'en dernier repli pour hdu (salarié sans créneau de travail ni modèle ce jour-là).
- Conséquences sur ce qui est stocké et imprimé (pour que l'écran, la paie et le bulletin disent la même
  chose) :
  - `PayrollLine.heuresContractuelles` reçoit **R** (ou la référence contrat en cas de repli). Le
    bulletin en tire déjà « Taux horaire » (`brut(S) / heuresContractuelles`) et « Heures / mois » : le
    récapitulatif devient juste sans autre changement de calcul. Libellé à changer : « Heures planifiées
    (forfait) » ou « Heures contrat (repli) ».
  - Nouvelle colonne `heuresPayeesNonTravaillees`. La ligne du bulletin « Jours payés non travaillés »
    affiche alors une base en **heures** × taux horaire. Aujourd'hui elle affiche
    `jours × tauxHoraire × heuresParJour`, ce qui devient faux dès que hdu ≠ heuresParJour (samedi à
    3,5 h d'Esther, par exemple).
  - `indemniteCongesUSD` = Σ hdu des jours C × t × ρ : le montant **réellement** compris dans la base,
    et non plus une estimation à part.
  - Migration purement additive. Les bulletins déjà figés (colonnes nouvelles à 0) gardent leur rendu
    historique, comme pour la scission du 2026-07-22.

---

## 7. Qui est concerné

- **Brigade, contrats CDD/CDI uniquement** : la branche `calculerPaieBrigade`. En production : 17
  salariés, tous en CDD.
- **Back-office (7 salariés, CDI)** : `calculerPaieBackoffice(S)`, salaire fixe → **aucun changement**.
- **Stagiaires** (`STAGE`) : `calculerPaieStage`, indemnité forfaitaire, aucun changement. Aucun en
  production.
- **Intérim** : pas de bulletin, aucun changement.
- **Journaliers** (`JOURNALIER`) : **exclus de la nouvelle règle.** Un salarié payé à la journée n'a pas
  de forfait mensuel ; il reste payé comme aujourd'hui. Aucun en production.
- Le moteur existe en **deux exemplaires** : `src/lib/paie-batch.ts` (lot, persistance) et
  `src/lib/bulletin-live.ts` (aperçu sur la fiche). La nouvelle référence doit être **une seule fonction
  pure** dans `src/lib/payroll.ts` (ou `src/lib/paie-reference.ts`), appelée par les deux. Sinon, la
  fiche et la paie divergeront.
- Écrans d'estimation qui calculent `× 52/12` (`employee-form.tsx`, `simulation-salaire.tsx`,
  `employes/[id]/page.tsx`, `planning/modele-grid.tsx`, `planning/page.tsx`) : ce sont des estimations
  contractuelles, pas de l'argent payé. À relibeller « taux contractuel indicatif — la paie suit le
  planning du mois ». Pas de changement de calcul.

---

## 8. Septembre, et les mois passés

- Septembre : `PayrollRun` en BROUILLON, les 24 lignes en `PAS_VALIDE` → **le recalcul avec la nouvelle
  règle est légitime** (le lot saute déjà les lignes VALIDE/PAYE).
- **Mais la règle ne doit pas être un interrupteur global.** Juin (lignes `PAS_VALIDE` et `PAYE`) et
  juillet (24 lignes `PAS_VALIDE`, run BROUILLON) seraient recalculés en douce au prochain
  rafraîchissement. De plus, leur planning est incomplet (juillet : 0/17 salariés complets). **Décision :
  paramètre daté** `paie_reference_planning_depuis = 202609` (AAAAMM) dans `ParametreLegal` (exercice
  2026, statut À_VALIDER, modifiable par l'ADMIN seul). La règle s'applique aux mois ≥ ce mois ; les
  mois antérieurs restent calculés avec la référence contrat, même s'ils sont encore `PAS_VALIDE`.
- Mois VALIDE/PAYE : jamais recalculés (snapshot `VersionBulletin`, déjà en place ; 13 versions en base).
- Avant de valider septembre : les jours du 24 au 30 sont **pré-remplis d'avance** (§0). Il faut les
  resaisir d'après la réalité à la fin du mois, sinon la retenue et les « heures en plus » porteront sur
  une projection.

---

## 9. Le planning devient un document de paie : garde-fous à livrer avec la règle

1. **Traçabilité** : `saisirCreneau` / `saisirCreneauxEnLot` / la génération automatique n'écrivent
   aujourd'hui **aucune trace** (un créneau effacé ne laisse rien). Avec la nouvelle règle, ajouter les
   créneaux de Rachel les 28 et 30/09 **ferait passer sa paie de 230,77 à 200 $**. Toute modification
   d'un créneau daté d'aujourd'hui ou avant, ou d'un mois qui a un `PayrollRun`, doit passer par
   `src/lib/audit.ts` (qui, quand, avant, après).
2. **Verrou** : refuser la modification d'un créneau d'un mois dont une ligne est VALIDE/PAYE.
3. **Signal sur la ligne de paie** : « planning modifié après la saisie des heures » (le cas
   Jeannette/Thérèse), « heures saisies pour des jours futurs », « jour codé P sans créneau »
   (le cas Rachel). La Direction voit et tranche. Aucun script correctif.
4. **Tests à écrire** (`payroll.test.ts`, `payroll-reference.test.ts`, `paie-batch.integration.test.ts`) :
   Martine (216 h → 400,00), Esther (300 + HS de la semaine 3), Rachel (156 h + 24 h hors planning),
   Syntyche (congé sans créneau, pas de double paiement), Marie (congé sur créneaux de travail),
   échange de jour neutre, absence N retenue, mois entier en congé = S, mois entier en N = 0, férié
   dû non travaillé / travaillé (double), férié un jour de repos travaillé, dimanche travaillé, semaine
   vide → repli, embauche en cours de mois → repli, juillet inchangé (paramètre daté),
   `bulletin-live` = `paie-batch` au centime.

---

## 10. Simulation — septembre 2026, toute la brigade (production, lecture seule)

Définitions : « net » = net hors transport = `salNetUSD − transportUSD` (`src/lib/paie-net.ts`),
allocation familiale **comprise**. « Écart » = net − S − allocation familiale (0 = le salarié touche
exactement son salaire). « Avant » = ligne stockée en base (le moteur rejoué la redonne à ±0,01).
« Après » = règle du §2, HS au taux contractuel t0 (variante HS au taux t entre parenthèses quand elle
diffère). Heures « faites » = `OvertimeEntry` ; « planifiées » = somme des créneaux de travail ;
R = référence du §2.

| Salarié | S | Faites | Planifiées | R | Net avant | Net après | Écart avant | Écart après | Explication de l'écart restant |
|---|---|---|---|---|---|---|---|---|---|
| Marie Samwel | 200 | 112 | 208 | 208 | 200,00 | 200,00 | 0 | 0 | 12 j de congé sur créneaux 8 h, payés une fois |
| Tyty Bokolomba | 200 | 208 | 208 | 208 | 201,50 | 201,50 | 0 | 0 | — |
| Coco Lala | 200 | 305,5 | 305,5 | 230 | 330,97 | **309,39** (299,36) | +126,46 | **+104,89** (+94,86) | 75,5 h HS imposées par le planning (70,5 h/sem) ; voir ci-dessous |
| **Martine Mutombo** | 400 | 216 | 216 | 216 | 372,23 | **403,00** | **−30,77** | **0** | défaut corrigé (400 + 3,00 alloc.) |
| Jeannette Bongota | 350 | 182 | 184 | 184 | 351,50 | 347,70 | 0 | −3,80 | artefact : heures pré-remplies le 22/09, planning modifié après |
| Myriam Bumbakini | 200 | 156 | 156 | 156 | 200,01 | 200,00 | 0 | 0 | — |
| Aimée Mutita | 250 | 187,5 | 187,5 | 186,57 | 253,72 | 251,58 | +3,72 | +1,58 | 0,93 h HS : planning au-dessus du contrat réglé à 42,69 h |
| Deladri Losole | 150 | 208 | 208 | 208 | 151,50 | 151,50 | 0 | 0 | — |
| Esther Nsundi | 300 | 223 | 223 | 220,92 | 301,09 | 306,51 (306,57) | −1,91 | +3,51 | 2,08 h HS sem. 14–20/09 (54 h contre 51,92 au contrat) |
| Prisca Lusamba | 200 | 156 | 156 | 156 | 200,00 | 200,00 | 0 | 0 | — |
| Rachel Lunda | 200 | 180 | 156 | 156 | 230,77 | 230,77 | +30,77 | +30,77 | 24 h codées P les 28 et 30/09 sans créneau, jours futurs : à vérifier |
| Francine Luyindula | 200 | 156 | 156 | 156 | 201,51 | 201,50 | 0 | 0 | — |
| Thérèse Moleka | 250 | 182 | 180 | 180 | 253,00 | 255,78 | 0 | +2,78 | même artefact que Jeannette (inversé) |
| Fallone Malewu | 156 | 156 | 156 | 156 | 157,51 | 157,50 | 0 | 0 | — |
| Syntyche Kanku | 200 | 102 | 102 | 156 | 200,00 | 200,00 | 0 | 0 | 9 j de congé hors planning entrés dans R |
| Caprice Bokole | 200 | 156 | 156 | 156 | 203,01 | 203,00 | 0 | 0 | — |
| Lydia Nzuzi | 400 | 154,4 | 156 | 156 | 397,40 | 397,40 | −4,10 | −4,10 | 1,6 h manquantes le 23/09 (4,4 h au lieu de 6) → retenue légitime |
| **Total** | | | | | **4 205,72** | **4 217,13** | | | **+11,41 $ net** sur le mois |

Les écarts de 0,01 $ (Myriam, Francine, Fallone, Caprice) viennent de l'arrondi de la dichotomie
entre deux calculs ; ce n'est pas un effet de la règle.

### Les trois curiosités

- **Marie Samwel (112 h sur 208, payée 200 $)** : du 1er au 14/09, elle est en congé annuel approuvé
  (24/08 → 14/09) ; 12 jours codés C. L'ancienne règle paie 112 h × 0,9615 + 12 j × 8 h × 0,9615
  = 107,69 + 92,31 = 200,00. Ce n'est pas un défaut : les heures faites + les jours de congé font
  exactement la référence contrat. Avec la nouvelle règle : même résultat (§3).
- **Syntyche Kanku (102 h sur 156, payée 200 $)** : en congé annuel approuvé à partir du 21/09 ;
  9 jours ouvrables codés C. 102 + 9 × 6 = 156 h = la référence contrat → 200,00. Même mécanisme,
  même résultat avec la nouvelle règle, à condition de mettre ses 54 h de congé dans R. Sans ça, elle
  toucherait 305,88 $ (§3).
- **Coco Lala (305,5 h sur 208, +130,97 $)** : chauffeur, contrat de 48 h, mais son planning (modèle
  compris) alterne des journées de 14,5 h (08:00–22:30) et de 9 h, soit **70,5 h par semaine**. Il fait
  exactement ce planning. Ses +126,46 $ (+130,97 si l'on compte les 4,50 $ d'allocation familiale) sont
  des heures supplémentaires réelles (24 h à +30 %, 51,5 h à +60 %) plus 22 h « normales » au-delà du
  mois contractuel.

### Le résultat discutable : Coco Lala

Avec la nouvelle règle, Coco **perd 21,58 $** (31,61 $ si les HS sont au taux du mois). La règle
s'applique correctement : ses 230 heures « normales » (48 h plafonnées par semaine, dont 48 h sur une
première semaine de 5 jours et 38 h sur la dernière) sont désormais payées par le forfait de 200 $, alors
que l'ancienne règle les payait 230 × 0,9615 = 221,15 $. Mais deux choses rendent ce résultat fragile :
1. le défaut des semaines à cheval gonfle ses heures de forfait (§4) ;
2. et surtout **son planning lui-même pose un problème juridique**. À ma connaissance, le Code du
   travail (art. 119) limite la durée légale à **45 h par semaine et 9 h par jour**. Des journées de
   14,5 h et des semaines de 70,5 h (et les journées de 12 h de Rachel et d'Aimée) sont à faire
   examiner par un juriste congolais.

Ce n'est pas à la formule de régler ça. La Direction doit savoir, avant de valider, qu'un salarié qui
travaille 305 heures touchera 21,58 $ de moins qu'avec l'ancienne règle.

Point voisin, lui aussi opposable et antérieur à ce chantier : le seuil HS est l'horaire **contractuel**
(48 h, 51,92 h, 54 h pour 6 salariés). Au-dessus de 45 h, le seuil contractuel est donc **moins**
favorable que le seuil légal, alors que le commentaire de `calculerHeuresSupp` le dit « plus généreux ».
Je le signale sans le trancher : c'est une règle déjà décidée, mais elle est à faire valider.

---

## 11. Résumé

### Décisions tranchées
1. Source : `PlanningCreneau` du mois ; le modèle ne sert qu'à chiffrer un jour payé sans créneau de travail.
2. Durée : `dureeShift` (déplacée dans `src/lib`) ; créneaux système = 0 h ; heures du dimanche jamais dans la référence.
3. Complétude : une semaine sans aucun créneau (hors semaine entièrement en absence codée) → tout le mois en référence contrat, badge et motif visibles.
4. Mois d'embauche → référence contrat, tant qu'aucun prorata n'a été validé par un comptable.
5. Formule : R = heures planifiées hors HS planifiées + heures dues des jours payés hors planning ; t = S / R ; base = t × (heures normales faites + heures payées non travaillées).
6. Congés, maladie, repos payés, fériés dus : mêmes heures dans R et dans la base → jamais payés deux fois, jamais retenus.
7. Férié dû : payé même s'il n'est pas codé F ; travaillé, il rapporte la prime seule → payé double.
8. HS : `calculerHeuresSupp` inchangé, valorisé au taux contractuel t0 ; heures en plus sous le seuil au taux t.
9. Taux de rôle : sans effet sur la base ; avertissement si un shift en porte un (aucun aujourd'hui).
10. Net → brut : inchangé ; le salaire journalier disparaît, les jours payés se comptent en heures sur le bulletin.
11. Périmètre : brigade CDD/CDI seulement ; back-office, stage, intérim et journaliers inchangés.
12. Date d'effet : paramètre daté `paie_reference_planning_depuis = 202609` ; juin et juillet ne bougent pas ; VALIDÉ/PAYÉ jamais recalculés.
13. Le planning devient une pièce de paie : journal d'audit des créneaux, verrou sur les mois validés, signaux d'incohérence.
14. Une seule fonction pure partagée par `paie-batch.ts` et `bulletin-live.ts`.

### Questions à la Direction
1. **Rachel Lunda** : a-t-elle vraiment travaillé 12 h le lundi 28 et le mercredi 30 septembre, jours qui
   ne sont pas à son planning et où son congé maternité est demandé ? Si oui, elle touche 30,77 $ de
   plus ; sinon, il faut effacer ces deux présences.
2. **Présences de fin septembre saisies d'avance** (du 24 au 30) : doit-on les ressaisir d'après la
   réalité avant de valider la paie ? Aujourd'hui, elles font perdre 3,80 $ à Jeannette et gagner
   2,78 $ à Thérèse, uniquement parce que leur planning a changé après la saisie.
3. **Esther et Aimée** : leur contrat est réglé à 51,92 h et 42,69 h par semaine pour tomber juste sous
   l'ancienne règle. Quelles heures sont écrites dans leur contrat signé ? Avec la nouvelle règle, toute
   heure planifiée au-delà du contrat est payée en heures supplémentaires : Esther touchera 3,51 $ de plus
   que ses 300 $ si son planning reste tel quel.
4. **Coco Lala** : planifié 70,5 h par semaine avec des journées de 14,5 h, il touchera 21,58 $ de moins
   qu'avant (309,39 au lieu de 330,97). Est-ce acceptable ? Voulez-vous faire vérifier par un juriste la
   durée de ses journées et de ses semaines (la loi fixe, à notre connaissance, 45 h par semaine et 9 h
   par jour) ?
5. **Heures supplémentaires** : les payer au taux horaire du contrat (ce que je recommande, c'est la
   pratique actuelle) ou au taux du mois (qui change chaque mois) ? Seul Coco est concerné en septembre
   (10,03 $ d'écart).
6. **Poste mieux (ou moins bien) payé** : si un jour un créneau a un taux horaire propre, faut-il payer la
   différence en plus quand c'est mieux payé, et ne jamais baisser le salaire quand c'est moins bien payé ?
7. **Embauche en cours de mois** : comment proratiser le salaire du premier mois (jours calendaires ou
   jours ouvrables) ? D'ici là, le premier mois reste calculé comme aujourd'hui. Question à poser au
   comptable.

### Tableau avant / après (septembre 2026, net hors transport, allocations comprises)

| Salarié | Contrat | Avant | Après | Écart au contrat après |
|---|---|---|---|---|
| Marie Samwel | 200 | 200,00 | 200,00 | 0 |
| Tyty Bokolomba | 200 | 201,50 | 201,50 | 0 |
| Coco Lala | 200 | 330,97 | 309,39 | +104,89 (HS réelles) |
| Martine Mutombo | 400 | 372,23 | 403,00 | 0 |
| Jeannette Bongota | 350 | 351,50 | 347,70 | −3,80 (saisie) |
| Myriam Bumbakini | 200 | 200,01 | 200,00 | 0 |
| Aimée Mutita | 250 | 253,72 | 251,58 | +1,58 (HS planifiées) |
| Deladri Losole | 150 | 151,50 | 151,50 | 0 |
| Esther Nsundi | 300 | 301,09 | 306,51 | +3,51 (HS planifiées) |
| Prisca Lusamba | 200 | 200,00 | 200,00 | 0 |
| Rachel Lunda | 200 | 230,77 | 230,77 | +30,77 (2 jours hors planning) |
| Francine Luyindula | 200 | 201,51 | 201,50 | 0 |
| Thérèse Moleka | 250 | 253,00 | 255,78 | +2,78 (saisie) |
| Fallone Malewu | 156 | 157,51 | 157,50 | 0 |
| Syntyche Kanku | 200 | 200,00 | 200,00 | 0 |
| Caprice Bokole | 200 | 203,01 | 203,00 | 0 |
| Lydia Nzuzi | 400 | 397,40 | 397,40 | −4,10 (1,6 h manquantes) |
| **Total** | | **4 205,72** | **4 217,13** | **+11,41** |

Fichiers de travail (hors dépôt) : `scratchpad/dump.mjs` (extraction en lecture seule), `scratchpad/data.json`,
`scratchpad/jours.txt` (planning / code / heures jour par jour), `scratchpad/sim.ts` (simulation, moteur réel).
