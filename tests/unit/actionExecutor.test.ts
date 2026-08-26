import { describe, it, expect } from 'vitest';
import { ActionExecutor } from '../../src/services/actionExecutor';
import { DEFAULT_SETTINGS } from '../../src/main';
import { CreateNoteActionProposal, CreateTaskActionProposal } from '../../src/models/actions';
import { TFile } from 'obsidian';

describe('ActionExecutor', () => {
	const createdFiles: Record<string, string> = {};
	const processedFiles: Record<string, string> = {};

	const createMockTFile = (path: string): TFile => {
		const f = new TFile();
		f.path = path;
		f.basename = path.split('/').pop()?.replace('.md', '') || '';
		return f;
	};

	const mockApp = {
		vault: {
			getFileByPath: (path: string) => {
				if (createdFiles[path] !== undefined || processedFiles[path] !== undefined) {
					return createMockTFile(path);
				}
				return null;
			},
			getAbstractFileByPath: () => null,
			getFolderByPath: (path: string) => ({ path }),
			createFolder: () => Promise.resolve(),
			create: (path: string, content: string) => {
				createdFiles[path] = content;
				return Promise.resolve(createMockTFile(path));
			},
			process: async (file: { path: string }, cb: (content: string) => string) => {
				const current = createdFiles[file.path] || processedFiles[file.path] || '';
				const updated = cb(current);
				processedFiles[file.path] = updated;
				return Promise.resolve(updated);
			}
		},
		fileManager: {
			renameFile: () => Promise.resolve()
		}
	} as unknown as Parameters<typeof ActionExecutor>[0];

	const executor = new ActionExecutor(mockApp, DEFAULT_SETTINGS);

	it('should execute create_note proposal and write formatted content with tags', async () => {
		const proposal: CreateNoteActionProposal = {
			id: 'act-1',
			type: 'create_note',
			description: 'Créer note Marc Dupont',
			selected: true,
			targetPath: '03 - Contacts/Marc Dupont.md',
			folder: '03 - Contacts',
			fileName: 'Marc Dupont.md',
			content: 'Directeur Technique chez Acme',
			tags: ['#contact', '#tech']
		};

		const results = await executor.executeProposals([proposal]);
		expect(results.length).toBe(1);
		expect(results[0].success).toBe(true);
		expect(createdFiles['03 - Contacts/Marc Dupont.md']).toContain('#contact #tech');
		expect(createdFiles['03 - Contacts/Marc Dupont.md']).toContain('Directeur Technique chez Acme');
	});

	it('should execute create_task proposal with signifiers and tags', async () => {
		const proposal: CreateTaskActionProposal = {
			id: 'act-2',
			type: 'create_task',
			description: 'Créer tâche',
			selected: true,
			targetPath: '01 - Projets/Second Brain.md',
			taskTitle: 'Préparer réunion Marc',
			dueDate: '2026-08-25',
			energy: 4,
			matrixQuadrant: 'q1',
			domainTags: ['#tech'],
			linkedNotes: ['Marc Dupont']
		};

		const results = await executor.executeProposals([proposal]);
		expect(results[0].success).toBe(true);
		expect(processedFiles['01 - Projets/Second Brain.md']).toContain('- [ ] Préparer réunion Marc 📅 2026-08-25 #energie/4 #tm/q1 #tech [[Marc Dupont]]');
	});

	it('should skip proposals when selected is false', async () => {
		const proposal: CreateNoteActionProposal = {
			id: 'act-3',
			type: 'create_note',
			description: 'Action non sélectionnée',
			selected: false,
			targetPath: '00 - Inbox/Temp.md',
			folder: '00 - Inbox',
			fileName: 'Temp.md',
			content: 'Ignore me'
		};

		const results = await executor.executeProposals([proposal]);
		expect(results.length).toBe(0);
	});

	it('should execute decompose_task proposal and clean subtask titles without duplicate checkboxes', async () => {
		createdFiles['01 - Projets/Jeu.md'] = '- [ ] Réparer le bug de collision\n- [ ] Autre tâche';

		const proposal = {
			id: 'act-4',
			type: 'decompose_task' as const,
			description: 'Décomposer tâche',
			selected: true,
			targetPath: '01 - Projets/Jeu.md',
			parentLineNumber: 1,
			subtasks: [
				{ title: '- [ ] - [ ] Isoler le script de collision' },
				{ title: '[ ] [ ] Identifier la fonction en cause' },
				{ title: 'Tester la correction' }
			]
		};

		const results = await executor.executeProposals([proposal]);
		expect(results[0].success).toBe(true);
		expect(processedFiles['01 - Projets/Jeu.md']).toContain('  - [ ] Isoler le script de collision');
		expect(processedFiles['01 - Projets/Jeu.md']).toContain('  - [ ] Identifier la fonction en cause');
		expect(processedFiles['01 - Projets/Jeu.md']).toContain('  - [ ] Tester la correction');
		expect(processedFiles['01 - Projets/Jeu.md']).not.toContain('[ ] [ ]');
		expect(processedFiles['01 - Projets/Jeu.md']).not.toContain('- [ ] - [ ]');
	});

	it('should handle create_note robustly when folder or content is omitted and clean invalid characters', async () => {
		const proposal = {
			id: 'act-5',
			type: 'create_note' as const,
			description: 'Créer un bac à sable pour toutes les idées en vrac non urgentes',
			selected: true,
			targetPath: '03 - Ressources/Bac à sable\npour idées.md'
		};

		const results = await executor.executeProposals([proposal]);
		expect(results[0].success).toBe(true);
		expect(createdFiles['03 - Ressources/Bac à sable pour idées.md']).toBeDefined();
		expect(createdFiles['03 - Ressources/Bac à sable pour idées.md']).toContain('# Bac à sable pour idées');
	});

	it('should execute move_note and rename_note with vault fileManager', async () => {
		createdFiles['Notes en vrac/Liste Appel.md'] = 'Antoine\nMarc';
		let renamedTo = '';

		const mockAppWithRename = {
			...mockApp,
			fileManager: {
				renameFile: (_file: any, newPath: string) => {
					renamedTo = newPath;
					return Promise.resolve();
				}
			}
		} as any;

		const customExecutor = new ActionExecutor(mockAppWithRename, DEFAULT_SETTINGS);

		// Test move_note with newFileName
		const moveProp = {
			id: 'act-6',
			type: 'move_note' as const,
			description: 'Déplacer et renommer note',
			selected: true,
			targetPath: 'Notes en vrac/Liste Appel.md',
			destinationFolder: '01 - Projets',
			newFileName: 'Vœux 2026 - Liste Appel.md'
		};

		const moveResults = await customExecutor.executeProposals([moveProp]);
		expect(moveResults[0].success).toBe(true);
		expect(renamedTo).toBe('01 - Projets/Vœux 2026 - Liste Appel.md');

		// Test rename_note
		const renameProp = {
			id: 'act-7',
			type: 'rename_note' as const,
			description: 'Renommer note',
			selected: true,
			targetPath: 'Notes en vrac/Liste Appel.md',
			newFileName: 'Nouvelle Liste.md'
		};

		const renameResults = await customExecutor.executeProposals([renameProp]);
		expect(renameResults[0].success).toBe(true);
		expect(renamedTo).toBe('Notes en vrac/Nouvelle Liste.md');
	});
});

