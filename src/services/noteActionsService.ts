import { App, Editor, MarkdownView, Notice } from 'obsidian';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { TaskMutator } from '../mutators/taskMutator';
import { TaskParser } from '../parsers/taskParser';
import { VaultFilterService } from './vaultFilterService';
import { NoteActionModal } from '../modals/noteActionModal';
import SecondBrainPlugin from '../main';

export type NoteActionType = 'extract_tasks' | 'breakdown_task' | 'summarize' | 'rephrase' | 'correct';

export class NoteActionsService {
	/**
	 * Récupère la configuration LLM active pour exécuter l'action.
	 */
	private static async getLLMConfig(plugin: SecondBrainPlugin, signal?: AbortSignal): Promise<LLMConfig> {
		const apiKey = await plugin.getSecretApiKey(plugin.settings.llmProvider);
		return {
			provider: plugin.settings.llmProvider,
			endpoint: plugin.settings.llmEndpoint,
			model: plugin.settings.llmModel,
			productId: plugin.settings.infomaniakProductId,
			apiKey,
			signal
		};
	}

	/**
	 * Extrait les tâches et actions concrètes depuis le texte d'une note ou une sélection.
	 */
	public static async extractTasks(
		text: string,
		noteBasename: string,
		plugin: SecondBrainPlugin
	): Promise<string> {
		const todayStr = new Date().toISOString().split('T')[0];
		const config = await this.getLLMConfig(plugin);

		const taskSyntaxDesc = TaskMutator.getTaskSyntaxPromptDescription(plugin.settings);

		const systemPrompt = `Tu es l'assistant de productivité "Second Brain Manager".
TON OBJECTIF : Analyser le texte fourni (compte-rendu de réunion, notes brutes, email, document) et en extraire toutes les actions concrètes et réalisables.

CONSIGNES STRICTES DE FORMATAGE :
1. Chaque action doit commencer par un verbe d'action à l'infinitif.
2. Chaque action doit impérativement respecter la syntaxe configurée :
${taskSyntaxDesc}
3. Estimation des métadonnées :
   - Date due : date mentionnée dans le texte ou date d'aujourd'hui (${todayStr}) si urgent.
   - Matrice : #tm/q1 (urgent & important), #tm/q2 (important de fond), #tm/q3 (urgent non important), ou #tm/q4 (ou équivalent dataview/tag selon configuration).
   - Énergie : 1 à 10 (1 = très rapide, 10 = tâche complexe).
4. Liens & Références : Si une personne, un contact, un projet ou une autre note est mentionné dans l'intitulé de la tâche, entoure-le systématiquement d'un wikilink [[...]] (ex: "Appeler [[Claire Dupont]]", "Envoyer le compte-rendu à [[Sophie]]").
5. Ne renvoie AUCUN blabla, AUCUN commentaire, AUCUN bloc markdown \`\`\` : renvoie UNIQUEMENT la liste des lignes de tâches.
6. Si aucune action n'est identifiable, renvoie exactement: "Aucune action concrète identifiée."`;

		const userPrompt = `Texte à analyser :\n\n${text}`;

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		];

		const response = await LLMService.generateResponse(messages, config);
		const rawContent = response.content.replace(/```(?:markdown)?/g, '').trim();

		if (rawContent.includes('Aucune action')) {
			return 'Aucune action concrète identifiée.';
		}

		// Nettoyage, parsing multi-format et reformatage strict selon les settings
		const lines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
		const formattedLines: string[] = [];

		for (const line of lines) {
			if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|')) continue;
			const cleanLine = TaskMutator.cleanTaskPrefix(line);
			if (cleanLine.length > 0) {
				const candidateLine = `- [ ] ${cleanLine}`;
				const parsed = TaskParser.parseLine(candidateLine, noteBasename, 1, plugin.settings);
				if (parsed) {
					const strictlyFormatted = TaskMutator.formatTaskLine({
						title: parsed.title,
						dueDate: parsed.dueDate,
						scheduledDate: parsed.scheduledDate,
						startDate: parsed.startDate,
						priority: parsed.priority,
						energy: parsed.energy,
						difficulty: parsed.difficulty,
						pieces: parsed.pieces,
						matrixTag: parsed.matrixTag,
						domainTags: parsed.domainTags,
						linkedNotes: [noteBasename]
					}, plugin.settings);
					formattedLines.push(strictlyFormatted);
				} else {
					const normalized = cleanLine.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
					formattedLines.push(`- [ ] ${normalized} [[${noteBasename}]]`);
				}
			}
		}

		return formattedLines.length > 0 ? formattedLines.join('\n') : 'Aucune action concrète identifiée.';
	}

	/**
	 * Décompose une tâche sous le curseur en 3 à 5 sous-tâches concrètes et atomiques.
	 */
	public static async breakdownTask(
		taskLine: string,
		noteBasename: string,
		plugin: SecondBrainPlugin,
		indent = '\t'
	): Promise<string[]> {
		const parsed = TaskParser.parseLine(taskLine, '', 1, plugin.settings);
		const cleanTitle = parsed?.title || TaskMutator.cleanTaskPrefix(taskLine);
		const config = await this.getLLMConfig(plugin);

		const systemPrompt = `Tu es un expert GTD de l'assistant "Second Brain Manager".
TON OBJECTIF : Décomposer la tâche complexe suivante en 3 à 5 sous-étapes simples, chronologiques et immédiatement actionnables ("Next Actions").

CONSIGNES STRICTES :
1. Chaque sous-étape doit commencer par un verbe d'action clair à l'infinitif (ex: "Appeler...", "Rédiger...", "Vérifier...", "Envoyer...").
2. Si une personne, un contact, un projet ou une autre note est mentionné dans une sous-étape, utilise systématiquement un wikilink [[...]] (ex: "Contacter [[Claire]]", "Rédiger pour [[Projet Alpha]]").
3. Renvoie UNIQUEMENT les 3 à 5 lignes d'intitulés des sous-tâches, sans texte d'introduction ni de conclusion, sans bloc de code markdown.`;

		const userPrompt = `Tâche à décomposer : "${cleanTitle}" (provenant de [[${noteBasename}]])`;

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		];

		const response = await LLMService.generateResponse(messages, config);
		const rawLines = response.content
			.replace(/```(?:markdown)?/g, '')
			.split('\n')
			.map(l => l.trim())
			.filter(Boolean);

		return rawLines
			.map(line => {
				const cleanSubtask = TaskMutator.cleanTaskPrefix(line);
				return cleanSubtask ? `${indent}- [ ] ${cleanSubtask}` : '';
			})
			.filter(Boolean);
	}

	/**
	 * Résume, reformule ou corrige le texte fourni.
	 */
	public static async summarizeOrRephrase(
		text: string,
		mode: 'summary' | 'rephrase' | 'key_points' | 'correct',
		plugin: SecondBrainPlugin
	): Promise<string> {
		const config = await this.getLLMConfig(plugin);

		let instruction = '';
		if (mode === 'summary') {
			instruction = 'Fais un résumé synthétique, clair et percutant du texte suivant. Mets en valeur les conclusions principales.';
		} else if (mode === 'rephrase') {
			instruction = 'Reformule le texte suivant pour améliorer sa clarté, son professionnalisme et sa fluidité tout en conservant scrupuleusement son sens.';
		} else if (mode === 'correct') {
			instruction = `Corrige rigoureusement les fautes d'orthographe, de grammaire, de conjugaison, d'accords, de ponctuation et de typographie du texte suivant.
CONSIGNES STRICTES :
1. NE REFORMULE PAS : ne modifie ni la structure des phrases, ni le style, ni le vocabulaire de l'auteur. Conserve scrupuleusement chaque mot, ton et registre de langue.
2. Respecte fidèlement la mise en page, les retours à la ligne, les indentations et les balises Markdown (titres #, listes -, cases à cocher - [ ], liens [[...]], mise en forme gras/italique, etc.).
3. Rends UNIQUEMENT le texte corrigé, sans introduction, sans conclusion, sans méta-commentaire et sans bloc de code markdown englobant.`;
		} else {
			instruction = 'Extrais les points clés essentiels sous forme de liste à puces percutante.';
		}

		const systemPrompt = `Tu es l'assistant de rédaction "Second Brain Manager". ${instruction}
Renvoie directement le texte résultant sans méta-commentaire.`;

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: text }
		];

		const response = await LLMService.generateResponse(messages, config);
		let content = response.content.trim();
		if (content.startsWith('```') && content.endsWith('```')) {
			content = content.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
		}
		return content.trim();
	}

	/**
	 * Révise et affine un résultat existant en appliquant une consigne de suivi (Follow-up instruction).
	 */
	public static async refineResult(
		originalText: string,
		currentResult: string,
		followUpInstruction: string,
		actionType: NoteActionType,
		plugin: SecondBrainPlugin
	): Promise<string> {
		const config = await this.getLLMConfig(plugin);

		const actionLabels: Record<NoteActionType, string> = {
			extract_tasks: 'Extraction de tâches Markdown',
			breakdown_task: 'Décomposition de tâche',
			summarize: 'Résumé exécutif',
			rephrase: 'Reformulation de texte',
			correct: 'Correction orthographique et grammaticale sans reformulation'
		};

		const systemPrompt = `Tu es l'assistant "Second Brain Manager".
L'utilisateur a généré un résultat pour l'action "${actionLabels[actionType] || actionType}", et souhaite l'ajuster via une consigne de suivi.

Texte d'origine :
"""
${originalText}
"""

Résultat actuel à adapter :
"""
${currentResult}
"""

CONSIGNE D'AJUSTEMENT :
"${followUpInstruction}"

CONSIGNES STRICTES :
1. Applique scrupuleusement la consigne d'ajustement au résultat actuel.
2. Si l'action est une correction sans reformulation, veille à préserver le ton, la mise en page et le vocabulaire de l'auteur sauf demande expresse contraire.
3. Ne renvoie AUCUN commentaire, préambule, conclusion ou bloc markdown englobant \`\`\` : renvoie UNIQUEMENT le texte final révisé.`;

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: followUpInstruction }
		];

		const response = await LLMService.generateResponse(messages, config);
		let content = response.content.trim();
		if (content.startsWith('```') && content.endsWith('```')) {
			content = content.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
		}
		return content.trim();
	}

	/**
	 * Exécute l'extraction des tâches depuis la note ou sélection active dans l'éditeur avec prévisualisation et validation.
	 */
	public static async handleExtractTasksCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<NoteActionModal | void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor || !activeFile) {
			new Notice('Veuillez ouvrir une note Markdown pour extraire les tâches.');
			return;
		}

		const filterService = new VaultFilterService(app, plugin.settings);
		if (filterService.isFileExcluded(activeFile)) {
			new Notice('🔒 Cette note est protégée par vos filtres de confidentialité (exclusion IA).');
			return;
		}

		const selectedText = targetEditor.getSelection();
		const hasSelection = Boolean(selectedText.trim());
		const textToAnalyze = hasSelection ? selectedText : targetEditor.getValue();

		if (!textToAnalyze.trim()) {
			new Notice('La note est vide.');
			return;
		}

		const modal = new NoteActionModal(app, plugin, {
			title: 'Extraire les tâches',
			icon: 'check-square',
			actionType: 'extract_tasks',
			sourceText: textToAnalyze,
			generateInitial: () => this.extractTasks(textToAnalyze, activeFile.basename, plugin),
			onApplyReplace: (result) => {
				if (hasSelection) {
					targetEditor.replaceSelection(`### 📋 Actions Extraites\n${result}\n`);
				} else {
					const docLength = targetEditor.lineCount();
					const lastLineContent = targetEditor.getLine(docLength - 1);
					const prefix = lastLineContent.trim() ? '\n\n' : '\n';
					targetEditor.replaceRange(`${prefix}## 📋 Actions Extraites\n${result}\n`, { line: docLength, ch: 0 });
				}
			},
			onApplyInsert: (result) => {
				if (hasSelection) {
					const cursor = targetEditor.getCursor('to');
					targetEditor.replaceRange(`\n\n### 📋 Actions Extraites\n${result}\n`, cursor);
				} else {
					const docLength = targetEditor.lineCount();
					const lastLineContent = targetEditor.getLine(docLength - 1);
					const prefix = lastLineContent.trim() ? '\n\n' : '\n';
					targetEditor.replaceRange(`${prefix}## 📋 Actions Extraites\n${result}\n`, { line: docLength, ch: 0 });
				}
			}
		});

		modal.open();
		return modal;
	}

	/**
	 * Exécute la décomposition de la tâche sous la ligne du curseur avec prévisualisation et validation.
	 */
	public static async handleBreakdownTaskCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<NoteActionModal | void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor || !activeFile) {
			new Notice('Veuillez positionner votre curseur sur une tâche.');
			return;
		}

		const filterService = new VaultFilterService(app, plugin.settings);
		if (filterService.isFileExcluded(activeFile)) {
			new Notice('🔒 Cette note est protégée par vos filtres de confidentialité (exclusion IA).');
			return;
		}

		const cursor = targetEditor.getCursor();
		const currentLine = targetEditor.getLine(cursor.line);

		if (!/^[-*0-9.]*\s*\[[ xX/]\]/.test(currentLine.trim())) {
			new Notice('La ligne actuelle ne semble pas être une tâche (doit commencer par - [ ]).');
			return;
		}

		const indentMatch = currentLine.match(/^(\s*)/);
		const parentIndent = indentMatch ? indentMatch[1] : '';
		const indentStep = parentIndent.includes('\t') ? '\t' : (parentIndent.length > 0 ? '  ' : '\t');
		const childIndent = parentIndent + indentStep;

		const modal = new NoteActionModal(app, plugin, {
			title: 'Décomposer cette tâche',
			icon: 'list-tree',
			actionType: 'breakdown_task',
			sourceText: currentLine,
			generateInitial: async () => {
				const subtasks = await this.breakdownTask(currentLine, activeFile.basename, plugin, childIndent);
				return subtasks.join('\n');
			},
			onApplyReplace: (result) => {
				targetEditor.replaceRange(result, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: currentLine.length });
			},
			onApplyInsert: (result) => {
				targetEditor.replaceRange('\n' + result, { line: cursor.line, ch: currentLine.length });
			}
		});

		modal.open();
		return modal;
	}

	/**
	 * Exécute le résumé de la sélection ou de la note courante avec prévisualisation et validation.
	 */
	public static async handleSummarizeCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<NoteActionModal | void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor) {
			new Notice('Veuillez ouvrir une note Markdown.');
			return;
		}

		const filterService = new VaultFilterService(app, plugin.settings);
		if (activeFile && filterService.isFileExcluded(activeFile)) {
			new Notice('🔒 Cette note est protégée par vos filtres de confidentialité (exclusion IA).');
			return;
		}

		const selectedText = targetEditor.getSelection();
		const hasSelection = Boolean(selectedText.trim());
		const textToAnalyze = hasSelection ? selectedText : targetEditor.getValue();

		if (!textToAnalyze.trim()) {
			new Notice('La note est vide.');
			return;
		}

		const modal = new NoteActionModal(app, plugin, {
			title: 'Résumer',
			icon: 'file-text',
			actionType: 'summarize',
			sourceText: textToAnalyze,
			generateInitial: async () => {
				const summary = await this.summarizeOrRephrase(textToAnalyze, 'summary', plugin);
				return `> [!SUMMARY] Résumé Exécutif\n> ${summary.split('\n').join('\n> ')}`;
			},
			onApplyReplace: (result) => {
				if (hasSelection) {
					targetEditor.replaceSelection(result + '\n\n');
				} else {
					targetEditor.setValue(result + '\n\n' + targetEditor.getValue());
				}
			},
			onApplyInsert: (result) => {
				if (hasSelection) {
					const from = targetEditor.getCursor('from');
					targetEditor.replaceRange(`${result}\n\n`, from);
				} else {
					targetEditor.replaceRange(`${result}\n\n`, { line: 0, ch: 0 });
				}
			}
		});

		modal.open();
		return modal;
	}

	/**
	 * Exécute la reformulation de la sélection active avec prévisualisation et validation.
	 */
	public static async handleRephraseCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<NoteActionModal | void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor) {
			new Notice('Veuillez ouvrir une note Markdown.');
			return;
		}

		const filterService = new VaultFilterService(app, plugin.settings);
		if (activeFile && filterService.isFileExcluded(activeFile)) {
			new Notice('🔒 Cette note est protégée par vos filtres de confidentialité (exclusion IA).');
			return;
		}

		const selectedText = targetEditor.getSelection();
		if (!selectedText.trim()) {
			new Notice('Veuillez sélectionner le texte à reformuler.');
			return;
		}

		const modal = new NoteActionModal(app, plugin, {
			title: 'Reformuler la sélection',
			icon: 'sparkles',
			actionType: 'rephrase',
			sourceText: selectedText,
			generateInitial: () => this.summarizeOrRephrase(selectedText, 'rephrase', plugin),
			onApplyReplace: (result) => {
				targetEditor.replaceSelection(result);
			},
			onApplyInsert: (result) => {
				const to = targetEditor.getCursor('to');
				targetEditor.replaceRange(`\n\n${result}`, to);
			}
		});

		modal.open();
		return modal;
	}

	/**
	 * Exécute la correction orthographique et grammaticale sans reformulation avec prévisualisation et validation.
	 */
	public static async handleCorrectCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<NoteActionModal | void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor) {
			new Notice('Veuillez ouvrir une note Markdown.');
			return;
		}

		const filterService = new VaultFilterService(app, plugin.settings);
		if (activeFile && filterService.isFileExcluded(activeFile)) {
			new Notice('🔒 Cette note est protégée par vos filtres de confidentialité (exclusion IA).');
			return;
		}

		const selectedText = targetEditor.getSelection();
		const hasSelection = Boolean(selectedText.trim());
		const textToCorrect = hasSelection ? selectedText : targetEditor.getValue();

		if (!textToCorrect.trim()) {
			new Notice(hasSelection ? 'Veuillez sélectionner du texte à corriger.' : 'La note est vide.');
			return;
		}

		const modal = new NoteActionModal(app, plugin, {
			title: 'Corriger sans reformuler',
			icon: 'check-check',
			actionType: 'correct',
			sourceText: textToCorrect,
			generateInitial: () => this.summarizeOrRephrase(textToCorrect, 'correct', plugin),
			onApplyReplace: (result) => {
				if (hasSelection) {
					targetEditor.replaceSelection(result);
				} else {
					targetEditor.setValue(result);
				}
			},
			onApplyInsert: (result) => {
				if (hasSelection) {
					const to = targetEditor.getCursor('to');
					targetEditor.replaceRange(`\n\n${result}`, to);
				} else {
					const docLength = targetEditor.lineCount();
					targetEditor.replaceRange(`\n\n${result}`, { line: docLength, ch: 0 });
				}
			}
		});

		modal.open();
		return modal;
	}
}
