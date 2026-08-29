import { ObsidianTask, TaskStatus, TaskPriority } from '../models/task';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from '../models/syntaxConfig';
import { DynamicRegexBuilder } from './regexBuilder';
import { TaskMutator } from '../mutators/taskMutator';

export class TaskParser {
	private static readonly BLOCK_ID_REGEX = /\^([a-zA-Z0-9_-]+)$/;
	private static readonly ALL_TAGS_REGEX = /#([\w/_-]+)/g;

	private static readonly PRIORITY_EMOJIS_REGEX = /([🔺⏫🔼🔽⏬])/u;

	public static parseLine(rawLine: string, filePath: string, lineNumber: number, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ObsidianTask | null {
		const checkboxRegex = DynamicRegexBuilder.buildCheckboxRegex(config);
		const match = checkboxRegex.exec(rawLine);
		if (!match) return null;

		const indentWhitespace = match[1];
		const statusChar = match[2];
		const body = match[3].trim();

		const indentLevel = this.calculateIndentLevel(indentWhitespace);
		const completed = statusChar.toLowerCase() === 'x';
		const status = this.resolveTaskStatus(statusChar);

		const dueDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.dueDateSignifier);
		const scheduledDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.scheduledDateSignifier);
		const startDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.startDateSignifier);
		const completedDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.completedDateSignifier);
		const cancelledDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.cancelledDateSignifier);
		const createdDateRegex = DynamicRegexBuilder.buildDateSignifierRegex('➕');
		const recurrenceRegex = DynamicRegexBuilder.buildRecurrenceRegex(config.recurrenceSignifier);

		const stdDueRegex = DynamicRegexBuilder.buildDateSignifierRegex('📅');
		const stdScheduledRegex = DynamicRegexBuilder.buildDateSignifierRegex('⏳');
		const stdStartRegex = DynamicRegexBuilder.buildDateSignifierRegex('🛫');
		const stdCompletedRegex = DynamicRegexBuilder.buildDateSignifierRegex('✅');
		const stdCancelledRegex = DynamicRegexBuilder.buildDateSignifierRegex('❌');

		// Tag date regexes
		const tagDueRegex = DynamicRegexBuilder.buildTagDateRegex(['due']);
		const tagScheduledRegex = DynamicRegexBuilder.buildTagDateRegex(['scheduled']);
		const tagStartRegex = DynamicRegexBuilder.buildTagDateRegex(['start']);
		const tagCompletedRegex = DynamicRegexBuilder.buildTagDateRegex(['done', 'completion', 'completed']);
		const tagCancelledRegex = DynamicRegexBuilder.buildTagDateRegex(['cancelled', 'canceled']);

		// Dataview field regexes
		const dvDueRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['due']);
		const dvScheduledRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['scheduled']);
		const dvStartRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['start']);
		const dvCompletedRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['completion', 'completed', 'done']);
		const dvCancelledRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['cancelled', 'canceled']);
		const dvRecurrenceRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['repeat', 'recurrence']);
		const dvPriorityRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['priority', 'priorite']);
		const dvEnergyRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['energy', 'energie']);
		const dvDifficultyRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['difficulty', 'difficulte']);
		const dvPiecesRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['pieces', 'piece', 'coins', 'coin']);
		const dvMatrixRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['matrix', 'quadrant', 'eisenhower']);

		const energyRegex = DynamicRegexBuilder.buildTagRegex(config.energyTagPrefix, true);
		const stdEnergyRegex = DynamicRegexBuilder.buildTagRegex('energy', true);
		const stdEnergieRegex = DynamicRegexBuilder.buildTagRegex('energie', true);

		const difficultyRegex = DynamicRegexBuilder.buildTagRegex(config.difficultyTagPrefix, false);
		const stdDifficultyRegex = DynamicRegexBuilder.buildTagRegex('difficulty', false);
		const stdDifficulteRegex = DynamicRegexBuilder.buildTagRegex('difficulte', false);

		const piecesRegex = DynamicRegexBuilder.buildTagRegex(config.piecesTagPrefix, true);
		const stdPiecesRegex = DynamicRegexBuilder.buildTagRegex('pieces', true);
		const stdCoinsRegex = DynamicRegexBuilder.buildTagRegex('coins', true);

		const priorityRegex = DynamicRegexBuilder.buildTagRegex(config.priorityTagPrefix, false);
		const stdPrioriteRegex = DynamicRegexBuilder.buildTagRegex('priorite', false);
		const stdPriorityRegex = DynamicRegexBuilder.buildTagRegex('priority', false);
		const stdPrioRegex = DynamicRegexBuilder.buildTagRegex('prio', false);

		const matrixRegex = DynamicRegexBuilder.buildTagRegex(config.matrixTagPrefix, false);
		const stdMatrixTmRegex = /#tm\/q([1-4])/i;
		const stdMatrixQRegex = /#q([1-4])/i;
		const stdMatrixFocusRegex = /#focus/i;

		const rawDueDate = this.extractRegexMatch(body, dvDueRegex) 
			|| this.extractRegexMatch(body, tagDueRegex) 
			|| this.extractRegexMatch(body, dueDateRegex) 
			|| this.extractRegexMatch(body, stdDueRegex);
		let dueDate = DynamicRegexBuilder.normalizeDate(rawDueDate);

		const rawScheduledDate = this.extractRegexMatch(body, dvScheduledRegex) 
			|| this.extractRegexMatch(body, tagScheduledRegex) 
			|| this.extractRegexMatch(body, scheduledDateRegex) 
			|| this.extractRegexMatch(body, stdScheduledRegex);
		let scheduledDate = DynamicRegexBuilder.normalizeDate(rawScheduledDate);

		const rawStartDate = this.extractRegexMatch(body, dvStartRegex) 
			|| this.extractRegexMatch(body, tagStartRegex) 
			|| this.extractRegexMatch(body, startDateRegex) 
			|| this.extractRegexMatch(body, stdStartRegex);
		const startDate = DynamicRegexBuilder.normalizeDate(rawStartDate);

		const rawCompletedDate = this.extractRegexMatch(body, dvCompletedRegex) 
			|| this.extractRegexMatch(body, tagCompletedRegex) 
			|| this.extractRegexMatch(body, completedDateRegex) 
			|| this.extractRegexMatch(body, stdCompletedRegex);
		const completedDate = DynamicRegexBuilder.normalizeDate(rawCompletedDate);

		const rawCancelledDate = this.extractRegexMatch(body, dvCancelledRegex) 
			|| this.extractRegexMatch(body, tagCancelledRegex) 
			|| this.extractRegexMatch(body, cancelledDateRegex) 
			|| this.extractRegexMatch(body, stdCancelledRegex);
		const cancelledDate = DynamicRegexBuilder.normalizeDate(rawCancelledDate);

		const rawWikiDateRegex = /\[\[(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})(?:\s+[a-zA-ZÀ-ÿ]+)?\]\]/g;

		// Si aucune date explicite n'a été détectée avec un préfixe 📅 ou ⏳ ou Dataview ou Tag,
		// on recherche la présence d'un wikilink date brut (ex: [[17-08-2026 lu]] ou [[2026-08-17]])
		if (!dueDate && !scheduledDate) {
			const wikiDateMatch = /\[\[(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})(?:\s+[a-zA-ZÀ-ÿ]+)?\]\]/.exec(body);
			if (wikiDateMatch) {
				dueDate = DynamicRegexBuilder.normalizeDate(wikiDateMatch[1]);
			}
		}

		// Si toujours aucune date n'est précisée et que la tâche se trouve dans une note quotidienne (ex: 28-12-2025.md),
		// la date de la note quotidienne sert de date de planification implicite.
		if (!dueDate && !scheduledDate) {
			const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
			if (/^\d{4}-\d{2}-\d{2}$/.test(fileName) || /^\d{2}-\d{2}-\d{4}$/.test(fileName)) {
				scheduledDate = DynamicRegexBuilder.normalizeDate(fileName);
			}
		}

		const recurrence = this.extractRegexMatch(body, dvRecurrenceRegex) || this.extractRegexMatch(body, recurrenceRegex);

		const energyMatch = energyRegex.exec(body) || stdEnergyRegex.exec(body) || stdEnergieRegex.exec(body) || dvEnergyRegex.exec(body);
		const energy = energyMatch ? parseInt(energyMatch[1], 10) : undefined;

		const difficultyMatch = difficultyRegex.exec(body) || stdDifficultyRegex.exec(body) || stdDifficulteRegex.exec(body) || dvDifficultyRegex.exec(body);
		const difficulty = difficultyMatch ? difficultyMatch[1].toLowerCase() : undefined;

		const piecesMatch = piecesRegex.exec(body) || stdPiecesRegex.exec(body) || stdCoinsRegex.exec(body) || dvPiecesRegex.exec(body);
		const pieces = piecesMatch ? parseInt(piecesMatch[1], 10) : undefined;

		// Parsing des priorités Emoji Tasks, Tags et Dataview
		const emojiPriorityMatch = this.PRIORITY_EMOJIS_REGEX.exec(body);
		const priorityTagMatch = priorityRegex.exec(body) || stdPrioriteRegex.exec(body) || stdPriorityRegex.exec(body) || stdPrioRegex.exec(body);
		const dvPriorityMatch = dvPriorityRegex.exec(body);

		let priority: TaskPriority | undefined;
		let prioritySignifier: string | undefined;
		let priorityTag: string | undefined;

		if (emojiPriorityMatch) {
			prioritySignifier = emojiPriorityMatch[1];
			priority = this.resolveEmojiPriority(prioritySignifier, config);
		} else if (dvPriorityMatch) {
			const dvVal = dvPriorityMatch[1].toLowerCase().trim();
			priority = this.resolveTagPriority(dvVal);
			priorityTag = `[priority:: ${dvVal}]`;
		} else if (priorityTagMatch) {
			const rawVal = priorityTagMatch[1].toLowerCase();
			priority = this.resolveTagPriority(rawVal);
			priorityTag = priorityTagMatch[0];
		}

		const matrixMatch = matrixRegex.exec(body) || stdMatrixTmRegex.exec(body) || stdMatrixQRegex.exec(body) || stdMatrixFocusRegex.exec(body) || dvMatrixRegex.exec(body);
		const matrixTag = matrixMatch ? matrixMatch[0] : undefined;

		const domainTags = this.extractDomainTags(body, config);

		const rawPauseTag = config.pauseTag ? config.pauseTag.toLowerCase().replace(/^#/, '') : 'pause';
		const pauseTagRegex = new RegExp(`#(?:${rawPauseTag}|pause|en-pause|on-hold)(?=[^\\w-]|$)`, 'gi');

		const blockIdMatch = this.BLOCK_ID_REGEX.exec(body);
		const blockId = blockIdMatch ? blockIdMatch[1] : undefined;

		const title = this.cleanTitle(body, [
			dueDateRegex, scheduledDateRegex, startDateRegex, completedDateRegex,
			cancelledDateRegex, createdDateRegex, recurrenceRegex,
			stdDueRegex, stdScheduledRegex, stdStartRegex, stdCompletedRegex, stdCancelledRegex,
			tagDueRegex, tagScheduledRegex, tagStartRegex, tagCompletedRegex, tagCancelledRegex,
			energyRegex, stdEnergyRegex, stdEnergieRegex,
			difficultyRegex, stdDifficultyRegex, stdDifficulteRegex,
			piecesRegex, stdPiecesRegex, stdCoinsRegex,
			priorityRegex, stdPrioriteRegex, stdPriorityRegex, stdPrioRegex,
			matrixRegex, stdMatrixTmRegex, stdMatrixQRegex, stdMatrixFocusRegex,
			this.PRIORITY_EMOJIS_REGEX,
			DynamicRegexBuilder.DATAVIEW_ANY_FIELD_REGEX, DynamicRegexBuilder.ANY_TAG_DATE_REGEX,
			rawWikiDateRegex, this.BLOCK_ID_REGEX,
			pauseTagRegex
		]);

		const isPausedByTag = (body.toLowerCase().includes('#pause') || body.toLowerCase().includes('#en-pause') || body.toLowerCase().includes('#on-hold') || (rawPauseTag && body.toLowerCase().includes(`#${rawPauseTag}`))) || (config.taskFormat === 'dataview' && body.includes('[status:: paused]'));

		const pauseSymbol = config.pauseStatusSymbol || '?';
		const isPausedByStatus = statusChar === pauseSymbol || statusChar === '?' || statusChar === 'p';

		const isPaused = !completed && (isPausedByTag || isPausedByStatus);
		const finalStatus: TaskStatus = isPaused ? 'paused' : status;

		return {
			rawText: rawLine,
			cleanText: body,
			title,
			completed,
			isPaused,
			statusChar,
			status: finalStatus,
			filePath,
			lineNumber,
			indentLevel,
			dueDate,
			startDate,
			scheduledDate,
			completedDate,
			cancelledDate,
			recurrence,
			energy,
			difficulty,
			pieces,
			priority,
			prioritySignifier,
			priorityTag,
			matrixTag,
			domainTags,
			blockId,
			subtasks: []
		};
	}

	public static flattenTasks(tasks: ObsidianTask[]): ObsidianTask[] {
		const result: ObsidianTask[] = [];
		const walk = (t: ObsidianTask) => {
			result.push(t);
			if (t.subtasks && t.subtasks.length > 0) {
				t.subtasks.forEach(walk);
			}
		};
		tasks.forEach(walk);
		return result;
	}

	public static parseFile(fileContent: string, filePath: string, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ObsidianTask[] {
		const lines = fileContent.split(/\r?\n/);
		const rootTasks: ObsidianTask[] = [];
		const taskStack: ObsidianTask[] = [];
		let inCodeBlock = false;

		lines.forEach((line, index) => {
			const trimmed = line.trim();
			if (trimmed.startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				return;
			}
			if (inCodeBlock) return;

			const lineNumber = index + 1;
			const task = this.parseLine(line, filePath, lineNumber, config);

			if (!task) return;

			while (taskStack.length > 0 && taskStack[taskStack.length - 1].indentLevel >= task.indentLevel) {
				taskStack.pop();
			}

			if (taskStack.length === 0) {
				rootTasks.push(task);
			} else {
				const parent = taskStack[taskStack.length - 1];
				task.parentLineNumber = parent.lineNumber;
				parent.subtasks.push(task);
			}

			taskStack.push(task);
		});

		return rootTasks;
	}

	public static parseAllTasks(fileContent: string, filePath: string, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ObsidianTask[] {
		const rootTasks = this.parseFile(fileContent, filePath, config);
		return this.flattenTasks(rootTasks);
	}

	private static calculateIndentLevel(whitespace: string): number {
		let level = 0;
		for (const char of whitespace) {
			level += char === '\t' ? 1 : 0.5;
		}
		return Math.floor(level);
	}

	private static resolveTaskStatus(statusChar: string): TaskStatus {
		switch (statusChar.toLowerCase()) {
			case 'x':
				return 'done';
			case '/':
				return 'in-progress';
			case '-':
				return 'cancelled';
			case '?':
			case 'p':
				return 'paused';
			case ' ':
				return 'todo';
			default:
				return statusChar;
		}
	}

	private static resolveEmojiPriority(emoji: string, config: TaskSyntaxConfig): TaskPriority {
		if (emoji === config.highestPrioritySignifier || emoji === '🔺') return 'highest';
		if (emoji === config.highPrioritySignifier || emoji === '⏫') return 'high';
		if (emoji === config.mediumPrioritySignifier || emoji === '🔼') return 'medium';
		if (emoji === config.lowPrioritySignifier || emoji === '🔽') return 'low';
		if (emoji === config.lowestPrioritySignifier || emoji === '⏬') return 'lowest';
		return 'normal';
	}

	private static resolveTagPriority(val: string): TaskPriority {
		const str = val.toLowerCase();
		if (str.includes('highest') || str.includes('plus-haute')) return 'highest';
		if (str.includes('high') || str.includes('haute')) return 'high';
		if (str.includes('medium') || str.includes('moyenne')) return 'medium';
		if (str.includes('low') || str.includes('basse')) return 'low';
		if (str.includes('lowest') || str.includes('plus-basse')) return 'lowest';
		return 'normal';
	}

	private static extractRegexMatch(text: string, regex: RegExp): string | undefined {
		const match = regex.exec(text);
		return match ? match[1].trim() : undefined;
	}

	private static extractDomainTags(text: string, config: TaskSyntaxConfig): string[] {
		const tags: string[] = [];
		let match: RegExpExecArray | null;
		this.ALL_TAGS_REGEX.lastIndex = 0;

		const controlledPrefixes = [
			`#${config.energyTagPrefix.toLowerCase()}/`,
			`#${config.difficultyTagPrefix.toLowerCase()}/`,
			`#${config.piecesTagPrefix.toLowerCase()}/`,
			`#${config.priorityTagPrefix.toLowerCase()}/`,
			`#${config.matrixTagPrefix.toLowerCase()}`,
			'#energie/',
			'#energy/',
			'#difficulte/',
			'#difficulty/',
			'#pieces/',
			'#piece/',
			'#coins/',
			'#coin/',
			'#priorite/',
			'#priority/',
			'#prio/',
			'#due/',
			'#scheduled/',
			'#start/',
			'#done/',
			'#completion/',
			'#completed/',
			'#cancelled/',
			'#canceled/',
			'#tm/',
			'#q1',
			'#q2',
			'#q3',
			'#q4',
			'#focus',
			'#pause',
			'#en-pause',
			'#on-hold',
			`#${(config.pauseTag || 'pause').toLowerCase().replace(/^#/, '')}`
		];

		while ((match = this.ALL_TAGS_REGEX.exec(text)) !== null) {
			const tag = match[0].toLowerCase();
			if (!controlledPrefixes.some(p => tag === p || tag.startsWith(p))) {
				tags.push(tag);
			}
		}

		return tags;
	}

	private static cleanTitle(text: string, regexes: RegExp[]): string {
		let result = text;
		regexes.forEach(regex => {
			result = result.replace(regex, '');
		});
		const rawTitle = result.replace(/\s+/g, ' ').trim();
		return TaskMutator.cleanTaskPrefix(rawTitle);
	}
}
