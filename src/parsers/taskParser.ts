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
		const recurrenceRegex = DynamicRegexBuilder.buildRecurrenceRegex(config.recurrenceSignifier);


		const energyRegex = DynamicRegexBuilder.buildTagRegex(config.energyTagPrefix, true);
		const difficultyRegex = DynamicRegexBuilder.buildTagRegex(config.difficultyTagPrefix, false);
		const piecesRegex = DynamicRegexBuilder.buildTagRegex(config.piecesTagPrefix, true);
		const priorityRegex = DynamicRegexBuilder.buildTagRegex(config.priorityTagPrefix, false);
		const matrixRegex = DynamicRegexBuilder.buildTagRegex(config.matrixTagPrefix, false);

		const dueDate = this.extractRegexMatch(body, dueDateRegex);
		const scheduledDate = this.extractRegexMatch(body, scheduledDateRegex);
		const startDate = this.extractRegexMatch(body, startDateRegex);
		const completedDate = this.extractRegexMatch(body, completedDateRegex);
		const cancelledDate = this.extractRegexMatch(body, cancelledDateRegex);
		const recurrence = this.extractRegexMatch(body, recurrenceRegex);

		const energyMatch = energyRegex.exec(body);
		const energy = energyMatch ? parseInt(energyMatch[1], 10) : undefined;

		const difficultyMatch = difficultyRegex.exec(body);
		const difficulty = difficultyMatch ? difficultyMatch[1].toLowerCase() : undefined;

		const piecesMatch = piecesRegex.exec(body);
		const pieces = piecesMatch ? parseInt(piecesMatch[1], 10) : undefined;

		// Parsing des priorités Emoji Tasks et Tags
		const emojiPriorityMatch = this.PRIORITY_EMOJIS_REGEX.exec(body);
		const priorityTagMatch = priorityRegex.exec(body);

		let priority: TaskPriority | undefined;
		let prioritySignifier: string | undefined;
		let priorityTag: string | undefined;

		if (emojiPriorityMatch) {
			prioritySignifier = emojiPriorityMatch[1];
			priority = this.resolveEmojiPriority(prioritySignifier, config);
		} else if (priorityTagMatch) {
			priorityTag = priorityTagMatch[0].toLowerCase();
			priority = this.resolveTagPriority(priorityTagMatch[1]);
		}

		const matrixMatch = matrixRegex.exec(body);
		const matrixTag = matrixMatch ? matrixMatch[0].toLowerCase() : undefined;

		const domainTags = this.extractDomainTags(body, config);

		const blockIdMatch = this.BLOCK_ID_REGEX.exec(body);
		const blockId = blockIdMatch ? blockIdMatch[1] : undefined;

		const title = this.cleanTitle(body, [
			dueDateRegex, scheduledDateRegex, startDateRegex, completedDateRegex,
			cancelledDateRegex, recurrenceRegex, energyRegex, difficultyRegex,
			piecesRegex, priorityRegex, matrixRegex, this.PRIORITY_EMOJIS_REGEX, this.BLOCK_ID_REGEX
		]);

		return {
			rawText: rawLine,
			cleanText: body,
			title,
			completed,
			statusChar,
			status,
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
			`#${config.matrixTagPrefix.toLowerCase()}`
		];

		while ((match = this.ALL_TAGS_REGEX.exec(text)) !== null) {
			const tag = match[0].toLowerCase();
			if (!controlledPrefixes.some(p => tag.startsWith(p))) {
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
