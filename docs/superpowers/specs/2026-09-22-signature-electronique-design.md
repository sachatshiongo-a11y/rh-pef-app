# Signature électronique du salarié — tracée, horodatée, opposable (lot 2)

- **Date** : 2026-09-22
- **Statut** : Design validé (à implémenter)
- **Périmètre** : un mécanisme de signature unique, appliqué à **trois documents** (contrat de
  travail, bulletin de paie validé, demande de congé approuvée), depuis **deux endroits**
  (l'espace salarié, et la Direction qui fait signer sur place).
- **Suite** : deuxième des sept lots arbitrés le 2026-09-22. Les lots 3 (contrats de l'espace
  salarié) et 4 (attestations) s'appuieront dessus.

---

## 1. Contexte

Le contrat de travail porte déjà une acceptation numérique depuis juillet : un bouton « Lu et
approuvé », un horodatage (`Contrat.accepteLe`), un **PDF figé** qui fait foi
(`Contrat.pdfAccepteUrl`) et un drapeau si les conditions changent après (`pdfAccepteObsolete`).
Le squelette est bon ; il lui manque le geste.

Le bulletin de paie, lui, imprime depuis le début une case **« Signature du salarié » vide**
(`bulletin.tsx`, `PdfSignatureBox signe={false}`), et la demande de congé une ligne « Signature du
salarié » jamais remplie. Les deux attendent ce lot.

La Direction demande (2026-09-22) une signature **tracée au doigt dans un cadre**, à la façon du
portail salarié de Factorial : un cadre en pointillés, on signe, c'est enregistré. Et elle doit
pouvoir **faire signer sur place** en tendant son appareil — la brigade est en cuisine, tout le
monde n'a pas de smartphone.

## 2. Décisions cadrantes

1. **Le tracé ne prouve rien tout seul.** Un dessin au doigt n'identifie personne. Ce qui rend la
   signature opposable est enregistré avec lui : **qui** (le salarié, par son matricule), **quand**
   (horodatage **serveur**, jamais l'heure de l'appareil), et **quoi** — une empreinte des données
   du document signé. Le tracé est la forme ; ces trois éléments sont le fond.
2. **Le document dit la vérité sur les conditions du geste.** Une signature recueillie sur
   l'appareil de la Direction n'est pas une signature faite seul depuis son espace : le PDF
   l'écrit, et nomme qui a présenté l'appareil. On n'imprime jamais « depuis son espace salarié »
   sur un geste qui a eu lieu sur la tablette du bureau.
3. **L'empreinte porte sur les DONNÉES, jamais sur le PDF rendu.** La refonte du bulletin du
   2026-09-22 (trois lignes en bas de page) n'a pas changé un centime : une empreinte du PDF aurait
   invalidé toutes les signatures d'hier sans qu'aucun montant ne bouge.
4. **Une signature ne s'efface pas.** Si le document change après coup, la signature passe en
   **obsolète** — elle reste, datée, et le salarié resigne. L'historique ne se réécrit pas.
5. **Les contrats déjà acceptés au clic restent des acceptations au clic.** La migration les reprend
   sans tracé, et le document l'écrit tel quel. On ne fabrique pas rétroactivement un geste qui n'a
   pas eu lieu.

## 3. Le modèle

```prisma
enum CibleSignature { CONTRAT  BULLETIN  DEMANDE_CONGE  @@schema("public") }

/// Signature faite SEUL depuis l'espace salarié, ou recueillie sur l'appareil de l'entreprise
/// en présence d'un responsable. La distinction est imprimée sur le document (cf. §6).
enum ModeSignature { ESPACE_SALARIE  PRESENTIEL  @@schema("public") }

model SignatureElectronique {
  id            String          @id @default(uuid())
  cible         CibleSignature
  cibleId       String          // id du Contrat / PayrollLine / LeaveRequest
  employeeId    String
  employee      Employee        @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  /// PNG du tracé, bucket privé (`/fichiers/signatures/<cible>/<cibleId>.png`).
  /// NULL = contrat accepté au clic avant le 2026-09-22 : il n'y a jamais eu de tracé.
  traceUrl      String?
  signeLe       DateTime        @default(now()) // horodatage SERVEUR
  mode          ModeSignature
  /// Compte Direction qui a présenté l'appareil. OBLIGATOIRE en PRESENTIEL, null sinon.
  presenteParId String?
  presentePar   User?           @relation("SignaturePresenteePar", fields: [presenteParId], references: [id])

  /// Ce qui a été signé : instantané canonique des données du document (cf. §5).
  donnees       Json
  /// SHA-256 de `donnees` — permet de détecter en une comparaison qu'un document a changé depuis.
  empreinte     String
  obsolete      Boolean         @default(false)

  @@unique([cible, cibleId])
  @@index([employeeId])
  @@schema("public")
}
```

Les relations inverses s'ajoutent sur `Employee` (`signatures`) et sur `User`
(`signaturesPresentees @relation("SignaturePresenteePar")`) — ce schéma nomme toutes ses relations
vers `User`, celle-ci ne fait pas exception.

`Contrat.accepteLe` et `pdfAccepteUrl` **restent** : ils portent l'historique et l'exemplaire figé.
La migration crée une `SignatureElectronique` (`traceUrl: null`, `mode: ESPACE_SALARIE`) pour chaque
contrat déjà accepté, avec `signeLe = accepteLe`.

## 4. Le cadre de signature

Un composant client unique, `components/cadre-signature.tsx`, utilisé aux deux endroits.

- Cadre en **pointillés**, hauteur confortable au doigt, pleine largeur sur téléphone.
- `<canvas>` + `pointerdown/move/up`, `touch-action: none` (la page ne défile pas pendant le geste),
  trait lissé par courbes quadratiques, épaisseur fixe.
- Deux boutons : **Effacer** et **Signer**. « Signer » est désactivé tant que le tracé est vide
  (moins de 8 points : un point isolé n'est pas une signature).
- Export **PNG à 2×** (netteté à l'impression), **fond transparent**, trait noir.
- Sur l'écran Direction, un bandeau au-dessus du cadre : *« Remettez l'appareil à Aimée Mutita. En
  signant, elle reconnaît avoir pris connaissance de ce document. »*

Le canvas ne quitte jamais le navigateur autrement qu'en PNG : aucune bibliothèque tierce.

## 5. Ce qui est signé — l'instantané et son empreinte

Un module `lib/signature-document.ts`, serveur, expose pour chaque cible une fonction qui **relit
le document et renvoie son instantané canonique** (clés triées, montants en chaînes à 2 décimales
pour éviter toute dérive de virgule flottante) :

| Cible | Instantané |
|---|---|
| `BULLETIN` | période, matricule, brut, CNSS, IPR, transport, primes, acompte, **salaire net**, **total versé**, statut de paiement |
| `CONTRAT` | type, poste, dates, salaire, devise, heures hebdo, période d'essai |
| `DEMANDE_CONGE` | type, dates, nombre de jours ouvrables, statut, approbateur |

`empreinte = sha256(JSON.stringify(instantané))`, en hexadécimal — `node:crypto`, aucune dépendance.

**Détection du changement** : à chaque affichage d'un document signé, le serveur recalcule
l'instantané et compare l'empreinte. Différente → `obsolete = true` est persisté, une notification
part à la Direction, et le document porte la mention (§6). Le salarié voit « À resigner ».

Le bulletin est le cas qui compte : la paie peut être recalculée après signature. Le modèle
`VersionBulletin` du schéma (inutilisé à ce jour) n'est **pas** réveillé ici — `donnees` porte
l'instantané, la table est auto-suffisante. Le réveiller reste au backlog.

## 6. Sur le document

`PdfSignatureBox` (`lib/pdf/layout.tsx`) gagne deux propriétés optionnelles : `image` (le tracé) et
`mention` (la ligne sous le trait). Les trois documents l'utilisent déjà — aucun n'a besoin d'une
nouvelle mise en page.

La mention, selon le mode :

- **Espace salarié** — *« Signé électroniquement par Aimée Mutita (matricule PEF-007) le 22/09/2026
  à 14 h 12, depuis son espace salarié. »*
- **Présentiel** — *« Signé par Aimée Mutita (matricule PEF-007) le 22/09/2026 à 14 h 12, sur
  l'appareil de l'entreprise, en présence de Dominique Tshiongo. »*
- **Contrat accepté au clic (avant le 2026-09-22)** — *« Accepté électroniquement le 20/07/2026 à
  09 h 40, sans signature tracée. »*
- **Signature obsolète** — la mention est précédée de *« ⚠ Document modifié après signature — à
  resigner. »* Le tracé n'est **pas** affiché : un tracé sur un document qui a changé induirait en
  erreur.

Heure de Kinshasa (UTC+1) partout, comme le reste des documents.

## 7. Qui signe quoi, et d'où

| Document | Signable quand | Espace salarié | Direction (« Faire signer ») |
|---|---|---|---|
| Contrat | actif, non signé | `/espace/documents` | fiche employé, onglet Contrats |
| Bulletin | statut **VALIDÉ** ou **PAYÉ** | `/espace/documents` | fiche employé (historique de paie) et `/documents` |
| Demande de congé | statut **APPROUVÉ** | `/espace/conges` | `/conges`, liste des demandes |

**Gardes serveur**, sans exception :
- Espace salarié : `estSalarie(user)` **et** le document appartient à `user.employeeId`. Mode forcé
  à `ESPACE_SALARIE`, `presenteParId` forcé à `null`.
- Direction : `requireRole(user, ["ADMIN", "MANAGER"])`. Mode forcé à `PRESENTIEL`,
  `presenteParId = user.id`. Le client ne choisit jamais son mode : c'est la garde qui le décide.
- Un document déjà signé et **non obsolète** ne peut pas être resigné (contrainte d'unicité +
  refus explicite). Obsolète → la signature est remplacée, l'ancienne est journalisée.
- Un bulletin en brouillon, une demande en attente ou refusée, un contrat rompu : refus, avec un
  message qui dit pourquoi.

Chaque signature est journalisée (`JournalAudit`) : qui, quand, sur quel document, dans quel mode.

## 8. Ce que la Direction voit

- Sur la fiche employé et dans `/documents`, chaque document signable porte son état : **À signer**,
  **Signé le …**, ou **À resigner** (obsolète).
- Une notification à chaque signature de salarié (comme aujourd'hui pour le contrat).
- Une notification quand une signature devient obsolète — c'est le seul cas qui demande une action.

## 9. Hors périmètre

- Le classement **À signer / Signés / Anciens** de l'espace salarié : lot 3.
- Les attestations (elles n'ont pas de signature salarié) : lot 4.
- La valeur probante au sens d'un certificat qualifié (OHADA/eIDAS) : ce lot produit une signature
  **simple**, horodatée et traçable. C'est ce qui se pratique pour un accusé de réception interne ;
  ce n'est pas une signature qualifiée, et la spec ne prétend pas le contraire.
- Le réveil de `VersionBulletin`.

## 10. Tests

- **`lib/signature-document.test.ts`** (pur) : l'instantané est stable (mêmes données → même
  empreinte, quel que soit l'ordre des clés) ; un montant qui change → empreinte différente ; un
  champ d'affichage qui change (libellé) → empreinte **identique**.
- **`lib/pdf/signature.render.test.ts`** (rendu réel, `pdf-parse`) : un bulletin signé en espace
  salarié porte « depuis son espace salarié » ; en présentiel, « en présence de … » ; obsolète,
  « Document modifié après signature » **et pas de tracé** ; non signé, la case reste vide.
- **`app/espace/signature.integration.test.ts`** (Postgres embarqué) : un salarié signe son
  bulletin validé → ligne créée, mode `ESPACE_SALARIE`, `presenteParId` null ; il ne peut pas signer
  le bulletin d'un collègue (refus) ; il ne peut pas signer un brouillon (refus) ; resigner un
  document déjà signé non obsolète (refus).
- **`app/(app)/signature-presentiel.integration.test.ts`** : la Direction fait signer → mode
  `PRESENTIEL`, `presenteParId` = le compte Direction ; un compte VIEWER est refusé.
- **Obsolescence** (intégration) : bulletin signé, puis paie recalculée avec un montant différent →
  à l'affichage suivant, `obsolete = true`, notification créée, le PDF porte la mention.
- Suite complète verte ; **aucune modification** de `payroll.ts`, `paie-batch.ts`, `paie-net.ts` ni
  de leurs tests : ce lot ne touche à aucun calcul.

## 11. Ce que la Direction doit savoir

- Les contrats déjà acceptés au clic ne portent pas de tracé et l'écrivent. Pour obtenir un tracé,
  il faut faire resigner — ce n'est pas nécessaire, l'acceptation reste valable.
- Une paie recalculée après signature **invalide** la signature du bulletin : le salarié devra
  resigner. C'est voulu — il a signé un montant, pas un document.
- La signature en présentiel nomme le responsable présent. Ce nom est imprimé sur le document remis
  au salarié.
