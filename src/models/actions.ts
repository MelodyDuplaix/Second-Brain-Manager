import { TaskPriority } from './task';
import { MatrixQuadrant } from '../adapters/matrixAdapter';

export type ActionType =
	| 'create_note'
	| 'append_to_note'
	| 'create_task'
	| 'update_task'
	| 'decompose_task'
	| 'link_notes'
	| 'move_note';

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

export interface UpdateTaskActionProposal extends BaseActionProposal {
	type: 'update_task';
	lineNumber: number;
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

export interface LinkNotesActionProposal extends BaseActionProposal {
	type: 'link_notes';
	targetNoteName: string;
	contextExplanation?: string;
}

export interface MoveNoteActionProposal extends BaseActionProposal {
	type: 'move_note';
	destinationFolder: string;
}

export type ActionProposal =
	| CreateNoteActionProposal
	| AppendToNoteActionProposal
	| CreateTaskActionProposal
	| UpdateTaskActionProposal
	| DecomposeTaskActionProposal
	| LinkNotesActionProposal
	| MoveNoteActionProposal;

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
