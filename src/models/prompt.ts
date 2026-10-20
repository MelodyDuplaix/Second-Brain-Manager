export type BuiltinPromptType = 'correct' | 'summarize' | 'rephrase' | 'extract_tasks' | 'breakdown_task';

export interface ConfiguredPrompt {
	id: string;
	name: string;
	description: string;
	systemInstruction: string;
	model?: string; // Model override. Empty string or undefined means default global model
	icon: string;
	showInContextMenu: boolean;
	showInCommandPalette: boolean;
	requiresSelection?: boolean;
	actionType: 'builtin' | 'custom';
	builtinType?: BuiltinPromptType;
	enabled: boolean;
}

export const DEFAULT_CONFIGURED_PROMPTS: ConfiguredPrompt[] = [
	{
		id: 'correct',
		name: 'Corriger sans reformuler',
		description: 'Corrige rigoureusement les fautes d\'orthographe et de grammaire en préservant scrupuleusement le style et la mise en page.',
		systemInstruction: `Corrige rigoureusement les fautes d'orthographe, de grammaire, de conjugaison, d'accords, de ponctuation et de typographie du texte suivant.
CONSIGNES STRICTES :
1. NE REFORMULE PAS : ne modifie ni la structure des phrases, ni le style, ni le vocabulaire de l'auteur. Conserve scrupuleusement chaque mot, ton et registre de langue.
2. Respecte fidèlement la mise en page, les retours à la ligne, les indentations et les balises Markdown (titres #, listes -, cases à cocher - [ ], liens [[...]], mise en forme gras/italique, etc.).
3. Rends UNIQUEMENT le texte corrigé, sans introduction, sans conclusion, sans méta-commentaire et sans bloc de code markdown englobant.`,
		model: '',
		icon: 'check-check',
		showInContextMenu: true,
		showInCommandPalette: true,
		requiresSelection: false,
		actionType: 'builtin',
		builtinType: 'correct',
		enabled: true
	},
	{
		id: 'summarize',
		name: 'Résumer',
		description: 'Génère un résumé synthétique et clair avec les points clés et conclusions principales.',
		systemInstruction: `Fais un résumé synthétique, clair et percutant du texte suivant. Mets en valeur les conclusions et points clés principaux. Renvoie directement le texte résultant sans méta-commentaire.`,
		model: '',
		icon: 'file-text',
		showInContextMenu: true,
		showInCommandPalette: true,
		requiresSelection: false,
		actionType: 'builtin',
		builtinType: 'summarize',
		enabled: true
	},
	{
		id: 'rephrase',
		name: 'Reformuler la sélection',
		description: 'Améliore la clarté, le professionnalisme et la fluidité tout en conservant le sens initial.',
		systemInstruction: `Reformule le texte suivant pour améliorer sa clarté, son professionnalisme et sa fluidité tout en conservant scrupuleusement son sens d'origine. Renvoie directement le texte sans méta-commentaire.`,
		model: '',
		icon: 'sparkles',
		showInContextMenu: true,
		showInCommandPalette: true,
		requiresSelection: true,
		actionType: 'builtin',
		builtinType: 'rephrase',
		enabled: true
	},
	{
		id: 'extract_tasks',
		name: 'Extraire les tâches',
		description: 'Analyse le texte et en extrait toutes les actions concrètes au format Obsidian Tasks.',
		systemInstruction: `Analyser le texte fourni et en extraire toutes les actions concrètes et réalisables en respectant la syntaxe des tâches Obsidian configurée.`,
		model: '',
		icon: 'check-square',
		showInContextMenu: true,
		showInCommandPalette: true,
		requiresSelection: false,
		actionType: 'builtin',
		builtinType: 'extract_tasks',
		enabled: true
	},
	{
		id: 'breakdown_task',
		name: 'Décomposer cette tâche',
		description: 'Décompose la tâche sous le curseur en 3 à 5 sous-tâches concrètes et atomiques.',
		systemInstruction: `Décomposer la tâche complexe en 3 à 5 sous-étapes simples, chronologiques et immédiatement actionnables ("Next Actions").`,
		model: '',
		icon: 'list-tree',
		showInContextMenu: true,
		showInCommandPalette: true,
		requiresSelection: false,
		actionType: 'builtin',
		builtinType: 'breakdown_task',
		enabled: true
	}
];
