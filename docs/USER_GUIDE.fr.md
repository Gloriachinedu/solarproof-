# Guide Utilisateur SolarProof — Administration de Coopérative

> **Audience :** Administrateurs et opérateurs d'énergie utilisant le tableau de bord SolarProof.  
> **Application :** [https://solarproof.vercel.app](https://solarproof.vercel.app)  
> **English version :** [USER_GUIDE.md](./USER_GUIDE.md)

---

## Table des matières

1. [Connexion du portefeuille](#1-connexion-du-portefeuille)
2. [Vue d'ensemble du tableau de bord](#2-vue-densemble-du-tableau-de-bord)
3. [Soumettre des relevés de compteurs](#3-soumettre-des-relevés-de-compteurs)
4. [Consulter les certificats](#4-consulter-les-certificats)
5. [Retirer des certificats](#5-retirer-des-certificats)
6. [Participer à la gouvernance](#6-participer-à-la-gouvernance)
7. [Vérifier un certificat](#7-vérifier-un-certificat)
8. [Administration de la coopérative](#8-administration-de-la-coopérative)
9. [Dépannage](#9-dépannage)

---

## 1. Connexion du portefeuille

SolarProof utilise [Freighter](https://www.freighter.app/) — un portefeuille Stellar pour navigateur.

**Prérequis**

- Extension Freighter installée ([freighter.app](https://www.freighter.app/))
- Freighter configuré sur **Testnet** (Paramètres → Réseau → Testnet)
- Votre compte Stellar avec au moins 1 XLM ([Friendbot Stellar](https://laboratory.stellar.org/#account-creator?network=test) pour le testnet)

**Étapes**

1. Ouvrez le tableau de bord SolarProof à `/dashboard`.
2. Cliquez sur **Connecter le portefeuille** en haut à droite.
3. Freighter vous demande d'approuver la connexion — cliquez sur **Approuver**.
4. Votre clé publique (ex. `GABC…XYZ`) s'affiche dans la barre de navigation.

**Déconnexion**

Cliquez sur votre clé publique dans la barre de navigation et sélectionnez **Déconnecter**.

---

## 2. Vue d'ensemble du tableau de bord

Naviguez vers **Tableau de bord** (`/dashboard`) pour voir un résumé en temps réel.

| Section | Contenu |
|---|---|
| **Énergie totale** | kWh cumulés sur tous les relevés vérifiés |
| **Certificats émis** | Nombre de tokens d'énergie frappés sur Stellar (1 token = 1 kWh) |
| **Certificats retirés** | Tokens définitivement brûlés |
| **Compteurs actifs** | Compteurs ayant signalé dans les dernières 24 heures |
| **Graphique de production journalière** | Graphique kWh sur les 14 derniers jours |
| **Tableau des relevés récents** | Les 20 derniers relevés avec badges de statut |

---

## 3. Soumettre des relevés de compteurs

### Via l'interface (page Compteurs)

1. Naviguez vers **Compteurs** (`/meters`).
2. Cliquez sur **Soumettre un relevé**.
3. Remplissez le formulaire :
   - **ID du compteur** — identifiant unique de votre appareil
   - **kWh** — énergie produite depuis le dernier relevé
   - **Horodatage** — par défaut maintenant ; ajustez si nécessaire
4. Cliquez sur **Soumettre**.

### Via l'API (compteurs automatisés / matériels)

```bash
node scripts/gen-meter-key.mjs
node scripts/send-reading.mjs --kwh 12.5 --meter-key ./meter-key.json
```

Voir [docs/API.md](./API.md) pour la spécification complète de `POST /api/readings`.

---

## 4. Consulter les certificats

1. Naviguez vers **Certificats** (`/certificates`).
2. Cliquez sur une ligne de certificat pour voir :
   - Le relevé source du compteur
   - Le hash de transaction Stellar
   - La signature Ed25519
   - Le hash d'ancrage dans le registre d'audit

---

## 5. Retirer des certificats

Le retrait d'un certificat brûle définitivement le token sur la blockchain. **Cette action est irréversible.**

1. Naviguez vers **Certificats** (`/certificates`).
2. Trouvez le certificat à retirer et cliquez sur **Retirer**.
3. Confirmez dans la boîte de dialogue.
4. Approuvez la transaction dans Freighter.

---

## 6. Participer à la gouvernance

### Consulter les propositions

1. Naviguez vers **Gouvernance** (`/governance`).

### Voter sur une proposition

1. Cliquez sur une proposition **Active**.
2. Cliquez sur **Voter Pour** ou **Voter Contre**.
3. Approuvez la transaction dans Freighter.

### Créer une proposition

1. Cliquez sur **Nouvelle Proposition**.
2. Remplissez le **Titre** et la **Description**.
3. Cliquez sur **Soumettre la Proposition**.

---

## 7. Vérifier un certificat

1. Naviguez vers **Vérifier** (`/verify`).
2. Entrez un **ID de certificat** ou un **hash de transaction Stellar**.
3. Cliquez sur **Vérifier**.

---

## 8. Administration de la coopérative

> **Audience :** Cette section est destinée aux utilisateurs ayant le rôle **Administrateur de Coopérative** (voir [docs/PERSONAS.md](./PERSONAS.md) — Persona Coopérative). Les opérateurs individuels n'ont pas accès à ces fonctionnalités.

Les fonctionnalités d'administration sont disponibles sous **Paramètres → Coopérative**.

---

### 8.1 Inviter des membres

Les administrateurs peuvent inviter de nouveaux opérateurs par e-mail.

**Étapes**

1. Naviguez vers **Paramètres → Coopérative → Membres**.
2. Cliquez sur **Inviter un membre**.
3. Entrez l'adresse **e-mail** du nouveau membre et optionnellement un **nom d'affichage**.
4. Cliquez sur **Envoyer l'invitation**.

L'utilisateur invité reçoit un e-mail avec un lien d'inscription. Une fois inscrit, il apparaît dans la liste des membres avec le badge **En attente**, qui passe à **Actif** après sa première connexion.

> **Placeholder de capture d'écran :** `docs/screenshots/10-invite-member.png`

**Gestion des membres existants**

| Action | Comment |
|---|---|
| Voir tous les membres | Paramètres → Coopérative → Membres |
| Supprimer un membre | Cliquer sur la ligne du membre → **Supprimer** → confirmer |
| Changer de rôle | Cliquer sur la ligne → **Modifier le rôle** (Administrateur / Opérateur) |

---

### 8.2 Consulter les statistiques de la coopérative

1. Naviguez vers **Paramètres → Coopérative → Statistiques**.
2. Utilisez les sélecteurs de **plage de dates** pour ajuster la fenêtre de rapport.
3. Utilisez le bouton **Granularité** pour basculer entre les vues journalière, mensuelle et annuelle.

| Section | Contenu |
|---|---|
| **Cartes résumé** | kWh total, certificats émis, certificats retirés, compteurs actifs |
| **Graphique de tendances** | kWh dans le temps selon la granularité sélectionnée |
| **Tableau par compteur** | Contribution de chaque compteur : kWh, nombre de relevés, dernière activité |

> **Placeholder de capture d'écran :** `docs/screenshots/11-coop-stats.png`

**Exporter les statistiques**

Cliquez sur **Exporter CSV** en haut à droite du tableau par compteur pour télécharger la vue courante en fichier CSV.

---

### 8.3 Suspendre un opérateur

Un administrateur peut suspendre un opérateur membre si celui-ci enfreint la politique de la coopérative ou si son appareil est compromis. Un opérateur suspendu ne peut plus soumettre de nouveaux relevés.

**Suspendre un opérateur**

1. Naviguez vers **Paramètres → Coopérative → Membres**.
2. Cliquez sur la ligne de l'opérateur pour ouvrir le panneau de détail.
3. Cliquez sur **Suspendre l'opérateur**.
4. Entrez une courte **raison** (obligatoire pour le journal d'audit).
5. Cliquez sur **Confirmer la suspension**.

La suspension est immédiate. Les relevés et certificats existants de l'opérateur ne sont pas affectés, mais toute nouvelle soumission de relevé sera rejetée avec une réponse `403 Forbidden`.

> **Placeholder de capture d'écran :** `docs/screenshots/12-suspend-operator.png`

**Lever une suspension**

1. Trouvez l'opérateur suspendu (badge **Suspendu**).
2. Cliquez sur sa ligne → **Lever la suspension** → confirmer.

**Piste d'audit**

Toutes les actions de suspension et de levée de suspension sont enregistrées dans le [Journal d'audit](#journal-daudit) sous les types d'événements `operator.suspended` et `operator.suspension_lifted`.

---

### 8.4 Journal d'audit

Le journal d'audit enregistre chaque action d'administration effectuée dans votre coopérative.

1. Naviguez vers **Paramètres → Coopérative → Journal d'audit**.
2. Utilisez le filtre **type d'événement** pour affiner les résultats.
3. Chaque ligne affiche : **horodatage**, **acteur**, **type d'événement** et **ressource concernée**.

---

*Guide révisé selon le persona Coopérative défini dans [docs/PERSONAS.md](./PERSONAS.md).*

---

## 9. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Le bouton "Connecter le portefeuille" ne répond pas | Freighter non installé | Installer depuis [freighter.app](https://www.freighter.app/) |
| Transaction échoue avec "fonds insuffisants" | Compte avec < 1 XLM | Utiliser [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) (testnet) |
| Le relevé reste en statut **En attente** | Échec de vérification de signature | Vérifier que la clé du compteur correspond à l'ID de compteur enregistré |
| Le certificat n'apparaît pas après le relevé | Délai de frappe ou frappe échouée | Vérifier la transaction Stellar dans le tableau de bord |
| Le vote de gouvernance n'est pas enregistré | Portefeuille non connecté ou mauvais réseau | Reconnecter Freighter en vous assurant d'être sur Testnet |

Pour toute aide supplémentaire, ouvrez un ticket sur [github.com/katecatherinaa/solarproof/issues](https://github.com/katecatherinaa/solarproof/issues).

---

*Contributeurs SolarProof 2026 · Apache-2.0*
