export interface TaskSyntaxConfig {
	energyTagPrefix: string;
	difficultyTagPrefix: string;
	piecesTagPrefix: string;
	priorityTagPrefix: string;
	matrixTagPrefix: string;

	priorityMode: 'emoji' | 'tag';
	highestPrioritySignifier: string;
	highPrioritySignifier: string;
	mediumPrioritySignifier: string;
	lowPrioritySignifier: string;
	lowestPrioritySignifier: string;

	dueDateSignifier: string;
	startDateSignifier: string;
	scheduledDateSignifier: string;
	completedDateSignifier: string;
	cancelledDateSignifier: string;
	recurrenceSignifier: string;

	dateFormat: string;
	useWikilinks: boolean;
	statusSymbols: string[];
}

export const DEFAULT_SYNTAX_CONFIG: TaskSyntaxConfig = {
	energyTagPrefix: 'energie',
	difficultyTagPrefix: 'difficulte',
	piecesTagPrefix: 'pieces',
	priorityTagPrefix: 'priorite',
	matrixTagPrefix: 'tm/q',

	priorityMode: 'emoji',
	highestPrioritySignifier: '🔺',
	highPrioritySignifier: '⏫',
	mediumPrioritySignifier: '🔼',
	lowPrioritySignifier: '🔽',
	lowestPrioritySignifier: '⏬',

	dueDateSignifier: '📅',
	startDateSignifier: '🛫',
	scheduledDateSignifier: '⏳',
	completedDateSignifier: '✅',
	cancelledDateSignifier: '❌',
	recurrenceSignifier: '🔁',

	dateFormat: 'YYYY-MM-DD',
	useWikilinks: false,
	statusSymbols: [' ', 'x', 'X', '/', '-', '!', '?', '>', 'b'],
};
