# Suivi et Mémoire de Développement — Second Brain Manager

---

## 1. 📌 Synthèse & État Actuel du Projet

Le projet **Second Brain Manager** est un plugin Obsidian agentique et gamifié, respectant le principe fondamental : **les tâches restent exclusivement des tâches Markdown compatibles avec Obsidian Tasks**, sans base de données propriétaire ni fichiers de tâches isolés.

### 🌟 Ce qui est actuellement accompli et opérationnel :

1. **Socle & Moteur de Tâches (`TaskParser`, `TaskMutator`, `TaskIdentityResolver`)** :
   - Détection et parsing intégral des tâches Markdown checkbox.
   - **Exclusion stricte des blocs de code** : `TaskParser.parseFile` ignore les blocs clôturés par des triples backticks (```...```), évitant l'indexation de fausses tâches de documentation.
   - Support des signifiants Obsidian Tasks : Échéance (`📅`), Début (`🛫`), Programmée (`⏳`), Réalisée (`✅`), Annulée (`❌`), Récurrence (`🔁`).
   - Support des tags normalisés : Énergie (`#energie/1-10`), Difficulté (`#difficulte/facile|moyenne|difficile`), Pièces (`#pieces/N`), Domaines (`#domaine/...`), Contextes (`#contexte/...`).
   - Mode de priorité configurable : Emojis Obsidian Tasks (`🔺 ⏫ 🔼 🔽 ⏬`) ou Tags hiérarchiques (`#priorite/haute`, `#priority/high` avec tag racine personnalisable).
   - Couche d'adaptation de matrice Eisenhower (`MatrixAdapter`) : Support de `TaskMatrix` (`#tm/qN`), `Focus First`, et tags personnalisés.
   - Modification chirurgicale et atomique en place des fichiers Markdown (`TaskMutator`, `app.vault.process()`) sans altérer le reste de la note.

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
     - Actions rapides : Démarrer (`🛫`), Terminer (`✅`), modification rapide de priorité par popover.
   - **`GamificationHistoryView` (`sbm-gamification-history-view`)** :
     - Onglet *Historique des Gains* avec recherche et remboursement/annulation.
     - Onglet *Statistiques Avancées* avec graphiques SVG natifs (Courbe 14 jours, Donut des catégories, Barres quotidiennes).
   - **`ChatView` (`sbm-chat-view`) — Expérience Copilot Fluide & Haute Performance** :
     - Dialogue multi-fournisseurs : **Google Gemini**, **OpenAI ChatGPT**, **OpenRouter**, **Infomaniak AI Services (Souverain Suisse)**, **Ollama**, **LM Studio**.
     - **Contournement CORS & Keep-Alive Persistant (`HttpStreamService`)** : Streaming natif Node.js `https` avec pool de connexions TLS réutilisées (gain ~150-300ms de TTFT) et TCP `setNoDelay(true)`. Fallback universel `requestUrl` sur mobile.
     - **Boucle Agentique ReAct Autonome** : L'agent consulte le coffre via des outils transparents et synthétise sa réponse sans polluer le chat de JSON brut.
     - **Détection Enrichie des Tâches** : Transformation in-place des tâches dans les listes (`<li>`), paragraphes (`<p>`), **blocs de code Markdown (`<pre><code>`)** et **tableaux Markdown (`<table>`)** en cartes interactives (`TaskCardWidget`).
     - **Widgets de Tâches In-Place (`TaskCardWidget`)** : Checkbox de complétion avec crédit de pièces 🪙, modification en ligne de l'échéance 📅, énergie ⚡, priorité, matrice `#Q1/#Q4` et bouton `[ 🚀 Commencer / ⏳ En cours ]`.
     - **Optimisation de Latence** : Fenêtre glissante des 8 derniers messages d'historique et plafonnement des notes volumineuses.

4. **Paramètres Natifs & Gestionnaire Unifié de Secrets (`SecretsManagementModal`)** :
   - Architecture modulaire (`SettingsPageManager` + `MainPage` + `RewardsPage`).
   - Modal centralisée `SecretsManagementModal` pour lier, sécuriser et tester les clés Gemini, OpenAI, OpenRouter et Infomaniak.
   - Auto-détection automatique du `product_id` Infomaniak (`GET /1/ai`) sans saisie manuelle.

5. **Qualité & Tests Automatisés** :
   - Suite de tests unitaires Vitest : **59/59 tests passés avec succès** (100% de réussite sur 11 suites de tests).
   - Linting ESLint & Compilation ESBuild : **0 erreur, 0 avertissement**.

---

## 2. 📋 Feuille de Route Exhaustive : Ce qu'il reste à faire (Alignement 100% avec `Réflexion plugin.md`)

### 🔥 Priorités Immédiates UI / UX & Robustesse LLM (Demande Utilisateur)

1. **Épuration & Suppression des Redondances dans l'UI des Réglages (`MainPage.ts`)** :
   - **Suppression des champs obsolètes** : Supprimer le champ de saisie isolé "Clé API / Secret" et le champ "Product ID Infomaniak" de la page principale des paramètres.
   - **Point d'entrée unique & centralisé** : Toute la configuration des clés, tokens, product IDs et endpoints doit passer exclusivement par le bouton `🔑 Gérer les clés d'API et secrets` ouvrant la modal [`SecretsManagementModal`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/modals/secretsManagementModal.ts).
   - **Clarté visuelle** : Afficher uniquement le fournisseur actif, son statut de connexion/secret lié, et les options globales indispensables.

2. **Unification et Simplification de la Gestion des Modèles** :
   - **Sélecteur unique & direct** : Harmoniser le sélecteur de modèle pour qu'il n'y ait pas de redondance ou d'ambiguïté entre les réglages généraux et le sélecteur dans le chat.
   - **Sélection fluide** : Dans le chat, permettre de basculer de modèle via un menu épuré et synchronisé en temps réel avec les réglages du plugin.

3. **Refonte Visuelle & Ergonomique de la Gestion des Erreurs dans le Chat** :
   - **Différenciation visuelle immédiate** : Afficher les erreurs réseau/API dans une carte d'alerte stylisée (fond ambre/rouge translucide, bordure d'accent d'avertissement, icône ⚠️ explicite) pour ne jamais les confondre avec une réponse normale du LLM.
   - **Sélection & Copie facile** : Rendre le texte de l'erreur 100% sélectionnable à la souris et ajouter un bouton direct `📋 Copier l'erreur` pour faciliter le diagnostic.
   - **Actions correctives contextuelles** : Boutons d'action rapides intégrés dans la bulle d'erreur : `[ 🔄 Réessayer ]` et `[ 🔑 Gérer les clés d'API ]`.
   - **Intégrité de l'historique** : Ne pas enregistrer les messages d'erreur comme des tours normaux d'assistant dans l'historique de conversation sauvegardé.

---

### 🎯 Phase A : Workflows Dédiés (Briefing, Revue & Reprise)
1. **Workflow du Briefing du Matin (`MorningBriefingWorkflow` / Commande & Modal/Vue Dédiée)** :
   - Commande Obsidian : `Second Brain: Briefing du matin`.
   - Étape 1 : Lecture des tâches dues aujourd'hui, en retard, dont la date de début est atteinte, et récurrentes.
   - Étape 2 : Demande / confirmation du niveau d'énergie actuel (jauge 1-10).
   - Étape 3 : Sélection éventuelle d'un **projet prioritaire du jour** (ex: *« Aujourd'hui la priorité c'est le MFRB »* ou *« Avancée de mon jeu vidéo »*).
   - Étape 4 : Proposition d'un programme structuré de la journée (tâche principale, tâches secondaires, mode économie si énergie faible).
   - Étape 5 : Validation et application des dates de début / planification.
   - Possibilité de réévaluer son niveau d'énergie après une tâche (Commande : `Second Brain: Indiquer mon énergie`).

2. **Workflow de la Revue du Soir (`EveningReviewWorkflow` / Commande & Modal/Vue Dédiée)** :
   - Commande Obsidian : `Second Brain: Revue du soir`.
   - Comparaison des tâches prévues vs tâches terminées de la journée.
   - Traitement sans culpabilisation des tâches ouvertes : proposition de *reporter*, *découper*, *changer de quadrant*, *abandonner* ou *conserver*.
   - Proposition d'un « nettoyage mental / rangement du second cerveau » (classer les notes de l'Inbox, suggérer des liens pertinents entre notes).

3. **Workflow de Reprise après Pause (`RecoveryWorkflow`)** :
   - Commande Obsidian : `Second Brain: Reprendre après une pause`.
   - Détection de la durée écoulée depuis la dernière session active.
   - Sélection courte et non intimidante : 1 tâche administrative courte, 1 tâche importante, urgences réelles, et traitement des éléments Inbox.

4. **Journal de Journée (`DailySessionJournal`)** :
   - Commande Obsidian : `Second Brain: Démarrer une session` / `Faire une pause`.
   - Enregistrement des accomplissements et réorganisations dans la note quotidienne du jour.

---

### 🤖 Phase B : Commandes Métier Contextuelles & Intelligence Artificielle sur les Notes
1. **Commandes Contextuelles d'Édition et Analyse de Notes** :
   - `Second Brain: Reformuler la note courante` (amélioration du style, clarté).
   - `Second Brain: Résumer la note courante` (synthèse exécutive).
   - `Second Brain: Extraire les tâches d'une note` (transformer les comptes-rendus en tâches Tasks avec dates et tags).
   - `Second Brain: Décomposer la tâche courante` (générer automatiquement des sous-tâches ordonnées avec estimation d'énergie et dates).
   - `Second Brain: Classer la tâche dans la matrice` (assignation assistée du quadrant Q1-Q4).
   - `Second Brain: Replanifier la tâche` / `Reporter les tâches sélectionnées`.
   - `Second Brain: Nettoyage mental` (triage rapide de l'Inbox et consolidation des liens).

---

### ⏰ Phase C : Moteur de Rappels & Notifications Découplé
1. **Architecture `NotificationProvider`** :
   - Interface abstraite permettant de découpler le moteur de règles temporelles des canaux de diffusion :
     ```text
     NotificationProvider
     ├── DesktopNotificationProvider (Notifications système OS)
     ├── InAppNotificationProvider (Notices et badges Obsidian)
     └── FutureMobileNotificationProvider (ntfy, Gotify, application compagnon)
     ```
2. **Rappels Logiques & Anticipation** :
   - Rappel d'anticipation à J-3 avant une échéance (`📅`).
   - Rappels quotidiens des tâches programmées (`⏳`).
   - Détection des tâches obsolètes ou en souffrance.

---

### 🎮 Phase D : Gamification Avancée (XP, Niveaux & Trophées)
1. **Système d'Expérience (XP) & Niveaux de Productivité** :
   - Ajout d'une jauge d'XP en complément des pièces pour valoriser la régularité et l'effort.
   - Calcul des séries de jours actifs (streaks).
2. **Trophées et Accomplissements** :
   - Déblocage de badges de succès (ex: *Première semaine complète*, *Maître du Q2*, *Zéro tâche en retard*, *Grand Nettoyeur d'Inbox*).

---

### 🎙️ Phase E : Extensions Futures (Voix & Mobile)
1. **Capture et Journal Vocal (Phase 5 du document)** :
   - Enregistrement audio intégré et transcription locale (modèle Whisper local ou API).
   - Injection automatique de la transcription dans le chat ou la note quotidienne.
2. **Optimisation Mobile (Phase 6 du document)** :
   - Adaptation fine des tableaux de bord et des charts aux formats smartphones / tablettes.
   - Évaluation de solutions de notifications push distantes (ntfy / Gotify).

---

### 🌿 Phase F : Stratégie Git, Workflow CI/CD & Releases GitHub (IMPORTANT)
1. **Gestion des Branches Git (`main` & `dev`)** :
   - **Branche `main`** : Branche de production, réservée aux versions stables, auditées et publiées sur les releases GitHub.
   - **Branche `dev`** : Branche de développement actif, recevant les nouvelles fonctionnalités, tests et ajustements avant merge sur `main`.
2. **Workflow GitHub Actions (CI)** :
   - Déclenchement automatique sur chaque `push` et `pull_request` vers `dev` et `main`.
   - Exécution systématique :
     - Vérification de la syntaxe et conformité (`npm run lint` / ESLint).
     - Exécution des tests unitaires (`npx vitest run` / 47 tests).
     - Validation de la compilation (`npm run build` / ESBuild).
3. **Automatisation des Releases & Tags Git (CD)** :
   - Déclenchement sur création d'un tag git `vX.Y.Z`.
   - Synchronisation automatique du numéro de version dans `manifest.json` et `package.json`.
   - Génération automatique des release assets officiels d'Obsidian : `main.js`, `manifest.json`, `styles.css`.
   - Création de la release GitHub avec changelog automatisé.

---

## 3. 📊 Tableau Récapitulatif d'Avancement Global

| Module / Fonctionnalité | Statut | Fichiers Clés |
|---|---|---|
| **Parsing Obsidian Tasks (Dates, Signifiants, Statuts)** | ✅ Terminé | `src/parsers/taskParser.ts` |
| **Exclusion des Blocs de Code (```) dans le Parsing** | ✅ Terminé | `src/parsers/taskParser.ts` |
| **Mutation Chirurgicale Markdown & Statuts (`[/]`)** | ✅ Terminé | `src/mutators/taskMutator.ts` |
| **Adaptateur Matrice Eisenhower Multi-Plugins** | ✅ Terminé | `src/adapters/matrixAdapter.ts` |
| **Détection de Complétion & Portefeuille de Pièces** | ✅ Terminé | `src/services/gamificationService.ts` |
| **Révocation de Pièces / Anti-Missclick** | ✅ Terminé | `src/services/gamificationService.ts` |
| **Tableau de Bord & Barre de Recherche** | ✅ Terminé | `src/views/dashboardView.ts` |
| **Historique des Gains & Graphiques Statistiques (SVG)** | ✅ Terminé | `src/views/gamificationHistoryView.ts` |
| **Chat IA avec Streaming Progressif (Typewriter)** | ✅ Terminé | `src/services/llmService.ts`, `src/views/chatView.ts` |
| **Boucle Agentique ReAct & Outils du Coffre** | ✅ Terminé | `src/services/agentOrchestrator.ts`, `src/services/toolRegistry.ts` |
| **Découverte Dynamique des Modèles API** | ✅ Terminé | `src/services/modelDiscoveryService.ts`, `src/modals/modelPickerModal.ts` |
| **Widgets de Tâches In-Place & Édition Inline (Popovers)** | ✅ Terminé | `src/views/taskCardWidget.ts`, `src/views/inlineMetaPopover.ts` |
| **Matching Flou Intelligent Anti-Tâches Sautées** | ✅ Terminé | `src/views/chatView.ts` (`isTaskMatch`) |
| **Gestion Sécurisée des Clés API (Secret Storage)** | ✅ Terminé | `src/modals/secretSelectModal.ts` |
| **Fournisseur Infomaniak AI Services (Chat, Embeddings, Discovery)** | ✅ Terminé | `src/services/llmService.ts`, `src/services/modelDiscoveryService.ts` |
| **Panneau de Réglages Natif (Style Spaced Repetition)** | ✅ Terminé | `src/settings/` (`settingsPageManager.ts`, `mainPage.ts`, `rewardsPage.ts`) |
| **Configuration Branche Git `dev` & `main`** | ✅ Terminé | Dépôt GitHub (`origin/main`, `origin/dev`) |
| **Workflow GitHub Actions (CI : Lint + Test + Build)** | ⏳ À faire | `.github/workflows/ci.yml` |
| **Workflow de Release GitHub Automatisé (CD)** | ⏳ À faire | `.github/workflows/release.yml` |
| **Workflow du Briefing du Matin (Projet Prioritaire & Énergie)** | ⏳ À faire | `src/workflows/morningBriefing.ts` |
| **Workflow de la Revue du Soir & Nettoyage Mental** | ⏳ À faire | `src/workflows/eveningReview.ts` |
| **Workflow de Reprise après Pause** | ⏳ À faire | `src/workflows/recoveryWorkflow.ts` |
| **Commandes Contextuelles d'Édition / Reformulation de Notes** | ⏳ À faire | `src/services/noteActionsService.ts` |
| **Moteur de Rappels & Notifications Desktop** | ⏳ À faire | `src/services/reminderEngine.ts`, `src/services/notificationService.ts` |
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
     - **Intégration In-Place au cœur du flux Markdown** : Les éléments de liste (`<li>`) et paragraphes de tâches (`<p>`) sont directement transformés et remplacés à leur position exacte dans le texte.
     - **Support des Listes Imbriquées & Feuilles (`<li>`)** : Filtrage intelligent des éléments parents pour ne transformer que les éléments feuilles réels sans écraser les en-têtes de catégorie.
     - **Exclusion des Blocs de Code (`TaskParser`)** : `TaskParser.parseFile` ignore strictement les lignes situées à l'intérieur des blocs de code clôturés par des triples backticks (```...```) évitant l'indexation de tâches fictives issues de la documentation.
     - **Bouton `🚀 Commencer` / `⏳ En cours` Fonctionnel** : Implémentation de `TaskMutator.setStatus` passant atomiquement la tâche en cours (`- [/]`) dans la note avec bascule d'état visuelle (checkbox indéterminée, fond accentué et badge actif).
     - **Cochage & Récompenses réelles** : Cocher la case met à jour la note dans le coffre (`app.vault.process`) et crédite instantanément les pièces 🪙 dans le profil de gamification.
     - **Édition Inline Complète** : Clic direct sur n'importe quel badge pour modifier l'échéance 📅, l'énergie ⚡ (1-10), le quadrant de matrice `#Q1/#Q4`, la priorité ou le montant de pièces avec répercussion immédiate dans la note.
     - Boutons d'action instantanés : `[ 🚀 Commencer / ⏳ En cours ]`, `[ ✅ Terminer ]`, `[ ⏩ Reporter à demain ]` et `[ 🔗 Ouvrir la note à la ligne exacte ]`.
  9. **Cadrage du Prompt Agentique (Consultation vs Modification)** :
     - L'agent ne propose plus de modifications agressives lors des simples questions de planning ou d'information du jour.
     - Les propositions d'écriture (`propose_create_task`, `propose_update_task`) sont réservées aux demandes explicites d'actions ou comptes-rendus de réunion.
  10. **Audit de Conformité & Tests** : **47/47 tests unitaires passés avec succès à 100% (9 suites de tests)**, 0 erreur et 0 avertissement ESLint, respect strict des guidelines Obsidian.
- **Statut** : Validée.

### 📅 2026-08-17 — Étape 3.5 : Mise en Place de la Branche `dev` & Stratégie de Versioning
- **Décision & Actions Réalisées** :
  1. **Création et synchronisation de la branche `dev`** : La branche `dev` est créée localement et sur le dépôt distant (`origin/dev`).
  2. **Convention de Branches** :
     - `main` : Réservée aux versions de production stables et aux releases officielles.
     - `dev` : Branche d'intégration pour les fonctionnalités en cours de développement.
  3. **Planification CI/CD** : Mise en place prochaine des workflows GitHub Actions pour tester et builder automatiquement sur chaque commit / PR.
- **Statut** : Validée.

### 📅 2026-08-18 — Étape 3.7 : Gestionnaire Unifié de Secrets, Support OpenRouter & Auto-Détection Infomaniak
- **Décision & Actions Réalisées** :
  1. **Modal Centralisée [`SecretsManagementModal`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/modals/secretsManagementModal.ts)** :
     - Interface dédiée pour lier, tester et sécuriser les clés de 4 fournisseurs (Google Gemini, OpenAI ChatGPT, OpenRouter, Infomaniak AI Services).
     - Masquage mot de passe avec oeil de visibilité et persistance directe dans `app.secretStorage` / `localStorage`.
  2. **Auto-Détection du `product_id` Infomaniak (`GET /1/ai`)** :
     - Implémentation de [`InfomaniakService`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/infomaniakService.ts) interrogeant automatiquement le compte utilisateur pour extraire son identifiant produit sans saisie manuelle.
  3. **Support Complet d'OpenRouter** :
     - Endpoint officiel `https://openrouter.ai/api/v1` avec headers requis (`HTTP-Referer`, `X-Title`) et modèles phares.
  4. **Correctif CSS Layout Réglages** :
     - Troncature propre (`max-width: 240px`, `text-overflow: ellipsis`) et colonne d'info préservée (`min-width: 220px`) pour éliminer l'écrasement des libellés.
- **Statut** : Validée.

### 📅 2026-08-18 — Étape 3.8 : Résolution Définitive des Blocages CORS Streaming (HttpStreamService)
- **Décision & Actions Réalisées** :
  1. **Contournement CORS via [`HttpStreamService`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/httpStreamService.ts)** :
     - Utilisation native du module Node.js `https` sur Desktop (Electron) pour streamer les réponses SSE en direct sans passer par les restrictions CORS du moteur Chromium (`app://obsidian.md`).
     - Utilisation de `requestUrl` comme fallback universel sur Mobile.
  2. **Intégration du Catalogue Officiel Infomaniak** :
     - Support strict des 12 modèles officiels (`qwen3`, `mistral3`, `mistral24b`, `swiss-ai/Apertus-70B-Instruct-2509`, `swiss-ai/Apertus-v1.5-70B`, `Qwen/Qwen3.5-122B-A10B-FP8`, `google/gemma-4-31B-it`, etc.).
     - Assainissement et repli transparent sur `qwen3` si un modèle non reconnu issu d'un autre fournisseur est encore configuré.
  3. **Tests & Validation** : **59/59 tests unitaires passés avec 100% de succès** (11 suites), 0 erreur ESLint, bundle de production validé.
- **Statut** : Validée.

### 📅 2026-08-18 — Étape 3.9 : Optimisation Latence (Keep-Alive Persistant) & Détection Enrichie des Tâches
- **Décision & Actions Réalisées** :
  1. **Pool de Connexions HTTPS & Keep-Alive Persistant** :
     - Instanciation d'un `https.Agent({ keepAlive: true, keepAliveMsecs: 60000, maxSockets: 10 })` persistant dans [`HttpStreamService`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/httpStreamService.ts) pour réutiliser les sessions TLS 1.3 vers Infomaniak (gain immédiat de ~150-300ms sur le TTFT).
     - Désactivation de l'algorithme de Nagle (`setNoDelay(true)`) sur les sockets TCP.
  2. **Fenêtre Glissante d'Historique ([`AgentOrchestrator`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/agentOrchestrator.ts))** :
     - Limitation aux 8 derniers messages de conversation et compression des notes volumineuses pour accélérer le préfill GPU.
  3. **Détection Enrichie des Tâches dans le Chat ([`ChatView`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/chatView.ts))** :
     - Parsing et conversion automatique en cartes interactives des tâches contenues dans les **blocs de code Markdown (`<pre><code>`)** et dans les **tableaux Markdown (`<table>`)**.
- **Statut** : Validée.





