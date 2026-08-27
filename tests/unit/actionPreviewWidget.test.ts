import { describe, it, expect } from 'vitest';
import { ActionProposal, UpdateTaskActionProposal, MoveNoteActionProposal, LinkNotesActionProposal } from '../../src/models/actions';
import { ActionPreviewWidget } from '../../src/views/actionPreviewWidget';
import { TFile } from 'obsidian';

describe('ActionPreviewWidget & Interactive Proposals Customization', () => {
	it('should allow dynamic mutation and conversion of task proposals', () => {
		const prop: UpdateTaskActionProposal = {
			id: 'prop-1',
			type: 'update_task',
			description: 'Tâche test',
			selected: true,
			targetPath: '01 - Projets/Test.md',
			lineNumber: 5,
			taskTitle: 'Faire les courses',
			newStatus: 'cancelled'
		};

		expect(prop.newStatus).toBe('cancelled');

		// User changes action to postpone to tomorrow
		prop.newStatus = undefined;
		prop.newDueDate = '2026-08-27';
		prop.newMatrixQuadrant = 'q1';
		prop.newEnergy = 3;

		expect(prop.newStatus).toBeUndefined();
		expect(prop.newDueDate).toBe('2026-08-27');
		expect(prop.newMatrixQuadrant).toBe('q1');
		expect(prop.newEnergy).toBe(3);
	});

	it('should allow dynamic mutation and conversion of note proposals', () => {
		const prop: ActionProposal = {
			id: 'prop-2',
			type: 'move_note',
			description: 'Déplacer note',
			selected: true,
			targetPath: '00 - Inbox/Idées vrac.md',
			destinationFolder: '01 - Projets'
		} as MoveNoteActionProposal;

		// User modifies destination folder and adds new filename (Move & Rename)
		const moveProp = prop as MoveNoteActionProposal;
		moveProp.destinationFolder = '02 - Domaines/Maison';
		moveProp.newFileName = 'Organisation Maison.md';

		expect(moveProp.destinationFolder).toBe('02 - Domaines/Maison');
		expect(moveProp.newFileName).toBe('Organisation Maison.md');

		// User switches to link_notes
		const linkProp = prop as unknown as LinkNotesActionProposal;
		linkProp.type = 'link_notes';
		linkProp.targetNoteName = 'Felix';
		linkProp.contextExplanation = 'Contact référent';

		expect(linkProp.type).toBe('link_notes');
		expect(linkProp.targetNoteName).toBe('Felix');
		expect(linkProp.contextExplanation).toBe('Contact référent');
	});

	it('should allow combining multiple task actions simultaneously (date + quadrant + energy + priority + status)', () => {
		const prop: UpdateTaskActionProposal = {
			id: 'prop-multi-task',
			type: 'update_task',
			description: 'Tâche multi-actions',
			selected: true,
			targetPath: '01 - Projets/Test.md',
			lineNumber: 3,
			taskTitle: 'Rédiger spécifications'
		};

		// Apply multiple actions simultaneously
		prop.newDueDate = '2026-08-30';
		prop.newMatrixQuadrant = 'q1';
		prop.newEnergy = 8;
		prop.newPriority = 'highest';
		prop.newStatus = 'in_progress';

		expect(prop.newDueDate).toBe('2026-08-30');
		expect(prop.newMatrixQuadrant).toBe('q1');
		expect(prop.newEnergy).toBe(8);
		expect(prop.newPriority).toBe('highest');
		expect(prop.newStatus).toBe('in_progress');
	});

	it('should allow combining multiple note actions simultaneously (move + rename + link + append)', () => {
		const noteProp: MoveNoteActionProposal = {
			id: 'prop-multi-note',
			type: 'move_note',
			description: 'Note multi-actions',
			selected: true,
			targetPath: '00 - Inbox/Réunion.md',
			destinationFolder: '01 - Projets/Acme',
			newFileName: 'Compte-rendu Acme.md',
			targetNoteName: 'Claire',
			contextExplanation: 'Participante',
			section: 'Décisions',
			appendContent: 'Validation du budget pour Q4.'
		};

		expect(noteProp.destinationFolder).toBe('01 - Projets/Acme');
		expect(noteProp.newFileName).toBe('Compte-rendu Acme.md');
		expect(noteProp.targetNoteName).toBe('Claire');
		expect(noteProp.appendContent).toBe('Validation du budget pour Q4.');
	});

	it('should open note with workspace / leaf openFile', async () => {
		let openedFilePath = '';
		const mockApp = {
			vault: {
				getFileByPath: (p: string) => {
					const f = new TFile();
					f.path = p;
					return f;
				},
				getAbstractFileByPath: () => null
			},
			workspace: {
				getLeaf: () => ({
					openFile: (f: TFile) => {
						openedFilePath = f.path;
						return Promise.resolve();
					}
				}),
				openLinkText: (link: string) => {
					openedFilePath = link;
					return Promise.resolve();
				}
			}
		} as any;

		await ActionPreviewWidget.openNote(mockApp, '03 - Contacts/Claire.md');
		expect(openedFilePath).toBe('03 - Contacts/Claire.md');
	});

	it('should maintain create_task proposal type during customization and metadata mutation', () => {
		const createProp = {
			id: 'prop-create-task',
			type: 'create_task' as const,
			description: '⏰ Créer la tâche « Faire relance adhésion expiré » dans "Note rangés/MFRB/Tâche à faire MFRB.md"',
			selected: true,
			targetPath: 'Note rangés/MFRB/Tâche à faire MFRB.md',
			taskTitle: 'Faire relance adhésion expiré',
			dueDate: '2026-09-03',
			priority: 'high' as const,
			energy: 4,
			matrixQuadrant: 'q1' as const
		};

		// Mutate create_task properties as done by quick buttons and drawer
		createProp.dueDate = '2026-08-28';
		createProp.matrixQuadrant = 'q2';
		createProp.energy = 5;
		createProp.priority = 'highest';

		expect(createProp.type).toBe('create_task');
		expect(createProp.taskTitle).toBe('Faire relance adhésion expiré');
		expect(createProp.targetPath).toBe('Note rangés/MFRB/Tâche à faire MFRB.md');
		expect(createProp.dueDate).toBe('2026-08-28');
		expect(createProp.matrixQuadrant).toBe('q2');
		expect(createProp.energy).toBe(5);
		expect(createProp.priority).toBe('highest');
	});
});
