# Note de Suivi — Second Brain Manager

Ce document sert de journal de bord et de référence architecturale pour le développement du plugin **Second Brain Manager** pour Obsidian.

---

## 1. Vision et Principes Fondamentaux

- **Le coffre Obsidian reste la seule source de vérité** : Aucune base de données externe propriétaire pour les tâches ou les notes.
- **Une tâche = une ligne Markdown standard** : Pleine compatibilité avec Obsidian Tasks (`- [ ] Titre 📅 2026-08-31 #energie/3 #q1`).
- **L'IA propose avant d'agir** : Chaque modification (tâches, fichiers, agenda) génère un aperçu visuel interactif (`ActionPreviewWidget`) validable en un clic.
- **Matrice d'Eisenhower modulaire** : Prise en charge configurable via `MatrixAdapter` (TaskMatrix `#tm/qN`, Focus First, etc.).
- **Gamification équitable** : Récompense en pièces lors de la complétion de tâches dans Obsidian, tout en filtrant les fausses détections issues des synchronisations distantes.
- **Règle absolue de Release (CI/CD GitHub Actions)** : **Ne JAMAIS réutiliser ou écraser un numéro de tag/release déjà existant sur GitHub** (sinon le workflow GitHub Release échoue avec l'erreur `a release with the same tag name already exists`). Tout correctif, modification ou nouvelle livraison post-release DOIT impérativement incrémenter le numéro de version (ex: `0.5.0` ➔ `0.5.1`).

---

## 2. Historique des Réalisations & Journal des Modifications

### 🚀 Version 0.5.2 (27 Août 2026) — Persistance Disque, Synchronisation Directe de l'Éditeur & Correction Mutation de Tâches
- **Correction Critique de Mutation dans le Tiroir d'Édition (`create_task` vs `update_task`) ([`actionPreviewWidget.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/actionPreviewWidget.ts))** :
  - Rendu dédié pour les propositions `create_task` dans le tiroir d'édition multi-actions (`renderMultiActionEditDrawer`) et les boutons rapides (dates, quadrants, énergie, priorité).
  - Élimination des conversions forcées en `update_task` pour garantir la création effective de la tâche lors de l'exécution.
- **Persistance Disque & Synchronisation Temps Réel des Éditeurs Ouverts ([`actionExecutor.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/actionExecutor.ts))** :
  - Double synchronisation : écriture directe sur le disque via `vault.modify` avec garde `isTFile` stricte, et mise à jour instantanée en mémoire des documents ouverts dans le workspace (`app.workspace.iterateAllLeaves`, `editorView.editor.setValue`).
  - Détection dynamique et préservation absolue des fins de ligne Windows (`\r\n` vs `\n`).
- **Résolution Canonique Floue & Insensibilité aux Accents ([`vaultContextService.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/vaultContextService.ts))** :
  - Détection automatique et déterministe des notes cibles même en cas d'omission d'accents ou de chemins partiels (`stripAccents` + `normalizeCanonicalKey`).
  - Injection systématique du chemin canonique de la note active dans le prompt système du LLM.

### 🚀 Version 0.5.1 (27 Août 2026) — Différenciation Semaine / Planning & Correctifs CI
- **Différenciation claire des Vues Semaine & Planning ([`calendarView.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/calendarView.ts), [`styles.css`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/styles.css))** :
  - **Vue Semaine** : Grille complète des 7 jours de la semaine (Lundi à Dimanche) affichant les cartes des jours avec rendez-vous et un statut `Libre` pour les jours disponibles.
  - **Vue Planning** : Flux d'agenda chronologique continu sur 30 jours (uniquement les jours occupés) avec badges de distance temporelle (`Aujourd'hui`, `Demain`, `Dans 3 j`, `Semaine prochaine`...).
- **Conformité Linter & Stabilité CI** :
  - Correction des variables non réassignées (`prefer-const`) dans `toolRegistry.ts`, `vaultContextService.ts` et `calendarView.ts`.
  - Intégration de la règle de non-réutilisation de tag dans la documentation de suivi.

### 🚀 Version 0.5.0 (27 Août 2026) — Release Majeure
- **Archivage & Remise à Zéro du Score (Repartir à 0) ([`gamificationHistoryView.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/gamificationHistoryView.ts), [`gamificationService.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/gamificationService.ts))** :
  - Ajout d'un bouton `🔄 Repartir à zéro` dans l'en-tête de la vue d'historique des pièces.
  - Modale de confirmation sécurisée (`ResetGamificationModal`).
  - Génération automatique d'une note Markdown complète dans `00 - Archives/Bilan Score & Pièces - YYYY-MM-DD (HH-mm).md` avec métadonnées frontmatter, statistiques globales, trophées débloqués et tableau récapitulatif de toutes les tâches validées.
  - Remise à zéro des compteurs de pièces, des séries (streaks) et des historiques pour démarrer un nouveau cycle en toute sérénité.
- **Intégration Google Calendar Complète & Autonome** :
  - Authentification OAuth2 PKCE sans plugin tiers.
  - Outils ReAct étendus pour le LLM (`list_calendars`, `search_calendar_events`, `get_calendar_events` multi-critères).
  - Vue Agenda optimisée pour la barre latérale étroite avec mini-calendrier interactif et indicateurs de points.
  - Briefing du matin contextualisé avec les rendez-vous du jour.
- **Système de Tâches Multi-Formats & Anti-Triche** :
  - Support en lecture de toutes les syntaxes et respect absolu du format choisi en écriture.
  - Filtrage des complétions survenues lors de synchronisations mobiles/distantes.

### 📅 27 Août 2026 — Différenciation des Vues Semaine & Planning dans l'Agenda
- **Vue Semaine (`week`) ([`calendarView.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/calendarView.ts))** :
  - Structure hebdomadaire complète affichant **chacun des 7 jours de la semaine (Lundi à Dimanche)**.
  - Permet de visualiser en un coup d'œil les jours libres (`Libre`) et les jours chargés (`X rdv`), avec bouton d'ajout rapide `+` et zoom sur n'importe quel jour par simple clic.
- **Vue Planning (`schedule`) ([`calendarView.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/calendarView.ts))** :
  - Flux d'agenda chronologique continu sur **30 jours** (uniquement les jours avec événements).
  - Badges temporels relatifs explicites : `Aujourd'hui`, `Demain`, `Dans 3 j`, `Semaine prochaine`, `Dans 2 sem.`.
- **Vue Jour (`day`)** :
  - Focus détaillé et ergonomique sur la seule journée sélectionnée.

### 📅 27 Août 2026 — Outils IA Événements Multi-Critères
- **Outils ReAct Événements Multi-Paramètres ([`toolRegistry.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/toolRegistry.ts), [`googleCalendarService.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/googleCalendarService.ts))** :
  - `list_calendars` : Découverte de l'ensemble des agendas Google disponibles (professionnel, personnel, agendas partagés ou secondaires).
  - `search_calendar_events` / `get_calendar_events` : Recherche avancée multi-critères :
    - Par mots-clés (`query`) plein texte sur le titre ou la description.
    - Par plage de dates (`startDate`, `endDate`).
    - Par lieu ou visio (`location`).
    - Par participant (`attendee` par nom ou email).
    - Par agenda spécifique ou tous les agendas combinés (`calendarId: "all"`).
    - Avec ou sans événements passés (`includePast`).

### 📅 27 Août 2026 — Mini-Calendrier Interactif & Correction du Chat IA
- **Mini-Calendrier Mensuel avec Points d'Événements ([`calendarView.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/calendarView.ts))** :
  - Ajout d'une grille mensuelle interactive au-dessus de la liste des événements.
  - Calcul et affichage automatique de points indicateurs sous chaque jour ayant au moins un événement.
  - Survol avec infobulle détaillée listant les événements du jour.
  - Clic direct sur un jour pour naviguer et afficher le détail de cette journée dans la liste.
  - Navigation mois par mois (`< Mois Année >`) et bouton de bascule d'affichage du mini-calendrier.
- **Correction "TaskMutator is not defined" ([`agentOrchestrator.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/agentOrchestrator.ts))** :
  - Ajout de l'import manquant `TaskMutator` dans `AgentOrchestrator`, résolvant l'erreur lors de la construction du prompt système lors des échanges dans le chat.

### 📅 27 Août 2026 — Intégration Google Calendar (OAuth2 PKCE Natif & Vue Agenda)
- **Authentification OAuth2 PKCE Autonome ([`googleCalendarService.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/googleCalendarService.ts))** :
  - Suppression de toute dépendance ou importation d'un plugin tiers.
  - Saisie directe du **Client ID** et **Client Secret** Google Cloud dans les réglages.
  - Serveur HTTP local éphémère (`http://127.0.0.1:42813/callback`), génération cryptographique du `state`, `verifier` et `challenge` SHA-256 (PKCE).
  - Échange automatique du code contre les jetons (`refresh_token` & `access_token`) avec sauvegarde persistante dans les paramètres.
  - Gestion de la déconnexion et de la révocation locale des jetons.
- **Service API Google Calendar v3 ([`googleCalendarService.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/googleCalendarService.ts))** :
  - CRUD complet sur les événements Google Calendar (lecture, création, modification, suppression).
  - Formatage optimisé des événements pour injection dans les prompts du LLM (`formatEventsForPrompt`).
- **Outils ReAct pour l'Agent IA ([`toolRegistry.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/toolRegistry.ts))** :
  - `get_calendar_events` : consultation des événements sur une période donnée ou par mot-clé.
  - `propose_create_calendar_event` : création d'événement soumise à confirmation visuelle.
  - `propose_update_calendar_event` : modification d'événement soumise à confirmation.
- **Briefing du Matin augmenté ([`morningBriefingService.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/morningBriefingService.ts))** :
  - Récupération automatique des événements du jour et injection dans le prompt de l'IA pour articuler les tâches autour des rendez-vous réels.
- **Exécuteur d'actions ([`actionExecutor.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/actionExecutor.ts)) & Aperçu ([`actionPreviewWidget.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/actionPreviewWidget.ts))** :
  - Support de `create_calendar_event` et `update_calendar_event` dans l'exécuteur et dans les badges/diffs de la vue de prévisualisation.
- **Vue Agenda Interactive ([`calendarView.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/views/calendarView.ts))** :
  - Navigation par Jour, Semaine et Planning (14 jours).
  - Cartes d'événements avec horaires, lieu, description, bouton d'ouverture Google Calendar, modification et suppression.
  - Modale dédiée de création/édition d'événements (`CalendarEventModal`).
  - Bouton de connexion directe si non connecté.
- **Paramètres & Ruban ([`main.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/main.ts), [`mainPage.ts`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/settings/pages/mainPage.ts))** :
  - Section dédiée Google Calendar dans les paramètres avec saisie Client ID/Secret, bouton d'approbation OAuth2, indicateur de statut et test de connexion.
  - Icône calendrier dans le ruban latéral et commande `Second Brain: Ouvrir l'agenda Google Calendar`.

### 📅 27 Août 2026 — Correction de la création et ouverture de la Daily Note
- **Cause** : Les clés par défaut comme `autoOpenDailyNoteOnBriefing` étaient absentes du `data.json` existant et chargées comme `undefined`, désactivant l'ouverture silencieusement, et `openLinkText(..., false)` ciblait mal la zone d'édition centrale.
- **Correctif** :
  - Fusion garantie `DEFAULT_SETTINGS` dans `loadPluginData`.
  - Méthode [`VaultContextService.openDailyNoteInWorkspace`](file:///C:/Users/melos/Documents/Second%20Brain%20Manager/test/.obsidian/plugins/second-brain-manager/src/services/vaultContextService.ts) ciblant l'éditeur principal (`rootSplit`) sans masquer le panneau de briefing.
  - Remplacement de secours des balises Templater (`<% tp.date... %>`) si Templater n'est pas encore actif.

### 📅 26-27 Août 2026 — Parser Multi-Formats & Respect des Réglages
- **Lecture Universelle** : Le parser accepte tous les formats (émojis `📅`, Dataview `[due:: ...]`, Tags `#due/...`).
- **Écriture Stricte** : L'IA et les mutateurs appliquent rigoureusement le format choisi dans les réglages (`TaskMutator.getTaskSyntaxPromptDescription`).
- **Synchronisation Anti-Triche** : Filtrage des complétions survenues sans interaction locale (via DOM & Editor change tracking) enregistrées avec `coins: 0` (`fromSync: true`).

---

## 3. Architecture Technique & Composants

```text
src/
├── adapters/            # Adaptateurs de matrice d'Eisenhower (TaskMatrix, FocusFirst...)
├── modals/              # Modales utilisateur (Énergie, Secrets API, Événements Agenda)
├── models/              # Types TypeScript (Task, Gamification, LLM, Actions, GoogleCalendar)
├── mutators/            # Modification chirurgicale des lignes Markdown (TaskMutator)
├── parsers/             # Analyseurs de tâches et expressions régulières (TaskParser, RegexBuilder)
├── services/            # Services métier (LLM, VaultContext, GoogleCalendar, Gamification, Orchestrator)
├── settings/            # Pages de configuration modulaires
└── views/               # Vues Obsidian (Dashboard, Briefing, EveningReview, Chat, History, Calendar)
```

---

## 4. Statut des Tests et Qualité

- **Suite de tests unitaires (Vitest)** : 19 fichiers de tests, 127 tests unitaires passés à 100% sans échec.
- **Compilation de production (esbuild)** : Build réussi sans erreur de typage.
