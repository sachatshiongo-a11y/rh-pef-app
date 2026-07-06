# Plan d'évolution — Logiciel RH Pâtes en Folie (RDC)

> Statut : **EN ATTENTE DE VALIDATION** — aucune implémentation de masse avant accord.
> Les taux et règles légales ci-dessous doivent être **validés par un comptable/juriste congolais avant tout usage réel**.

## 0. Revue de l'existant (résumé)

Stack : Next.js 16 + Prisma 7 + PostgreSQL (Supabase) + Supabase Auth. PDF via @react-pdf/renderer (police Optima, identité visuelle PEF).

Déjà en place : employés (soft delete via `actif`), présences (grille mensuelle codes P/O/M/A/N/C/F/S, copier-coller tableur, couleurs), heures supp (seuil hebdo contractuel par employé, majorations 30/60/100%, détail par semaine), congés (demande → validation Admin, PDF signé), paie mensuelle (PayrollRun/PayrollLine, statut EN_ATTENTE/PAYE, bulletins USD & CDF, confirmation de paiement), dashboard, historique, rôles ADMIN/MANAGER/VIEWER, mode production local.

## 1. Conflits prompt ↔ existant — À TRANCHER AVANT TOUT

| # | Sujet | Existant (validé par vous précédemment) | Prompt | Décision requise |
|---|-------|------------------------------------------|--------|------------------|
| C1 | CNSS patronal | **9%** (repris de votre Excel) | **13%** (5 pensions + 1,5 risques + 6,5 famille, Décret 18/041) | Quel taux ? |
| C2 | Barème IPR | Tranches en **USD** reprises de votre Excel : 0% ≤150$, 15% ≤900$, 20% ≤1500$, 22% ≤2500$, 30% au-delà | Barème **DGI en CDF** : 3/15/30/40%, plancher 2 000 FC, plafond 30%, réduction charges famille | Lequel appliquer ? (le barème DGI implique de convertir le net imposable USD→CDF avant calcul) |
| C3 | Allocation familiale | **+1,5 $/enfant** ajoutée au net (votre Excel) | Non mentionnée (les prestations familiales CNSS sont patronales) | Conserver ? |
| C4 | Statuts de paie | 2 états : EN_ATTENTE → PAYE | Machine à 5 états : En attente → Préparé → Validé → Payé → Annulé | Migration vers 5 états OK ? |
| C5 | Bulletins | Recalcul du mois **écrase** les lignes existantes | **Jamais écraser** : versioning | Versioning OK ? (le bouton "Calculer" créera une nouvelle version) |
| C6 | Rôles | 3 rôles (ADMIN/MANAGER/VIEWER) | Permissions fines par module | Garder 3 rôles + matrice de permissions par module, ou ajouter des rôles ? |

Points **sans conflit** (déjà conformes) : HS = dépassement hebdo contractuel, 6 premières h à +30%, ensuite +60%, dimanche/férié ×2, seuil hebdo par employé ✔ · soft delete employé ✔ · salaires USD + conversion CDF ✔ · congé validé avant présence (à renforcer, voir P4).

## 2. Questions ouvertes

1. **Devise** : salaires actuellement stockés en USD, taux CDF/USD dans Paramètres, bulletins dans les 2 devises. Confirmer que c'est le fonctionnement voulu.
2. **Matricules** : format observé `XX##-PEF` (initiales + numéro + suffixe), ex. MS12-PEF, TB16-PEF. Mais anomalies : « Deladri » et « Francine Luyindula » (noms utilisés comme matricules). Confirmer la règle de génération (numéro = ordre d'embauche ?) et si on doit régulariser les anomalies.
3. **IVMS-4200** : quel est le **modèle exact du terminal Hikvision** ? (détermine si l'AdaptateurAPI/ISAPI est possible ; l'import de rapport reste la voie n°1).
4. **Base imposable IPR** : brut / brut−CNSS / brut−CNSS−frais pro — quel défaut ? (À VALIDER comptable).
5. **Email** : quel fournisseur d'envoi (ex. Resend, SMTP existant) et quelle adresse expéditrice ?

## 3. Plan par phases

- **P1 — Paramètres légaux versionnés** : table `ParametreLegal` versionnée par exercice fiscal (CNSS salarié/patronal par branche, plafond CNSS nullable, barème IPR, plancher/plafond IPR, réduction famille, INPP, ONEM, seuil HS 6h/sem, majorations 30/60/100, base imposable IPR configurable). Migration du moteur de paie vers cette table (plus rien en dur). Seed avec les valeurs actuelles + valeurs du prompt marquées « À VALIDER ». *(dépend de C1/C2/C3)*
- **P2 — Machine à états paie + versioning bulletins + audit** : états En attente→Préparé→Validé→Payé→Annulé, transitions contrôlées avec (date, heure, utilisateur, mode de paiement, pièce jointe) ; bulletins versionnés jamais écrasés ; `JournalAudit` (qui/quand/avant/après) sur salaire, contrat, congé, présence, statut de paie.
- **P3 — Dossier employé complet** : contrats (dates, période d'essai, échéance), historique salarial/promotions, dossier disciplinaire (sanctions/avertissements + pièces), évaluations, documents avec métadonnées (type, émission, **expiration**) stockés dans Supabase Storage, historique de paiements ; notifications dans la fiche.
- **P4 — Présences deux socles** : couche adaptateurs (`AdaptateurImportRapport` IVMS-4200 Excel/CSV avec dossier surveillé, appariement matricules, détection anomalies sans écrasement silencieux ; `AdaptateurAPI` plus tard si terminal compatible) ; blocage strict congé-non-validé → présence ; validation HS/congés avant paie ; exports Excel/PDF des grilles.
- **P5 — Conformité paie RDC** : IPR barème DGI (selon C2), CNSS par branches (selon C1), INPP/ONEM patronaux, solde de tout compte, bordereaux mensuels de déclaration (CNSS avant le 15) avec rappels d'échéance et montants dus.
- **P6 — Dashboard & notifications** : présents/absents du jour, anniversaires, masse salariale, échéances CDD/périodes d'essai, congés en attente, taxes à payer ; notifications in-app (prioritaires) + email (avec gestion des échecs).
- **P7 — Sécurité & robustesse** : matrice de permissions par module, sauvegardes automatiques chiffrées hors machine + **procédure de restauration testée**, chiffrement des données sensibles, génération automatique des matricules.
- **P8 — Registre du personnel + tests + production encadrée** : registre exportable (PDF/Excel, tri par embauche, append-only) ; tests e2e (200 employés fictifs, clôture de mois, concurrence, pannes réseau, archivage, imports/exports, cas de paie à résultat connu vérifiables à la main) ; guide de déploiement, checklist production-readiness, **run parallèle 1–2 mois** avant bascule.

## 4. Modèle de données — ajouts proposés (Prisma)

```
ParametreLegal      exercice, cle, valeur, unite, source, statutValidation(A_VALIDER|VALIDE), validePar, dateEffet
TrancheIpr          exerciceId, ordre, plafondCDF, taux        (remplace IprTranche actuel, en CDF)
Contrat             employeeId, type(CDD/CDI), debut, fin?, finPeriodeEssai?, heuresHebdo, salaire, devise, statut
HistoriqueSalaire   employeeId, date, ancienSalaire, nouveauSalaire, motif(promotion/ajustement), decidePar
DossierDisciplinaire employeeId, type(SANCTION|AVERTISSEMENT|MESURE), date, description, documentId?
Evaluation          employeeId, date, note?, commentaire, evaluateur
DocumentEmploye     employeeId, type(enum), fichierUrl, dateEmission, dateExpiration?, importePar
TransitionPaie      payrollLineId, deStatut, versStatut, date, userId, modePaiement?, preuveUrl?
VersionBulletin     payrollLineId, numeroVersion, snapshot(JSON), genereLe, genrePar
JournalAudit        entite, entiteId, champ, ancienneValeur, nouvelleValeur, userId, date
ImportPointage      source(IVMS_RAPPORT|IVMS_API|MANUEL), fichier?, statut, anomalies(JSON), importePar, date
AppariementPointage employeeId, idExterneIVMS
Notification        userId, type, message, lien, lue, creeLe   (+ envoi email journalisé)
DeclarationTaxe     exercice, mois, type(CNSS|IPR|INPP|ONEM), montantDu, echeance, statut(A_PAYER|DECLARE|PAYE)
```

`PayrollLine` : + `statut` (5 états), `versionCourante`. `Employee` : + `dateNaissance`, `idExterneIVMS?`. `LeaveRequest` : inchangé (workflow déjà conforme).
