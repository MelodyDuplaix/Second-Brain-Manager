import { describe, it, expect, beforeEach } from 'vitest';
import { VaultFilterService } from '../../src/services/vaultFilterService';
import { VaultContextService } from '../../src/services/vaultContextService';
import { SecondBrainSettings, DEFAULT_SETTINGS } from '../../src/main';
import { TFile, TFolder } from '../mocks/obsidian';
import { ObsidianTask } from '../../src/models/task';

describe('VaultFilterService', () => {
	let mockApp: any;
	let settings: SecondBrainSettings;

	beforeEach(() => {
		settings = {
			...DEFAULT_SETTINGS,
			excludedFolders: 'Chaos/Archives, 99 - Privé, Templates',
			excludedFiles: 'MotsDePasse.md, Journal Intime, *.secret.md, *Confidentiel*',
			excludedTags: '#secret, #prive, #perso/sante, no-ai',
			excludedProperties: 'private, publish: false, confidential: true, draft'
		};

		mockApp = {
			vault: {
				getMarkdownFiles: () => [],
				getAllLoadedFiles: () => [],
				read: async () => '',
				cachedRead: async (f: any) => mockApp.vault.read(f),
				getFileByPath: () => null,
				getAbstractFileByPath: () => null,
			},
			metadataCache: {
				getFileCache: () => null,
				getFirstLinkpathDest: () => null
			},
			workspace: {
				getActiveFile: () => null
			}
		};
	});

	describe('Parsing utilities', () => {
		it('should parse list of strings with various delimiters (commas, semicolons, newlines)', () => {
			const raw = 'FolderA, FolderB;\nFolderC\n\nFolderD';
			const list = VaultFilterService.parseList(raw);
			expect(list).toEqual(['FolderA', 'FolderB', 'FolderC', 'FolderD']);
		});

		it('should parse properties with keys and key:value pairs', () => {
			const raw = 'private, publish: false, secret: true; status: draft\nno-ai';
			const props = VaultFilterService.parseProperties(raw);
			expect(props).toEqual([
				{ key: 'private' },
				{ key: 'publish', value: 'false' },
				{ key: 'secret', value: 'true' },
				{ key: 'status', value: 'draft' },
				{ key: 'no-ai' }
			]);
		});

		it('should handle empty or undefined settings gracefully', () => {
			const emptyService = new VaultFilterService(mockApp, {
				...DEFAULT_SETTINGS,
				excludedFolders: '',
				excludedFiles: '',
				excludedTags: '',
				excludedProperties: ''
			});
			expect(emptyService.hasActiveFilters()).toBe(false);
			expect(emptyService.isFolderExcluded('01 - Projets/Doc.md')).toBe(false);
			expect(emptyService.isFileNameExcluded('Doc.md')).toBe(false);
			expect(emptyService.isTagExcluded(['#travail'])).toBe(false);
			expect(emptyService.isPropertyExcluded({ private: true })).toBe(false);
		});
	});

	describe('Folder exclusion', () => {
		it('should exclude files inside configured excluded folders and subfolders', () => {
			const service = new VaultFilterService(mockApp, settings);

			expect(service.isFolderExcluded('Chaos/Archives/OldNote.md')).toBe(true);
			expect(service.isFolderExcluded('Chaos/Archives/2023/SubFolder/Doc.md')).toBe(true);
			expect(service.isFolderExcluded('99 - Privé/Secret.md')).toBe(true);
			expect(service.isFolderExcluded('Templates/Daily.md')).toBe(true);

			// Segment match
			expect(service.isFolderExcluded('Dossier/99 - Privé/Note.md')).toBe(true);

			// Non-matching folders
			expect(service.isFolderExcluded('01 - Projets/Acme.md')).toBe(false);
			expect(service.isFolderExcluded('00 - Inbox/Note.md')).toBe(false);
		});
	});

	describe('File name and pattern exclusion', () => {
		it('should exclude files matching exact name, basename or wildcards', () => {
			const service = new VaultFilterService(mockApp, settings);

			// Exact match
			expect(service.isFileNameExcluded('00 - Inbox/MotsDePasse.md')).toBe(true);
			expect(service.isFileNameExcluded('MotsDePasse.md')).toBe(true);

			// Basename without extension match
			expect(service.isFileNameExcluded('04 - Journal/Journal Intime.md')).toBe(true);
			expect(service.isFileNameExcluded('Journal Intime')).toBe(true);

			// Wildcards
			expect(service.isFileNameExcluded('Doc.secret.md')).toBe(true);
			expect(service.isFileNameExcluded('01 - Projets/Compte.secret.md')).toBe(true);
			expect(service.isFileNameExcluded('Document Confidentiel CA.md')).toBe(true);
			expect(service.isFileNameExcluded('Note-Confidentiel.md')).toBe(true);

			// Allowed files
			expect(service.isFileNameExcluded('01 - Projets/Normal.md')).toBe(false);
			expect(service.isFileNameExcluded('Notes.md')).toBe(false);
		});
	});

	describe('Tag exclusion', () => {
		it('should exclude files or tasks with matching tags (exact or hierarchical)', () => {
			const service = new VaultFilterService(mockApp, settings);

			expect(service.isTagExcluded(['#secret'])).toBe(true);
			expect(service.isTagExcluded(['secret'])).toBe(true);
			expect(service.isTagExcluded(['#prive'])).toBe(true);
			expect(service.isTagExcluded(['#prive/finances'])).toBe(true);
			expect(service.isTagExcluded(['#perso/sante'])).toBe(true);
			expect(service.isTagExcluded(['#no-ai'])).toBe(true);

			// Non matching
			expect(service.isTagExcluded(['#travail', '#projet'])).toBe(false);
			expect(service.isTagExcluded(['#perso/sport'])).toBe(false);
		});
	});

	describe('Property / Frontmatter exclusion', () => {
		it('should exclude notes with specified frontmatter keys or key-value pairs', () => {
			const service = new VaultFilterService(mockApp, settings);

			// Key presence (truthy)
			expect(service.isPropertyExcluded({ private: true })).toBe(true);
			expect(service.isPropertyExcluded({ private: 'yes' })).toBe(true);
			expect(service.isPropertyExcluded({ draft: true })).toBe(true);

			// Key-value pair
			expect(service.isPropertyExcluded({ publish: false })).toBe(true);
			expect(service.isPropertyExcluded({ publish: 'false' })).toBe(true);
			expect(service.isPropertyExcluded({ confidential: true })).toBe(true);

			// Key presence with explicit false when only key was configured
			expect(service.isPropertyExcluded({ private: false })).toBe(false);
			expect(service.isPropertyExcluded({ publish: true })).toBe(false);
			expect(service.isPropertyExcluded({ tags: ['travail'] })).toBe(false);
		});

		it('should parse frontmatter and tags from content when metadataCache is not present', () => {
			const service = new VaultFilterService(mockApp, settings);

			const file = new TFile();
			file.path = '01 - Projets/Test.md';
			file.basename = 'Test';

			const contentPrivate = `---
publish: false
---
# Note publique
Contenu normal.`;

			expect(service.isFileExcluded(file, contentPrivate)).toBe(true);

			const contentTag = `# Note
Ceci est une note avec un tag #secret dedans.`;

			expect(service.isFileExcluded(file, contentTag)).toBe(true);

			const contentNormal = `---
publish: true
---
# Note normale
Contenu normal sans tag secret.`;

			expect(service.isFileExcluded(file, contentNormal)).toBe(false);
		});
	});

	describe('Task exclusion', () => {
		it('should exclude tasks if folder, file, tags or note frontmatter is excluded', () => {
			const service = new VaultFilterService(mockApp, settings);

			const taskInExcludedFolder: ObsidianTask = {
				id: 't-1',
				filePath: 'Chaos/Archives/Doc.md',
				lineNumber: 10,
				rawText: '- [ ] Tâche archivée',
				title: 'Tâche archivée',
				completed: false,
				status: 'todo'
			};
			expect(service.isTaskExcluded(taskInExcludedFolder)).toBe(true);

			const taskWithExcludedTag: ObsidianTask = {
				id: 't-2',
				filePath: '01 - Projets/Projet.md',
				lineNumber: 5,
				rawText: '- [ ] Faire bilan santé #perso/sante',
				title: 'Faire bilan santé',
				domainTags: ['#perso/sante'],
				completed: false,
				status: 'todo'
			};
			expect(service.isTaskExcluded(taskWithExcludedTag)).toBe(true);

			const taskNormal: ObsidianTask = {
				id: 't-3',
				filePath: '01 - Projets/Projet.md',
				lineNumber: 6,
				rawText: '- [ ] Finir rapport trimestriel 📅 2026-08-30 #tm/q1',
				title: 'Finir rapport trimestriel',
				dueDate: '2026-08-30',
				completed: false,
				status: 'todo'
			};
			expect(service.isTaskExcluded(taskNormal)).toBe(false);
		});
	});

	describe('VaultContextService filtering integration', () => {
		it('should filter excluded files from searchNotes and searchTasks', async () => {
			const fileNormal = new TFile();
			fileNormal.path = '01 - Projets/Normal.md';
			fileNormal.basename = 'Normal';

			const filePrivateFolder = new TFile();
			filePrivateFolder.path = 'Chaos/Archives/Ancien.md';
			filePrivateFolder.basename = 'Ancien';

			const fileSecretTag = new TFile();
			fileSecretTag.path = '00 - Inbox/Doc.md';
			fileSecretTag.basename = 'Doc';

			mockApp.vault.getMarkdownFiles = () => [fileNormal, filePrivateFolder, fileSecretTag];
			mockApp.vault.read = async (f: TFile) => {
				if (f.path === '01 - Projets/Normal.md') return '# Normal\n- [ ] Tâche A 📅 2026-08-30';
				if (f.path === 'Chaos/Archives/Ancien.md') return '# Ancien\n- [ ] Tâche B 📅 2026-08-30';
				if (f.path === '00 - Inbox/Doc.md') return '# Doc #secret\n- [ ] Tâche Secrète 📅 2026-08-30';
				return '';
			};

			const vaultContext = new VaultContextService(mockApp, settings);

			const searchResults = await vaultContext.searchNotes('Tâche');
			expect(searchResults.length).toBe(1);
			expect(searchResults[0].path).toBe('01 - Projets/Normal.md');

			const taskResults = await vaultContext.searchTasks({});
			expect(taskResults.length).toBe(1);
			expect(taskResults[0].title).toBe('Tâche A');

			// readNote on secret file returns null
			const readSecret = await vaultContext.readNote('00 - Inbox/Doc.md');
			expect(readSecret).toBeNull();

			// readNote on normal file works
			const readNormal = await vaultContext.readNote('01 - Projets/Normal.md');
			expect(readNormal).not.toBeNull();
			expect(readNormal?.title).toBe('Normal');
		});

		it('should exclude private folders and files from getVaultStructure', () => {
			const folderNormal = new TFolder();
			folderNormal.path = '01 - Projets';
			folderNormal.name = '01 - Projets';

			const folderExcluded = new TFolder();
			folderExcluded.path = 'Chaos/Archives';
			folderExcluded.name = 'Chaos/Archives';

			const fileNormal = new TFile();
			fileNormal.path = '01 - Projets/Acme.md';
			fileNormal.basename = 'Acme';

			const fileExcluded = new TFile();
			fileExcluded.path = '01 - Projets/MotsDePasse.md';
			fileExcluded.basename = 'MotsDePasse';

			mockApp.vault.getAllLoadedFiles = () => [folderNormal, folderExcluded, fileNormal, fileExcluded];

			const vaultContext = new VaultContextService(mockApp, settings);
			const structure = vaultContext.getVaultStructure();

			expect(structure.folders).toContain('01 - Projets');
			expect(structure.folders).not.toContain('Chaos/Archives');
			expect(structure.projects).toContain('Acme');
			expect(structure.projects).not.toContain('MotsDePasse');
			expect(structure.totalMarkdownFiles).toBe(1);
		});
	});

	describe('Priority rules detection', () => {
		it('should detect priority tags accurately', () => {
			const service = new VaultFilterService(mockApp, {
				...DEFAULT_SETTINGS,
				priorityTags: '#urgent, #focus, #p1, prioritaire'
			});

			expect(service.hasActivePriorityRules()).toBe(true);
			expect(service.isTagPrioritized('#urgent')).toBe(true);
			expect(service.isTagPrioritized('#focus')).toBe(true);
			expect(service.isTagPrioritized('#p1/subtag')).toBe(true);
			expect(service.isTagPrioritized('prioritaire')).toBe(true);
			expect(service.isTagPrioritized(['#normal', '#urgent'])).toBe(true);
			expect(service.isTagPrioritized(['#normal', '#autre'])).toBe(false);
		});

		it('should detect priority frontmatter properties accurately', () => {
			const service = new VaultFilterService(mockApp, {
				...DEFAULT_SETTINGS,
				priorityProperties: 'priorite: haute, focus: true, statut: actif, important'
			});

			expect(service.isPropertiesPrioritized({ priorite: 'haute' })).toBe(true);
			expect(service.isPropertiesPrioritized({ focus: true })).toBe(true);
			expect(service.isPropertiesPrioritized({ statut: 'actif' })).toBe(true);
			expect(service.isPropertiesPrioritized({ important: 'n\'importe quoi' })).toBe(true);
			expect(service.isPropertiesPrioritized({ priorite: 'basse' })).toBe(false);
			expect(service.isPropertiesPrioritized({ statut: 'archive' })).toBe(false);
		});

		it('should detect prioritized task with priority tags or from prioritized file', () => {
			const service = new VaultFilterService(mockApp, {
				...DEFAULT_SETTINGS,
				priorityTags: '#urgent, #focus'
			});

			const taskA: ObsidianTask = {
				title: 'Tâche urgente',
				completed: false,
				status: 'todo',
				lineNumber: 1,
				filePath: '01 - Projets/Projet.md',
				rawLine: '- [ ] Tâche urgente #urgent',
				indentLevel: 0,
				domainTags: ['#urgent']
			};

			const taskB: ObsidianTask = {
				title: 'Tâche normale',
				completed: false,
				status: 'todo',
				lineNumber: 2,
				filePath: '01 - Projets/Projet.md',
				rawLine: '- [ ] Tâche normale #normal',
				indentLevel: 0,
				domainTags: ['#normal']
			};

			expect(service.isTaskPrioritized(taskA)).toBe(true);
			expect(service.isTaskPrioritized(taskB)).toBe(false);
		});
	});
});
