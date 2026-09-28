# Lots 3 et 4 de l'espace salarié : mes contrats et mes attestations

- **Date** : 2026-09-28
- **Programme** : lots 3 et 4 sur 7, arbitrés le 2026-09-22 (voir `2026-09-22-signature-electronique-design.md`, §8-9). Les lots 1, 2 et 5 sont livrés.
- **Décisions de la Direction (2026-09-28)** :
  1. **Contrats, classement automatique.** Un CDD dont la date de fin est passée s'affiche comme « ancien (expiré) ». Créer un nouveau contrat PROPOSE de clôturer l'ancien. Rien n'est réécrit en base sans le clic de la Direction.
  2. **Attestations.** Le salarié les **demande** depuis son espace. La Direction **valide**, à l'unité ou en lot. L'attestation reçoit alors un **numéro**, elle est **tracée**, et apparaît dans les documents du salarié avec la signature de la Direction. Le libre-service actuel disparaît.
  3. **Attestation de salaire.** Elle porte le net et le brut de la **dernière paie VALIDÉE ou PAYÉE**, avec le mois indiqué. Sans paie validée, pas d'attestation de salaire. Stagiaires et intérimaires : pas d'attestation de salaire.

## Constats (code au 2026-09-28, commit 57c0f06)

- **Contrats.**
  - Aujourd'hui, les contrats sont listés à plat dans `espace/documents/page.tsx:150-192`, triés par date de début.
  - La signature est proposée seulement pour un contrat au statut ACTIF.
  - Le statut `EXPIRE` n'est jamais posé.
  - `ajouterContrat` (`employes/[id]/dossier-actions.ts:109-156`) ne clôt pas le contrat actif précédent : plusieurs contrats peuvent être ACTIF en même temps.
  - Aucune notification n'avertit le salarié qu'un contrat attend sa signature.
  - La fenêtre de signature d'un contrat dit « vous reconnaissez avoir pris connaissance » (`components/bouton-signer.tsx:128`), alors que signer vaut acceptation formelle (décision du 2026-09-23).
- **Attestations.**
  - Le salarié génère lui-même les attestations de travail et de salaire (`espace/attestation/[type]/route.ts`, libellé « sans passer par la Direction »).
  - Il n'y a ni numéro, ni registre, ni journal, ni notification.
  - La signature de la Direction est apposée automatiquement.
  - L'attestation de salaire lit `Contrat.salaireMensuel`, qui n'est pas mis à jour par `changerSalaire`.
  - « Depuis le » reprend la date de début du contrat en cours, et non la date d'embauche.
  - Pour un CDI résilié sans date de fin, l'attestation affiche « au — ».
  - L'attestation de paie côté Direction (`employes/[id]/attestation-paie/[ligneId]`) ne vérifie pas que la ligne est validée : un brouillon peut être attesté.
  - Les routes Direction et salarié sont des copies presque identiques.

## Lot 3 : Mes contrats

### 3.1 Classement, fonction pure `src/lib/contrats-classement.ts`

`classerContrat(contrat, signature, aujourdhui)` renvoie l'une des catégories suivantes :
- **`A_SIGNER`** : le contrat est en vigueur (voir ci-dessous) et son état de signature est `A_SIGNER` ou `A_RESIGNER`.
- **`EN_VIGUEUR`** : le contrat est en vigueur et signé.
- **`ANCIEN`** : les autres cas, avec un motif :
  - « expiré le JJ/MM/AAAA » : CDD ou stage dont la `dateFin` est passée, quel que soit le statut stocké ;
  - « résilié », « transformé » : selon le statut ;
  - « remplacé par le contrat du JJ/MM/AAAA » : un contrat ACTIF plus ancien alors qu'un contrat ACTIF plus récent existe.

« En vigueur » veut dire : statut ACTIF, `dateFin` nulle ou non passée, et contrat ACTIF le plus récent de la fiche (par `dateDebut`, puis par `createdAt`).

« Aujourd'hui » est le jour civil à Kinshasa (`jourCivilKinshasa`), jamais l'UTC.

Aucune écriture en base : le classement est dérivé, comme l'état de signature.

### 3.2 Espace salarié : page « Mes contrats » (`/espace/contrats`)

- Une nouvelle entrée de menu « Mes contrats ». La section « Contrats » quitte « Mes documents ». Le bloc « Contrat en cours » du dossier renvoie vers cette page.
- Trois rubriques, dans l'ordre :
  1. **À signer** : bouton « Signer » (`BoutonSigner`) et aperçu du PDF.
  2. **En vigueur** : « Signé le … », téléchargement de l'exemplaire signé (figé si c'est lui qui fait foi).
  3. **Anciens** : motif, dates, téléchargement de l'exemplaire (le figé s'il existe). On ne signe pas un ancien contrat.
- Une rubrique vide annonce son état (« Aucun contrat à signer »).
- Le type de contrat s'écrit en clair (CDI, CDD, Stage, Intérim, Journalier), avec le même libellé que dans le dossier. Aucune valeur brute du type n'apparaît.
- La pastille de l'accueil de l'espace indique « 1 contrat à signer » quand c'est le cas.
- Texte de la fenêtre de signature d'un CONTRAT : « En signant, vous acceptez ce contrat et ses conditions. » Les autres documents gardent leur formulation.

### 3.3 Notifications

- La création d'un contrat, ou une modification qui le fait repasser « à resigner », notifie le salarié : « Un contrat vous attend pour signature », avec un lien vers `/espace/contrats`. La notification passe par la cloche de l'espace salarié et par le push, comme les autres notifications salarié (`notifierSalarie`). Un salarié sans compte n'est pas notifié.

### 3.4 Côté Direction

- **Nouveau contrat** (fiche employé, onglet Contrats) : si un contrat en vigueur existe, le formulaire propose la case « Clôturer le contrat en cours (il passera en Transformé ou Résilié, à choisir) ». La case est cochée par défaut pour un changement de type, décochée sinon. La clôture se fait dans la même transaction, et elle est journalisée.
- **Onglet Contrats et Suivi des contrats** : les CDD expirés s'affichent « expiré le … », comme dans l'espace salarié (même fonction de classement). Un bouton « Marquer expiré » (actions groupées dans le Suivi des contrats) pose `EXPIRE` en base ; c'est un geste de la Direction, journalisé.
- **État de signature** visible dans le Suivi des contrats et dans `/documents` (onglet Contrats), avec le même composant que pour les bulletins.

## Lot 4 : Mes attestations

### 4.1 Données : migration additive

Modèle `Attestation` (schéma `public`, protégé par RLS comme les autres tables, `ENABLE ROW LEVEL SECURITY` dans la migration) :
- `id`, `employeeId`, `type` (enum `TypeAttestation` : `TRAVAIL`, `SALAIRE`, `STAGE`) ;
- `statut` (enum : `DEMANDEE`, `DELIVREE`, `REFUSEE`), `motifRefus` ;
- `numero` (texte unique, nul tant que l'attestation n'est pas délivrée) ;
- `demandeLe`, `demandeParId` (le compte qui demande : le salarié, ou la Direction quand elle crée l'attestation elle-même) ;
- `delivreeLe`, `delivreeParId`, `payrollLineId` (la paie retenue pour une attestation de salaire) ;
- `pdfUrl` : l'exemplaire FIGÉ au moment de la délivrance, dans le stockage privé ;
- `donnees` (JSON, instantané des valeurs imprimées).

**Numéro** : `ATT-AAAA-NNNN`, séquence par année, attribuée dans la transaction de délivrance (verrou de ligne ou séquence Postgres, jamais un `max + 1` sans verrou). Un numéro n'est jamais réutilisé.

### 4.2 Contenu

- **Travail** : identité, poste, type de contrat, « depuis le » = **date d'embauche** (`Employee.dateEmbauche`), et selon le cas :
  - en poste : « et est toujours en fonction à ce jour » ;
  - sorti : « jusqu'au JJ/MM/AAAA », avec la date de fin du dernier contrat ou la date de sortie.

  Si aucune de ces dates n'existe, la délivrance est refusée avec un message, plutôt que d'imprimer « — ».
- **Salaire** :
  - net et brut de la dernière `PayrollLine` au statut VALIDE ou PAYE, avec « au titre du mois de … » ;
  - net = salaire net hors transport (`salaireNetUSD`), et les allocations sont mentionnées à part si elles existent ;
  - la devise suit celle de la ligne (USD, avec le taux du bulletin pour l'équivalent en CDF, comme sur le bulletin).

  Refusée avec un motif lisible si le salarié est stagiaire ou intérimaire, ou s'il n'a aucune paie validée.
- **Stage** : reprend le modèle d'attestation de stage existant, sur le dernier contrat de stage.
- Chaque attestation porte son **numéro** et la mention « délivrée le … », avec la signature de la Direction. Tous les nombres passent par `formaterNombre` (police Optima, pas d'espace fine).

### 4.3 Circuit

- **Salarié** (`/espace/attestations`, nouvelle entrée de menu, sortie de « Mes documents ») :
  - formulaire « Demander une attestation » : type, motif facultatif ;
  - une seule demande EN COURS par type à la fois ;
  - liste de ses attestations avec leur statut : demandée, délivrée (téléchargement de l'exemplaire figé), refusée (motif).
- **Direction** : les demandes apparaissent dans « Demandes de validation » (`/a-valider`), avec :
  - cases à cocher et barre d'actions « Délivrer » / « Refuser » (motif) ;
  - un aperçu du PDF avant délivrance ;
  - une vérification serveur de l'éligibilité au moment de délivrer (paie validée, type de contrat) ;
  - le refus automatique d'une demande inéligible, avec un message lisible par ligne.
- **Délivrance** :
  - numéro attribué, PDF généré puis figé dans le stockage privé, instantané en `donnees` ;
  - journal d'audit ;
  - notification du salarié (« Votre attestation … est disponible »).
- **La Direction peut aussi délivrer directement** depuis la fiche employé. Les liens actuels « Attestation de travail / salaire » deviennent « Délivrer une attestation », qui crée une attestation déjà délivrée, numérotée, et la propose au téléchargement. Plus aucune attestation sans numéro ni trace.
- **Registre** : la fiche employé liste ses attestations (numéro, type, date, qui). `/documents` reçoit un onglet « Attestations » : registre de toutes les attestations, filtres type et statut, export Excel.
- **L'ancien libre-service disparaît** : `espace/attestation/[type]` est supprimé, et son lien aussi. L'attestation de paie mensuelle de la Direction exige désormais une ligne VALIDE ou PAYE.

### 4.4 Accès

- L'exemplaire figé d'une attestation n'est téléchargeable que par son titulaire (route de l'espace, contrôle de propriété fait sur la base) et par la RH.
- Toute route ajoutée respecte le garde-fou « une garde par route » (branche `fix/securite-routes-rh`, fusionnée avant ou avec ce lot).

## Tests exigés (chaque garde-fou est falsifié : casse, rouge, restauration depuis une copie, `cmp`)

- `classerContrat` : en vigueur signé ou à signer, à resigner, CDD expiré avec statut ACTIF, deux ACTIF (le plus ancien est « remplacé »), résilié, transformé, date du jour à Kinshasa (autour de minuit UTC).
- Page « Mes contrats » : rubriques dans l'ordre, états vides, libellés de type traduits, aucune valeur brute d'enum.
- Notification à la création d'un contrat et au passage « à resigner ».
- Nouveau contrat avec la case de clôture : ancien contrat clôturé dans la même transaction, avec journal. Case décochée : rien ne change.
- Attestations :
  - numéro unique, y compris sous concurrence (deux délivrances simultanées) ;
  - séquence par année ;
  - délivrance en lot, tout ou rien par ligne, avec message ;
  - refus avec motif ;
  - une seule demande en cours par type.
- Salaire : dernière paie VALIDE ou PAYE (un brouillon plus récent est ignoré) ; aucune paie validée → refus ; stagiaire → refus.
- Travail : date d'embauche ; en poste ; sorti ; aucune date → refus.
- Propriété : un salarié ne télécharge pas l'attestation d'un collègue ; l'ancienne route libre-service n'existe plus.
- PDF : numéro et mention présents, aucune police de repli.

## Hors périmètre

- Ergonomie générale de l'espace salarié (lots 6 et 7).
- Réécriture de l'historique git pour retirer l'ancienne image de signature (décision de la Direction).
- Signature électronique d'une attestation par la Direction (on garde la signature scannée).
