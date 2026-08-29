export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'cancelled' | 'paused' | string;
export type TaskPriority = 'highest' | 'high' | 'medium' | 'normal' | 'low' | 'lowest';

export interface DateFormatOptions {
	dateFormat: string;
	useWikilinks: boolean;
}

export interface ObsidianTask {
	rawText: string;
	cleanText: string;
	title: string;

	completed: boolean;
	isPaused?: boolean;
	statusChar: string;
	status: TaskStatus;

	filePath: string;
	lineNumber: number;
	indentLevel: number;

	dueDate?: string;
	startDate?: string;
	scheduledDate?: string;
	completedDate?: string;
	cancelledDate?: string;
	recurrence?: string;

	energy?: number;
	difficulty?: string;
	pieces?: number;
	priority?: TaskPriority;
	prioritySignifier?: string;
	priorityTag?: string;
	matrixTag?: string;
	domainTags: string[];

	blockId?: string;
	parentLineNumber?: number;
	subtasks: ObsidianTask[];
}
