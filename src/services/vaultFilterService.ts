import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { SecondBrainSettings } from '../main';

export interface ParsedFilters {
	excludedFolders: string[];
	excludedFiles: string[];
	excludedTags: string[];
	excludedProperties: Array<{ key: string; value?: string }>;
}

export class VaultFilterService {
	private app: App;
	private settings: SecondBrainSettings;

	constructor(app: App, settings: SecondBrainSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Découpe une chaîne en liste d'éléments nettoyés (séparateurs: virgules, points-virgules, retours à la ligne).
	 */
	public static parseList(raw?: string): string[] {
		if (!raw || typeof raw !== 'string') return [];
		return raw
			.split(/[\n,;]+/)
			.map(s => s.trim())
			.filter(s => s.length > 0);
	}

	/**
	 * Découpe une chaîne de propriétés en paires clé / valeur ou clés seules.
	 * Ex: "private, publish: false, secret: true, no-ai"
	 */
	public static parseProperties(raw?: string): Array<{ key: string; value?: string }> {
		const items = this.parseList(raw);
		const props: Array<{ key: string; value?: string }> = [];
		for (const item of items) {
			const colonIndex = item.indexOf(':');
			if (colonIndex !== -1) {
				const key = item.slice(0, colonIndex).trim().toLowerCase();
				const val = item.slice(colonIndex + 1).trim().toLowerCase();
				if (key) {
					props.push({ key, value: val });
				}
			} else {
				props.push({ key: item.toLowerCase() });
			}
		}
		return props;
	}

	/**
	 * Renvoie la configuration des 4 filtres sous forme normalisée.
	 */
	public getParsedFilters(): ParsedFilters {
		return {
			excludedFolders: VaultFilterService.parseList(this.settings.excludedFolders).map(f => normalizePath(f).toLowerCase()),
			excludedFiles: VaultFilterService.parseList(this.settings.excludedFiles),
			excludedTags: VaultFilterService.parseList(this.settings.excludedTags).map(t => t.replace(/^#/, '').toLowerCase()),
			excludedProperties: VaultFilterService.parseProperties(this.settings.excludedProperties)
		};
	}

	/**
	 * Indique si au moins une règle d'exclusion est active.
	 */
	public hasActiveFilters(): boolean {
		const f = this.getParsedFilters();
		return f.excludedFolders.length > 0 || f.excludedFiles.length > 0 || f.excludedTags.length > 0 || f.excludedProperties.length > 0;
	}

	/**
	 * Vérifie si un chemin de dossier ou fichier correspond à la liste des dossiers exclus.
	 */
	public isFolderExcluded(folderOrFilePath: string): boolean {
		if (!folderOrFilePath) return false;
		const norm = normalizePath(folderOrFilePath).toLowerCase();
		const filters = this.getParsedFilters();
		if (filters.excludedFolders.length === 0) return false;

		for (const excluded of filters.excludedFolders) {
			if (!excluded) continue;
			// 1. Correspondance exacte ou préfixe de dossier
			if (norm === excluded || norm.startsWith(excluded + '/') || norm.startsWith(excluded + '\\')) {
				return true;
			}
			// 2. Vérification par segments de dossiers
			const segments = norm.split('/');
			if (segments.some(seg => seg === excluded)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Vérifie si un nom de fichier ou chemin correspond aux motifs de fichiers exclus (supporte les wildcards * et ?).
	 */
	public isFileNameExcluded(filePathOrName: string): boolean {
		if (!filePathOrName) return false;
		const norm = normalizePath(filePathOrName);
		const baseName = norm.split('/').pop() || norm;
		const baseWithoutMd = baseName.replace(/\.md$/i, '');
		const lowerBase = baseName.toLowerCase();
		const lowerBaseNoMd = baseWithoutMd.toLowerCase();
		const lowerPath = norm.toLowerCase();

		const filters = this.getParsedFilters();
		if (filters.excludedFiles.length === 0) return false;

		for (const pattern of filters.excludedFiles) {
			if (!pattern) continue;
			const cleanPattern = pattern.trim();
			const lowerPattern = cleanPattern.toLowerCase();
			const patternNoMd = lowerPattern.replace(/\.md$/i, '');

			// Match exact sur basename ou chemin
			if (lowerBase === lowerPattern || lowerBaseNoMd === patternNoMd || lowerPath === lowerPattern) {
				return true;
			}

			// Match avec jokers / wildcards (* ou ?)
			if (cleanPattern.includes('*') || cleanPattern.includes('?')) {
				const regexStr = '^' + cleanPattern
					.replace(/[.+^${}()|[\]\\]/g, '\\$&')
					.replace(/\*/g, '.*')
					.replace(/\?/g, '.') + '$';
				try {
					const regex = new RegExp(regexStr, 'i');
					if (regex.test(baseName) || regex.test(baseWithoutMd) || regex.test(norm)) {
						return true;
					}
				} catch {
					// En cas d'expression invalide, ignorer
				}
			}
		}
		return false;
	}

	/**
	 * Vérifie si une liste de tags contient l'un des tags exclus (supporte les tags hiérarchiques).
	 */
	public isTagExcluded(tags: string[]): boolean {
		if (!tags || tags.length === 0) return false;
		const filters = this.getParsedFilters();
		if (filters.excludedTags.length === 0) return false;

		for (const rawTag of tags) {
			const tag = rawTag.replace(/^#/, '').toLowerCase().trim();
			for (const excluded of filters.excludedTags) {
				if (!excluded) continue;
				// Match exact ou tag parent hiérarchique (ex: excluded 'prive' match '#prive' et '#prive/sante')
				if (tag === excluded || tag.startsWith(excluded + '/')) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Vérifie si les propriétés YAML du frontmatter contiennent l'une des propriétés exclues.
	 */
	public isPropertyExcluded(frontmatter: Record<string, any> | undefined | null): boolean {
		if (!frontmatter || typeof frontmatter !== 'object') return false;
		const filters = this.getParsedFilters();
		if (filters.excludedProperties.length === 0) return false;

		for (const { key, value } of filters.excludedProperties) {
			// Recherche insensible à la casse de la clé
			const fmKey = Object.keys(frontmatter).find(k => k.toLowerCase().trim() === key);
			if (fmKey !== undefined) {
				const fmVal = frontmatter[fmKey];
				if (value === undefined) {
					// Clé seule : exclue si la propriété est présente et truthy
					if (fmVal !== false && fmVal !== null && fmVal !== undefined && fmVal !== '' && fmVal !== 'false') {
						return true;
					}
				} else {
					// Clé-valeur : compare la valeur
					const fmValStr = String(fmVal).toLowerCase().trim();
					if (fmValStr === value || (Array.isArray(fmVal) && fmVal.map(v => String(v).toLowerCase().trim()).includes(value))) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * Extrait les métadonnées (frontmatter et tags) d'un fichier soit via metadataCache soit par parsing du contenu.
	 */
	public getFileMetadata(file: TFile, content?: string): { frontmatter?: Record<string, any>; tags: string[] } {
		let frontmatter: Record<string, any> | undefined;
		const tags: string[] = [];

		// 1. Essai via metadataCache natif d'Obsidian
		if (this.app && this.app.metadataCache && typeof this.app.metadataCache.getFileCache === 'function') {
			try {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache) {
					if (cache.frontmatter) {
						frontmatter = cache.frontmatter;
						if (cache.frontmatter.tags) {
							if (Array.isArray(cache.frontmatter.tags)) {
								tags.push(...cache.frontmatter.tags.map(t => String(t)));
							} else if (typeof cache.frontmatter.tags === 'string') {
								tags.push(...cache.frontmatter.tags.split(/[\s,]+/));
							}
						}
						if (cache.frontmatter.tag) {
							if (Array.isArray(cache.frontmatter.tag)) {
								tags.push(...cache.frontmatter.tag.map(t => String(t)));
							} else if (typeof cache.frontmatter.tag === 'string') {
								tags.push(...cache.frontmatter.tag.split(/[\s,]+/));
							}
						}
					}
					if (cache.tags && Array.isArray(cache.tags)) {
						tags.push(...cache.tags.map(t => t.tag));
					}
				}
			} catch {
				// ignore
			}
		}

		// 2. Parsing du contenu si nécessaire (ex: si pas de cache ou si content fourni)
		if (content) {
			// Extraction frontmatter YAML : ^---\r?\n([\s\S]*?)\r?\n---
			const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
			if (fmMatch && !frontmatter) {
				frontmatter = {};
				const fmLines = fmMatch[1].split('\n');
				for (const line of fmLines) {
					const colonIdx = line.indexOf(':');
					if (colonIdx !== -1) {
						const k = line.slice(0, colonIdx).trim();
						let v = line.slice(colonIdx + 1).trim();
						// Nettoyage guillemets
						v = v.replace(/^["']/, '').replace(/["']$/, '');
						if (v === 'true') frontmatter[k] = true;
						else if (v === 'false') frontmatter[k] = false;
						else frontmatter[k] = v;

						// Si c'est un champ tags ou tag dans le frontmatter
						if (k.toLowerCase() === 'tags' || k.toLowerCase() === 'tag') {
							const rawTags = v.replace(/^\[/, '').replace(/\]$/, '').split(/[\s,]+/);
							tags.push(...rawTags.filter(t => t.length > 0));
						}
					}
				}
			}

			// Extraction des tags inline : #tag
			const inlineTags = content.match(/#([a-zA-Z0-9_/-]+)/g) || [];
			tags.push(...inlineTags);
		}

		return { frontmatter, tags };
	}

	/**
	 * Vérifie de façon exhaustive si un fichier TFile est exclu (Dossier, Nom, Tags, Propriétés).
	 */
	public isFileExcluded(file: TFile, content?: string): boolean {
		if (!file) return false;

		// 1. Filtre dossier
		if (this.isFolderExcluded(file.path)) {
			return true;
		}

		// 2. Filtre nom de fichier
		if (this.isFileNameExcluded(file.path) || this.isFileNameExcluded(file.basename)) {
			return true;
		}

		// Si aucun filtre de tag ou propriété n'est configuré, gain de performance
		const filters = this.getParsedFilters();
		if (filters.excludedTags.length === 0 && filters.excludedProperties.length === 0) {
			return false;
		}

		// 3. Métadonnées (Tags et Propriétés)
		const { frontmatter, tags } = this.getFileMetadata(file, content);

		if (this.isTagExcluded(tags)) {
			return true;
		}

		if (this.isPropertyExcluded(frontmatter)) {
			return true;
		}

		return false;
	}

	/**
	 * Vérifie si une tâche est exclue (par dossier hôte, nom de fichier hôte, tags de tâche ou métadonnées de note).
	 */
	public isTaskExcluded(task: ObsidianTask, fileContent?: string): boolean {
		if (!task) return false;

		// 1. Filtre par le dossier du fichier
		if (task.filePath && this.isFolderExcluded(task.filePath)) {
			return true;
		}

		// 2. Filtre par le nom du fichier
		if (task.filePath && this.isFileNameExcluded(task.filePath)) {
			return true;
		}

		// 3. Filtre par les tags de la tâche
		const taskTags: string[] = [];
		if (task.domainTags && Array.isArray(task.domainTags)) {
			taskTags.push(...task.domainTags);
		}
		if (task.rawText) {
			const inline = task.rawText.match(/#([a-zA-Z0-9_/-]+)/g) || [];
			taskTags.push(...inline);
		}
		if (this.isTagExcluded(taskTags)) {
			return true;
		}

		// 4. Si la tâche appartient à un fichier, vérifie si le fichier hôte a des tags/propriétés exclus
		if (task.filePath && this.app?.vault) {
			const file = (typeof this.app.vault.getFileByPath === 'function' ? this.app.vault.getFileByPath(task.filePath) : null)
				|| (typeof this.app.vault.getAbstractFileByPath === 'function' ? this.app.vault.getAbstractFileByPath(task.filePath) : null);
			if (file instanceof TFile) {
				return this.isFileExcluded(file, fileContent);
			}
		}

		return false;
	}

	public filterFiles(files: TFile[]): TFile[] {
		if (!this.hasActiveFilters()) return files;
		return files.filter(f => !this.isFileExcluded(f));
	}

	public filterTasks(tasks: ObsidianTask[]): ObsidianTask[] {
		if (!this.hasActiveFilters()) return tasks;
		return tasks.filter(t => !this.isTaskExcluded(t));
	}

	/**
	 * Renvoie la liste normalisée des tags prioritaires configurés.
	 */
	public getPriorityTags(): string[] {
		return VaultFilterService.parseList(this.settings.priorityTags).map(t => t.replace(/^#/, '').toLowerCase());
	}

	/**
	 * Renvoie la liste normalisée des propriétés frontmatter prioritaires configurées.
	 */
	public getPriorityProperties(): Array<{ key: string; value?: string }> {
		return VaultFilterService.parseProperties(this.settings.priorityProperties);
	}

	/**
	 * Indique si des règles de priorité sont configurées.
	 */
	public hasActivePriorityRules(): boolean {
		return this.getPriorityTags().length > 0 || this.getPriorityProperties().length > 0;
	}

	/**
	 * Vérifie si un tag ou une liste de tags correspond aux tags prioritaires.
	 */
	public isTagPrioritized(tagOrTags?: string | string[]): boolean {
		if (!tagOrTags) return false;
		const priorityTags = this.getPriorityTags();
		if (priorityTags.length === 0) return false;

		const list = Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags];
		for (const t of list) {
			if (!t) continue;
			const clean = t.replace(/^#/, '').trim().toLowerCase();
			for (const pTag of priorityTags) {
				if (clean === pTag || clean.startsWith(pTag + '/') || clean.startsWith(pTag + '-')) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Vérifie si les propriétés frontmatter correspondent aux règles prioritaires.
	 */
	public isPropertiesPrioritized(frontmatter?: Record<string, any>): boolean {
		if (!frontmatter || typeof frontmatter !== 'object') return false;
		const priorityProps = this.getPriorityProperties();
		if (priorityProps.length === 0) return false;

		const lowerKeys = Object.keys(frontmatter).reduce((acc, k) => {
			acc[k.toLowerCase()] = frontmatter[k];
			return acc;
		}, {} as Record<string, any>);

		for (const propRule of priorityProps) {
			const val = lowerKeys[propRule.key];
			if (val !== undefined && val !== null) {
				if (propRule.value === undefined) {
					return true;
				}
				const strVal = String(val).trim().toLowerCase();
				if (strVal === propRule.value || (Array.isArray(val) && val.map(v => String(v).trim().toLowerCase()).includes(propRule.value))) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Vérifie si un fichier est prioritaire (par ses tags ou son frontmatter).
	 */
	public isFilePrioritized(file: TFile, fileContent?: string): boolean {
		if (!file) return false;
		if (!this.hasActivePriorityRules()) return false;

		if (this.app?.metadataCache) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache) {
				if (cache.frontmatter) {
					if (this.isPropertiesPrioritized(cache.frontmatter)) {
						return true;
					}
					if (cache.frontmatter.tags) {
						const tags = Array.isArray(cache.frontmatter.tags)
							? cache.frontmatter.tags
							: String(cache.frontmatter.tags).split(/[\s,]+/);
						if (this.isTagPrioritized(tags)) {
							return true;
						}
					}
				}
				if (cache.tags && cache.tags.length > 0) {
					if (this.isTagPrioritized(cache.tags.map(t => t.tag))) {
						return true;
					}
				}
			}
		}

		if (fileContent) {
			const inlineTags = fileContent.match(/#([a-zA-Z0-9_/-]+)/g) || [];
			if (inlineTags.length > 0 && this.isTagPrioritized(inlineTags)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Vérifie si une tâche est prioritaire (par ses tags ou son fichier hôte).
	 */
	public isTaskPrioritized(task: ObsidianTask, fileContent?: string): boolean {
		if (!task) return false;
		if (!this.hasActivePriorityRules()) return false;

		const taskTags: string[] = [];
		if (task.domainTags && Array.isArray(task.domainTags)) {
			taskTags.push(...task.domainTags);
		}
		if (task.rawText) {
			const inline = task.rawText.match(/#([a-zA-Z0-9_/-]+)/g) || [];
			taskTags.push(...inline);
		}
		if (this.isTagPrioritized(taskTags)) {
			return true;
		}

		if (task.filePath && this.app?.vault) {
			const file = (typeof this.app.vault.getFileByPath === 'function' ? this.app.vault.getFileByPath(task.filePath) : null)
				|| (typeof this.app.vault.getAbstractFileByPath === 'function' ? this.app.vault.getAbstractFileByPath(task.filePath) : null);
			if (file instanceof TFile) {
				return this.isFilePrioritized(file, fileContent);
			}
		}

		return false;
	}
}
