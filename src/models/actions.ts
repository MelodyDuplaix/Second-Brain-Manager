import { TaskPriority } from './task';
import { MatrixQuadrant } from '../adapters/matrixAdapter';

export type ActionType =
	| 'create_note'
	| 'append_to_note'
	| 'create_task'
	| 'update_task'
	| 'decompose_task'
	| 'link_notes'
	| 'move_note'
	| 'rename_note'
	| 'create_calendar_event'
	| 'update_calendar_event'
	| 'open_note'
	| 'execute_command';

export interface BaseActionProposal {
	id: string;
	type: ActionType;
	description: string;
	selected: boolean;
	targetPath: string;
}

export interface CreateNoteActionProposal extends BaseActionProposal {
	type: 'create_note';
	folder: string;
	fileName: string;
	content: string;
	tags?: string[];
	frontmatter?: Record<string, unknown>;
}

export interface AppendToNoteActionProposal extends BaseActionProposal {
	type: 'append_to_note';
	section?: string;
	entryText: string;
}

export interface CreateTaskActionProposal extends BaseActionProposal {
	type: 'create_task';
	taskTitle: string;
	dueDate?: string;
	startDate?: string;
	scheduledDate?: string;
	priority?: TaskPriority;
	energy?: number;
	difficulty?: string;
	pieces?: number;
	matrixQuadrant?: MatrixQuadrant;
	domainTags?: string[];
	linkedNotes?: string[];
	blockId?: string;
}

export interface TaskDiffMetadata {
	taskTitle?: string;
	filePath?: string;
	lineNumber?: number;
	oldDueDate?: string | null;
	newDueDate?: string | null;
	oldQuadrant?: string | null;
	newQuadrant?: string | null;
	oldPriority?: string | null;
	newPriority?: string | null;
	oldEnergy?: number | null;
	newEnergy?: number | null;
	oldStatus?: string | null;
	newStatus?: string | null;
	reason?: string;
}

export interface UpdateTaskActionProposal extends BaseActionProposal {
	type: 'update_task';
	lineNumber: number;
	taskTitle?: string;
	diff?: TaskDiffMetadata;
	reason?: string;
	newStatus?: string;
	newDueDate?: string | null;
	newStartDate?: string | null;
	newPriority?: TaskPriority | null;
	newEnergy?: number | null;
	newPieces?: number | null;
	newMatrixQuadrant?: MatrixQuadrant;
}

export interface DecomposeTaskActionProposal extends BaseActionProposal {
	type: 'decompose_task';
	parentLineNumber: number;
	subtasks: Array<{
		title: string;
		energy?: number;
		pieces?: number;
	}>;
}

export type LinkDirection = 'forward' | 'backward' | 'both';

export interface LinkNotesActionProposal extends BaseActionProposal {
	type: 'link_notes';
	targetNoteName: string;
	linkDirection?: LinkDirection;
	contextExplanation?: string;
}

export interface MoveNoteActionProposal extends BaseActionProposal {
	type: 'move_note';
	destinationFolder?: string;
	newFileName?: string;
	targetNoteName?: string;
	linkDirection?: LinkDirection;
	contextExplanation?: string;
	appendContent?: string;
	section?: string;
	tags?: string[];
}

export interface RenameNoteActionProposal extends BaseActionProposal {
	type: 'rename_note';
	newFileName: string;
	destinationFolder?: string;
	targetNoteName?: string;
	linkDirection?: LinkDirection;
}

export interface CreateCalendarEventActionProposal extends BaseActionProposal {
	type: 'create_calendar_event';
	title: string;
	startDate: string;
	startTime?: string;
	endDate?: string;
	endTime?: string;
	eventDescription?: string;
	location?: string;
	calendarId?: string;
}

export interface UpdateCalendarEventActionProposal extends BaseActionProposal {
	type: 'update_calendar_event';
	eventId: string;
	title?: string;
	startDate?: string;
	startTime?: string;
	endDate?: string;
	endTime?: string;
	eventDescription?: string;
	location?: string;
	calendarId?: string;
}

export interface OpenNoteActionProposal extends BaseActionProposal {
	type: 'open_note';
	newLeaf?: boolean;
	lineNumber?: number;
}

export interface ExecuteCommandActionProposal extends BaseActionProposal {
	type: 'execute_command';
	commandId: string;
	commandName?: string;
}

export type ActionProposal =
	| CreateNoteActionProposal
	| AppendToNoteActionProposal
	| CreateTaskActionProposal
	| UpdateTaskActionProposal
	| DecomposeTaskActionProposal
	| LinkNotesActionProposal
	| MoveNoteActionProposal
	| RenameNoteActionProposal
	| CreateCalendarEventActionProposal
	| UpdateCalendarEventActionProposal
	| OpenNoteActionProposal
	| ExecuteCommandActionProposal;

export interface ActionResult {
	proposalId: string;
	success: boolean;
	message: string;
	createdOrModifiedPath?: string;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, {
			type: string;
			description: string;
			enum?: string[];
			items?: { type: string };
		}>;
		required: string[];
	};
}
