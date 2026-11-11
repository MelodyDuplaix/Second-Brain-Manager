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
	/** Nom du statut (réglages du plugin Tasks), ex. « En cours », « progress » */
	statusName?: string;
	/** Type du statut selon Tasks : TODO, DONE, IN_PROGRESS, CANCELLED, ON_HOLD */
	statusType?: string;

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
	/** Personne mentionnée à afficher (fonctionnalité « Personnes dans les tâches ») :
	 *  destinataire, donneur ou personne liée selon le réglage */
	person?: string;
	/** Toutes les personnes mentionnées */
	people?: string[];
	/** Tâche attribuée à quelqu'un d'autre (mode « attribuée ») : ce n'est pas une de mes tâches */
	forOthers?: boolean;

	blockId?: string;
	parentLineNumber?: number;
	subtasks: ObsidianTask[];
}
