import { App, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';

/**
 * Règles d'exclusion de tâches, appliquées à toutes les requêtes du plugin
 * (tableau de bord, calendrier, briefing, revue du soir, reprise, recherche de l'IA).
 * La gamification n'est pas concernée : cocher une tâche exclue rapporte toujours ses pièces.
 */
export interface TaskExclusionSettings {
	/** Tags (sans ou avec #), un sous-tag est exclu avec son parent : #projet exclut #projet/x */
	taskExcludeTags: string;
	/** Mots ou expressions dans le titre ; /motif/i pour une expression régulière */
	taskExcludeWords: string;
	/** Dossiers ou fichiers ; * comme joker (ex. Archives, Modèles/*, *Brouillon*) */
	taskExcludePaths: string;
	/** Caractères de statut entre crochets (ex. - pour annulée, > pour reportée) */
	taskExcludeStatuses: string;
}

export const DEFAULT_TASK_EXCLUSION_SETTINGS: TaskExclusionSettings = {
	taskExcludeTags: '',
	taskExcludeWords: '',
	taskExcludePaths: '',
	taskExcludeStatuses: ''
};

/** Accès facultatif aux tags de note (frontmatter et corps) via le cache de métadonnées d'Obsidian. */
export type NoteTagsResolver = (filePath: string) => string[];

export type ExclusionReason = 'tag' | 'note-tag' | 'word' | 'path' | 'status' | 'parent';

export function parseRuleList(raw?: string): string[] {
	if (!raw) return [];
	return raw
		.split(/[\n,;]+/)
		.map(s => s.trim())
		.filter(Boolean);
}

function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#/, '').toLowerCase();
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${escaped}$`, 'i');
}

export class TaskExclusionRules {
	private readonly tags: string[];
	private readonly words: Array<(text: string) => boolean>;
	private readonly paths: Array<(path: string) => boolean>;
	private readonly statuses: Set<string>;

	constructor(settings: Partial<TaskExclusionSettings>, private noteTags?: NoteTagsResolver) {
		this.tags = parseRuleList(settings.taskExcludeTags).map(normalizeTag).filter(Boolean);

		this.words = parseRuleList(settings.taskExcludeWords).map(rule => {
			const re = /^\/(.+)\/([a-z]*)$/i.exec(rule);
			if (re) {
				try {
					const regex = new RegExp(re[1], re[2].includes('i') ? re[2] : `${re[2]}i`);
					return (text: string) => regex.test(text);
				} catch {
					// Expression invalide : traitée comme un texte simple
				}
			}
			const needle = rule.replace(/^["«]\s*|\s*["»]$/g, '').toLowerCase();
			return (text: string) => text.toLowerCase().includes(needle);
		});

		this.paths = parseRuleList(settings.taskExcludePaths).map(rule => {
			const clean = rule.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
			if (clean.includes('*') || clean.includes('?')) {
				const re = globToRegExp(clean);
				return (path: string) => re.test(path) || re.test(path.split('/').pop() || '');
			}
			const lower = clean.toLowerCase();
			return (path: string) => {
				const p = path.toLowerCase();
				const base = p.split('/').pop() || '';
				return p === lower || p.startsWith(`${lower}/`) || p === `${lower}.md` || base === lower || base === `${lower}.md`;
			};
		});

		this.statuses = new Set(parseRuleList(settings.taskExcludeStatuses)
			.flatMap(s => s.replace(/[[\]]/g, '').split(''))
			.map(c => c === '' ? ' ' : c));
	}

	public isEmpty(): boolean {
		return !this.tags.length && !this.words.length && !this.paths.length && !this.statuses.size;
	}

	/** Exclusion au niveau du fichier (évite de le lire). */
	public isPathExcluded(path: string): boolean {
		return this.paths.some(match => match(path));
	}

	/** Raison de l'exclusion d'une tâche, ou null si elle est conservée. */
	public reasonFor(task: ObsidianTask): ExclusionReason | null {
		if (this.isEmpty()) return null;
		if (this.isPathExcluded(task.filePath)) return 'path';
		if (this.statuses.size && this.statuses.has(task.statusChar)) return 'status';
		if (this.tags.length) {
			const taskTags = this.extractTags(task);
			if (taskTags.some(t => this.matchesTag(t))) return 'tag';
			if (this.noteTags) {
				const fileTags = this.noteTags(task.filePath).map(normalizeTag);
				if (fileTags.some(t => this.matchesTag(t))) return 'note-tag';
			}
		}
		if (this.words.length) {
			const text = `${task.title} ${task.cleanText || ''}`;
			if (this.words.some(match => match(text))) return 'word';
		}
		return null;
	}

	public isExcluded(task: ObsidianTask): boolean {
		return this.reasonFor(task) !== null;
	}

	/**
	 * Filtre une liste de tâches. Les sous-tâches d'une tâche exclue sont exclues avec elle.
	 * Les tâches doivent être dans l'ordre du fichier (ce que produit TaskParser.parseAllTasks).
	 */
	public filter(tasks: ObsidianTask[]): ObsidianTask[] {
		if (this.isEmpty()) return tasks;
		const excludedLines = new Map<string, Set<number>>();
		return tasks.filter(task => {
			const lines = excludedLines.get(task.filePath) || new Set<number>();
			const parentExcluded = task.parentLineNumber !== undefined && lines.has(task.parentLineNumber);
			if (parentExcluded || this.isExcluded(task)) {
				lines.add(task.lineNumber);
				excludedLines.set(task.filePath, lines);
				return false;
			}
			return true;
		});
	}

	private matchesTag(tag: string): boolean {
		return this.tags.some(ex => tag === ex || tag.startsWith(`${ex}/`));
	}

	private extractTags(task: ObsidianTask): string[] {
		const fromText = (task.rawText || '').match(/#[^\s#,;:!?()[\]{}"'`]+/gu) || [];
		return [...(task.domainTags || []), ...fromText].map(normalizeTag);
	}
}

/** Tags d'une note (frontmatter « tags »/« tag » et tags du corps), via le cache d'Obsidian. */
function noteTagsFromCache(app: App, filePath: string): string[] {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return [];
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return [];
	const tags = (cache.tags || []).map(t => t.tag);
	const fm = cache.frontmatter as Record<string, unknown> | undefined;
	for (const key of ['tags', 'tag']) {
		const value = fm?.[key];
		const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
		list.forEach(v => { if (typeof v === 'string' && v.trim()) tags.push(v.trim()); });
	}
	return tags;
}

let cachedRules: { key: string; app?: App; rules: TaskExclusionRules } | null = null;

/**
 * Règles d'exclusion à jour pour les réglages fournis (mises en cache tant qu'ils ne changent pas).
 * Avec `app`, les tags de la note qui contient la tâche sont aussi pris en compte.
 */
export function getTaskExclusionRules(app: App | undefined, settings: Partial<TaskExclusionSettings>): TaskExclusionRules {
	const key = [settings.taskExcludeTags, settings.taskExcludeWords, settings.taskExcludePaths, settings.taskExcludeStatuses]
		.map(v => v || '')
		.join('\u0000');
	if (cachedRules && cachedRules.key === key && cachedRules.app === app) return cachedRules.rules;
	const rules = new TaskExclusionRules(settings, app ? (path) => noteTagsFromCache(app, path) : undefined);
	cachedRules = { key, app, rules };
	return rules;
}
