import { App, Editor, MarkdownView, Notice } from 'obsidian';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { TaskMutator } from '../mutators/taskMutator';
import { TaskParser } from '../parsers/taskParser';
import SecondBrainPlugin from '../main';

export type NoteActionType = 'extract_tasks' | 'breakdown_task' | 'summarize' | 'rephrase';

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

		const systemPrompt = `Tu es l'assistant de productivité "Second Brain Manager".
TON OBJECTIF : Analyser le texte fourni (compte-rendu de réunion, notes brutes, email, document) et en extraire toutes les actions concrètes et réalisables.

CONSIGNES STRICTES DE FORMATAGE :
1. Chaque action doit commencer par un verbe d'action à l'infinitif.
2. Chaque action doit être au format Obsidian Tasks strict :
   - [ ] Action concrète 📅 YYYY-MM-DD #tm/qN #energie/X [[${noteBasename}]]
3. Estimation des métadonnées :
   - 📅 Date due : date mentionnée dans le texte ou date d'aujourd'hui (${todayStr}) si urgent.
   - #tm/q1 (urgent & important), #tm/q2 (important de fond), #tm/q3 (urgent non important), ou #tm/q4.
   - #energie/1 à 10 : estimation de l'effort cognitif (1 = très rapide, 10 = tâche complexe).
   - Toujours terminer la ligne par le lien vers la note source [[${noteBasename}]].
4. Ne renvoie AUCUN blabla, AUCUN commentaire, AUCUN bloc markdown \`\`\` : renvoie UNIQUEMENT la liste des lignes de tâches.
5. Si aucune action n'est identifiable, renvoie exactement: "Aucune action concrète identifiée."`;

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

		// Nettoyage et normalisation de chaque ligne de tâche extraite
		const lines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
		const formattedLines: string[] = [];

		for (const line of lines) {
			if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|')) continue;
			const cleanLine = TaskMutator.cleanTaskPrefix(line);
			if (cleanLine.length > 0) {
				const normalized = cleanLine.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
				formattedLines.push(`- [ ] ${normalized}`);
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
2. Renvoie UNIQUEMENT les 3 à 5 lignes d'intitulés des sous-tâches, sans texte d'introduction ni de conclusion, sans bloc de code markdown.`;

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
	 * Résume ou reformule le texte fourni.
	 */
	public static async summarizeOrRephrase(
		text: string,
		mode: 'summary' | 'rephrase' | 'key_points',
		plugin: SecondBrainPlugin
	): Promise<string> {
		const config = await this.getLLMConfig(plugin);

		let instruction = '';
		if (mode === 'summary') {
			instruction = 'Fais un résumé synthétique, clair et percutant du texte suivant. Mets en valeur les conclusions principales.';
		} else if (mode === 'rephrase') {
			instruction = 'Reformule le texte suivant pour améliorer sa clarté, son professionnalisme et sa fluidité tout en conservant scrupuleusement son sens.';
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
		return response.content.trim();
	}

	/**
	 * Exécute l'extraction des tâches depuis la note ou sélection active dans l'éditeur.
	 */
	public static async handleExtractTasksCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor || !activeFile) {
			new Notice('Veuillez ouvrir une note Markdown pour extraire les tâches.');
			return;
		}

		const selectedText = targetEditor.getSelection();
		const textToAnalyze = selectedText.trim() ? selectedText : targetEditor.getValue();

		if (!textToAnalyze.trim()) {
			new Notice('La note est vide.');
			return;
		}

		const notice = new Notice('🧠 Extraction des tâches en cours...', 0);

		try {
			const result = await this.extractTasks(textToAnalyze, activeFile.basename, plugin);
			notice.hide();

			if (result.includes('Aucune action')) {
				new Notice('ℹ️ Aucune action concrète identifiée dans ce texte.');
				return;
			}

			// Insertion des tâches extraites
			if (selectedText.trim()) {
				// Insère directement après la sélection
				const cursor = targetEditor.getCursor('to');
				targetEditor.replaceRange(`\n\n### 📋 Actions Extraites\n${result}\n`, cursor);
			} else {
				// Insère à la fin du document
				const docLength = targetEditor.lineCount();
				const lastLineContent = targetEditor.getLine(docLength - 1);
				const prefix = lastLineContent.trim() ? '\n\n' : '\n';
				targetEditor.replaceRange(`${prefix}## 📋 Actions Extraites\n${result}\n`, { line: docLength, ch: 0 });
			}

			new Notice('✅ Tâches extraites et insérées avec succès !');
		} catch (err: unknown) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`❌ Erreur lors de l'extraction : ${msg}`);
		}
	}

	/**
	 * Exécute la décomposition de la tâche sous la ligne du curseur.
	 */
	public static async handleBreakdownTaskCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;
		const activeFile = targetView?.file;

		if (!targetEditor || !activeFile) {
			new Notice('Veuillez positionner votre curseur sur une tâche.');
			return;
		}

		const cursor = targetEditor.getCursor();
		const currentLine = targetEditor.getLine(cursor.line);

		if (!/^[-*0-9.]*\s*\[[ xX/]\]/.test(currentLine.trim())) {
			new Notice('La ligne actuelle ne semble pas être une tâche (doit commencer par - [ ]).');
			return;
		}

		const notice = new Notice('🧩 Décomposition de la tâche en cours...', 0);

		try {
			// Déterminer l'indentation appropriée par rapport à la ligne parente
			const indentMatch = currentLine.match(/^(\s*)/);
			const parentIndent = indentMatch ? indentMatch[1] : '';
			const indentStep = parentIndent.includes('\t') ? '\t' : (parentIndent.length > 0 ? '  ' : '\t');
			const childIndent = parentIndent + indentStep;

			const subtasks = await this.breakdownTask(currentLine, activeFile.basename, plugin, childIndent);
			notice.hide();

			if (subtasks.length === 0) {
				new Notice('Impossible de décomposer cette tâche.');
				return;
			}

			const insertText = '\n' + subtasks.join('\n');
			targetEditor.replaceRange(insertText, { line: cursor.line, ch: currentLine.length });

			new Notice(`✅ Tâche décomposée en ${subtasks.length} sous-étapes !`);
		} catch (err: unknown) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`❌ Erreur lors de la décomposition : ${msg}`);
		}
	}

	/**
	 * Exécute le résumé de la sélection ou de la note courante.
	 */
	public static async handleSummarizeCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;

		if (!targetEditor) {
			new Notice('Veuillez ouvrir une note Markdown.');
			return;
		}

		const selectedText = targetEditor.getSelection();
		const textToAnalyze = selectedText.trim() ? selectedText : targetEditor.getValue();

		if (!textToAnalyze.trim()) {
			new Notice('La note est vide.');
			return;
		}

		const notice = new Notice('📝 Génération du résumé...', 0);

		try {
			const summary = await this.summarizeOrRephrase(textToAnalyze, 'summary', plugin);
			notice.hide();

			const callout = `> [!SUMMARY] Résumé Exécutif\n> ${summary.split('\n').join('\n> ')}\n\n`;

			if (selectedText.trim()) {
				const from = targetEditor.getCursor('from');
				targetEditor.replaceRange(`${callout}${selectedText}`, from, targetEditor.getCursor('to'));
			} else {
				targetEditor.replaceRange(callout, { line: 0, ch: 0 });
			}

			new Notice('✅ Résumé généré et inséré !');
		} catch (err: unknown) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`❌ Erreur : ${msg}`);
		}
	}

	/**
	 * Exécute la reformulation de la sélection active.
	 */
	public static async handleRephraseCommand(app: App, plugin: SecondBrainPlugin, editor?: Editor, view?: MarkdownView): Promise<void> {
		const targetView = view || app.workspace.getActiveViewOfType(MarkdownView);
		const targetEditor = editor || targetView?.editor;

		if (!targetEditor) {
			new Notice('Veuillez ouvrir une note Markdown.');
			return;
		}

		const selectedText = targetEditor.getSelection();
		if (!selectedText.trim()) {
			new Notice('Veuillez sélectionner le texte à reformuler.');
			return;
		}

		const notice = new Notice('✨ Reformulation en cours...', 0);

		try {
			const rephrased = await this.summarizeOrRephrase(selectedText, 'rephrase', plugin);
			notice.hide();

			targetEditor.replaceSelection(rephrased);
			new Notice('✅ Texte reformulé avec succès !');
		} catch (err: unknown) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`❌ Erreur : ${msg}`);
		}
	}
}
