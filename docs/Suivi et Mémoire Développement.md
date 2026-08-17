# Suivi et Mémoire de Développement — Second Brain Manager

---

## 1. 📌 Synthèse & État Actuel du Projet

Le projet **Second Brain Manager** est un plugin Obsidian agentique et gamifié, respectant le principe fondamental : **les tâches restent exclusivement des tâches Markdown compatibles avec Obsidian Tasks**, sans base de données propriétaire ni fichiers de tâches isolés.

### 🌟 Ce qui est actuellement accompli et opérationnel :

1. **Socle & Moteur de Tâches (`TaskParser`, `TaskMutator`, `TaskIdentityResolver`)** :
   - Détection et parsing intégral des tâches Markdown checkbox.
   - Support des signifiants Obsidian Tasks : Échéance (`📅`), Début (`🛫`), Programmée (`⏳`), Réalisée (`✅`), Annulée (`❌`), Récurrence (`🔁`).
   - Support des tags normalisés : Énergie (`#energie/1-10`), Difficulté (`#difficulte/facile|moyenne|difficile`), Pièces (`#pieces/N`), Domaines (`#domaine/...`), Contextes (`#contexte/...`).
   - Mode de priorité configurable : Emojis Obsidian Tasks (`🔺 ⏫ 🔼 🔽 ⏬`) ou Tags hiérarchiques (`#priorite/haute`, `#priority/high` avec tag racine personnalisable).
   - Couche d'adaptation de matrice Eisenhower (`MatrixAdapter`) : Support de `TaskMatrix` (`#tm/qN`), `Focus First`, et tags personnalisés.
   - Modification chirurgicale en place des fichiers Markdown (`TaskMutator`) sans altérer le reste de la note.

2. **Système de Gamification & Portefeuille (`GamificationService`, `data.json`)** :
   - Écouteur automatique de complétion de tâches (`app.vault.on('modify')`).
   - Calcul des pièces explicites (`#pieces/N`) ou barème automatique (quadrants Q1: 8🪙, Q2: 4🪙, Q3: 2🪙, Q4: 1🪙 + bonus de difficulté).
   - Portefeuille persistant (`balance`, `lifetimeEarned`, `lifetimeSpent`).
   - Détection d'unicité par empreinte stable pour éviter les doubles attributions.
   - Révocation et remboursement des pièces en cas de missclick (`removeCompletion`).

3. **Vues & Ergonomie Utilisateur** :
   - **`DashboardView` (`sbm-dashboard-view`)** :
     - Jauge d'énergie interactive (1 à 10) et bascule de mode (Économie vs Pleine Énergie).
     - 4 sections de triage : *Aujourd'hui & Urgences*, *Recommandées selon votre énergie*, *Non classées dans la matrice*, *Boîte de réception (Inbox)*.
     - Barre de recherche en temps réel filtrant par titre, note ou tag.
     - Actions rapides : Démarrer (`🛫`), Terminer (`✅`), modification rapide de priorité par popover.
   - **`GamificationHistoryView` (`sbm-gamification-history-view`)** :
     - Onglet *Historique des Gains* avec recherche et bouton de remboursement/annulation.
     - Onglet *Statistiques Avancées* avec graphiques SVG natifs zéro-dépendance (Courbe d'évolution sur 14 jours, Donut des catégories avec pourcentages, Diagramme en barres quotidien).
   - **`ChatView` (`sbm-chat-view`)** :
     - Dialogue avec l'IA en flux continu (streaming SSE / ReadableStream) multi-fournisseurs (Gemini, OpenAI, Ollama, LM Studio).
     - Pacing progressif (Typewriter Queue à 16ms) avec curseur actif (`▌`) pour un déroulement mot à mot naturel.
     - Rendu Markdown compact sans grands espaces vides verticaux.

4. **Paramètres Natifs & Secret Storage (`SettingsPageManager`)** :
   - Architecture calquée sur le plugin officiel *Spaced Repetition* :
     - Page principale directe (`MainPage`) regroupant les `SettingGroup` natifs.
     - Sous-page dédiée pour le catalogue des récompenses (`RewardsPage`) avec ajout, édition des coûts et suppression.
     - Navigation 100% accessible au clavier (`tabindex="0"`, `Entrée` / `Espace`, `clickable-icon`, `chevron-right`).
   - Gestion sécurisée des clés d'API via l'API officielle `app.secretStorage` d'Obsidian (`SecretSelectModal`).
   - Affichage dynamique du champ de tag racine lorsque le mode de priorité `tag` est activé.

5. **Qualité & Tests Automatisés** :
   - Suite de tests unitaires Vitest : **10/10 tests passés avec succès** (100% de réussite).
   - Linting ESLint & Compilation ESBuild : **0 erreur, 0 avertissement**.

---

## 2. 📋 Feuille de Route : Ce qu'il reste à faire (alignement avec `Réflexion plugin.md`)

Pour répondre à l'intégralité des spécifications et ambitions du document [`Réflexion plugin.md`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/docs/R%C3%A9flexion%20plugin.md), voici la feuille de route détaillée par phases et composants :

### 🎯 Phase A : Workflows Dédiés (Briefing, Revue & Reprise)
1. **Workflow du Briefing du Matin (`MorningBriefingWorkflow` / Commande & Vue Dédiée)** :
   - Commande Obsidian : `Second Brain: Briefing du matin`.
   - Étape 1 : Lecture des tâches dues aujourd'hui, en retard, dont la date de début est atteinte, et récurrentes.
   - Étape 2 : Demande / confirmation du niveau d'énergie actuel.
   - Étape 3 : Sélection éventuelle d'un **projet prioritaire du jour** (ex: *« Aujourd'hui la priorité c'est le MFRB »*).
   - Étape 4 : Proposition d'un programme structuré de la journée (tâche principale, tâches secondaires, mode économie si énergie faible).
   - Étape 5 : Validation et application des dates de début / planification.

2. **Workflow de la Revue du Soir (`EveningReviewWorkflow` / Commande & Vue Dédiée)** :
   - Commande Obsidian : `Second Brain: Revue du soir`.
   - Comparaison des tâches prévues vs tâches terminées de la journée.
   - Traitement sans culpabilisation des tâches ouvertes : proposition de *reporter*, *découper*, *changer de quadrant*, *abandonner* ou *conserver*.
   - Proposition d'un « nettoyage mental / rangement du second cerveau » (classer les notes de l'Inbox, suggérer des liens entre notes).

3. **Workflow de Reprise après Pause (`RecoveryWorkflow`)** :
   - Commande Obsidian : `Second Brain: Reprendre après une pause`.
   - Détection de la durée écoulée depuis la dernière session.
   - Sélection courte et non intimidante : 1 tâche administrative rapide, 1 tâche importante, urgences réelles, et traitement des éléments Inbox.

---

### 🤖 Phase B : Actions et Intelligence Artificielle Avancée sur le Coffre
1. **Commandes Contextuelles d'Édition et Analyse de Notes** :
   - `Second Brain: Reformuler la note courante` (amélioration du style, clarté).
   - `Second Brain: Résumer la note courante` (synthèse exécutive).
   - `Second Brain: Extraire les tâches d'une note` (transformer les décisions de réunions en tâches Tasks avec dates et tags).
   - `Second Brain: Décomposer la tâche courante` (générer automatiquement des sous-tâches ordonnées avec estimation d'énergie et dates).
   - `Second Brain: Rechercher dans le coffre avec l'IA` (recherche contextuelle sur les notes et tâches du coffre).

2. **Boîte d'Aperçu et Validation Contrôlée (`ActionValidator`, `ActionExecutor`)** :
   - L'IA produit des propositions d'actions structurées en JSON.
   - Affichage d'un panneau d'aperçu clair avant toute modification sur le coffre :
     ```text
     3 modifications proposées :
     [x] Modifier la tâche « Préparer le dossier »
     [x] Ajouter 2 sous-tâches
     [x] Ajouter #energie/3 et #pieces/4
     [Appliquer]  [Modifier]  [Annuler]
     ```
   - Protection contre les écritures concurrentes et sauvegarde du contenu précédent.

---

### ⏰ Phase C : Moteur de Rappels & Notifications
1. **Architecture `NotificationProvider`** :
   - Fournisseur abstrait avec implémentation `DesktopNotificationProvider` (notifications système de l'OS) et `InAppNotificationProvider` (notices et badges Obsidian).
2. **Rappels Logiques & Anticipation** :
   - Rappel d'anticipation à J-3 avant une échéance (`📅`).
   - Rappels quotidiens des tâches programmées (`⏳`).
   - Détection des tâches obsolètes ou en souffrance.

---

### 🎮 Phase D : Gamification Avancée (XP, Niveaux & Trophées)
1. **Système d'Expérience (XP) & Niveaux de Productivité** :
   - Ajout d'une jauge d'XP en complément des pièces pour valoriser la régularité.
   - Calcul des séries de jours actifs (streaks).
2. **Trophées et Accomplissements** :
   - Déblocage de badges de succès (ex: *Première semaine complète*, *Maître du Q2*, *Zéro tâche en retard*).

---

### 🎙️ Phase E : Extensions Futures (Voix & Mobile)
1. **Capture et Journal Vocal (Phase 5 du document)** :
   - Enregistrement audio intégré et transcription locale (modèle Whisper local ou API).
   - Injection automatique de la transcription dans le chat ou la note quotidienne.
2. **Optimisation Mobile (Phase 6 du document)** :
   - Adaptation fine des tableaux de bord et des charts aux formats smartphones / tablettes.
   - Évaluation de solutions de notifications push distantes (ntfy / Gotify).

---

## 3. 📊 Tableau Récapitulatif d'Avancement

| Module / Fonctionnalité | Statut | Fichiers Clés |
|---|---|---|
| **Parsing Obsidian Tasks (Dates, Signifiants, Statuts)** | ✅ Terminé | `src/parsers/taskParser.ts` |
| **Mutation Chirurgicale Markdown** | ✅ Terminé | `src/mutators/taskMutator.ts` |
| **Adaptateur Matrice Eisenhower Multi-Plugins** | ✅ Terminé | `src/adapters/matrixAdapter.ts` |
| **Détection de Complétion & Portefeuille de Pièces** | ✅ Terminé | `src/services/gamificationService.ts` |
| **Révocation de Pièces / Anti-Missclick** | ✅ Terminé | `src/services/gamificationService.ts` |
| **Tableau de Bord & Barre de Recherche** | ✅ Terminé | `src/views/dashboardView.ts` |
| **Historique des Gains & Graphiques Statistiques (SVG)** | ✅ Terminé | `src/views/gamificationHistoryView.ts` |
| **Chat IA avec Streaming Progressif (Typewriter)** | ✅ Terminé | `src/services/llmService.ts`, `src/views/chatView.ts` |
| **Gestion Sécurisée des Clés API (Secret Storage)** | ✅ Terminé | `src/modals/secretSelectModal.ts` |
| **Panneau de Réglages Natif (Style Spaced Repetition)** | ✅ Terminé | `src/settings/` (`settingsPageManager.ts`, `mainPage.ts`, `rewardsPage.ts`) |
| **Workflow du Briefing du Matin (Projet Prioritaire & Énergie)** | ⏳ À faire | `src/workflows/morningBriefing.ts` |
| **Workflow de la Revue du Soir & Nettoyage Mental** | ⏳ À faire | `src/workflows/eveningReview.ts` |
| **Workflow de Reprise après Pause** | ⏳ À faire | `src/workflows/recoveryWorkflow.ts` |
| **Extraction de Tâches & Reformulation de Notes via IA** | ⏳ À faire | `src/services/noteActionsService.ts` |
| **Aperçu & Validation d'Actions Structurées IA** | ⏳ À faire | `src/services/actionExecutor.ts` |
| **Moteur de Rappels & Notifications Desktop** | ⏳ À faire | `src/services/reminderEngine.ts` |
| **Système d'XP, Niveaux & Trophées** | ⏳ À faire | `src/services/gamificationService.ts` |
| **Capture Vocale & Whisper Local** | ⏳ Futur | `src/services/voiceService.ts` |

---

## 4. 📝 Journal des Décisions Techniques

### 📅 2026-08-07 — Étape 1.1 : Structure Initiale & Modèles de Données
- **Décision** :
  1. Modèles `TaskItem` et `TaskSyntaxConfig` calqués sur la syntaxe canonique d'Obsidian Tasks.
  2. Création de `TaskParser` utilisant des expressions régulières robustes pour extraire dates, tags hiérarchiques et priorités.
- **Statut** : Validée.

### 📅 2026-08-07 — Étape 1.2 : Adaptateur Matrice Eisenhower
- **Décision** :
  1. Création de `MatrixAdapter` avec support extensible de TaskMatrix (`#tm/q1..4`), Focus First et Custom Tags.
- **Statut** : Validée.

### 📅 2026-08-07 — Étape 1.3 : Mutation Contrôlée de Tâches
- **Décision** :
  1. Création de `TaskMutator` pour ajouter, supprimer ou modifier des tags et dates sans corrompre le texte original.
- **Statut** : Validée.

### 📅 2026-08-07 — Étape 1.4 : Système de Gamification
- **Décision** :
  1. `GamificationService` avec détection automatique sur `app.vault.on('modify')`.
  2. Barème automatique et support explicite de `#pieces/N`.
  3. `GamificationHistoryView` avec annulation et graphiques SVG zéro-dépendance.
- **Statut** : Validée.

### 📅 2026-08-07 — Étape 1.5c : Architecture Équilibrée Spaced Repetition & Tag Racine Dynamique
- **Décision** :
  1. **Page Principale Directe & Complète** : Accès direct aux réglages essentiels (Général & Énergie, Dossiers du Coffre, Syntaxes & Priorités, Matrice Eisenhower, Agent IA & Secret Storage) avec les `SettingGroup` natifs.
  2. **Sous-Page Dédiée Récompenses** : Accès fluide via une ligne cliquable et navigable au clavier (`tabindex="0"`, `Enter`/`Space`) menant au catalogue de récompenses et au formulaire d'ajout, avec bouton de retour natif `<`.
  3. **Champ Dynamique du Tag Racine de Priorité** : Lorsque le mode de priorité `tag` est sélectionné, un champ textuel apparaît automatiquement pour personnaliser le préfixe racine (ex: `priorite` pour `#priorite/haute`, `priority` pour `#priority/high`).
- **Statut** : Terminée.

### 📅 Prochaine Étape Prioritaire : Gestion des Branches Git, Workflow CI/CD & Releases GitHub
- **Objectifs** :
  1. **Stratégie de Branches (Git Branching Model)** : Définition d'une convention de branches (`main` pour les versions stables/publiées, `develop` ou `feature/...` pour les développements actifs).
  2. **Workflow GitHub Actions (CI/CD)** : Automatisation du linting, des tests unitaires Vitest et de la compilation lors des pushs et pull requests.
  3. **Gestion des Releases & Tags Git (`vX.Y.Z`)** : Automatisation de la publication des releases officielles avec synchronisation du `manifest.json`, génération automatique des assets de distribution (`main.js`, `manifest.json`, `styles.css`) et changelog.


### 📅 2026-08-17 — Étape 3.4 : Expérience Utilisateur Copilot-like, Édition In-Place & Cadre Intégré Fluide
- **Décision & Actions Réalisées** :
  1. **Résolution Définitive des Liens Wikilinks Non Cliquables** :
     - Cause identifiée : Le modèle entourait parfois les wikilinks d'accents graves (ex: `\`[[Claire]]\``), ce que le Markdown d'Obsidian traite en bloc `<code>` littéral non cliquable.
     - Correction : Nettoyage automatique en amont (`cleanWikilinkSyntax`) éliminant les backticks superflus, interdiction explicite dans le prompt système, et gestion des clics universelle dans le conteneur du chat sur tous les éléments contenant `[[...]]`.
  2. **Édition de Message In-Place & Régénération d'Arborescence d'Historique** :
     - Cliquer sur le bouton crayon ✏️ transforme directement la bulle du message utilisateur en un éditeur en ligne (`sbm-inline-edit-box`) avec boutons `[Enregistrer et soumettre]` et `[Annuler]`.
     - Lors de la soumission, l'historique de discussion est automatiquement tronqué à partir de cette position (`messages.splice(i + 1)`), et une nouvelle réponse de l'assistant est générée et streamée à partir de ce nouveau point de départ.
  3. **Suppression Universelle de Messages (Utilisateur & Assistant)** :
     - Chaque bulle dispose d'un bouton poubelle 🗑️ fonctionnel permettant de supprimer un message individuel et de synchroniser instantanément l'historique.
  4. **Cadre de Saisie Intégré & Fluide (Copilot Style)** :
     - Remplacement de la double bordure par une carte unique élégante (`sbm-chat-input-card`), intégrant la barre de contexte `@ Add context`, les pilules actives, la zone de texte fluide et la barre d'outils inférieure (`+`, modèle actif, bouton flèche `↑`).
  5. **Qualité & Tests** : **36/36 tests unitaires réussis**, 0 erreur et 0 avertissement ESLint.
- **Statut** : Validée.





