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
		const dvCompletedRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['completion', 'completed', 'done']);
		const hasDataviewStyle = dvCompletedRegex.test(body) || DynamicRegexBuilder.buildDataviewFieldRegex(['due', 'scheduled', 'start']).test(body);

		const updatedBody = body
			.replace(completedDateRegex, '')
			.replace(dvCompletedRegex, '')
			.replace(/\s+/g, ' ')
			.trim();

		const lineWithStatus = `${indentWhitespace}- [${newStatusChar}] ${updatedBody}`;

		if (completed && completionDate) {
			const formattedDate = this.formatDate(completionDate, config);
			let meta = `${config.completedDateSignifier} ${formattedDate}`;
			if (hasDataviewStyle || config.taskFormat === 'dataview') {
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
		const dvDueRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['due']);
		const tagDueRegex = /(?:^|\s)#due\/[^\s#^]+/gi;
		const hasDataviewStyle = dvDueRegex.test(rawLine) || DynamicRegexBuilder.buildDataviewFieldRegex(['scheduled', 'start', 'completion']).test(rawLine);

		const lineWithoutDue = rawLine
			.replace(dueDateRegex, '')
			.replace(dvDueRegex, '')
			.replace(tagDueRegex, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!dateStr) return lineWithoutDue;

		const formattedDate = this.formatDate(dateStr, config);
		let meta = `${config.dueDateSignifier} ${formattedDate}`;
		if (hasDataviewStyle || config.taskFormat === 'dataview') {
			meta = `[due:: ${formattedDate}]`;
		} else if (config.taskFormat === 'tag') {
			meta = `#due/${formattedDate}`;
		}
		return this.insertMetaBeforeBlockId(lineWithoutDue, meta);
	}

	public static setStartDate(rawLine: string, dateStr: string | null, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const startDateRegex = DynamicRegexBuilder.buildDateSignifierRegex(config.startDateSignifier);
		const dvStartRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['start']);
		const tagStartRegex = /(?:^|\s)#start\/[^\s#^]+/gi;
		const hasDataviewStyle = dvStartRegex.test(rawLine) || DynamicRegexBuilder.buildDataviewFieldRegex(['due', 'scheduled', 'completion']).test(rawLine);

		const lineWithoutStart = rawLine
			.replace(startDateRegex, '')
			.replace(dvStartRegex, '')
			.replace(tagStartRegex, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!dateStr) return lineWithoutStart;

		const formattedDate = this.formatDate(dateStr, config);
		let meta = `${config.startDateSignifier} ${formattedDate}`;
		if (hasDataviewStyle || config.taskFormat === 'dataview') {
			meta = `[start:: ${formattedDate}]`;
		} else if (config.taskFormat === 'tag') {
			meta = `#start/${formattedDate}`;
		}
		return this.insertMetaBeforeBlockId(lineWithoutStart, meta);
	}

	public static setPriority(rawLine: string, priority: TaskPriority | null, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): string {
		const tagPrefix = config.priorityTagPrefix;
		const tagRegex = DynamicRegexBuilder.buildTagRegex(tagPrefix, false);
		const dvPriorityRegex = DynamicRegexBuilder.buildDataviewFieldRegex(['priority', 'priorite']);

		const cleaned = rawLine
			.replace(tagRegex, '')
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

		const updatedLine = rawLine.replace(tagRegex, '').replace(/\s+/g, ' ').trim();
		if (value === null || value === undefined) return updatedLine;

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
