# Second Brain Manager — Plugin Obsidian

> **Un orchestrateur agentique, gamifié et intelligent pour votre coffre Obsidian.**
> Compatible nativement avec Obsidian Tasks, la matrice d'Eisenhower et les modèles de langage (LLM).

---

## 🌟 Fonctionnalités Principales

- **Tâches 100% Markdown & Standard Obsidian Tasks** :
  - Parsing complet des échéances (`📅`), dates de début (`🛫`), planifiées (`⏳`), récurrences (`🔁`).
  - Tags normalisés : `#energie/1-10`, `#difficulte/...`, `#pieces/N`, `#domaine/...`, `#contexte/...`.
  - Tags Unicode : accents et caractères non latins reconnus partout (`#ménage`, `#santé`, `#日本`).
  - Mode de priorité configurable : Emojis Tasks (`🔺 ⏫ 🔼 🔽 ⏬`) ou tags hiérarchiques (`#priorite/haute`).
  - **Statuts personnalisés du plugin Tasks** : les statuts (`[/]`, `[-]`, `[>]`…), leurs types (à faire, en cours, terminée, annulée, en attente) et le filtre global sont lus directement dans les réglages de Tasks.
  - Bouton de suppression d'une tâche sur les cartes, le tableau de bord et les aperçus d'actions IA.

- **Matrice d'Eisenhower optionnelle** :
  - Compatibilité via `MatrixAdapter` (TaskMatrix `#tm/q1..4`, Focus First, Custom tags).
  - Interrupteur « Activer les quadrants » : désactivée, la matrice disparaît partout (cartes, tableau de bord, prompts et outils de l'IA, barème de pièces, trophées).
  - Les sous-tâches gardent leur indentation lors d'un changement de quadrant.

- **Exclusion de tâches** :
  - Tâches ignorées dans toutes les vues et requêtes (tableau de bord, calendrier, briefing, revue du soir, reprise, recherches de l'IA).
  - Règles par tags (sous-tags et tags de note inclus), mots ou expressions régulières, dossiers / fichiers (avec jokers `*`) et statuts.
  - Bouton « Tester les règles » pour voir immédiatement les tâches exclues.

- **Calendrier unifié tâches + Google Agenda (`TaskCalendarView`)** :
  - Vues Jour et Semaine avec grille horaire (déplacer / redimensionner à la souris, cliquer-glisser sur un créneau vide pour créer, zoom avec Ctrl + molette ou `+` / `-`), Mois et Agenda continu, dans la barre latérale ou la zone principale (en barre latérale étroite : liste ou grille du jour).
  - Tâches et événements Google réunis, plusieurs agendas avec couleurs, dédoublonnage des événements présents dans plusieurs agendas.
  - **Couleurs au choix** : tâches par quadrant (ou par priorité quand les quadrants sont désactivés), tâches sans catégorie, entrées de note quotidienne, jour courant, agenda principal, agendas des autres ; couleur propre à chaque agenda Google ou reprise des couleurs de Google Agenda.
  - **Filtres** (bouton Filtres ou touche `F`) : types affichés (tâches, terminées, entrées, événements), agendas par rôle en un clic (ex. masquer tous les agendas secondaires) ou un par un (« Seulement »), quadrants ou priorités, personne qui a donné la tâche (option). Filtres actifs résumés sur une ligne sous la barre d'outils.
  - **Préréglages de filtres** : Tout, Mon agenda, Tâches, Rendez-vous, À faire et les vôtres ; tous renommables, modifiables, réordonnables et rétablissables, avec un préréglage appliqué à l'ouverture du calendrier au choix.
  - L'agenda reste sur le même jour quand le calendrier se met à jour (tâche cochée, synchronisation).
  - **Entrées des notes quotidiennes** : les lignes horodatées (`- 11:30 - 12:00 Dentiste`, `- 13:16 [[Projet]]`, cases à cocher comprises) s'affichent à leur heure. Section lue, formes de ligne (`{start}`, `{end}`, `{text}`), format d'heure, modèle d'écriture et position d'insertion sont réglables, avec un champ d'essai. Ajout, modification, déplacement et suppression depuis le calendrier.
  - **Autocomplétion dans la saisie** (entrée de note quotidienne, tâche rapide) : `[[` propose les notes et leurs alias, `#` les tags du coffre ; `Ctrl+Entrée` enregistre l'entrée.
  - Glisser-déposer pour replanifier, menus contextuels, ajout rapide d'une tâche, d'une entrée de note quotidienne ou d'un événement.
  - **Sur mobile** : un appui long sur une entrée, un événement ou une tâche, relâché sans glisser, ouvre sa fenêtre de modification (ou son menu pour une tâche) ; glisser après l'appui long déplace toujours l'élément.
  - Bacs « En retard » et « Sans date » fixés en haut de la barre latérale.
  - Vue Mois : tout reste visible (les semaines chargées s'agrandissent), sans bouton pour déplier une journée.

- **Gamification & Portefeuille de Pièces d'Or** :
  - Écouteur automatique de complétion de tâches (`app.vault.on('modify')`), y compris pour les cases cochées dans les requêtes du plugin Tasks.
  - Portefeuille persistant avec détection d'unicité et barème automatique ou explicite.
  - Les anciennes tâches déjà cochées (date ✅ passée) ne sont jamais recomptées, même quand des lignes sont ajoutées dans la note.
  - **45 trophées** regroupés par famille (régularité, volume, moments de la journée, effort, variété, matrice, boutique…), calculés rétroactivement.
  - **Boutique de récompenses** : échangez vos pièces contre les récompenses de votre catalogue (achat confirmé en deux clics, annulation possible).
  - Historique unique des tâches validées et des récompenses échangées, avec recherche et annulation / remboursement en cas de missclick.
  - Statistiques avancées avec graphiques vectoriels SVG natifs zéro-dépendance (Courbe 14 jours, Camembert Donut, Barres journalières).

- **Tableau de Bord Interactif (`DashboardView`)** :
  - Jauge d'énergie (1 à 10) et bascule de mode Économie vs Pleine Énergie.
  - 4 sections de triage : Aujourd'hui & Urgences, Recommandées selon énergie, Non classées, Boîte de réception Inbox.
  - Barre de recherche en temps réel et popover de changement de priorité.

- **Personnes dans les tâches (option, désactivée par défaut)** :
  - Activez « Personnes dans les tâches (@nom) » dans Fonctionnalités, puis choisissez le sens de la mention dans Tâches. Par défaut, `@Antoine` attribue la tâche à Antoine : elle n'apparaît pas dans vos tâches, briefings ou pièces. Renseignez vos noms pour que vos propres tâches restent les vôtres lorsque vous êtes mentionné.
  - Vous pouvez aussi choisir « donnée par » (`@Antoine` signifie qu'Antoine vous a confié la tâche) ou « contexte » (Antoine est lié à la tâche, qui reste la vôtre).
  - Jeton personnalisable (`@`, `de:`, `👤`, `#de/`…). Les formes `@[[Claire Dupont]]` et `@"Jean Dupont"` sont aussi reconnues. Un prénom seul est relié à la note de contact correspondante quand elle est unique.
  - Dans le calendrier : badge de la personne, filtre selon le sens choisi (mes tâches, celles qui mentionnent quelqu'un, ou une personne précise, enregistrable dans un préréglage) et entrée correspondante dans le menu d'une tâche.
  - Dans les briefings : les tâches mentionnant une personne sont regroupées par personne et signalées quand elles arrivent à échéance. Seules les tâches attribuées à quelqu'un d'autre sont retirées des tâches personnelles.

- **Briefing du matin, revue du soir et reprise** :
  - L'IA reçoit le rythme réel de l'utilisateur (tâches terminées par jour actif sur 14 jours, moment de la journée le plus productif, thèmes fréquents) et adapte le nombre de tâches proposées à ce rythme et à l'énergie déclarée.
  - Les prompts reflètent le coffre tel qu'il est configuré : sans agenda connecté, sans gamification ou sans quadrants, l'IA n'en parle pas ; chaque tâche n'est envoyée qu'une fois et les parties sans contenu sont omises (journée calme = briefing court).
  - Continuité : le briefing du matin relit la revue d'hier soir, la revue du soir compare avec le plan du matin et tient compte de ce qui est déjà prévu pour demain.
  - **Aucune création forcée** : le bloc d'actions est facultatif, l'IA ajuste l'existant plutôt que de créer, les créations qui doublonnent une tâche ou un rendez-vous sont écartées et les autres sont proposées décochées. « Planifier pour aujourd'hui » ne concerne plus que les tâches réellement recommandées dans le texte.
  - Zone de réponse identique à celle du chat pour dialoguer avec l'assistant pendant le briefing.
  - Les tâches proposées et acceptées sont écrites dans le corps de la note (jamais dans les propriétés), à la fin de la section de tâches, ou de la section choisie dans les réglages (« Section des nouvelles tâches »).

- **Assistant IA Conversationnel & Streaming en Temps Réel (`ChatView`)** :
  - Multi-fournisseurs : Google Gemini (1.5 / 2.0 Flash / Pro), OpenAI ChatGPT (GPT-4o), Ollama & LM Studio (Local).
  - Déroulement fluide mot à mot (Typewriter Queue à 16ms) avec curseur actif (`▌`).
  - Rendu Markdown soigné et compact.
  - Prompt de correction qui corrige le texte sans jamais le surligner ni le mettre en forme.
  - Pas de défilement forcé quand on relit plus haut : le suivi reprend en bas, avec un bouton « revenir en bas ».

- **Interface** :
  - Densité réglable (Confortable, Compacte, Très compacte) appliquée à toutes les vues du plugin.
  - Vues de la barre latérale ouvertes automatiquement au démarrage (au choix).

- **Paramètres Natifs & Secret Storage** :
  - Architecture modulaire inspirée du plugin officiel *Spaced Repetition* (`SettingsPageManager`).
  - **Six sections navigables** (Général, Tâches, Calendrier, Intelligence artificielle, Dictée vocale, Gamification & boutique), chacune en sous-page native d'Obsidian avec retour et valeur courante affichée ; sous-page dédiée à Google Agenda. Blocs repliables sur Obsidian < 1.13.
  - Réglages déclaratifs avec **barre de recherche** pour retrouver un réglage instantanément, sous-pages comprises.
  - Boutique de récompenses gérée directement dans la section Gamification.
  - Navigation 100% accessible au clavier (`Tab`, `Entrée`, `Espace`).
  - Intégration officielle de l'API `SecretStorage` d'Obsidian pour sécuriser les clés d'API.

---

## Screenshots

![Gamification et trophés](gamification-et-trophes.png)
![Démarrage du briefing du matin](demarrage-du-briefing-du-matin.png)
![Tableau de bord](tableau-de-bord.png)
![Propositions de rangements](propositions-de-rangements.png)
![Vue Chat](vue-chat.png)
![Vue des trophés](vue-des-trophes.png)
![Vue calendrier main et sidebar](Vue-calendrier-main-et-sidebar.png)


## 🚀 Installation & Développement

```bash
# Installation des dépendances
npm install

# Lancer la compilation en mode développement
npm run dev

# Vérification du typage et du code
npm run lint

# Exécuter les tests unitaires
npx vitest run

# Compiler pour la production
npm run build
```

---

## 📜 Licence

MIT License.
