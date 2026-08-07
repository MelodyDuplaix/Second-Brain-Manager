# Second Brain Manager — Plugin Obsidian

> **Un orchestrateur agentique, gamifié et intelligent pour votre coffre Obsidian.**
> Compatible nativement avec Obsidian Tasks, la matrice d'Eisenhower et les modèles de langage (LLM).

---

## 🌟 Fonctionnalités Principales

- **Tâches 100% Markdown & Standard Obsidian Tasks** :
  - Parsing complet des échéances (`📅`), dates de début (`🛫`), planifiées (`⏳`), récurrences (`🔁`).
  - Tags normalisés : `#energie/1-10`, `#difficulte/...`, `#pieces/N`, `#domaine/...`, `#contexte/...`.
  - Mode de priorité configurable : Emojis Tasks (`🔺 ⏫ 🔼 🔽 ⏬`) ou tags hiérarchiques (`#priorite/haute`).
  - Compatibilité matrice Eisenhower via `MatrixAdapter` (TaskMatrix `#tm/q1..4`, Focus First, Custom tags).

- **Gamification & Portefeuille de Pièces d'Or** :
  - Écouteur automatique de complétion de tâches (`app.vault.on('modify')`).
  - Portefeuille persistant avec détection d'unicité et barème automatique ou explicite.
  - Révocation et remboursement immédiat en cas de missclick.
  - Statistiques avancées avec graphiques vectoriels SVG natifs zéro-dépendance (Courbe 14 jours, Camembert Donut, Barres journalières).

- **Tableau de Bord Interactif (`DashboardView`)** :
  - Jauge d'énergie (1 à 10) et bascule de mode Économie vs Pleine Énergie.
  - 4 sections de triage : Aujourd'hui & Urgences, Recommandées selon énergie, Non classées, Boîte de réception Inbox.
  - Barre de recherche en temps réel et popover de changement de priorité.

- **Assistant IA Conversationnel & Streaming en Temps Réel (`ChatView`)** :
  - Multi-fournisseurs : Google Gemini (1.5 / 2.0 Flash / Pro), OpenAI ChatGPT (GPT-4o), Ollama & LM Studio (Local).
  - Déroulement fluide mot à mot (Typewriter Queue à 16ms) avec curseur actif (`▌`).
  - Rendu Markdown soigné et compact.

- **Paramètres Natifs & Secret Storage** :
  - Architecture modulaire inspirée du plugin officiel *Spaced Repetition* (`SettingsPageManager`).
  - Navigation 100% accessible au clavier (`Tab`, `Entrée`, `Espace`).
  - Intégration officielle de l'API `SecretStorage` d'Obsidian pour sécuriser les clés d'API.

---

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
