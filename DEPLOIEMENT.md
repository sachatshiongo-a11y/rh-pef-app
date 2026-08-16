# Déploiement — RH Pâtes en Folie

Objectif : installer le logiciel sur **plusieurs ordinateurs**, avec une **application de bureau**
(icône, fenêtre native — pas un simple lien) et des temps de réponse **quasi instantanés**.

## Pourquoi c'est lent aujourd'hui

L'application tourne sur ton poste à Kinshasa, mais la base de données Supabase est en Europe
(`eu-west-3`). Chaque écran fait plusieurs allers-retours vers l'Europe → 150–250 ms × plusieurs =
lenteur. La distance est le vrai facteur, pas le code.

**Solution :** rapprocher l'application de la base. On sépare alors deux rôles :

- **Le serveur** (l'app Next.js + la clé secrète Supabase) tourne **une seule fois**, hébergé
  **en Europe, près de la base**. Il fait ses requêtes à la base en quelques millisecondes.
- **Les postes** ne font qu'afficher ce serveur via l'**application de bureau Electron** (une icône
  par ordinateur). Un seul aller-retour Kinshasa→Europe par action au lieu de dix.

> ⚠️ **Sécurité — important.** La clé `SUPABASE_SERVICE_ROLE_KEY` donne un accès total à la base.
> Elle ne doit **jamais** être embarquée dans l'application de bureau distribuée sur les postes.
> Elle reste **uniquement sur le serveur**. La coque Electron n'affiche qu'une URL, sans secret.

## Architecture recommandée

```
Base Supabase (Europe)  ⇄  Serveur Next.js (hébergé en Europe)  ⇄  App de bureau sur chaque poste
      millisecondes                (détient la clé secrète)            (n'affiche que l'URL)
```

### 1. Héberger le serveur en Europe (à faire une fois)

Options possibles (au choix, à faire avec tes accès) :

- **VPS en Europe** (OVH Gravelines, Hetzner, Scaleway Paris…) : y copier le projet, définir les
  variables d'environnement (`.env`), puis `npm ci && npm run build && npm start` derrière un
  reverse proxy HTTPS (Caddy/Nginx). C'est là que vit la clé secrète.
- **PaaS** (Railway, Render, Fly.io région Paris/Amsterdam) : déploiement Git, variables
  d'environnement dans le tableau de bord.

Le serveur expose alors une URL, par ex. `https://rh.patesenfolie.cd`.

> Variante « serveur local au restaurant » : faire tourner ce serveur sur un PC allumé en
> permanence au restaurant, accessible sur le réseau local (`http://192.168.x.x:3000`). Le plus
> rapide **sur place** ; prévoir les sauvegardes.

### 2. Installer l'application de bureau sur chaque poste

La coque Electron est dans `electron/`. Elle affiche l'URL définie par :

- la variable d'environnement `APP_URL`, **ou**
- le fichier `electron/app-url.txt` (par défaut `http://localhost:3000`).

Mets-y l'URL du serveur hébergé, par ex. :

```
echo "https://rh.patesenfolie.cd" > electron/app-url.txt
```

Lancer en développement (le serveur doit être accessible) :

```
npm run electron
```

Construire les installateurs (icône double-cliquable, un par système) :

```
npm run electron:build        # sur macOS -> .dmg  |  sur Windows -> .exe (NSIS)
```

Les installateurs sont générés dans `dist-electron/`. On distribue le `.dmg` (Mac) ou le `.exe`
(Windows) à chaque poste. À la première ouverture sous macOS non signé : clic droit → Ouvrir.

> Signature/notarisation (facultatif mais recommandé pour éviter les avertissements) : nécessite un
> compte développeur Apple / un certificat Windows. À configurer dans la section `build` du
> `package.json` le moment venu.

## Récapitulatif des commandes

| But | Commande |
| --- | --- |
| Lancer le serveur (dev) | `npm run dev` |
| Construire le serveur | `npm run build` puis `npm start` |
| Lancer la coque bureau | `npm run electron` |
| Construire les installateurs | `npm run electron:build` |

## Étapes ponctuelles après déploiement

### Lot « génération de planning » (2026-08)

Après `prisma migrate deploy`, lancer **une fois** la reprise des correspondances poste → shift,
sinon la première génération n'attribuera plus aucun shift dans la passe complémentaire :

```bash
npx tsx scripts/reprise-shifts-poste.ts
```

Puis vérifier dans Planning → « Shifts par poste » qu'aucun poste ne reste sans shift déclaré.

**Attendu** : les plannings générés vont changer, à cause des règles de repos (1 jour par semaine,
6 jours consécutifs au maximum) qui n'existaient pas. Ne pas régénérer un mois déjà validé sans
l'avoir décidé.

## Ce qui reste à décider avec toi

1. **Où héberger le serveur** (VPS Europe conseillé, ou serveur local restaurant). Nécessite tes
   accès (compte hébergeur / machine).
2. **Nom de domaine / URL** à mettre dans `electron/app-url.txt`.
3. **Signature** des installateurs (optionnel).

Une fois l'hébergement choisi, l'app devient quasi instantanée et s'installe comme un vrai logiciel
sur chaque ordinateur.
