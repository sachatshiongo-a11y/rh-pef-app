# Paie brigade sur heures planifiées — conception

- **Date** : 2026-09-23
- **Annexe (fait foi pour le détail, les exemples chiffrés et la simulation)** :
  `2026-09-23-paie-heures-planifiees-note-nagi.md`, dans ce même dossier.
- **Décisions de la Direction (Sacha, 2026-09-23)** :
  1. **« Qui fait tout son planning touche exactement son net. »** La référence du mois devient les
     heures PLANIFIÉES pour ce salarié ce mois-là, plus `heures hebdo du contrat × 52/12`.
  2. **Heures supplémentaires au taux du CONTRAT**, comme aujourd'hui.
  3. **Le planning d'un mois validé est verrouillé, et chaque modification de planning est tracée.**
  4. **Présences saisies pour des jours à venir : avertir à la validation, sans bloquer.**

---

## 1. Le défaut

`src/lib/paie-batch.ts` fixe, pour la brigade, `taux = salaire / (heures hebdo du contrat × 52/12)`,
puis paie les heures enregistrées. Le net n'est juste que les mois où le planning fait pile 4,33
semaines-contrat.

Mesuré en production, septembre 2026, lecture seule :
- **Martine Mutombo** : contrat 54 h/sem, planning A/B de 49,5 h en moyenne. 216 h faites, **toutes
  planifiées, 0 absence** → **372,23 $ au lieu de 400 $**.
- **Esther Nsundi** : contrat réglé à la main à 51,92 h/sem pour « tomber juste » ; juste par chance.
- Les écarts de Rachel (+30,77 $), Jeannette et Thérèse ne viennent PAS de la référence : ce sont des
  présences saisies le 21/09 pour des jours à venir (§6).

## 2. La règle

Pour un salarié de la BRIGADE en CDD/CDI (back-office, stagiaires, intérim et journaliers ne changent
pas), un mois donné :

- `S` = salaire mensuel net saisi ; `H` = heures hebdo du contrat (seuil HS, inchangé) ;
  `t0 = S / (H × 52/12)` = taux contractuel.
- **Heures planifiées** : créneaux de TRAVAIL de `PlanningCreneau` du mois (le planning réel, pas le
  gabarit `PlanningModele`), durée par `dureeShift` (à déplacer de `src/app/(app)/planning/creneaux.ts`
  vers `src/lib/`). Créneaux système (Repos, Congé, Férié) = 0 h. Dimanche : jamais dans la référence.
- **Référence R** = heures planifiées passées dans `calculerHeuresSupp` (même découpage lun → dim, même
  seuil H), MOINS les HS planifiées, PLUS les heures dues (`hdu`) des jours sans heures faites et
  sans créneau de travail codés C, A, O, F, M (payés) ou **S** (congé sans solde : dans R, jamais
  payé), et des fériés hors dimanche. `N` n'ajoute rien (sur un jour non planifié il est sans effet ;
  sur un jour planifié ses heures sont déjà dans R et retenues faute d'heures faites). `hdu(j)` =
  durée du créneau de travail s'il y en a un, sinon durée du modèle pour ce jour (couche A/B puis
  « chaque semaine » ; 0 si le modèle ne prévoit rien ce jour, et le jour ne compte alors ni dans R
  ni dans les jours payés), sinon `heuresParJour`.
  **Plafond hebdomadaire, au prorata** : sont concernés les jours non travaillés et sans créneau de
  travail (hors dimanche) qui sont dus : C, A, O, F, M, S (ou jour de `joursCongeSansSolde`), et les
  **fériés** (codés ou non). Le plafond se calcule sur la **semaine civile entière** (lun → dim), les
  deux mois confondus : `C = max(0, H − heures planifiées de travail de toute la semaine, lun → sam,
  hors fériés)`. `D_mois` = Σ hdu de ces jours dans le mois, `D_hors` = même somme sur les jours de la
  semaine qui tombent hors du mois (mêmes règles ; un jour hors mois sans code ni créneau vaut 0 : repos
  inconnu, pas un jour dû). Part du mois : `P = C × D_mois / (D_mois + D_hors)`, soit C quand
  `D_hors = 0`. Chaque jour du mois reçoit `hdu(j) × min(1, P / D_mois)`, soit un **prorata** :
  l'argent ne dépend jamais de l'ordre des codes dans la semaine, ni de la date où le mois coupe la
  semaine ; les retenues des deux mois sur une semaine à cheval, additionnées, ne dépassent jamais C.
  La borne `min(1, ·)` empêche une semaine qui a de la marge de gonfler les heures dues. Les jours
  hors du mois (`joursHorsMois`), leurs fériés et leurs congés sans solde viennent de
  `chargerJoursMois`, qui lit la plage lundi de la première semaine → dimanche de la dernière. Rachel,
  C lun-mer puis S jeu-sam, ou l'inverse : 176,92 $ dans les deux cas (18 h payées, 18 h retenues).
  Pour une semaine d'un seul code payé, le plafond ne change rien (mêmes heures dans R et dans la
  base). Pour S, il est décisif : sans modèle, compter `heuresParJour` pour chaque jour du lundi au
  samedi retiendrait 72 h à Rachel (36 h/sem), soit 125,00 $ au lieu de 153,85 $. Un férié consomme
  le plafond comme les autres jours (Rachel, semaine S + férié hors congé : 161,54 $, pas 157,14 $).
  Semaines à cheval (Rachel, 36 h, mar/jeu/sam 12 h) : S le jeudi 3/09, lundi 31/08 sans code →
  C = 36 − 24 = 12 h retenues, 184,62 $ (l'ancien `H × n/6` donnait 192,00 $) ; S du 28/09 au 3/10 →
  septembre et octobre retiennent 18 h chacun (177,78 $), 36 h en tout ; S du 28 au 30/09 et octobre
  sans code → septembre retient 36 h (160,00 $). 40 h lun-ven, S le mercredi 30/09 → 190,91 $, octobre
  planifié ou non. Quand la semaine à cheval sur le mois SUIVANT a des heures dues dans le mois
  (D_mois > 0) et que ses jours hors du mois (lun → sam) n'ont encore ni créneau ni code,
  l'avertissement `SEMAINE_A_CHEVAL_NON_PLANIFIEE` le dit (« Semaine du 28/09 à cheval sur le mois
  suivant, encore non planifié : la retenue de la semaine est calculée sur ce mois seul. ») : Rachel,
  S du 28 au 30/09, retient 160,00 $ au lieu de 184,62 $ si octobre avait été planifié.
- **Congé sans solde** : le contrat est suspendu, aucun jour n'est dû, **même un férié**. Est traité
  comme S un jour non travaillé codé S, **ou tout jour non travaillé qui figure dans
  `joursCongeSansSolde`** (dates couvertes par un congé APPROUVÉ de type non payé, fériés compris,
  fournies par l'appelant), **quel que soit son code** : la liste fait foi. Un jour de la liste
  travaillé est payé comme travaillé. La précision est nécessaire parce que `poserCodesConge`
  (`conges-presences.ts`) saute les fériés (un férié pris pendant un congé sans solde arrive sans code,
  ou F), et qu'un S peut être effacé à la main (ADMIN, MANAGER) ou manquer au rattrapage : ces jours
  seraient payés (208,00 $ au lieu de 200,00 $ pour un S effacé). Un jour de la liste non travaillé
  dont le code n'est pas S déclenche l'avertissement `CONGE_SANS_SOLDE_RECODE` (« Congé sans solde
  approuvé mais code C le 16/09 : traité comme sans solde », « … mais sans code … ») ; les fériés et
  dimanches SANS code sont le cas normal et n'en déclenchent pas ; un férié codé F (posé à la main,
  « férié payé ») en déclenche un, puisque le logiciel l'écarte. Un jour de
  la liste non travaillé compte aussi comme S pour la semaine couverte (§3). Ce jour est traité
  avant la règle des fériés : ses heures dues entrent dans R (sur un créneau de travail elles y sont
  déjà, sauf un férié compté en HS planifiées) et rien n'est payé. Semaine S contenant un férié →
  160,00 $ et mois entier S avec un férié → 0, **à condition que l'appelant fournisse
  `joursCongeSansSolde`**. Sans cette liste, le férié non codé est payé : 168,00 $ et 8,00 $.
  *Pourquoi S entre dans R* (relecture 2026-09-23) : la génération automatique du planning ne pose
  aucun créneau pendant un congé approuvé, et le congé sans solde est codé S. Sans ses heures dans
  R, `t` monte et paie le congé : 208 $ au lieu de 192 $ pour 2 jours S, 400,00 $ au lieu de
  366,67 $ pour Martine.
- **Taux du mois `t = S / R`** (varie d'un mois à l'autre : c'est la mensualisation).
- **Base payée** = `t × (heures normales faites + hdu des jours payés non travaillés)`
  `+ t × ⅔ × hdu des jours de maladie`. Un jour avec des heures faites n'est jamais compté aussi comme
  jour payé non travaillé.
- **HS** : `calculerHeuresSupp` inchangé, valorisé au **taux contractuel `t0`** (décision 2). Une heure
  faite au-delà du planning mais sous le seuil HS est payée à `t` (un échange de jour reste neutre).
- **Fériés** : un férié un jour dû est payé même s'il n'est pas codé F ; travaillé, il rapporte la
  prime seule (payé double, pas triple). Dimanche : inchangé.
- **Taux de rôle** (`Shift.tauxHoraireUSD`) : aucun shift n'en porte en production. Ils ne déterminent
  plus la base ; un créneau dont le shift porte un taux déclenche un avertissement sur la ligne de paie
  et le taux est ignoré.
- **Reconstitution net → brut** inchangée. Le salaire journalier disparaît du calcul brigade : les
  jours payés non travaillés se comptent en heures.

**Propriétés garanties par des tests** : planning fait → net = S (au centime) ; absence non payée →
retenue `hp × t` ; échange de jour → neutre ; mois entier en congé → S ; mois entier en absence
injustifiée → 0 ; un congé n'est jamais payé deux fois (cas Syntyche : 200,00 $, pas 305,88 $).

## 3. Repli, visible

Si **une semaine** du mois n'a aucun créneau pour le salarié (créneaux système compris ; sauf semaine
dont tous les jours ouvrables hors fériés sont codés C, A, M, O, F ou S, un jour non travaillé de
`joursCongeSansSolde` valant S — pas N), si c'est le **mois
d'embauche**, le **mois de fin de contrat** (fin avant le dernier jour du mois : tous les CDD de la
brigade y passent, et R ne couvrirait que les jours restants, soit le mois entier payé), ou si la fiche
n'a **pas d'heures hebdomadaires** (seuil HS inconnu), le mois entier retombe sur l'ancienne référence
(`H × 52/12`), avec un motif : daté pour l'embauche et la fin de contrat (« Embauche le 15/09/2026 :
mois incomplet », « Fin de contrat le 28/09/2026 : mois incomplet »), avec les semaines pour un planning
incomplet (« Planning incomplet : semaine du 21/09 sans créneau »), non daté sinon (« Heures
hebdomadaires du contrat non renseignées », « Aucune heure planifiée ce mois », ce dernier quand R ≤ 0).
Une date de fin de contrat antérieure au mois calculé est ignorée (le contrat ne couvre pas ce mois).
`dateFinContrat` est une date pure (minuit UTC). Un planning à moitié publié payerait sinon ~866 $ au
lieu de 200 $. Le repli est visible : `PayrollLine.sourceReference` (`PLANNING` | `CONTRAT_REPLI`) +
`motifReference`, badge sur l'écran Paie, mention sur le bulletin (« Heures planifiées » /
« Heures contrat (repli) »).

## 4. Date d'effet

Paramètre daté `paie_reference_planning_depuis = 202609` (`ParametreLegal`, modifiable par l'ADMIN
seul). Les mois antérieurs, même encore `PAS_VALIDE` (juin, juillet), restent calculés comme avant. Les
mois VALIDÉS/PAYÉS ne sont jamais recalculés.

## 5. Un seul calcul

La référence et la base sont une **fonction pure** (`src/lib/paie-reference.ts`) appelée par
`paie-batch.ts` ET `bulletin-live.ts` : sinon la fiche et la paie divergent.
`PayrollLine.heuresContractuelles` reçoit R ; nouvelle colonne `heuresPayeesNonTravaillees` ;
`indemniteCongesUSD` = montant réellement compris dans la base. Migration purement additive.

## 6. Le planning devient une pièce de paie (décisions 3 et 4)

1. **Trace** : toute création, modification ou suppression d'un créneau passe par `src/lib/audit.ts`
   (qui, quand, avant, après) — `saisirCreneau`, `saisirCreneauxEnLot`, génération automatique,
   échanges et changements de shift approuvés.
2. **Verrou** : refus de modifier un créneau d'un mois dont une ligne de paie est VALIDE ou PAYÉE.
3. **Avertissements sur la ligne de paie et dans la boîte de validation, sans bloquer** : présences ou
   heures saisies pour des jours à venir ; jour codé P sans créneau ; planning modifié après la saisie
   des heures ; repli sur la référence contrat ; taux de rôle ignoré ; `t > 1,3 × t0`.

## 7. Hors périmètre

- Le défaut des semaines à cheval sur deux mois (documenté dans `paie-batch.ts`) : lot à part. Sans
  effet sur septembre.
- Prorata du mois d'embauche : repli sur l'ancienne référence en attendant un comptable.
- Données : présences du 24 au 30/09 saisies à l'avance, jours du 28 et 30/09 de Rachel, heures des
  contrats d'Esther et d'Aimée — à trancher par la Direction, jamais par un script.
- Durées légales (journées de 12 h et 14,5 h, semaines de 70,5 h) : à faire vérifier par un juriste.

## 8. Critère d'acceptation

La simulation de l'annexe (§10) rejouée par les tests sur des données identiques à septembre 2026 :
Martine **400,00 $** de base nette (403,00 $ allocation comprise), Syntyche et Marie 200,00 $, les 11
salariés inchangés inchangés, et `bulletin-live` égal à `paie-batch` au centime.
