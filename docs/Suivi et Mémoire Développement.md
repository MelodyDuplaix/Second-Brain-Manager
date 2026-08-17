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

### 📅 2026-08-17 — Étape 3.2 : Audit Sécurité, Fiabilité, Normalisation des Chemins & Guidelines Obsidian
- **Décision & Actions Réalisées** :
  1. **Sécurité (Éradication de `innerHTML`)** : Création du module `DomUtils` (`src/utils/domUtils.ts`) permettant la génération programmatique des éléments SVG (courbes d'évolution, camemberts donut, histogrammes) sans aucune injection de chaînes HTML brutes.
  2. **Fiabilité & Atomicité (`Vault.process`)** : Remplacement de tous les blocs `vault.read` + `vault.modify` par `this.app.vault.process()` dans `DashboardView` et `BriefingView` pour éliminer les risques de *race condition*.
  3. **Annulation et Résilience Réseau (`AbortController`)** : Intégration d'un signal d'interruption dans `LLMService` et `ChatView`, permettant l'annulation instantanée du streaming via le bouton d'interface ou la fermeture d'onglet (`onClose`).
  4. **Nettoyage du Code Mort** : Suppression des 5 fichiers orphelins (`aiPage.ts`, `generalPage.ts`, `matrixPage.ts`, `syntaxPage.ts`, `editMetaModal.ts`).
  5. **Normalisation des Chemins & Guidelines** : Application systématique de `normalizePath()` sur les dossiers Inbox, Journal et chemins de fichiers. Suppression de tous les `console.log` superflus et harmonisation des libellés UI en *Sentence case*.
  6. **Tests Unitaires & Couverture** : Extension de la suite de tests Vitest avec couverture complète de `DynamicRegexBuilder`, `MatrixAdapter`, `TaskMutator` et `TaskParser`.
- **Statut** : Validée.

### 📅 2026-08-17 — Étape 3.3 : Outils Agentiques (Tools), RAG Contextuel & Boîte d'Aperçu Interactive
- **Décision & Actions Réalisées** :
  1. **Modèles d'Actions & Outils (`src/models/actions.ts`)** : Typage complet des propositions d'actions (`create_note`, `append_to_note`, `create_task`, `update_task`, `decompose_task`, `link_notes`, `move_note`) et des schémas d'outils.
  2. **Moteur RAG & Cartographie du Coffre (`VaultContextService`)** : Recherche pondérée dans les notes, découverte des backlinks et outlinks (`[[...]]`), recherche avancée des tâches Tasks et extraction de l'arborescence des projets, contacts et domaines.
  3. **Registre d'Outils & Multi-Fournisseurs (`ToolRegistry`)** : Définition des schémas JSON compatibles OpenAI/Ollama, déclarations de fonctions Gemini, et exécution sécurisée des requêtes d'outils.
  4. **Exécuteur Atomique Sécurisé (`ActionExecutor`)** : Exécution des actions validées par l'utilisateur via `app.vault.process()` et `app.fileManager.renameFile()` garantissant l'intégrité des liens.
  5. **Widget d'Aperçu Interactif (`ActionPreviewWidget`)** : Affichage soigné dans le chat avec cases à cocher `[x]`, badges de statut et bouton `[Tout Appliquer]`.
- **Statut** : Validée.

### 📅 2026-08-17 — Étape 3.4 : Expérience Utilisateur Copilot-like, Édition In-Place, Liens Cliquables & Audit
- **Décision & Actions Réalisées** :
  1. **Résolution Définitive des Liens Wikilinks Non Cliquables** :
     - Cause identifiée : Le modèle entourait parfois les wikilinks d'accents graves (ex: `\`[[Claire]]\``), ce que le Markdown d'Obsidian traite en bloc `<code>` littéral non cliquable.
     - Correction : Nettoyage automatique en amont (`cleanWikilinkSyntax`) éliminant les backticks superflus, interdiction explicite dans le prompt système, et gestion des clics universelle dans le conteneur du chat sur tous les éléments contenant `[[...]]`.
  2. **Boucle Agentique Autonome (ReAct)** : Fin des doubles messages pour demander d'analyser le coffre. L'agent exécute automatiquement les outils de lecture en arrière-plan et synthétise directement la réponse en 1 tour.
  3. **Filtrage du JSON Brut & Indicateur de Réflexion Discret** : Aucun bloc JSON technique affiché en streaming. Présentation d'un spinner discret à 3 points (*dots wave*) indiquant l'action en cours (`🔍 Recherche dans le coffre : "Claire"...`).
  4. **Édition de Message In-Place & Régénération d'Arborescence** : Cliquer sur le crayon ✏️ permet d'éditer directement le message dans la bulle avec mise à jour et régénération de la suite de l'historique.
  5. **Suppression Universelle de Messages (Utilisateur & Assistant)** : Bouton poubelle 🗑️ fonctionnel sur chaque message.
  6. **Cadre de Saisie Intégré & Fluide (Copilot Style)** : Suppression de la double bordure pour une carte unique épurée (`sbm-chat-input-card`), avec barre de contexte `@ Add context`, détection de note active, champ transparent et barre d'outils inférieure.
  7. **Découverte Dynamique & Auto-Sélection de Modèles (`ModelDiscoveryService` & Settings)** :
     - Interrogation en temps réel des APIs de modèles (Google Gemini API `/v1beta/models`, OpenAI `/v1/models`, Ollama `/api/tags`, LM Studio `/v1/models`).
     - Menu déroulant `<select>` dynamique dans les réglages du plugin avec bouton `🔄 Détecter via API` et saisie personnalisée.
     - Prise en charge automatique de **tous** les modèles actuels et futurs (dont `gemini-3.5-flash`, `gemini-3.5-pro`, `gemini-2.5-flash`, `gpt-4o`, `o3-mini`, etc.).
  8. **Widgets de Tâches Interactifs & Remplacement In-Place dans le Message (`TaskCardWidget`)** :
     - **Intégration In-Place au cœur du flux Markdown** : Les éléments de liste (`<li>`) de tâches sont directement transformés et remplacés à leur position exacte dans le texte (sous les sous-titres, catégories ou dates où l'agent les cite) au lieu d'être relégués en bas du message.
     - **Cochage & Récompenses réelles** : Cocher la case met à jour la note dans le coffre (`app.vault.process`) et crédite instantanément les pièces 🪙 dans le profil de gamification.
     - **Édition Inline Complète** : Clic direct sur n'importe quel badge pour modifier l'échéance 📅, l'énergie ⚡ (1-10), le quadrant de matrice `#Q1/#Q4`, la priorité ou le montant de pièces avec répercussion immédiate dans la note.
     - Boutons d'action instantanés : `[ 🚀 Commencer ]`, `[ ✅ Terminer ]`, `[ ⏩ Reporter à demain ]` et `[ 🔗 Ouvrir la note à la ligne exacte ]`.
  9. **Cadrage du Prompt Agentique (Consultation vs Modification)** :
     - L'agent ne propose plus de modifications agressives lors des simples questions de planning ou d'information du jour.
     - Les propositions d'écriture (`propose_create_task`, `propose_update_task`) sont réservées aux demandes explicites d'actions ou comptes-rendus de réunion.
  10. **Audit de Conformité & Tests** : **38/38 tests unitaires passés avec succès à 100% (8 suites de tests)**, 0 erreur et 0 avertissement ESLint, respect strict des guidelines Obsidian.
- **Statut** : Validée.

### 📅 Prochaine Étape Prioritaire : Gestion des Branches Git, Workflow CI/CD & Releases GitHub
- **Objectifs** :
  1. **Stratégie de Branches (Git Branching Model)** : Définition d'une convention de branches (`main` pour les versions stables/publiées, `develop` ou `feature/...` pour les développements actifs).
  2. **Workflow GitHub Actions (CI/CD)** : Automatisation du linting, des tests unitaires Vitest et de la compilation lors des pushs et pull requests.
  3. **Gestion des Releases & Tags Git (`vX.Y.Z`)** : Automatisation de la publication des releases officielles avec synchronisation du `manifest.json`, génération automatique des assets de distribution (`main.js`, `manifest.json`, `styles.css`) et changelog.






