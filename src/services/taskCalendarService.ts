import { App, TFile, normalizePath } from 'obsidian';
import { ObsidianTask, TaskPriority } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { TaskSyntaxConfig } from '../models/syntaxConfig';
import { TaskStatusRegistry } from '../models/taskStatusRegistry';

/* ==========================================================================
   Dates locales (jamais toISOString : décalage UTC le soir / tôt le matin)
   ========================================================================== */

export class CalendarDate {
	public static toISO(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	/** Convertit "YYYY-MM-DD" en Date locale à midi (évite les sauts d'heure d'été). */
	public static fromISO(iso: string): Date {
		const [y, m, d] = iso.split('-').map(Number);
		return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
	}

	/** Normalise une date de tâche ("YYYY-MM-DD", "DD-MM-YYYY", "YYYY/MM/DD") en ISO, sinon null. */
	public static normalize(raw?: string | null): string | null {
		if (!raw) return null;
		const s = raw.trim();
		let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
		if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
		m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
		if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
		return null;
	}

	public static today(): string {
		return this.toISO(new Date());
	}

	public static addDays(iso: string, n: number): string {
		const d = this.fromISO(iso);
		d.setDate(d.getDate() + n);
		return this.toISO(d);
	}

	public static addMonths(iso: string, n: number): string {
		const d = this.fromISO(iso);
		const targetDay = d.getDate();
		d.setDate(1);
		d.setMonth(d.getMonth() + n);
		const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		d.setDate(Math.min(targetDay, lastDay));
		return this.toISO(d);
	}

	/** Nombre de jours de a vers b (b - a). */
	public static diffDays(a: string, b: string): number {
		return Math.round((this.fromISO(b).getTime() - this.fromISO(a).getTime()) / 86400000);
	}

	/** Jour de la semaine, 0 = lundi … 6 = dimanche. */
	public static weekdayIndex(iso: string): number {
		return (this.fromISO(iso).getDay() + 6) % 7;
	}

	public static isWeekend(iso: string): boolean {
		return this.weekdayIndex(iso) >= 5;
	}

	public static startOfWeek(iso: string): string {
		return this.addDays(iso, -this.weekdayIndex(iso));
	}

	public static startOfMonth(iso: string): string {
		return `${iso.slice(0, 7)}-01`;
	}

	public static weekDays(iso: string): string[] {
		const start = this.startOfWeek(iso);
		return Array.from({ length: 7 }, (_, i) => this.addDays(start, i));
	}

	/** Grille mensuelle de 6 semaines commençant le lundi (42 jours). */
	public static monthGrid(iso: string): string[] {
		const start = this.startOfWeek(this.startOfMonth(iso));
		return Array.from({ length: 42 }, (_, i) => this.addDays(start, i));
	}

	public static isoWeekNumber(iso: string): number {
		const d = this.fromISO(iso);
		const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const dayNr = (target.getDay() + 6) % 7;
		target.setDate(target.getDate() - dayNr + 3);
		const firstThursday = new Date(target.getFullYear(), 0, 4);
		const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
		return 1 + Math.round((diff - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
	}

	public static format(iso: string, opts: Intl.DateTimeFormatOptions): string {
		return new Intl.DateTimeFormat('fr-FR', opts).format(this.fromISO(iso));
	}

	/** Libellé relatif court : "Aujourd'hui", "Demain", "Hier", sinon "mar. 12 nov.". */
	public static relativeLabel(iso: string, today = this.today()): string {
		const diff = this.diffDays(today, iso);
		if (diff === 0) return 'Aujourd\'hui';
		if (diff === 1) return 'Demain';
		if (diff === -1) return 'Hier';
		const sameYear = iso.slice(0, 4) === today.slice(0, 4);
		return this.format(iso, sameYear
			? { weekday: 'short', day: 'numeric', month: 'short' }
			: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
	}
}

/* ==========================================================================
   Tri & regroupement
   ========================================================================== */

export type CalendarDateField = 'due' | 'scheduled';

const PRIORITY_RANK: Record<TaskPriority, number> = {
	highest: 0, high: 1, medium: 2, normal: 3, low: 4, lowest: 5
};

export function taskKey(task: Pick<ObsidianTask, 'filePath' | 'lineNumber'>): string {
	return `${task.filePath}::${task.lineNumber}`;
}

export function isTaskOpen(task: ObsidianTask): boolean {
	return !task.completed && task.status !== 'done' && task.status !== 'cancelled';
}

export function getTaskDate(task: ObsidianTask, field: CalendarDateField): string | null {
	if (field === 'scheduled') {
		return CalendarDate.normalize(task.scheduledDate) || CalendarDate.normalize(task.dueDate);
	}
	return CalendarDate.normalize(task.dueDate);
}

export function compareTasks(a: ObsidianTask, b: ObsidianTask): number {
	const openA = isTaskOpen(a) ? 0 : 1;
	const openB = isTaskOpen(b) ? 0 : 1;
	if (openA !== openB) return openA - openB;
	const pa = PRIORITY_RANK[a.priority || 'normal'] ?? 3;
	const pb = PRIORITY_RANK[b.priority || 'normal'] ?? 3;
	if (pa !== pb) return pa - pb;
	const qa = quadrantRank(a);
	const qb = quadrantRank(b);
	if (qa !== qb) return qa - qb;
	return a.title.localeCompare(b.title, 'fr');
}

function quadrantRank(task: ObsidianTask): number {
	const m = /q([1-4])/i.exec(task.matrixTag || '');
	return m ? Number(m[1]) : 5;
}

/**
 * Jour où la tâche s'affiche dans le calendrier : son échéance (ou sa date prévue). Une tâche terminée
 * ou annulée sans date apparaît le jour où elle l'a été (✅ / ❌) : sans cela, elle ne figurait
 * nulle part — ni sur un jour, ni dans « Sans date », réservé aux tâches ouvertes — et une
 * recherche qui la trouvait ne pouvait pas l'afficher.
 */
export function getTaskDisplayDate(task: ObsidianTask, field: CalendarDateField): string | null {
	const date = getTaskDate(task, field);
	if (date || isTaskOpen(task)) return date;
	return CalendarDate.normalize(task.completedDate) || CalendarDate.normalize(task.cancelledDate);
}

export function bucketTasksByDate(tasks: ObsidianTask[], field: CalendarDateField): Map<string, ObsidianTask[]> {
	const map = new Map<string, ObsidianTask[]>();
	for (const task of tasks) {
		const date = getTaskDisplayDate(task, field);
		if (!date) continue;
		const list = map.get(date);
		if (list) list.push(task);
		else map.set(date, [task]);
	}
	map.forEach(list => list.sort(compareTasks));
	return map;
}

/** Charge "énergétique" d'une journée : somme des énergies des tâches ouvertes (3 par défaut). */
export function dayEnergyLoad(tasks: ObsidianTask[] | undefined): number {
	if (!tasks) return 0;
	return tasks.filter(isTaskOpen).reduce((sum, t) => sum + (t.energy || 3), 0);
}

/** Bloc minuté (entrée de note quotidienne) déjà résolu par la vue. */
export interface EnergyTimedItem {
	/** Début en minutes depuis minuit */
	start: number;
	/** Fin en minutes, null : durée par défaut */
	end: number | null;
	/** Case cochée (terminée) */
	done?: boolean;
	/** Case annulée : ne compte pas */
	cancelled?: boolean;
}

/** Événement réduit à ce qui sert au calcul de charge. */
export interface EnergyEventLike {
	allDay: boolean;
	status?: string;
	start: { dateTime?: string };
	end: { dateTime?: string };
}

export interface DayEnergyOptions {
	/** Jour calculé (YYYY-MM-DD) */
	day: string;
	/** Instant présent : ce qui est terminé ou passé compte comme fait */
	now: Date;
	countEvents: boolean;
	countEntries: boolean;
	/** Points par heure d'événement ou d'entrée */
	pointsPerHour: number;
	/** Durée d'une entrée sans heure de fin (minutes) */
	entryDefaultMinutes: number;
}

export interface DayEnergyPart {
	count: number;
	points: number;
	/** Minutes cumulées (événements et entrées) */
	minutes: number;
}

export interface DayEnergyBreakdown {
	/** Charge totale de la journée */
	total: number;
	/** Part déjà faite (tâches terminées, blocs passés) */
	done: number;
	tasks: DayEnergyPart;
	events: DayEnergyPart;
	entries: DayEnergyPart;
}

/** Points d'un bloc minuté : au moins 1, proportionnel à la durée. */
export function energyPointsForMinutes(minutes: number, pointsPerHour: number): number {
	if (minutes <= 0) return 0;
	return Math.max(1, Math.round((minutes / 60) * Math.max(0, pointsPerHour)));
}

/** Minutes d'un événement minuté comprises dans le jour, et minute de fin dans ce jour (null si journée entière). */
export function eventSpanOnDay(ev: EnergyEventLike, day: string): { minutes: number; endMs: number } | null {
	if (ev.allDay || !ev.start.dateTime || !ev.end.dateTime) return null;
	const start = new Date(ev.start.dateTime).getTime();
	const end = new Date(ev.end.dateTime).getTime();
	if (isNaN(start) || isNaN(end) || end <= start) return null;
	const [y, m, d] = day.split('-').map(Number);
	const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
	const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
	const from = Math.max(start, dayStart);
	const to = Math.min(end, dayEnd);
	if (to <= from) return null;
	return { minutes: Math.round((to - from) / 60000), endMs: to };
}

/**
 * Charge d'énergie d'une journée et part déjà accomplie :
 * - tâches : énergie ⚡ (3 par défaut), faites si cochées, annulées ignorées ;
 * - événements minutés et entrées : points selon la durée, faits une fois passés (ou cochés).
 */
export function computeDayEnergy(
	tasks: ObsidianTask[],
	events: EnergyEventLike[],
	entries: EnergyTimedItem[],
	opts: DayEnergyOptions
): DayEnergyBreakdown {
	const result: DayEnergyBreakdown = {
		total: 0,
		done: 0,
		tasks: { count: 0, points: 0, minutes: 0 },
		events: { count: 0, points: 0, minutes: 0 },
		entries: { count: 0, points: 0, minutes: 0 }
	};
	const add = (part: DayEnergyPart, points: number, done: boolean, minutes = 0) => {
		part.count++;
		part.points += points;
		part.minutes += minutes;
		result.total += points;
		if (done) result.done += points;
	};

	for (const t of tasks) {
		if (t.status === 'cancelled') continue;
		add(result.tasks, t.energy || 3, !isTaskOpen(t));
	}

	const nowMs = opts.now.getTime();
	if (opts.countEvents) {
		for (const ev of events) {
			if (ev.status === 'cancelled') continue;
			const span = eventSpanOnDay(ev, opts.day);
			if (!span) continue;
			add(result.events, energyPointsForMinutes(span.minutes, opts.pointsPerHour), span.endMs <= nowMs, span.minutes);
		}
	}

	if (opts.countEntries) {
		const today = CalendarDate.toISO(opts.now);
		const nowMin = opts.now.getHours() * 60 + opts.now.getMinutes();
		for (const e of entries) {
			if (e.cancelled) continue;
			const end = e.end !== null && e.end > e.start ? e.end : e.start + opts.entryDefaultMinutes;
			const minutes = end - e.start;
			const past = opts.day < today || (opts.day === today && end <= nowMin);
			add(result.entries, energyPointsForMinutes(minutes, opts.pointsPerHour), !!e.done || past, minutes);
		}
	}
	return result;
}

/** Capacité du jour : réglage de base, ajusté aujourd'hui selon le niveau d'énergie déclaré (5/10 = normal). */
export function dayEnergyCapacity(base: number, isToday: boolean, followLevel: boolean, energyLevel: number | undefined): number {
	const cap = Math.max(1, Number(base) || 15);
	if (!isToday || !followLevel || !energyLevel) return cap;
	return Math.max(1, Math.round(cap * Math.max(1, Math.min(10, energyLevel)) / 5));
}

/* ==========================================================================
   Localisation robuste d'une ligne de tâche dans un fichier
   ========================================================================== */

/**
 * Retrouve l'index (0-based) de la ligne de la tâche, même si le fichier a bougé depuis le parsing.
 * Ordre : ligne d'origine identique → ligne identique la plus proche → titre dans une case à cocher la plus proche.
 */
export function locateTaskLine(lines: string[], task: Pick<ObsidianTask, 'lineNumber' | 'rawText' | 'title'>): number {
	const expected = task.lineNumber - 1;
	if (lines[expected] !== undefined && lines[expected] === task.rawText) return expected;

	const nearest = (predicate: (l: string) => boolean): number => {
		let best = -1;
		let bestDist = Infinity;
		lines.forEach((l, i) => {
			if (!predicate(l)) return;
			const dist = Math.abs(i - expected);
			if (dist < bestDist) {
				best = i;
				bestDist = dist;
			}
		});
		return best;
	};

	if (task.rawText) {
		const exact = nearest(l => l === task.rawText);
		if (exact !== -1) return exact;
	}

	const title = (task.title || '').trim().toLowerCase();
	if (!title) return -1;
	return nearest(l => /^\s*[-*+]\s+\[.\]/.test(l) && l.toLowerCase().includes(title));
}

/* ==========================================================================
   Index des tâches (incrémental, par fichier)
   ========================================================================== */

export class TaskIndex {
	private byFile = new Map<string, ObsidianTask[]>();

	constructor(
		private app: App,
		private getConfig: () => TaskSyntaxConfig,
		private isPathIncluded: (path: string) => boolean,
		private filterTasks: (tasks: ObsidianTask[]) => ObsidianTask[] = (tasks) => tasks
	) {}

	public async buildAll(): Promise<void> {
		this.byFile.clear();
		const files = this.app.vault.getMarkdownFiles().filter(f => this.isPathIncluded(f.path));
		await Promise.all(files.map(f => this.indexFile(f)));
	}

	/** Réindexe un fichier. Retourne true si ses tâches ont changé. */
	public async updateFile(file: TFile): Promise<boolean> {
		if (!this.isPathIncluded(file.path)) {
			return this.byFile.delete(file.path);
		}
		const before = this.signature(this.byFile.get(file.path));
		await this.indexFile(file);
		return before !== this.signature(this.byFile.get(file.path));
	}

	public removeFile(path: string): boolean {
		return this.byFile.delete(path);
	}

	public getAll(): ObsidianTask[] {
		const all: ObsidianTask[] = [];
		this.byFile.forEach(list => all.push(...list));
		return all;
	}

	private async indexFile(file: TFile): Promise<void> {
		// Raccourci : le cache de métadonnées sait si le fichier contient des cases à cocher
		const cache = this.app.metadataCache?.getFileCache?.(file);
		if (cache && !(cache.listItems || []).some(li => li.task !== undefined)) {
			this.byFile.delete(file.path);
			return;
		}
		try {
			const content = await this.app.vault.cachedRead(file);
			const tasks = this.filterTasks(TaskParser.parseAllTasks(content, file.path, this.getConfig()));
			if (tasks.length > 0) this.byFile.set(file.path, tasks);
			else this.byFile.delete(file.path);
		} catch {
			this.byFile.delete(file.path);
		}
	}

	private signature(tasks?: ObsidianTask[]): string {
		return (tasks || []).map(t => `${t.lineNumber}|${t.rawText}`).join('\n');
	}
}

/* ==========================================================================
   Écriture des tâches dans le coffre
   ========================================================================== */

interface TasksPluginApi {
	executeToggleTaskDoneCommand?: (line: string, path: string) => string;
}

export class TaskWriter {
	constructor(private app: App, private getConfig: () => TaskSyntaxConfig) {}

	/**
	 * Remplace la ligne de la tâche par le résultat du mutateur (qui peut produire plusieurs lignes).
	 * Retourne la nouvelle ligne principale, ou null si la tâche est introuvable.
	 */
	public async mutate(task: ObsidianTask, mutator: (line: string) => string): Promise<string | null> {
		const file = this.getFile(task.filePath);
		if (!file) return null;

		let result: string | null = null;
		await this.app.vault.process(file, (content) => {
			const eol = content.includes('\r\n') ? '\r\n' : '\n';
			const lines = content.split(/\r?\n/);
			const idx = locateTaskLine(lines, task);
			if (idx === -1) return content;

			const updated = mutator(lines[idx]);
			if (updated === lines[idx]) {
				result = updated;
				return content;
			}
			const newLines = updated.split(/\r?\n/);
			lines.splice(idx, 1, ...newLines);
			// La ligne principale est celle qui conserve le titre (Tasks insère la récurrence au-dessus)
			result = newLines.find(l => l.includes(task.title)) || newLines[newLines.length - 1];
			return lines.join(eol);
		});
		return result;
	}

	public async setDueDate(task: ObsidianTask, date: string | null): Promise<boolean> {
		const config = this.getConfig();
		const res = await this.mutate(task, line => TaskMutator.setDueDate(line, date, config));
		return res !== null;
	}

	public async setScheduledDate(task: ObsidianTask, date: string | null): Promise<boolean> {
		const config = this.getConfig();
		const res = await this.mutate(task, line => TaskMutator.setScheduledDate(line, date, config));
		return res !== null;
	}

	/**
	 * Coche / décoche. Utilise l'API du plugin Tasks quand elle est disponible pour que
	 * les tâches récurrentes génèrent leur prochaine occurrence, sinon le mutateur interne.
	 */
	public async setCompleted(task: ObsidianTask, completed: boolean): Promise<boolean> {
		const config = this.getConfig();
		const tasksApi = this.getTasksApi();
		const res = await this.mutate(task, line => {
			const current = /^\s*[-*+]\s+\[(.)\]/.exec(line)?.[1] ?? ' ';
			const isDone = TaskStatusRegistry.typeOf(current) === 'DONE';
			if (isDone === completed) return line;
			if (tasksApi?.executeToggleTaskDoneCommand) {
				try {
					const toggled = tasksApi.executeToggleTaskDoneCommand(line, task.filePath);
					if (toggled && toggled !== line) return toggled;
				} catch {
					// repli sur le mutateur interne
				}
			}
			return TaskMutator.setCompleted(line, completed, completed ? CalendarDate.today() : undefined, config);
		});
		return res !== null;
	}

	/**
	 * Clic sur la case : passe au statut suivant défini dans Tasks (ex. 0 → 1 → 2, m → y),
	 * via l'API de Tasks si elle est disponible (gestion des récurrences), sinon localement.
	 * Retourne le nouveau symbole de statut, ou null si la tâche est introuvable.
	 */
	public async toggle(task: ObsidianTask): Promise<string | null> {
		const config = this.getConfig();
		const tasksApi = this.getTasksApi();
		let nextSymbol: string | null = null;
		const res = await this.mutate(task, line => {
			if (tasksApi?.executeToggleTaskDoneCommand) {
				try {
					const toggled = tasksApi.executeToggleTaskDoneCommand(line, task.filePath);
					if (toggled && toggled !== line) {
						const main = toggled.split(/\r?\n/).find(l => l.includes(task.title)) || toggled;
						nextSymbol = /^\s*[-*+]\s+\[(.)\]/.exec(main)?.[1] ?? null;
						return toggled;
					}
				} catch {
					// repli sur le calcul local
				}
			}
			const current = /^\s*[-*+]\s+\[(.)\]/.exec(line)?.[1];
			if (current === undefined) return line;
			const next = TaskStatusRegistry.nextSymbol(current);
			nextSymbol = next;
			return TaskWriter.applyStatus(line, current, next, config);
		});
		return res === null ? null : nextSymbol;
	}

	/** Change le symbole de statut en gérant les dates de réalisation / d'annulation comme Tasks. */
	public static applyStatus(line: string, current: string, next: string, config: TaskSyntaxConfig): string {
		const currentType = TaskStatusRegistry.typeOf(current);
		const nextType = TaskStatusRegistry.typeOf(next);
		let updated = line;
		if (nextType === 'DONE' && currentType !== 'DONE') {
			updated = TaskMutator.setCompleted(updated, true, TaskStatusRegistry.setDoneDate ? CalendarDate.today() : undefined, config);
		} else if (currentType === 'DONE' && nextType !== 'DONE') {
			updated = TaskMutator.setCompleted(updated, false, undefined, config);
		}
		return updated.replace(/^(\s*[-*+]\s+\[).(\])/, `$1${next}$2`);
	}

	public async deleteTask(task: ObsidianTask): Promise<boolean> {
		const file = this.getFile(task.filePath);
		if (!file) return false;
		let removed = false;
		await this.app.vault.process(file, (content) => {
			const eol = content.includes('\r\n') ? '\r\n' : '\n';
			const lines = content.split(/\r?\n/);
			const idx = locateTaskLine(lines, task);
			if (idx === -1) return content;
			const indentOf = (l: string) => (/^[ \t]*/.exec(l) as RegExpExecArray)[0].replace(/\t/g, '    ').length;
			const base = indentOf(lines[idx]);
			let end = idx + 1;
			while (end < lines.length && lines[end].trim() !== '' && indentOf(lines[end]) > base) end++;
			lines.splice(idx, end - idx);
			removed = true;
			return lines.join(eol);
		});
		return removed;
	}

	private getFile(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return f instanceof TFile ? f : null;
	}

	private getTasksApi(): TasksPluginApi | null {
		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, { apiV1?: TasksPluginApi }> } }).plugins;
		return plugins?.plugins?.['obsidian-tasks-plugin']?.apiV1 || null;
	}
}
