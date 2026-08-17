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
});
