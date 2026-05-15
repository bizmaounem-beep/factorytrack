# Fiche Technique : Application AgroSync

Cette fiche technique détaille l'état actuel de l'application AgroSync (également référencée en interne sous le nom PILOTCLOUD), une plateforme industrielle de suivi de production et de gestion des arrêts machine.

## 1. Architecture Globale (Full-Stack)

L'application repose sur une architecture moderne monolithique, optimisée pour un déploiement local (Edge Computing) sans dépendance critique à internet.

*   **Frontend (Interface Utilisateur) :**
    *   **Framework :** React 18+ avec TypeScript.
    *   **Styling :** Tailwind CSS pour une interface responsive et ultra-rapide.
    *   **Animations :** Motion pour les transitions fluides (feedback visuel critique en milieu industriel).
    *   **Packaging Mobile :** Intégration Capacitor pour transformer l'application web en application native Android (APK).
*   **Backend (Serveur) :**
    *   **Runtime :** Node.js avec Express.
    *   **Langage :** TypeScript (transpilé en CJS pour la production via esbuild).
    *   **Communication temps réel :** Socket.io pour la synchronisation immédiate des compteurs de production et des états machines entre tous les terminaux.
*   **Base de Données :**
    *   **Moteur :** SQLite (via `better-sqlite3`).
    *   **Avantages :** Zéro configuration, haute performance en lecture/écriture, stockage dans un fichier unique (`data.db`) facilitant les sauvegardes.
    *   **Mode WAL :** Journalisation en mode "Write-Ahead Logging" active pour maximiser la stabilité lors d'écritures concurrentes.

## 2. Infrastructure Physique (Déploiement NUC)

L'application est conçue pour tourner en autonomie totale sur un mini-ordinateur de type NUC.

*   **Environnement :** Serveur sous Linux (Debian/Ubuntu).
*   **Serveur de Processus (PM2) :**
    *   L'application est gérée par PM2 pour assurer un redémarrage automatique en cas de crash ou après une coupure de courant.
    *   Commande de monitoring : `pm2 status`, `pm2 logs`.
*   **Réseau Local :**
    *   Le NUC agit comme serveur central relié à un routeur Wi-Fi industriel.
    *   Les tablettes des opérateurs se connectent à l'adresse IP statique du NUC sur le port 3000.
*   **Résilience Électrique :** Grâce à SQLite et PM2, le système est "crash-proof". En cas de coupure de courant, les données sont persistées sur disque et le serveur redémarre dès le rétablissement de l'alimentation sans intervention humaine.

## 3. Système d'Authentification et Sécurité

Le système a migré d'un mode "PIN seul" vers un mode "Identifiant + Mot de passe" pour renforcer la traçabilité.

*   **Identification :** Les utilisateurs disposent d'un identifiant unique (Ex: `nom.user`) et d'un mot de passe complexe.
*   **Hachage (Bcrypt) :** Aucun mot de passe n'est stocké en clair. Utilisation de Bcrypt (10 rounds de sel) pour garantir que les données restent sécurisées même si le fichier `data.db` est récupéré.
*   **Migration Héritée :** Un système de migration temporaire permet aux anciens utilisateurs de se connecter via leur PIN pour configurer leurs nouveaux identifiants sécurisés (Page 'Security Initialization').
*   **Protections :**
    *   **Rate Limiting :** Protection contre les attaques par force brute (max 5 tentatives par minute par IP).
    *   **Sanitization :** Toutes les entrées utilisateur sont nettoyées pour prévenir les injections SQL.
    *   **Helmet :** En-têtes HTTP sécurisés activés.

## 4. Gestion des Données (data.db)

La base de données est structurée pour capturer chaque événement de production avec précision.

*   **Tables Principales :**
    *   `users` : Gestion des rôles (ADMIN, PILOTE, OPERATEUR).
    *   `machines` / `lines` : Configuration de l'atelier.
    *   `programmes` : Ordres de fabrication (OF) actifs, incluant les paramètres techniques.
    *   `production_logs` : Horodatage précis de chaque unité (palette) produite.
    *   `downtime_logs` : Enregistrement des arrêts (Heure début, Heure fin, Durée, Type d'arrêt via `downtime_types`).
    *   `shifts` : Définition des équipes (Matin, Après-midi, Nuit) pour le calcul automatique des performances par cycle.
*   **Sauvegardes :** Le serveur effectue une copie de sauvegarde automatique (`data_backup.db`) toutes les 24 heures et à chaque redémarrage du serveur.

## 5. Procédure de Déploiement Mobile (APK)

Pour générer une nouvelle version de l'application sur les tablettes Android :

1.  **Build Web :** Exécuter `npm run build` pour générer les fichiers statiques dans `/dist`.
2.  **Synchronisation Capacitor :** Exécuter `npx cap sync` pour copier le build web dans le projet Android.
3.  **Android Studio :**
    *   Ouvrir le dossier `/android` dans Android Studio.
    *   Aller dans `Build > Build Bundle(s) / APK(s) > Build APK(s)`.
    *   Installer le fichier `.apk` généré sur les tablettes via USB ou via le réseau local.

---
*Fin de la fiche technique - Version 2.1 (Migration Sécurité Complétée)*
