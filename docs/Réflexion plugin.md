# Rapport de conception — Second Brain Manager pour Obsidian

## 1. Résumé exécutif

Le **Second Brain Manager** est un plugin Obsidian conçu comme un agent personnel local capable de dialoguer avec le coffre, de comprendre les tâches Markdown existantes, de proposer un programme quotidien et d'exécuter des modifications contrôlées.

Principe central : **les tâches restent exclusivement des tâches Markdown compatibles avec Obsidian Tasks**. Le plugin ne crée pas de fiche de tâche, de base de données de tâches parallèle ou de format propriétaire. Il lit, enrichit, modifie, planifie et récompense les tâches existantes.

Le plugin fournirait :

- une interface conversationnelle écrite puis vocale ;
- une recherche contextuelle dans le coffre ;
- un briefing du matin piloté par le niveau d'énergie ;
- une revue du soir sans culpabilisation ;
- la création, modification et décomposition de tâches ;
- des rappels logiques associés aux échéances ;
- la reformulation, l'organisation et l'archivage de notes ;
- une matrice d'Eisenhower fournie par un plugin spécialisé ;
- un système de pièces, statistiques et récompenses ==(gamification)== ;
- des notifications desktop, avec extension mobile ultérieure.

## 2. Principes de conception

### 2.1. Le coffre reste la source de vérité

Les notes, documents et tâches restent dans le coffre Obsidian. Le plugin ne doit pas rendre les données inutilisables en cas de désinstallation.

Les tâches utilisent la syntaxe prise en charge par Tasks : échéances, dates de début ou de programmation, récurrences, dates de réalisation et sous-tâches. Tasks sait interroger et modifier les tâches présentes dans l'ensemble du coffre. [web:20][web:33][web:34]

### 2.2. Une tâche est une ligne Markdown

Exemple canonique :

```markdown
- [ ] Poster le contenu Instagram 📅 2026-08-31 ⏳ 2026-08-28 #communication #q2 #difficulte/moyenne #energie/3 #pieces/4
```

Le plugin ajoute ou interprète des tags contrôlés, mais ne crée pas de note dédiée à chaque tâche.

### 2.3. L'IA propose avant d'agir

L'IA retourne un texte et des actions structurées. Les opérations sensibles — modifier une tâche, écrire une note, déplacer un fichier, archiver ou supprimer — sont présentées dans un aperçu avant validation.

### 2.4. La matrice est déléguée à un plugin spécialisé

Le Manager ne doit pas réimplémenter la visualisation de la matrice d'Eisenhower. Il doit s'intégrer à un plugin spécialisé et utiliser le marquage écrit par celui-ci comme donnée de référence.

Les candidats à évaluer sont :

| Plugin | Intérêt pour le Manager |
|---|---|
| **Focus First** | Classe automatiquement les tâches selon urgence et importance, propose une matrice Eisenhower ou Value/Effort, une vue de triage et une liste de focus. Il lit les tâches checkbox compatibles avec Tasks et fonctionne sur desktop et mobile. [web:89] |
| **TaskMatrix** | Écrit le quadrant directement dans le Markdown avec des tags `#tm/qN`, sans état hors coffre. Les déplacements sont écrits dans la tâche source et les écritures sont contrôlées contre les conflits. [web:90] |
| **QuadTasks** | Offre une matrice interactive, du drag-and-drop, un Inbox et un mode Focus, avec stockage en Markdown. Il nécessite toutefois une installation manuelle d'après sa fiche actuelle. [web:91] |
| **4D Eisenhower Matrix** | Lit et écrit une syntaxe Tasks standard, propose cinq catégories DO / DECIDE / DELEGATE / DELETE / OPEN, une vue Kanban, des filtres et une compatibilité desktop/mobile. [web:92] |

### Recommandation

Le premier candidat à tester est **Focus First**, car il semble le plus proche d'une classification automatique et d'une utilisation quotidienne. **TaskMatrix** est le candidat le plus intéressant si la priorité est de conserver un marquage très simple et transparent dans les tâches. Le Manager doit cependant supporter une couche d'adaptation configurable :

```yaml
matrix:
  provider: focus-first
  tags:
    do: "#tm/q1"
    schedule: "#tm/q2"
    delegate: "#tm/q3"
    eliminate: "#tm/q4"
```

L'implémentation ne doit pas dépendre d'un nom de tag unique. Elle doit pouvoir lire et écrire le format du plugin retenu.

## 3. Format des tâches

### 3.1. Tags standardisés

| Information | Format | Exemple |
|---|---|---|
| Domaine | tag libre ou `#domaine/...` | `#travail` |
| Priorité Eisenhower | fourni par le plugin matrice | `#tm/q1` |
| Priorité complémentaire | `#priorite/...` | `#priorite/haute` |
| Difficulté | `#difficulte/...` | `#difficulte/moyenne` |
| Énergie | `#energie/1` à `#energie/10` | `#energie/3` |
| Pièces | `#pieces/<nombre>` | `#pieces/4` |
| Contexte | `#contexte/...` | `#contexte/ordinateur` |
| Projet | lien ou tag | `[[Projet Instagram]]` |

Exemple :

```markdown
- [ ] Envoyer le catalogue à Claire 📅 2026-08-07 #reseau #difficulte/facile #energie/2 #pieces/3 [[Claire]]
```

La matrice externe ajoute ou interprète son propre tag de quadrant. Le Manager ne doit pas dupliquer ce champ avec un autre `#q1` si cela crée une ambiguïté.

### 3.2. Dates et récurrences

Le plugin utilise les signifiants Tasks plutôt qu'un format concurrent :

```markdown
- [ ] Payer le loyer 🔁 every month on the 1st 📅 2026-09-01 #maison #energie/1 #pieces/2
```

### 3.3. Tâches complexes

Une tâche principale peut contenir des sous-tâches :

```markdown
- [ ] Préparer le post Instagram 📅 2026-08-31 ⏳ 2026-08-28 #communication #energie/3 #pieces/4
  - [ ] Choisir le sujet
  - [ ] Rédiger le texte
  - [ ] Préparer l'image
  - [ ] Relire
  - [ ] Programmer la publication
```

Par défaut, seule la tâche principale portant `#pieces/...` est récompensée. Ce comportement doit être configurable.

## 4. Fonctionnalités du plugin

### 4.1. Chat avec le coffre

Le chat permet de :

- rechercher dans les notes et les documents ;
- retrouver les tâches liées à un projet, contact ou domaine ;
- résumer une note ;
- reformuler une note ;
- extraire des décisions et actions ;
- proposer des liens ;
- créer ou modifier une note après confirmation ;
- créer, modifier, reporter et décomposer des tâches ;
- lancer le briefing ou la revue ;
- interroger le portefeuille et les statistiques.

Exemples :

```text
Que dois-je faire aujourd'hui ?
Montre-moi les tâches à faire avant vendredi.
Reformule la note [[Réunion Claire]].
Transforme cette note en tâches.
Je viens de finir la réunion X, c'était épuisant.
Décompose la tâche courante.
```

### 4.2. Briefing du matin

Commande : `Second Brain: Briefing du matin`

Étapes :

1. lire les tâches dues aujourd'hui ;
2. lire les tâches en retard ;
3. lire les tâches dont la date de début est atteinte ;
4. lire les tâches récurrentes ;
5. lire les quadrants de la matrice ;
6. demander le niveau d'énergie ;
7. appliquer le filtre énergie/priorité ;
8. proposer une journée ;
9. demander validation.
==pouvoir rendre prioritaire un projet spécifique (par exemple, aujourd'hui la priorité c'est le MFRB ou aujourd'hui, la priorité c'est l'avancé de mon jeu)==

Pour une énergie basse, le plugin propose un mode économie : une seule tâche importante, des tâches légères et le report explicite des tâches demandant trop d'énergie.
==possibilité de réévaluer son niveau d'énergie après une tache ==

### 4.3. Journal de journée

L'utilisateur peut indiquer ce qu'il vient de faire. Le Manager propose alors :

- une entrée dans la note quotidienne ;
- une mise à jour de tâche ;
- une nouvelle tâche ;
- un changement de mode énergétique ;
- une réorganisation du programme.

Aucune modification ne doit être silencieuse.

### 4.4. Revue du soir

Commande : `Second Brain: Revue du soir`

La revue compare les tâches prévues et terminées, puis propose pour chaque tâche ouverte :

- reporter ;
- découper ;
- changer de quadrant ;
- abandonner ;
- conserver sans modification.

Le changement de quadrant doit être écrit selon le format du plugin Eisenhower sélectionné.

==proposition de nettoyage du second cerveau (classer les notes dans les dossier, créer des liens entre plusieurs notes, etc...)==

### 4.5. Reprise après une pause

Commande : `Second Brain: Reprendre après une pause`

Le plugin détecte la durée depuis le dernier briefing et limite la restitution à :

- une tâche administrative courte ;
- une tâche importante ;
- les urgences réelles ;
- les tâches à reporter en masse ;
- les tâches probablement obsolètes ;
- les éléments de l'Inbox.

### 4.6. Décomposition de tâche

Pour :

```text
Poster sur Instagram avant le 31 août.
```

Le Manager propose une tâche complète :

```markdown
- [ ] Poster sur Instagram 📅 2026-08-31 ⏳ 2026-08-28 #communication #difficulte/moyenne #energie/3 #pieces/4
  - [ ] Choisir le sujet
  - [ ] Rédiger le texte
  - [ ] Préparer le visuel
  - [ ] Relire
  - [ ] Publier
```

La tâche devient visible dans le briefing à partir du 28 août. Le plugin peut la signaler chaque jour sans créer de doublons.

### 4.7. Gestion des notes et documents

Le Manager peut proposer :

- une destination ;
- un titre ;
- des tags ;
- des propriétés ;
- des liens ;
- une reformulation ;
- un résumé ;
- une fusion ;
- un déplacement vers une archive.
==- un lien entre note==

Les PDF, documents Word et images sont référencés dans le coffre mais ne deviennent pas des tâches. L'IA peut produire un résumé et des tâches associées après validation.

## 5. Gamification

### 5.1. Calcul des pièces

==Peux aussi imaginer un système xp / trophée pour valoriser l'avancement ==
Une valeur explicite peut être inscrite dans la tâche :

```markdown
#pieces/4
```

Sinon, le Manager applique un barème configurable selon le domaine, la difficulté et éventuellement le quadrant :

```json
{
  "coinRules": {
    "default": 1,
    "quadrants": {
      "q1": 8,
      "q2": 4,
      "q3": 2,
      "q4": 1
    },
    "difficultyBonus": {
      "facile": 0,
      "moyenne": 1,
      "difficile": 3
    }
  }
}
```

Si `#pieces/...` est présent, il prévaut sur le calcul automatique.

### 5.2. Détection de complétion

Quand une tâche passe à l'état terminé :

1. identifier le fichier et la ligne ;
2. calculer une identité stable ;
3. vérifier qu'elle n'a pas déjà été récompensée ;
4. calculer les pièces ;
5. mettre à jour le portefeuille ;
6. enregistrer l'événement dans `data.json` ;
7. actualiser les statistiques.

Un identifiant de bloc peut aider :

```markdown
- [ ] Régler le loyer 🔁 every month on the 1st #pieces/2 ^task-loyer-mensuel
```

### 5.3. Récompenses

Les récompenses peuvent être stockées dans `data.json` durant le MVP :

```json
{
  "rewards": [
    {
      "id": "pause-jeu",
      "name": "30 minutes de jeu",
      "description": "Une pause choisie sans culpabilité",
      "cost": 20,
      "enabled": true
    }
  ]
}
```

L'interface permet de créer, modifier, désactiver et échanger les récompenses.

### 5.4. Statistiques

- solde actuel ;
- total gagné et dépensé ;
- pièces par domaine ;
- tâches par quadrant ;
- tâches par difficulté ;
- énergie moyenne ;
- progression hebdomadaire ;
- séries de jours actifs ;
- récompenses consommées.

## 6. Commandes Obsidian

### IA et notes

- `Second Brain: Ouvrir le chat`
- `Second Brain: Ouvrir le chat du jour`
- `Second Brain: Demander à l'IA`
- `Second Brain: Reformuler la note courante`
- `Second Brain: Résumer la note courante`
- `Second Brain: Extraire les tâches`
- `Second Brain: Rechercher dans le coffre`

### Tâches et matrice

- `Second Brain: Créer une tâche avec l'IA`
- `Second Brain: Décomposer la tâche courante`
- `Second Brain: Enrichir la tâche avec des tags`
- `Second Brain: Replanifier la tâche`
- `Second Brain: Reporter les tâches sélectionnées`
- `Second Brain: Classer la tâche dans la matrice`
- `Second Brain: Changer le quadrant de la tâche`
- `Second Brain: Marquer la tâche comme abandonnée`

### Journée

- `Second Brain: Briefing du matin`
- `Second Brain: Indiquer mon énergie`
- `Second Brain: Démarrer une session`
- `Second Brain: Faire une pause`
- `Second Brain: Reprendre après une pause`
- `Second Brain: Revue du soir`
- `Second Brain: Nettoyage mental`

### Gamification

- `Second Brain: Ouvrir le portefeuille`
- `Second Brain: Ouvrir les statistiques`
- `Second Brain: Ouvrir les récompenses`
- `Second Brain: Échanger une récompense`
- `Second Brain: Corriger un événement de pièces`

## 7. Interfaces

### Vue Chat

- historique ;
- zone de saisie ;
- bouton vocal futur ;
- contexte utilisé ;
- aperçu des modifications ;
- validation et annulation.

### Vue Briefing

- énergie ;
- mode de journée ;
- tâche principale ;
- tâches secondaires ;
- échéances ;
- tâches à décider ;
- boutons commencer, reporter et décomposer.

### Vue Matrice

La matrice est ouverte depuis le plugin spécialisé retenu. Le Manager peut fournir des actions complémentaires, mais la vue matricielle, le drag-and-drop et le format du tag de quadrant appartiennent à ce plugin.

### Vue Gamification

- solde ;
- évolution sur 7 et 30 jours ;
- pièces par domaine et quadrant ;
- récompenses disponibles ;
- historique des échanges.

### Aperçu des actions

```text
3 modifications proposées

[x] Modifier la tâche « Préparer le dossier »
[x] Ajouter 2 sous-tâches
[x] Ajouter #energie/3 et #pieces/4

[Appliquer] [Modifier] [Annuler]
```

## 8. Paramètres

### Coffre et tâches

- dossiers inclus et exclus ;
- dossier Inbox ;
- dossier des notes quotidiennes ;
- tags de domaine ;
- tags d'énergie ;
- tags de difficulté ;
- tag de pièces ;
- statut terminé ;
- comportement des sous-tâches ;
- identifiant de tâche ;
- plugin Eisenhower utilisé ;
- mapping des quadrants.

### IA

- fournisseur : Ollama, LM Studio ou endpoint compatible ;
- modèle de chat ;
- modèle d'embeddings ;
- URL locale ;
- taille maximale du contexte ;
- nombre de notes récupérées ;
- autorisation d'écriture ;
- autorisation de déplacement et archivage ;
- conservation de l'historique.

### Briefing et énergie

- heure du briefing ;
- nombre maximal de tâches proposées ;
- seuil de faible énergie ;
- nombre maximal de tâches Q1 ;
- durée maximale recommandée ;
- marge minimale ;
- tags ou domaines prioritaires.

### Rappels

- délai de préparation par défaut ;
- rappel à l'échéance ;
- répétition quotidienne ;
- délai avant obsolescence ;
- inclusion dans le briefing ;
- inclusion dans la revue ;
- notifications desktop.

### Gamification

- barème des quadrants ;
- bonus de difficulté ;
- récompense des sous-tâches ;
- bonus de série ;
- solde négatif ou non ;
- récompenses ;
- devise ;
- confirmation des échanges.

## 9. Notifications

Obsidian Mobile ne permettant pas actuellement de compter sur l'envoi de notifications, le plugin doit séparer le moteur de rappel du canal de notification :

```text
NotificationProvider
├── DesktopNotificationProvider
├── InAppNotificationProvider
└── FutureMobileNotificationProvider
```

### MVP

- notification système sur ordinateur ;
- badge dans le plugin ;
- rappels visibles dans le briefing ;
- rappels visibles dans la revue du soir ;
- aucune promesse de notification mobile.

### Évolution

- application compagnon ;
- ntfy ou Gotify ;
- intégration calendrier ;
- notification système mobile ;
- serveur local.

## 10. Architecture technique

```text
Second Brain Manager
├── TaskParser
├── TaskMutator
├── TaskIdentityResolver
├── VaultSearchService
├── LLMProvider
├── PromptOrchestrator
├── ActionValidator
├── ActionExecutor
├── MatrixAdapter
├── MorningBriefingWorkflow
├── EveningReviewWorkflow
├── RecoveryWorkflow
├── ReminderEngine
├── GamificationService
├── NotificationService
├── ChatView
├── BriefingView
├── GamificationView
└── SettingsTab
```

### `MatrixAdapter`

Ce composant isole la dépendance au plugin choisi. Il doit savoir :

- détecter le quadrant d'une tâche ;
- produire un libellé lisible ;
- modifier le quadrant ;
- vérifier si une tâche est non classée ;
- gérer le mapping entre quadrants et priorité.

Exemples de stratégies :

```text
Focus First   → utiliser son classement ou son tag focus
TaskMatrix    → #tm/q1, #tm/q2, #tm/q3, #tm/q4
QuadTasks     → syntaxe et code block propres au plugin
4D Matrix     → #DO, #DECIDE, #DELEGATE, #DELETE, #OPEN
```

### `TaskParser`

- détecte les lignes checkbox ;
- extrait les dates ;
- extrait les tags ;
- identifie les sous-tâches ;
- lit le quadrant via `MatrixAdapter` ;
- calcule l'énergie et la récompense.

### `TaskMutator`

- ajoute ou remplace un tag ;
- modifie une date ;
- ajoute une sous-tâche ;
- change le statut ;
- modifie le quadrant ;
- préserve le reste de la ligne.

### `ActionExecutor`

- exécute uniquement des actions validées ;
- vérifie que le fichier n'a pas changé ;
- conserve le contenu précédent ;
- produit un rapport des modifications.

## 11. `data.json`

Obsidian fournit `loadData()` et `saveData()` pour stocker les données du plugin dans son `data.json`. [web:81]

Structure initiale :

```json
{
  "schemaVersion": 1,
  "settings": {},
  "wallet": {
    "balance": 0,
    "lifetimeEarned": 0,
    "lifetimeSpent": 0
  },
  "rewards": [],
  "rewardPurchases": [],
  "completionEvents": {},
  "dailySessions": {},
  "reminderState": {}
}
```

Les événements peuvent être indexés par identifiant de tâche :

```json
{
  "completionEvents": {
    "task-file.md::task-hash": {
      "completedAt": "2026-08-06T16:00:00+02:00",
      "coins": 4,
      "taskText": "Poster le contenu Instagram"
    }
  }
}
```

Cette approche est adaptée au MVP. Une migration vers un journal externe ne serait utile que pour gérer un très grand historique ou des écritures concurrentes sur plusieurs appareils.

## 12. Robustesse et sécurité

Le plugin doit prévoir :

- confirmation des écritures IA ;
- aperçu avant modification ;
- sauvegarde du contenu précédent ;
- détection des modifications concurrentes ;
- validation des dates et tags ;
- refus des chemins hors coffre ;
- dossiers accessibles configurables ;
- désactivation des actions automatiques ;
- journal des dernières actions ;
- version de schéma de `data.json` ;
- migrations de configuration.

## 13. Plan de mise en place

### Phase 0 — Choix et test de la matrice

Tester les quatre plugins sur un petit coffre de démonstration :

- compatibilité exacte avec le format Tasks ;
- tags écrits dans les lignes ;
- comportement mobile ;
- gestion des tâches non classées ;
- API ou possibilités d'intégration ;
- stabilité des écritures ;
- compatibilité avec les tags énergie, difficulté et pièces.

Recommandation initiale : tester d'abord **Focus First** et **TaskMatrix**. Focus First paraît le plus complet pour la classification et le triage, tandis que TaskMatrix paraît le plus simple à intégrer côté Markdown.

### Phase 1 — Socle sans IA

- créer le plugin ;
- ajouter les paramètres ;
- intégrer `MatrixAdapter` ;
- parser les tâches ;
- afficher les tâches du jour ;
- détecter les complétions ;
- calculer les pièces ;
- stocker le portefeuille dans `data.json` ;
- ajouter les récompenses et statistiques de base.

### Phase 2 — Briefing et revue

- vue Briefing ;
- saisie de l'énergie ;
- sélection par quadrant, échéance et énergie ;
- mode faible énergie ;
- revue du soir ;
- report et abandon assistés ;
- reprise après pause ;
- rappels visibles dans l'interface.

### Phase 3 — IA conversationnelle

- connexion à Ollama ou LM Studio ;
- chat contextuel ;
- extraction de tâches ;
- décomposition ;
- génération de tags ;
- reformulation ;
- actions structurées en JSON ;
- aperçu et validation.

### Phase 4 — Automatisation contrôlée

- briefing généré par l'IA ;
- revue générée par l'IA ;
- ajustement du programme ;
- rappels J-3 et quotidiens ;
- classement via le plugin matrice ;
- organisation de l'Inbox ;
- résumé de documents ;
- création de notes sur proposition.

### Phase 5 — Voix et notifications desktop

- capture audio ;
- transcription Whisper locale ;
- envoi de la transcription au chat ;
- journal vocal ;
- notifications de bureau ;
- file de notifications en attente.

### Phase 6 — Mobile

- vérifier la compatibilité mobile ;
- adapter les vues au petit écran ;
- consulter et cocher les tâches hors ligne ;
- évaluer ntfy, Gotify ou une application compagnon ;
- ajouter les notifications mobiles si une solution fiable est retenue ;
- traiter les conflits de synchronisation.

## 14. MVP recommandé

Le MVP devrait contenir :

1. lecture des tâches Tasks ;
2. parsing des tags ;
3. intégration d'un seul plugin Eisenhower ;
4. vue des tâches du jour ;
5. saisie de l'énergie ;
6. briefing simple ;
7. détection des tâches terminées ;
8. ajout de pièces ;
9. `data.json` pour portefeuille et récompenses ;
10. statistiques de base ;
11. revue du soir simple ;
12. rappels visibles dans le plugin ;
13. notifications desktop facultatives.

La recherche sémantique, la voix, l'écriture libre dans les notes et la décomposition avancée peuvent venir ensuite.

## Conclusion

Le Second Brain Manager doit être un **orchestrateur de tâches Markdown existantes**, et non une seconde application de tâches.

La matrice d'Eisenhower doit être confiée à un plugin spécialisé, avec une couche `MatrixAdapter` permettant de changer de plugin sans réécrire le Manager. Le stockage du portefeuille, des récompenses et des événements de complétion dans `data.json` est adapté au MVP. Le moteur de rappels doit rester indépendant des notifications afin de fonctionner immédiatement sur ordinateur et d'accueillir plus tard une solution mobile.