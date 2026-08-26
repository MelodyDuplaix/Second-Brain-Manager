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
			getMarkdownFiles: () => {
				const paths = Object.keys(createdFiles);
				return paths.map(p => createMockTFile(p));
			},
			process: async (file: { path: string }, cb: (content: string) => string) => {
				const current = processedFiles[file.path] !== undefined ? processedFiles[file.path] : (createdFiles[file.path] || '');
				const updated = cb(current);
				processedFiles[file.path] = updated;
				return Promise.resolve(updated);
			}
		},
		metadataCache: {
			getFirstLinkpathDest: (name: string) => {
				const matchPath = Object.keys(createdFiles).find(p => p.includes(name) || p.endsWith(`${name}.md`));
				if (matchPath) return createMockTFile(matchPath);
				return null;
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

		// Test create_note with wikilinks in fileName
		const wikilinkProp = {
			id: 'act-5b',
			type: 'create_note' as const,
			description: 'Créer contact',
			selected: true,
			folder: '03 - Contacts',
			fileName: '[[Félix Martin]]',
			content: '# Félix Martin\nContact pro'
		};

		const wikiResults = await executor.executeProposals([wikilinkProp]);
		expect(wikiResults[0].success).toBe(true);
		expect(createdFiles['03 - Contacts/Félix Martin.md']).toBeDefined();

		// Test create_note when note already exists (should append/process instead of failing)
		createdFiles['03 - Contacts/Existant.md'] = '# Note Existante';
		const existingProp = {
			id: 'act-5c',
			type: 'create_note' as const,
			description: 'Ajouter infos contact',
			selected: true,
			targetPath: '03 - Contacts/Existant.md',
			content: 'Nouveau paragraphe ajouté.'
		};

		const existingResults = await executor.executeProposals([existingProp]);
		expect(existingResults[0].success).toBe(true);
		expect(processedFiles['03 - Contacts/Existant.md']).toContain('Nouveau paragraphe ajouté.');
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

		// Test combined multi-actions on a note (move + rename + link + append)
		createdFiles['00 - Inbox/Brainstorming.md'] = '# Idées';
		const combinedNoteProp = {
			id: 'act-8',
			type: 'move_note' as const,
			description: 'Déplacer, renommer, lier et compléter note',
			selected: true,
			targetPath: '00 - Inbox/Brainstorming.md',
			destinationFolder: '01 - Projets',
			newFileName: 'Projet Secret.md',
			targetNoteName: 'Claire Dupont',
			contextExplanation: 'Chef de projet',
			section: 'Points Clés',
			appendContent: 'Objectif de lancement fixé pour décembre.'
		};

		const combinedResults = await customExecutor.executeProposals([combinedNoteProp]);
		expect(combinedResults[0].success).toBe(true);
		expect(renamedTo).toBe('01 - Projets/Projet Secret.md');
		expect(processedFiles['00 - Inbox/Brainstorming.md']).toContain('[[Claire Dupont]]');
		expect(processedFiles['00 - Inbox/Brainstorming.md']).toContain('Objectif de lancement fixé pour décembre.');

		// Test directional link (both)
		createdFiles['01 - Projets/Alpha.md'] = '# Alpha';
		createdFiles['02 - Domaines/Beta.md'] = '# Beta';

		const linkBothProp = {
			id: 'act-9',
			type: 'link_notes' as const,
			description: 'Lier Alpha et Beta',
			selected: true,
			targetPath: '01 - Projets/Alpha.md',
			targetNoteName: 'Beta',
			linkDirection: 'both' as const,
			contextExplanation: 'Dépendance'
		};

		const linkResults = await customExecutor.executeProposals([linkBothProp]);
		expect(linkResults[0].success).toBe(true);
		expect(processedFiles['01 - Projets/Alpha.md']).toContain('[[Beta]] — Dépendance');
		expect(processedFiles['02 - Domaines/Beta.md']).toContain('[[Alpha]] — Dépendance');
	});
});

