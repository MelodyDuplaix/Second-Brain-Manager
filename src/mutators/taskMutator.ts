import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from '../models/syntaxConfig';
import { TaskPriority } from '../models/task';
import { DynamicRegexBuilder } from '../parsers/regexBuilder';

export class TaskMutator {
	private static readonly BLOCK_ID_MATCH_REGEX = /\s+(\^[a-zA-Z0-9_-]+)$/;
	private static readonly ALL_PRIORITY_EMOJIS_REGEX = /[🔺⏫🔼🔽⏬]/gu;

	public static setCompleted(rawLine: string, completed: boolean, completionDate?: string, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const checkboxRegex = DynamicRegexBuilder.buildCheckboxRegex(config);
		const match = checkboxRegex.exec(rawLine);
		if (!match) return rawLine;

		const indentWhitespace = match[1];
		const body = match[3];
		const newStatusChar = completed ? 'x' : ' ';

		const completedDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.completedDateSignifier);
		const stdCompletedRegex = DynamicRegexBuilder.buildDateSignifierRegex('✅');
		const dvCompletedRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['completion', 'completed', 'done']);
		const tagCompletedRegex = DynamicRegexBuilder.buildTagDateRegex(['done', 'completion', 'completed']);

		const updatedBody = body
			.replace(completedDateRegex, '')
			.replace(stdCompletedRegex, '')
			.replace(dvCompletedRegex, '')
			.replace(tagCompletedRegex, '')
			.replace(/\s+/g, ' ')
			.trim();

		const lineWithStatus = `${indentWhitespace}- [${newStatusChar}] ${updatedBody}`;

		if (completed && completionDate) {
			const formattedDate = this.formatDate(completionDate, config);
			let meta = `${config.completedDateSignifier} ${formattedDate}`;
			if (config.taskFormat === 'dataview') {
				meta = `[completion:: ${formattedDate}]`;
			} else if (config.taskFormat === 'tag') {
				meta = `#done/${formattedDate}`;
			}
			return this.insertMetaBeforeBlockId(lineWithStatus, meta);
		}

		return lineWithStatus;
	}

	public static setStatus(rawLine: string, status: 'in_progress' | 'done' | 'todo' | 'cancelled' | string, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const checkboxRegex = DynamicRegexBuilder.buildCheckboxRegex(config);
		const match = checkboxRegex.exec(rawLine);
		if (!match) return rawLine;

		const indentWhitespace = match[1];
		const body = match[3];
		let statusChar = ' ';
		if (status === 'in_progress' || status === '/') statusChar = '/';
		else if (status === 'done' || status === 'completed' || status === 'x') statusChar = 'x';
		else if (status === 'cancelled' || status === '-') statusChar = '-';
		else statusChar = ' ';

		return `${indentWhitespace}- [${statusChar}] ${body}`;
	}

	public static setDueDate(rawLine: string, dateStr: string | null, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const dueDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.dueDateSignifier);
		const stdDueRegex = DynamicRegexBuilder.buildDateSignifierRegex('📅');
		const dvDueRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['due']);
		const tagDueRegex = DynamicRegexBuilder.buildTagDateRegex(['due']);

		const lineWithoutDue = rawLine
			.replace(dueDateRegex, '')
			.replace(stdDueRegex, '')
			.replace(dvDueRegex, '')
			.replace(tagDueRegex, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!dateStr) return lineWithoutDue;

		const formattedDate = this.formatDate(dateStr, config);
		let meta = `${config.dueDateSignifier} ${formattedDate}`;
		if (config.taskFormat === 'dataview') {
			meta = `[due:: ${formattedDate}]`;
		} else if (config.taskFormat === 'tag') {
			meta = `#due/${formattedDate}`;
		}
		return this.insertMetaBeforeBlockId(lineWithoutDue, meta);
	}

	public static setStartDate(rawLine: string, dateStr: string | null, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const startDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.startDateSignifier);
		const stdStartRegex = DynamicRegexBuilder.buildDateSignifierRegex('🛫');
		const dvStartRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['start']);
		const tagStartRegex = DynamicRegexBuilder.buildTagDateRegex(['start']);

		const lineWithoutStart = rawLine
			.replace(startDateRegex, '')
			.replace(stdStartRegex, '')
			.replace(dvStartRegex, '')
			.replace(tagStartRegex, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!dateStr) return lineWithoutStart;

		const formattedDate = this.formatDate(dateStr, config);
		let meta = `${config.startDateSignifier} ${formattedDate}`;
		if (config.taskFormat === 'dataview') {
			meta = `[start:: ${formattedDate}]`;
		} else if (config.taskFormat === 'tag') {
			meta = `#start/${formattedDate}`;
		}
		return this.insertMetaBeforeBlockId(lineWithoutStart, meta);
	}

	public static setScheduledDate(rawLine: string, dateStr: string | null, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const scheduledDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.scheduledDateSignifier);
		const stdScheduledRegex = DynamicRegexBuilder.buildDateSignifierRegex('⏳');
		const dvScheduledRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['scheduled']);
		const tagScheduledRegex = DynamicRegexBuilder.buildTagDateRegex(['scheduled']);

		const lineWithoutScheduled = rawLine
			.replace(scheduledDateRegex, '')
			.replace(stdScheduledRegex, '')
			.replace(dvScheduledRegex, '')
			.replace(tagScheduledRegex, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!dateStr) return lineWithoutScheduled;

		const formattedDate = this.formatDate(dateStr, config);
		let meta = `${config.scheduledDateSignifier} ${formattedDate}`;
		if (config.taskFormat === 'dataview') {
			meta = `[scheduled:: ${formattedDate}]`;
		} else if (config.taskFormat === 'tag') {
			meta = `#scheduled/${formattedDate}`;
		}
		return this.insertMetaBeforeBlockId(lineWithoutScheduled, meta);
	}

	public static setPriority(rawLine: string, priority: TaskPriority | null, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const tagPrefix = config.priorityTagPrefix;
		const tagRegex = DynamicRegexBuilder.buildTagRegex(tagPrefix, false);
		const stdPrioriteRegex = DynamicRegexBuilder.buildTagRegex('priorite', false);
		const stdPriorityRegex = DynamicRegexBuilder.buildTagRegex('priority', false);
		const stdPrioRegex = DynamicRegexBuilder.buildTagRegex('prio', false);
		const dvPriorityRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['priority', 'priorite']);

		const cleaned = rawLine
			.replace(tagRegex, '')
			.replace(stdPrioriteRegex, '')
			.replace(stdPriorityRegex, '')
			.replace(stdPrioRegex, '')
			.replace(dvPriorityRegex, '')
			.replace(this.ALL_PRIORITY_EMOJIS_REGEX, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!priority || priority === 'normal') return cleaned;

		if (config.taskFormat === 'dataview') {
			return this.insertMetaBeforeBlockId(cleaned, `[priority:: ${priority}]`);
		}

		if (config.priorityMode === 'emoji' && config.taskFormat !== 'tag') {
			const emojiMap: Record<TaskPriority, string> = {
				highest: config.highestPrioritySignifier,
				high: config.highPrioritySignifier,
				medium: config.mediumPrioritySignifier,
				normal: '',
				low: config.lowPrioritySignifier,
				lowest: config.lowestPrioritySignifier
			};
			const emoji = emojiMap[priority];
			return this.insertMetaBeforeBlockId(cleaned, emoji);
		} else {
			const tagString = `#${config.priorityTagPrefix}/${priority}`;
			return this.insertMetaBeforeBlockId(cleaned, tagString);
		}
	}

	public static setControlledTag(
		rawLine: string,
		tagType: 'energie' | 'difficulte' | 'pieces' | 'priorite' | 'matrix',
		value: string | number | null,
		config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG
	): string {
		if (tagType === 'priorite') {
			return this.setPriority(rawLine, value as TaskPriority | null, config);
		}

		const prefixMap = {
			energie: config.energyTagPrefix,
			difficulte: config.difficultyTagPrefix,
			pieces: config.piecesTagPrefix,
			matrix: config.matrixTagPrefix,
		};

		const tagPrefix = prefixMap[tagType];
		const isNumeric = tagType === 'energie' || tagType === 'pieces';
		const tagRegex = DynamicRegexBuilder.buildTagRegex(tagPrefix, isNumeric);
		const stdTagRegex = DynamicRegexBuilder.buildTagRegex(tagType === 'energie' ? 'energy' : (tagType === 'difficulte' ? 'difficulty' : (tagType === 'pieces' ? 'coins' : tagType)), isNumeric);

		const dvFieldNames = tagType === 'energie' ? ['energy', 'energie']
			: (tagType === 'difficulte' ? ['difficulty', 'difficulte']
			: (tagType === 'pieces' ? ['pieces', 'piece', 'coins', 'coin']
			: ['matrix', 'quadrant', 'eisenhower']));
		const dvRegex = DynamicRegexBuilder.buildDataviewFieldRegex(dvFieldNames);

		const updatedLine = rawLine
			.replace(tagRegex, '')
			.replace(stdTagRegex, '')
			.replace(dvRegex, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (value === null || value === undefined) return updatedLine;

		if (config.taskFormat === 'dataview') {
			const dvFieldName = tagType === 'energie' ? 'energy' : (tagType === 'difficulte' ? 'difficulty' : (tagType === 'pieces' ? 'pieces' : 'matrix'));
			return this.insertMetaBeforeBlockId(updatedLine, `[${dvFieldName}:: ${value}]`);
		}

		const tagString = `#${tagType === 'matrix' ? value : `${tagPrefix}/${value}`}`;
		return this.insertMetaBeforeBlockId(updatedLine, tagString);
	}

	/**
	 * Nettoie rigoureusement tous les préfixes de listes, numérotations et cases à cocher (simples ou dupliqués).
	 * Exemple : "- [ ] - [ ] Faire X" -> "Faire X", "[ ] [ ] Faire X" -> "Faire X", "1. - [ ] Faire X" -> "Faire X"
	 */
	public static cleanTaskPrefix(rawText: string): string {
		if (!rawText) return '';
		let text = rawText.trim();
		let prev = '';
		while (prev !== text) {
			prev = text;
			text = text
				.replace(/^[-*+]\s+/, '')
				.replace(/^\d+[.)]\s+/, '')
				.replace(/^\[[- xX/!?b>]?\]\s*/, '')
				.trim();
		}
		return text;
	}

	public static createSubtaskLine(parentIndent: number | string, subtaskTitle: string): string {
		const cleanTitle = this.cleanTaskPrefix(subtaskTitle);
		const indent = typeof parentIndent === 'number'
			? '  '.repeat(parentIndent + 1)
			: parentIndent;
		return `${indent}- [ ] ${cleanTitle}`;
	}

	/**
	 * Formate une tâche complète selon la configuration active des settings.
	 */
	public static formatTaskLine(
		options: {
			title: string;
			dueDate?: string | null;
			scheduledDate?: string | null;
			startDate?: string | null;
			completedDate?: string | null;
			priority?: TaskPriority | null;
			energy?: number | null;
			difficulty?: string | null;
			pieces?: number | null;
			matrixQuadrant?: string | null;
			matrixTag?: string | null;
			domainTags?: string[];
			linkedNotes?: string[];
			blockId?: string;
			completed?: boolean;
			statusChar?: string;
			indentLevel?: number | string;
		},
		config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG
	): string {
		const cleanTitle = this.cleanTaskPrefix(options.title);
		const indent = typeof options.indentLevel === 'number'
			? '  '.repeat(options.indentLevel)
			: (options.indentLevel || '');

		const statusChar = options.statusChar || (options.completed ? 'x' : ' ');
		let line = `${indent}- [${statusChar}] ${cleanTitle}`;

		if (options.dueDate) {
			line = this.setDueDate(line, options.dueDate, config);
		}
		if (options.scheduledDate) {
			line = this.setScheduledDate(line, options.scheduledDate, config);
		}
		if (options.startDate) {
			line = this.setStartDate(line, options.startDate, config);
		}
		if (options.priority) {
			line = this.setPriority(line, options.priority, config);
		}
		if (options.energy !== undefined && options.energy !== null) {
			line = this.setControlledTag(line, 'energie', options.energy, config);
		}
		if (options.difficulty) {
			line = this.setControlledTag(line, 'difficulte', options.difficulty, config);
		}
		if (options.pieces !== undefined && options.pieces !== null) {
			line = this.setControlledTag(line, 'pieces', options.pieces, config);
		}
		if (options.matrixQuadrant) {
			const qTag = options.matrixQuadrant.startsWith('q') ? options.matrixQuadrant : `q${options.matrixQuadrant}`;
			const matrixVal = config.taskFormat === 'dataview'
				? qTag
				: `${config.matrixTagPrefix || 'tm/q'}${qTag.replace('q', '')}`;
			line = this.setControlledTag(line, 'matrix', matrixVal, config);
		} else if (options.matrixTag) {
			const cleanMat = options.matrixTag.replace(/^#/, '');
			line = this.setControlledTag(line, 'matrix', cleanMat, config);
		}

		if (options.domainTags && options.domainTags.length > 0) {
			const tagsStr = options.domainTags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
			line = `${line} ${tagsStr}`;
		}
		if (options.linkedNotes && options.linkedNotes.length > 0) {
			const linksStr = options.linkedNotes.map(n => n.startsWith('[[') ? n : `[[${n}]]`).join(' ');
			line = `${line} ${linksStr}`;
		}
		if (options.completed && options.completedDate) {
			line = this.setCompleted(line, true, options.completedDate, config);
		}
		if (options.blockId) {
			line = this.insertMetaBeforeBlockId(line, `^${options.blockId.replace(/^\^/, '')}`);
		}

		return line.replace(/\s+/g, ' ').trim();
	}

	/**
	 * Formate un objet ObsidianTask existant selon la syntaxe configurée (pour les prompts LLM ou l'affichage).
	 */
	public static formatTaskForPrompt(
		task: ObsidianTask,
		config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG,
		includeLocation = true
	): string {
		const noteBasename = task.filePath ? task.filePath.replace(/\.md$/, '').split('/').pop() : undefined;
		const linkedNotes = noteBasename ? [noteBasename] : [];

		let line = this.formatTaskLine({
			title: task.title,
			dueDate: task.dueDate,
			scheduledDate: task.scheduledDate,
			startDate: task.startDate,
			completedDate: task.completedDate,
			priority: task.priority,
			energy: task.energy,
			difficulty: task.difficulty,
			pieces: task.pieces,
			matrixTag: task.matrixTag,
			domainTags: task.domainTags,
			linkedNotes,
			completed: task.completed,
			statusChar: task.statusChar
		}, config);

		if (includeLocation && task.filePath && task.lineNumber) {
			line += ` (Fichier: "${task.filePath}", Ligne: ${task.lineNumber})`;
		}

		return line;
	}

	/**
	 * Fournit les instructions textuelles et un exemple précis de la syntaxe de tâches active
	 * configurée dans les paramètres pour les prompts des modèles de langage (LLM).
	 */
	public static getTaskSyntaxPromptDescription(config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const dateEx = config.useWikilinks ? '[[YYYY-MM-DD]]' : 'YYYY-MM-DD';

		if (config.taskFormat === 'dataview') {
			return `FORMAT STRICT DES TÂCHES (Dataview Inline Fields) :
Chaque tâche DOIT impérativement respecter le format Dataview configuré par l'utilisateur :
- [ ] Titre de la tâche [due:: ${dateEx}] [scheduled:: ${dateEx}] [start:: ${dateEx}] [priority:: high] [energy:: 5] [matrix:: q1] [[LienNote]]
Règles :
- Les échéances doivent utiliser [due:: ...], la date planifiée [scheduled:: ...], la date de début [start:: ...].
- Les métadonnées utilisent des champs Dataview entre crochets : [priority:: ...], [energy:: ...], [matrix:: ...].`;
		} else if (config.taskFormat === 'tag') {
			return `FORMAT STRICT DES TÂCHES (Tags) :
Chaque tâche DOIT impérativement respecter le format Tags configuré par l'utilisateur :
- [ ] Titre de la tâche #due/${dateEx} #scheduled/${dateEx} #start/${dateEx} #${config.priorityTagPrefix}/haute #${config.energyTagPrefix}/5 #${config.matrixTagPrefix || 'tm/q'}1 [[LienNote]]
Règles :
- Les dates s'écrivent sous forme de tags : #due/..., #scheduled/..., #start/...
- Les priorités s'écrivent sous forme de tags : #${config.priorityTagPrefix}/haute, #${config.priorityTagPrefix}/moyenne, etc.
- L'énergie s'écrit #${config.energyTagPrefix}/N.`;
		} else {
			const prioEx = config.priorityMode === 'tag'
				? `#${config.priorityTagPrefix}/haute`
				: (config.highPrioritySignifier || '⏫');
			return `FORMAT STRICT DES TÂCHES (Obsidian Tasks - Emojis) :
Chaque tâche DOIT impérativement respecter le format Emojis configuré par l'utilisateur :
- [ ] Titre de la tâche ${config.dueDateSignifier} ${dateEx} ${config.scheduledDateSignifier} ${dateEx} ${config.startDateSignifier} ${dateEx} ${prioEx} #${config.energyTagPrefix}/5 #${config.matrixTagPrefix || 'tm/q'}1 [[LienNote]]
Règles :
- Échéance : ${config.dueDateSignifier} ${dateEx}
- Date planifiée : ${config.scheduledDateSignifier} ${dateEx}
- Date de début : ${config.startDateSignifier} ${dateEx}
- Priorité : ${prioEx} (ou ${config.highestPrioritySignifier || '🔺'}, ${config.mediumPrioritySignifier || '🔼'}, ${config.lowPrioritySignifier || '🔽'})
- Énergie : #${config.energyTagPrefix}/1 à 10
- Matrice : #${config.matrixTagPrefix || 'tm/q'}1 à 4`;
		}
	}

	private static insertMetaBeforeBlockId(line: string, metaString: string): string {
		const blockIdMatch = this.BLOCK_ID_MATCH_REGEX.exec(line);
		if (blockIdMatch) {
			const blockId = blockIdMatch[1];
			const lineWithoutBlockId = line.slice(0, -blockId.length).trim();
			return `${lineWithoutBlockId} ${metaString} ${blockId}`;
		}
		return `${line} ${metaString}`;
	}

	private static formatDate(dateStr: string, config: TaskSyntaxConfig): string {
		if (config.useWikilinks) {
			return `[[${dateStr}]]`;
		}
		return dateStr;
	}
}
