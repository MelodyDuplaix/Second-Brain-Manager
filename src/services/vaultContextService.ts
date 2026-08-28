import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { TaskParser } from '../parsers/taskParser';
import { DynamicRegexBuilder } from '../parsers/regexBuilder';
import { ObsidianTask } from '../models/task';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { SecondBrainSettings } from '../main';
import { VaultFilterService } from './vaultFilterService';

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

/**
 * Normalise une chaîne en clé canonique alphanumérique sans accents ni ponctuation ni espaces.
 * "Note rangés/MFRB/Tâche à faire MFRB.md" -> "noterangesmfrbtacheafairemfrb"
 */
export function normalizeCanonicalKey(input: string): string {
	if (!input || typeof input !== 'string') return '';
	return input
		.replace(/^\[\[/, '')
		.replace(/\]\]$/, '')
		.replace(/\.md$/i, '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

/**
 * Supprime les accents et diacritiques d'une chaîne tout en conservant les séparateurs.
 */
export function stripAccents(str: string): string {
	if (!str || typeof str !== 'string') return '';
	return str
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/**
 * Vérifie de manière robuste et cross-realm si un objet est un fichier TFile.
 */
export function isTFile(file: unknown): file is TFile {
	return Boolean(file && typeof file === 'object' && typeof (file as any).path === 'string' && (file as any).extension !== undefined);
}

export class VaultContextService {
	private app: App;
	private settings: SecondBrainSettings;
	private filterService: VaultFilterService;

	constructor(app: App, settings: SecondBrainSettings) {
		this.app = app;
		this.settings = settings;
		this.filterService = new VaultFilterService(app, settings);
	}

	public getFilterService(): VaultFilterService {
		return this.filterService;
	}

	/**
	 * Résolution canonique déterministe d'un fichier dans le coffre (sans devinette ni sensibilité aux accents/casse/chemins relatifs).
	 */
	public resolveFileCanonically(rawPath: string, activeFile?: TFile | null): TFile | null {
		if (!rawPath || typeof rawPath !== 'string') return null;

		let clean = rawPath
			.replace(/^\[\[/, '')
			.replace(/\]\]$/, '')
			.replace(/[\r\n]+/g, ' ')
			.trim();
		clean = clean.replace(/^["']/, '').replace(/["']$/, '').trim();
		if (!clean) return null;

		const lowerClean = clean.toLowerCase();

		// 1. Si la recherche cible explicitement la note active
		if (lowerClean === 'active' || lowerClean === 'current' || lowerClean === 'note active' || lowerClean === 'cette note') {
			const active = activeFile || this.app.workspace?.getActiveFile?.();
			if (isTFile(active)) return active;
		}

		// 2. Recherche exacte directe via Vault
		const directNorm = normalizePath(clean.endsWith('.md') ? clean : `${clean}.md`);
		let file = this.app.vault.getFileByPath(directNorm) || this.app.vault.getAbstractFileByPath(directNorm);
		if (isTFile(file)) return file;

		const directWithoutExt = normalizePath(clean);
		file = this.app.vault.getFileByPath(directWithoutExt) || this.app.vault.getAbstractFileByPath(directWithoutExt);
		if (isTFile(file)) return file;

		// 3. Comparaison avec la note active
		const effectiveActive = activeFile || this.app.workspace?.getActiveFile?.();
		if (isTFile(effectiveActive)) {
			const activeKey = normalizeCanonicalKey(effectiveActive.basename);
			const queryKey = normalizeCanonicalKey(clean);
			if (activeKey === queryKey || normalizeCanonicalKey(effectiveActive.path) === queryKey) {
				return effectiveActive;
			}
		}

		// 4. Moteur de liens natif Obsidian (metadataCache)
		const baseOnly = clean.split('/').pop()?.replace(/\.md$/, '').trim() || clean;
		if (this.app.metadataCache && typeof this.app.metadataCache.getFirstLinkpathDest === 'function') {
			try {
				const dest = this.app.metadataCache.getFirstLinkpathDest(baseOnly, '');
				if (isTFile(dest)) return dest;
				const destFull = this.app.metadataCache.getFirstLinkpathDest(clean, '');
				if (isTFile(destFull)) return destFull;
			} catch {
				// ignore
			}
		}

		// 5. Index canonique (Normalisation sans accents, ponctuation, espaces)
		if (typeof this.app.vault.getMarkdownFiles === 'function') {
			const mdFiles = this.app.vault.getMarkdownFiles();
			const queryKey = normalizeCanonicalKey(clean);
			const baseKey = normalizeCanonicalKey(baseOnly);

			// Match A : Correspondance exacte clé normalisée sur le nom de fichier (basename)
			const exactBase = mdFiles.find(f => normalizeCanonicalKey(f.basename) === baseKey || normalizeCanonicalKey(f.basename) === queryKey);
			if (exactBase && isTFile(exactBase)) return exactBase;

			// Match B : Correspondance exacte clé normalisée sur le chemin complet
			const exactPath = mdFiles.find(f => normalizeCanonicalKey(f.path) === queryKey);
			if (exactPath && isTFile(exactPath)) return exactPath;

			// Match C : Fin de chemin (ex: "mfrb/tacheafairemfrb")
			const endPath = mdFiles.find(f => normalizeCanonicalKey(f.path).endsWith(queryKey));
			if (endPath && isTFile(endPath)) return endPath;

			// Match D : Intersection de mots-clés (Fuzzy word tokens)
			const queryTokens = stripAccents(clean).split(/[^a-z0-9]+/).filter(w => w.length >= 2);
			if (queryTokens.length > 0) {
				let bestFile: TFile | null = null;
				let bestScore = 0;

				for (const f of mdFiles) {
					const baseNorm = stripAccents(f.basename);
					const pathNorm = stripAccents(f.path);
					let matchedTokens = 0;

					for (const token of queryTokens) {
						if (baseNorm.includes(token)) {
							matchedTokens += 2; // Priorité élevée si dans le nom de fichier
						} else if (pathNorm.includes(token)) {
							matchedTokens += 1;
						}
					}

					const maxPossible = queryTokens.length * 2;
					const score = matchedTokens / maxPossible;

					if (score > bestScore && (matchedTokens >= queryTokens.length || score >= 0.7)) {
						bestScore = score;
						bestFile = f;
					}
				}

				if (bestFile) return bestFile;
			}
		}

		return null;
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

			// 1. Filtre de confidentialité rapide (dossier / nom)
			if (this.filterService.isFolderExcluded(normalizedPath) || this.filterService.isFileNameExcluded(normalizedPath)) {
				continue;
			}

			if (normalizedFolderFilter && !lowerPath.startsWith(normalizedFolderFilter)) {
				continue;
			}

			const content = await this.app.vault.read(file);

			// 2. Filtre de confidentialité approfondi (tags / propriétés YAML)
			if (this.filterService.isFileExcluded(file, content)) {
				continue;
			}

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

			// 1. Filtre rapide de dossier / fichier exclu
			if (this.filterService.isFolderExcluded(normPath) || this.filterService.isFileNameExcluded(normPath)) {
				continue;
			}

			if (normFolder && !normPath.toLowerCase().startsWith(normFolder)) {
				continue;
			}

			const content = (typeof (this.app.vault as any).cachedRead === 'function')
				? await (this.app.vault as any).cachedRead(file)
				: await this.app.vault.read(file);

			// 2. Filtre de note complète par tags / frontmatter
			if (this.filterService.isFileExcluded(file, content)) {
				continue;
			}

			const tasks = TaskParser.parseAllTasks(content, normPath, this.settings);

			for (const task of tasks) {
				// 3. Filtre spécifique de la tâche
				if (this.filterService.isTaskExcluded(task, content)) {
					continue;
				}

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
		const file = this.resolveFileCanonically(filePath);

		if (!(file instanceof TFile)) {
			return null;
		}

		// Filtre rapide dossier / nom
		if (this.filterService.isFolderExcluded(file.path) || this.filterService.isFileNameExcluded(file.path)) {
			return null;
		}

		const fullContent = await this.app.vault.read(file);

		// Filtre complet frontmatter / tags
		if (this.filterService.isFileExcluded(file, fullContent)) {
			return null;
		}

		const truncated = fullContent.length > maxCharacters;
		const content = truncated ? fullContent.slice(0, maxCharacters) + '\n\n... [Contenu tronqué pour la taille du contexte]' : fullContent;

		return {
			path: normalizePath(file.path),
			title: file.basename,
			content,
			truncated
		};
	}

	/**
	 * Analyse des liens entrants (backlinks) et sortants (outlinks) d'une note.
	 */
	public async getNoteConnections(filePath: string): Promise<NoteConnections | null> {
		const file = this.resolveFileCanonically(filePath);

		if (!(file instanceof TFile)) {
			return null;
		}

		if (this.filterService.isFileExcluded(file)) {
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
			if (this.filterService.isFileExcluded(otherFile)) continue;
			const otherContent = await this.app.vault.read(otherFile);
			if (linkRegex.test(otherContent)) {
				backlinks.push(normalizePath(otherFile.path));
			}
		}

		return {
			path: normalizePath(file.path),
			title: baseName,
			outgoingLinks,
			backlinks,
			tags
		};
	}

	/**
	 * Détecte dynamiquement la configuration des notes quotidiennes du coffre :
	 * - Vérifie le plugin Obsidian natif "Daily Notes" (daily-notes)
	 * - Vérifie le plugin communautaire "Periodic Notes" (periodic-notes)
	 * - Vérifie les réglages du plugin Second Brain Manager
	 * - Analyse les notes existantes dans le coffre pour déduire le format et le dossier réel
	 */
	public getDailyNotesConfig(): { folder: string; format: string; template?: string } {
		let folder = this.settings.dailyNotesFolder || '';
		let format = this.settings.dateFormat || 'YYYY-MM-DD';
		let template = this.settings.dailyNoteTemplatePath || '';

		// 1. Détection via plugin officiel Daily Notes d'Obsidian
		const coreDaily = (this.app as any).internalPlugins?.plugins?.['daily-notes']?.instance?.options;
		if (coreDaily) {
			if (coreDaily.folder && !folder) folder = coreDaily.folder;
			if (coreDaily.format && (!this.settings.dateFormat || this.settings.dateFormat === 'YYYY-MM-DD')) format = coreDaily.format;
			if (coreDaily.template && !template) template = coreDaily.template;
		}

		// 2. Détection via plugin Periodic Notes
		const periodicDaily = (this.app as any).plugins?.plugins?.['periodic-notes']?.settings?.daily;
		if (periodicDaily && periodicDaily.enabled) {
			if (periodicDaily.folder && !folder) folder = periodicDaily.folder;
			if (periodicDaily.format && (!this.settings.dateFormat || this.settings.dateFormat === 'YYYY-MM-DD')) format = periodicDaily.format;
			if (periodicDaily.template && !template) template = periodicDaily.template;
		}

		if (!folder) {
			folder = '04 - Journal';
		}

		return { folder: normalizePath(folder), format, template: template ? normalizePath(template) : undefined };
	}

	/**
	 * Récupération de la note quotidienne pour une date donnée (par défaut aujourd'hui).
	 * Prend en charge tous les formats de date (YYYY-MM-DD, DD-MM-YYYY, formats personnalisés) et tous les dossiers de coffre.
	 */
	public async getDailyNote(dateStr?: string): Promise<{ path: string; exists: boolean; content?: string }> {
		const targetIso = dateStr ? (DynamicRegexBuilder.normalizeDate(dateStr) || dateStr) : new Date().toISOString().split('T')[0];
		const config = this.getDailyNotesConfig();

		const nameVariants = new Set<string>();
		nameVariants.add(targetIso);

		let frDate = targetIso;
		const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetIso);
		if (isoMatch) {
			frDate = `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
			nameVariants.add(frDate);
			nameVariants.add(`${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`);
			nameVariants.add(`${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`);
			nameVariants.add(`${isoMatch[1]}_${isoMatch[2]}_${isoMatch[3]}`);
		}

		try {
			if (typeof (this.app as any).moment === 'function' || typeof (window as any).moment === 'function') {
				const momentFn = (this.app as any).moment || (window as any).moment;
				const m = momentFn(targetIso, 'YYYY-MM-DD');
				if (m.isValid()) {
					if (config.format) nameVariants.add(m.format(config.format));
					nameVariants.add(m.format('YYYY-MM-DD'));
					nameVariants.add(m.format('DD-MM-YYYY'));
				}
			}
		} catch {
			// ignore
		}

		const variantsList = Array.from(nameVariants);
		const dailyFolder = config.folder;

		// 1. Recherche dans le dossier configuré
		for (const name of variantsList) {
			const dailyPath = normalizePath(`${dailyFolder}/${name}.md`);
			const file = this.app.vault.getFileByPath(dailyPath) || this.app.vault.getAbstractFileByPath(dailyPath);
			if (file instanceof TFile) {
				const content = (typeof (this.app.vault as any).cachedRead === 'function')
					? await (this.app.vault as any).cachedRead(file)
					: await this.app.vault.read(file);
				return { path: dailyPath, exists: true, content };
			}
		}

		// 2. Recherche globale dans tout le coffre
		if (typeof this.app.vault.getMarkdownFiles === 'function') {
			const markdownFiles = this.app.vault.getMarkdownFiles();
			for (const f of markdownFiles) {
				if (variantsList.includes(f.basename)) {
					const content = (typeof (this.app.vault as any).cachedRead === 'function')
						? await (this.app.vault as any).cachedRead(f)
						: await this.app.vault.read(f);
					return { path: normalizePath(f.path), exists: true, content };
				}
			}
		}

		const defaultName = (config.format && config.format !== 'YYYY-MM-DD')
			? frDate
			: targetIso;

		return { path: normalizePath(`${dailyFolder}/${defaultName}.md`), exists: false };
	}

	/**
	 * Récupère ou crée la note quotidienne en appliquant le modèle (template) et en exécutant Templater si disponible.
	 */
	public async getOrCreateDailyNote(
		dateStr?: string,
		templatePath?: string
	): Promise<{ file: TFile | null; path: string; created: boolean; content: string }> {
		const targetIso = dateStr ? (DynamicRegexBuilder.normalizeDate(dateStr) || dateStr) : new Date().toISOString().split('T')[0];
		const config = this.getDailyNotesConfig();

		// 1. Vérification si la note existe déjà
		const existingCheck = await this.getDailyNote(targetIso);
		if (existingCheck.exists) {
			const file = this.app.vault.getFileByPath(existingCheck.path) || this.app.vault.getAbstractFileByPath(existingCheck.path);
			if (file instanceof TFile) {
				return { file, path: existingCheck.path, created: false, content: existingCheck.content || '' };
			}
		}

		// 2. Détermination du nom de fichier cible
		let chosenName = targetIso;
		const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetIso);
		const frDate = isoMatch ? `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}` : targetIso;

		try {
			if (typeof (this.app as any).moment === 'function' || typeof (window as any).moment === 'function') {
				const momentFn = (this.app as any).moment || (window as any).moment;
				const m = momentFn(targetIso, 'YYYY-MM-DD');
				if (m.isValid() && config.format) {
					chosenName = m.format(config.format);
				}
			} else if (config.folder.toLowerCase().includes('quotidienne') || (config.format && config.format.startsWith('DD'))) {
				chosenName = frDate;
			}
		} catch {
			chosenName = targetIso;
		}

		const dailyFolder = config.folder;
		const targetPath = normalizePath(`${dailyFolder}/${chosenName}.md`);

		if (dailyFolder && dailyFolder !== '/' && dailyFolder !== '.') {
			const folderExists = this.app.vault.getAbstractFileByPath(dailyFolder);
			if (!folderExists && typeof this.app.vault.createFolder === 'function') {
				try {
					await this.app.vault.createFolder(dailyFolder);
				} catch {
					// Dossier créé
				}
			}
		}

		let initialContent = `# Note du ${chosenName}\n\n`;
		let rawTemplate = '';
		const effectiveTemplatePath = templatePath || config.template;

		if (effectiveTemplatePath) {
			const normTemplate = normalizePath(effectiveTemplatePath);
			const templateFile = this.app.vault.getFileByPath(normTemplate) || this.app.vault.getAbstractFileByPath(normTemplate);
			if (templateFile instanceof TFile) {
				rawTemplate = await this.app.vault.read(templateFile);
			}
		}

		if (rawTemplate) {
			initialContent = rawTemplate;
		}

		let createdFile: TFile | null = null;
		if (typeof this.app.vault.create === 'function') {
			try {
				createdFile = await this.app.vault.create(targetPath, initialContent);
			} catch {
				const existing = this.app.vault.getFileByPath(targetPath) || this.app.vault.getAbstractFileByPath(targetPath);
				if (existing instanceof TFile) createdFile = existing;
			}
		}

		if (!createdFile) {
			const fileObj = this.app.vault.getFileByPath(targetPath) || this.app.vault.getAbstractFileByPath(targetPath);
			if (fileObj instanceof TFile) createdFile = fileObj;
		}

		// Exécution de Templater ou remplacement des placeholders
		if (createdFile) {
			const templaterPlugin = (this.app as any).plugins?.plugins?.['templater-obsidian'];
			if (templaterPlugin && rawTemplate) {
				try {
					if (templaterPlugin.templater?.overwrite_file_commands) {
						await templaterPlugin.templater.overwrite_file_commands(createdFile);
					} else if (templaterPlugin.templater?.parse_template) {
						const parsed = await templaterPlugin.templater.parse_template({ target_file: createdFile, run_mode: 0 }, rawTemplate);
						if (parsed) {
							await this.app.vault.modify(createdFile, parsed);
						}
					}
				} catch (tpErr) {
					console.warn('[Second Brain Manager] Erreur lors de l\'exécution de Templater:', tpErr);
				}
			} else if (rawTemplate) {
				const dateObj = new Date(targetIso);
				const yesterday = new Date(dateObj);
				yesterday.setDate(yesterday.getDate() - 1);
				const yesterdayFr = `${String(yesterday.getDate()).padStart(2, '0')}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${yesterday.getFullYear()}`;
				const yesterdayIso = yesterday.toISOString().split('T')[0];

				const tomorrow = new Date(dateObj);
				tomorrow.setDate(tomorrow.getDate() + 1);
				const tomorrowFr = `${String(tomorrow.getDate()).padStart(2, '0')}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${tomorrow.getFullYear()}`;
				const tomorrowIso = tomorrow.toISOString().split('T')[0];

				const parsedContent = rawTemplate
					.replace(/\{\{date\}\}/gi, chosenName)
					.replace(/\{\{title\}\}/gi, chosenName)
					.replace(/\{\{yesterday\}\}/gi, yesterdayFr)
					.replace(/\{\{tomorrow\}\}/gi, tomorrowFr)
					// Remplacement de secours si Templater n'est pas actif
					.replace(/<%\s*tp\.date\.now\([^)]*-[0-9]+[^)]*\)\s*%>/gi, yesterdayFr)
					.replace(/<%\s*tp\.date\.now\([^)]*\+[0-9]+[^)]*\)\s*%>/gi, tomorrowFr)
					.replace(/<%\s*tp\.date\.now\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, targetIso)
					.replace(/<%\s*tp\.date\.now\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, frDate)
					.replace(/<%\s*tp\.date\.now\(\)\s*%>/gi, chosenName)
					.replace(/<%\s*tp\.date\.tomorrow\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, tomorrowIso)
					.replace(/<%\s*tp\.date\.tomorrow\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, tomorrowFr)
					.replace(/<%\s*tp\.date\.yesterday\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, yesterdayIso)
					.replace(/<%\s*tp\.date\.yesterday\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, yesterdayFr)
					.replace(/<%\s*tp\.file\.title\s*%>/gi, chosenName);

				if (parsedContent !== rawTemplate) {
					await this.app.vault.modify(createdFile, parsedContent);
				}
			}
		}

		let finalContent = initialContent;
		if (createdFile) {
			if (typeof (this.app.vault as any).cachedRead === 'function') {
				try {
					finalContent = await (this.app.vault as any).cachedRead(createdFile);
				} catch {
					// Fallback
				}
			} else if (typeof this.app.vault.read === 'function') {
				try {
					finalContent = await this.app.vault.read(createdFile);
				} catch {
					// Fallback
				}
			}
		}
		return { file: createdFile, path: targetPath, created: true, content: finalContent };
	}

	/**
	 * Ouvre proprement la note quotidienne dans la zone éditeur principale d'Obsidian (rootSplit),
	 * sans écraser ni fermer le briefing du matin ou d'autres vues du panneau latéral.
	 */
	public async openDailyNoteInWorkspace(dailyFile: TFile): Promise<void> {
		if (!dailyFile) return;

		try {
			// 1. Vérifie si la note est déjà ouverte dans un onglet markdown existant
			const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of markdownLeaves) {
				const view = leaf.view;
				if (view && (view as any).file && (view as any).file.path === dailyFile.path) {
					this.app.workspace.setActiveLeaf(leaf, { focus: true });
					return;
				}
			}

			// 2. Recherche un onglet dans la zone centrale principale (rootSplit)
			let targetLeaf: any = null;
			const rootMarkdownLeaves = markdownLeaves.filter(l => (l as any).getRoot?.() === this.app.workspace.rootSplit);
			if (rootMarkdownLeaves.length > 0) {
				targetLeaf = rootMarkdownLeaves[0];
			} else {
				targetLeaf = this.app.workspace.getLeaf(false);
			}

			if (targetLeaf && typeof targetLeaf.openFile === 'function') {
				await targetLeaf.openFile(dailyFile, { active: true });
			} else if (typeof this.app.workspace.openLinkText === 'function') {
				await this.app.workspace.openLinkText(dailyFile.path, '', false);
			}
		} catch (err) {
			console.warn('[Second Brain Manager] Erreur lors de l\'ouverture de la note quotidienne:', err);
		}
	}

	/**
	 * Synthèse globale de la structure du coffre pour l'agent (projets, contacts, domaines, inbox).
	 */
	public getVaultStructure(): VaultStructureSummary {
		const allFiles = (typeof this.app.vault.getAllLoadedFiles === 'function') ? this.app.vault.getAllLoadedFiles() : [];
		const folders: string[] = [];
		const projects: string[] = [];
		const contacts: string[] = [];
		const domains: string[] = [];
		const inboxFiles: string[] = [];
		let totalMarkdownFiles = 0;

		const inboxFolder = normalizePath(this.settings.inboxFolder || '00 - Inbox').toLowerCase();

		for (const f of allFiles) {
			if (f instanceof TFolder) {
				const normFolder = normalizePath(f.path);
				if (!this.filterService.isFolderExcluded(normFolder)) {
					folders.push(normFolder);
				}
			} else if (f instanceof TFile && f.extension === 'md') {
				const normPath = normalizePath(f.path);
				if (this.filterService.isFileExcluded(f)) {
					continue;
				}

				totalMarkdownFiles++;
				const lowerPath = normPath.toLowerCase();

				if (lowerPath.includes('projet') || lowerPath.includes('01 - projets')) {
					projects.push(f.basename);
				} else if (lowerPath.includes('contact') || lowerPath.includes('personne') || lowerPath.includes('03 - contacts')) {
					contacts.push(f.basename);
				} else if (lowerPath.includes('domaine') || lowerPath.includes('ressource') || lowerPath.includes('note rangé') || lowerPath.includes('02 - domaines')) {
					domains.push(f.basename);
				}

				const isRootFile = !normPath.includes('/');
				const isInInboxFolder = lowerPath.startsWith(inboxFolder) || lowerPath.includes('notes en vrac') || lowerPath.includes('vrac') || lowerPath.includes('sans titre');
				if (isInInboxFolder || isRootFile) {
					inboxFiles.push(normPath);
				}
			}
		}

		return {
			folders: folders.sort(),
			projects: Array.from(new Set(projects)).sort(),
			contacts: Array.from(new Set(contacts)).sort(),
			domains: Array.from(new Set(domains)).sort(),
			inboxFiles: Array.from(new Set(inboxFiles)).sort(),
			totalMarkdownFiles
		};
	}
}
