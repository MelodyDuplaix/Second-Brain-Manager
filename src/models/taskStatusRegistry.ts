/**
 * Registre des statuts de tâche, aligné sur le plugin Tasks.
 *
 * Tasks associe à chaque caractère de case ([ ], [x], [/], [3]…) un nom, un type
 * (TODO, DONE, IN_PROGRESS, CANCELLED, ON_HOLD, NON_TASK) et un statut suivant
 * (utilisé quand on clique sur la case). Ce registre lit ces réglages pour que le
 * Second Brain Manager interprète les cases exactement comme Tasks.
 */

export type TasksStatusType = 'TODO' | 'DONE' | 'IN_PROGRESS' | 'CANCELLED' | 'ON_HOLD' | 'NON_TASK';

export interface TaskStatusDefinition {
	symbol: string;
	name: string;
	nextStatusSymbol: string;
	type: TasksStatusType;
}

export interface TasksPluginStatusConfig {
	statuses: TaskStatusDefinition[];
	globalFilter: string;
	removeGlobalFilter: boolean;
	setDoneDate: boolean;
	setCancelledDate: boolean;
}

const VALID_TYPES: TasksStatusType[] = ['TODO', 'DONE', 'IN_PROGRESS', 'CANCELLED', 'ON_HOLD', 'NON_TASK'];

/** Statuts par défaut de Tasks (utilisés tant que ses réglages ne sont pas chargés). */
export const DEFAULT_TASK_STATUSES: TaskStatusDefinition[] = [
	{ symbol: ' ', name: 'À faire', nextStatusSymbol: 'x', type: 'TODO' },
	{ symbol: 'x', name: 'Terminée', nextStatusSymbol: ' ', type: 'DONE' },
	{ symbol: 'X', name: 'Terminée', nextStatusSymbol: ' ', type: 'DONE' },
	{ symbol: '/', name: 'En cours', nextStatusSymbol: 'x', type: 'IN_PROGRESS' },
	{ symbol: '-', name: 'Annulée', nextStatusSymbol: ' ', type: 'CANCELLED' },
	{ symbol: '?', name: 'En pause', nextStatusSymbol: ' ', type: 'ON_HOLD' },
	{ symbol: 'p', name: 'En pause', nextStatusSymbol: ' ', type: 'ON_HOLD' }
];

export class TaskStatusRegistry {
	private static byName = new Map<string, TaskStatusDefinition>(DEFAULT_TASK_STATUSES.map(s => [s.symbol, s]));
	private static fromTasks = false;
	private static config: Omit<TasksPluginStatusConfig, 'statuses'> = {
		globalFilter: '',
		removeGlobalFilter: false,
		setDoneDate: true,
		setCancelledDate: true
	};

	/** Revient aux statuts par défaut (plugin Tasks absent ou option désactivée). */
	public static reset(): void {
		this.byName = new Map(DEFAULT_TASK_STATUSES.map(s => [s.symbol, s]));
		this.fromTasks = false;
		this.config = { globalFilter: '', removeGlobalFilter: false, setDoneDate: true, setCancelledDate: true };
	}

	/** Applique les statuts lus dans les réglages de Tasks (ils complètent et remplacent les défauts). */
	public static configure(conf: TasksPluginStatusConfig): void {
		const map = new Map(DEFAULT_TASK_STATUSES.map(s => [s.symbol, s]));
		for (const s of conf.statuses) map.set(s.symbol, s);
		this.byName = map;
		this.fromTasks = true;
		this.config = {
			globalFilter: conf.globalFilter || '',
			removeGlobalFilter: Boolean(conf.removeGlobalFilter),
			setDoneDate: conf.setDoneDate !== false,
			setCancelledDate: conf.setCancelledDate !== false
		};
	}

	public static isFromTasksPlugin(): boolean {
		return this.fromTasks;
	}

	public static all(): TaskStatusDefinition[] {
		return [...this.byName.values()];
	}

	public static symbols(): string[] {
		return [...this.byName.keys()];
	}

	public static get(symbol: string): TaskStatusDefinition | undefined {
		return this.byName.get(symbol);
	}

	/** Type d'un statut ; un symbole inconnu est traité comme « à faire », comme dans Tasks. */
	public static typeOf(symbol: string): TasksStatusType {
		return this.byName.get(symbol)?.type || 'TODO';
	}

	public static nameOf(symbol: string): string {
		return this.byName.get(symbol)?.name || `[${symbol}]`;
	}

	/** Statut suivant lors d'un clic sur la case (comportement de Tasks). */
	public static nextSymbol(symbol: string): string {
		const def = this.byName.get(symbol);
		if (def && def.nextStatusSymbol !== undefined && def.nextStatusSymbol !== null) return def.nextStatusSymbol;
		return this.typeOf(symbol) === 'DONE' ? ' ' : 'x';
	}

	/** Premier symbole d'un type donné (ex. pour « Terminer » → x). */
	public static firstSymbolOfType(type: TasksStatusType, fallback: string): string {
		if (this.byName.get(fallback)?.type === type) return fallback;
		return this.all().find(s => s.type === type)?.symbol ?? fallback;
	}

	public static get globalFilter(): string {
		return this.config.globalFilter;
	}

	public static get removeGlobalFilter(): boolean {
		return this.config.removeGlobalFilter;
	}

	public static get setDoneDate(): boolean {
		return this.config.setDoneDate;
	}

	public static get setCancelledDate(): boolean {
		return this.config.setCancelledDate;
	}

	/** Avec un filtre global dans Tasks, seules les cases qui le contiennent sont des tâches. */
	public static passesGlobalFilter(body: string): boolean {
		const filter = this.config.globalFilter.trim();
		if (!filter) return true;
		return body.includes(filter);
	}

	/** Lit le bloc de réglages de Tasks (contenu de son data.json). */
	public static parseTasksPluginData(data: unknown): TasksPluginStatusConfig | null {
		if (!data || typeof data !== 'object') return null;
		const d = data as Record<string, unknown>;
		const statusSettings = (d.statusSettings || {}) as { coreStatuses?: unknown[]; customStatuses?: unknown[] };
		const raw = [...(statusSettings.coreStatuses || []), ...(statusSettings.customStatuses || [])];
		const statuses: TaskStatusDefinition[] = [];
		for (const item of raw) {
			if (!item || typeof item !== 'object') continue;
			const s = item as Record<string, unknown>;
			const symbol = typeof s.symbol === 'string' ? s.symbol : '';
			if ([...symbol].length !== 1 || symbol === ']' || symbol === '\n') continue;
			const type = (typeof s.type === 'string' && (VALID_TYPES as string[]).includes(s.type) ? s.type : 'TODO') as TasksStatusType;
			statuses.push({
				symbol,
				name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : `[${symbol}]`,
				nextStatusSymbol: typeof s.nextStatusSymbol === 'string' ? s.nextStatusSymbol : (type === 'DONE' ? ' ' : 'x'),
				type
			});
		}
		return {
			statuses,
			globalFilter: typeof d.globalFilter === 'string' ? d.globalFilter : '',
			removeGlobalFilter: Boolean(d.removeGlobalFilter),
			setDoneDate: d.setDoneDate !== false,
			setCancelledDate: d.setCancelledDate !== false
		};
	}
}
