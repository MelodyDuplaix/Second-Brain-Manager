import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { TaskParser } from '../parsers/taskParser';
import { ObsidianTask } from '../models/task';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { SecondBrainSettings } from '../main';

export interface NoteSearchResult {
	path: string;
	title: string;
	snippet: string;
	score: number;
	tags: string[];
	folder: string;
}

export interface NoteConnections {
	path: string;
	title: string;
	outgoingLinks: string[];
	backlinks: string[];
	tags: string[];
}

export interface VaultStructureSummary {
	folders: string[];
	projects: string[];
	contacts: string[];
	domains: string[];
	inboxFiles: string[];
	totalMarkdownFiles: number;
}

export class VaultContextService {
	private app: App;
	private settings: SecondBrainSettings;

	constructor(app: App, settings: SecondBrainSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Recherche textuelle et contextuelle (RAG) dans les notes du coffre avec pondération de pertinence.
	 */
	public async searchNotes(query: string, limit = 5, folderFilter?: string, tagFilter?: string): Promise<NoteSearchResult[]> {
		const files = this.app.vault.getMarkdownFiles();
		const results: NoteSearchResult[] = [];
		const lowerQuery = query.toLowerCase().trim();
		const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 1);

		const normalizedFolderFilter = folderFilter ? normalizePath(folderFilter).toLowerCase() : undefined;
		const normalizedTagFilter = tagFilter ? tagFilter.toLowerCase() : undefined;

		for (const file of files) {
			const normalizedPath = normalizePath(file.path);
			const lowerPath = normalizedPath.toLowerCase();

			if (normalizedFolderFilter && !lowerPath.startsWith(normalizedFolderFilter)) {
				continue;
			}

			const content = await this.app.vault.read(file);
			const lowerContent = content.toLowerCase();

			if (normalizedTagFilter && !lowerContent.includes(normalizedTagFilter)) {
				continue;
			}

			const fileName = file.basename;
			const lowerFileName = fileName.toLowerCase();

			let score = 0;

			// Titre exact ou partiel (Pondération forte : 10x)
			if (lowerFileName === lowerQuery) {
				score += 50;
			} else if (lowerFileName.includes(lowerQuery)) {
				score += 25;
			}

			// Mots du titre (Pondération : 5x par mot)
			queryWords.forEach(w => {
				if (lowerFileName.includes(w)) score += 5;
			});

			// Tags dans le contenu (Pondération : 3x)
			queryWords.forEach(w => {
				if (lowerContent.includes(`#${w}`)) score += 3;
			});

			// Contenu texte (Pondération : 1x par occurrence)
			queryWords.forEach(w => {
				const occurrences = (lowerContent.match(new RegExp(w, 'g')) || []).length;
				score += Math.min(occurrences, 10);
			});

			if (score > 0 || !queryWords.length) {
				const tagsMatch = content.match(/#([\w/_-]+)/g) || [];
				const tags = Array.from(new Set(tagsMatch.map(t => t.toLowerCase())));

				// Extraction d'un extrait pertinent autour de la première occurrence
				let snippet = '';
				if (queryWords.length > 0) {
					const firstIndex = lowerContent.indexOf(queryWords[0]);
					if (firstIndex !== -1) {
						const start = Math.max(0, firstIndex - 60);
						const end = Math.min(content.length, firstIndex + 140);
						snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n+/g, ' ') + (end < content.length ? '...' : '');
					}
				}
				if (!snippet) {
					snippet = content.slice(0, 160).replace(/\n+/g, ' ') + (content.length > 160 ? '...' : '');
				}

				results.push({
					path: normalizedPath,
					title: fileName,
					snippet,
					score,
					tags,
					folder: file.parent ? file.parent.path : ''
				});
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	/**
	 * Recherche ciblée de tâches dans tout le coffre avec filtres avancés.
	 */
	public async searchTasks(filter: {
		query?: string;
		status?: 'todo' | 'done' | 'in-progress' | 'cancelled' | 'all';
		dueBefore?: string;
		quadrant?: string;
		energyMax?: number;
		folder?: string;
		limit?: number;
	} = {}): Promise<ObsidianTask[]> {
		const files = this.app.vault.getMarkdownFiles();
		const matchedTasks: ObsidianTask[] = [];
		const limit = filter.limit || 20;

		const matrixAdapter = MatrixAdapterFactory.createAdapter(
			this.settings.matrixProvider,
			this.settings.customMatrixMapping
		);

		const normFolder = filter.folder ? normalizePath(filter.folder).toLowerCase() : undefined;
		const lowerQuery = filter.query ? filter.query.toLowerCase().trim() : undefined;

		for (const file of files) {
			const normPath = normalizePath(file.path);
			if (normFolder && !normPath.toLowerCase().startsWith(normFolder)) {
				continue;
			}

			const content = await this.app.vault.read(file);
			const tasks = TaskParser.parseFile(content, normPath, this.settings);

			for (const task of tasks) {
				// Filtre statut
				if (filter.status && filter.status !== 'all') {
					if (filter.status === 'done' && !task.completed && task.status !== 'done') continue;
					if (filter.status === 'todo' && (task.completed || task.status === 'cancelled')) continue;
					if (filter.status === 'in-progress' && task.status !== 'in-progress') continue;
					if (filter.status === 'cancelled' && task.status !== 'cancelled') continue;
				}

				// Filtre échéance
				if (filter.dueBefore && task.dueDate && task.dueDate > filter.dueBefore) {
					continue;
				}

				// Filtre énergie
				if (filter.energyMax !== undefined && task.energy && task.energy > filter.energyMax) {
					continue;
				}

				// Filtre matrice
				if (filter.quadrant) {
					const taskQuad = matrixAdapter.getQuadrant(task);
					if (taskQuad !== filter.quadrant.toLowerCase()) continue;
				}

				// Filtre texte
				if (lowerQuery) {
					const matchTitle = task.title.toLowerCase().includes(lowerQuery);
					const matchRaw = task.rawText.toLowerCase().includes(lowerQuery);
					const matchTags = task.domainTags && Array.isArray(task.domainTags) && task.domainTags.some(t => t.toLowerCase().includes(lowerQuery));
					if (!matchTitle && !matchRaw && !matchTags) continue;
				}

				matchedTasks.push(task);
				if (matchedTasks.length >= limit) break;
			}

			if (matchedTasks.length >= limit) break;
		}

		return matchedTasks;
	}

	/**
	 * Lecture sécurisée du contenu d'une note.
	 */
	public async readNote(filePath: string, maxCharacters = 4000): Promise<{ path: string; title: string; content: string; truncated: boolean } | null> {
		const normalized = normalizePath(filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);

		if (!(file instanceof TFile)) {
			return null;
		}

		const fullContent = await this.app.vault.read(file);
		const truncated = fullContent.length > maxCharacters;
		const content = truncated ? fullContent.slice(0, maxCharacters) + '\n\n... [Contenu tronqué pour la taille du contexte]' : fullContent;

		return {
			path: normalized,
			title: file.basename,
			content,
			truncated
		};
	}

	/**
	 * Analyse des liens entrants (backlinks) et sortants (outlinks) d'une note.
	 */
	public async getNoteConnections(filePath: string): Promise<NoteConnections | null> {
		const normalized = normalizePath(filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);

		if (!(file instanceof TFile)) {
			return null;
		}

		const content = await this.app.vault.read(file);
		const baseName = file.basename;

		// 1. Liens sortants [[Nom de la note]]
		const outgoingMatches = content.match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g) || [];
		const outgoingLinks = Array.from(new Set(outgoingMatches.map(m => {
			const clean = m.replace(/^\[\[/, '').replace(/\]\]$/, '');
			return clean.split('|')[0].split('#')[0].trim();
		})));

		// 2. Tags
		const tagsMatch = content.match(/#([\w/_-]+)/g) || [];
		const tags = Array.from(new Set(tagsMatch.map(t => t.toLowerCase())));

		// 3. Backlinks (Recherche des autres fichiers qui pointent vers cette note)
		const backlinks: string[] = [];
		const allFiles = this.app.vault.getMarkdownFiles();
		const linkRegex = new RegExp(`\\[\\[${baseName}(?:[|#][^\\]]+)?\\]\\]`, 'i');

		for (const otherFile of allFiles) {
			if (otherFile.path === file.path) continue;
			const otherContent = await this.app.vault.read(otherFile);
			if (linkRegex.test(otherContent)) {
				backlinks.push(normalizePath(otherFile.path));
			}
		}

		return {
			path: normalized,
			title: baseName,
			outgoingLinks,
			backlinks,
			tags
		};
	}

	/**
	 * Récupération de la note quotidienne pour une date donnée (par défaut aujourd'hui).
	 */
	public async getDailyNote(dateStr?: string): Promise<{ path: string; exists: boolean; content?: string }> {
		const targetDate = dateStr || new Date().toISOString().split('T')[0];
		const dailyFolder = normalizePath(this.settings.dailyNotesFolder || '04 - Journal');
		const dailyPath = normalizePath(`${dailyFolder}/${targetDate}.md`);

		const file = this.app.vault.getFileByPath(dailyPath) || this.app.vault.getAbstractFileByPath(dailyPath);

		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			return { path: dailyPath, exists: true, content };
		}

		return { path: dailyPath, exists: false };
	}

	/**
	 * Synthèse globale de la structure du coffre pour l'agent (projets, contacts, dossiers).
	 */
	public getVaultStructure(): VaultStructureSummary {
		const allFiles = this.app.vault.getAllLoadedFiles();
		const folders: string[] = [];
		const projects: string[] = [];
		const contacts: string[] = [];
		const domains: string[] = [];
		const inboxFiles: string[] = [];
		let totalMarkdownFiles = 0;

		const inboxFolder = normalizePath(this.settings.inboxFolder || '00 - Inbox').toLowerCase();

		for (const f of allFiles) {
			if (f instanceof TFolder) {
				folders.push(normalizePath(f.path));
			} else if (f instanceof TFile && f.extension === 'md') {
				totalMarkdownFiles++;
				const normPath = normalizePath(f.path);
				const lowerPath = normPath.toLowerCase();

				if (lowerPath.includes('01 - projets') || lowerPath.startsWith('projets/')) {
					projects.push(f.basename);
				} else if (lowerPath.includes('03 - contacts') || lowerPath.startsWith('contacts/')) {
					contacts.push(f.basename);
				} else if (lowerPath.includes('02 - domaines') || lowerPath.startsWith('domaines/')) {
					domains.push(f.basename);
				}

				if (lowerPath.startsWith(inboxFolder)) {
					inboxFiles.push(normPath);
				}
			}
		}

		return {
			folders: folders.sort(),
			projects: projects.sort(),
			contacts: contacts.sort(),
			domains: domains.sort(),
			inboxFiles: inboxFiles.sort(),
			totalMarkdownFiles
		};
	}
}
