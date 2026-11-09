import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { CalendarDate } from './taskCalendarService';

/* ==========================================================================
   Entrées horodatées des notes quotidiennes
   Ex. « - 11:30 - 12:00 Dentiste » ou « - 13:16 [[Projet]] » dans une section choisie,
   affichées dans le calendrier et ajoutées depuis celui-ci.
   ========================================================================== */

export type DailyEntryInsertPosition = 'sorted' | 'end' | 'start';

export interface DailyEntriesSettings {
	/** Affiche les entrées horodatées des notes quotidiennes dans le calendrier */
	dailyEntriesEnabled: boolean;
	/** Titres des sections lues (séparés par des virgules ou des retours à la ligne) ; vide = toute la note */
	dailyEntriesHeadings: string;
	/** Formes de ligne reconnues, une par ligne, avec {start}, {end} et {text} */
	dailyEntriesLineFormats: string;
	/** Format d'heure (jetons HH, H, hh, h, mm, m, A, a ; texte littéral entre crochets) */
	dailyEntriesTimeFormat: string;
	/** Ne lit que les éléments de liste (« - », « * », « + », « 1. ») */
	dailyEntriesListOnly: boolean;
	/** Lit aussi les cases à cocher horodatées (« - [ ] 10:00 … ») */
	dailyEntriesIncludeTasks: boolean;
	/** Durée affichée d'une entrée sans heure de fin (minutes) */
	dailyEntriesDefaultDuration: number;
	/** Ligne écrite pour une nouvelle entrée avec heure de fin */
	dailyEntriesNewRangeFormat: string;
	/** Ligne écrite pour une nouvelle entrée sans heure de fin */
	dailyEntriesNewPointFormat: string;
	/** Place d'une nouvelle entrée dans la section */
	dailyEntriesInsertPosition: DailyEntryInsertPosition;
	/** Titre ajouté à la note quand la section est absente (vide = « ## » + premier titre) */
	dailyEntriesNewHeading: string;
	/** Couleur des entrées dans le calendrier (vide = violet du thème) */
	dailyEntriesColor: string;

	/** Première heure affichée dans la grille horaire */
	calendarGridStartHour: number;
	/** Dernière heure affichée dans la grille horaire (exclue) */
	calendarGridEndHour: number;
	/** Heure placée en haut de la grille à l'ouverture */
	calendarScrollToHour: number;
}

export const DEFAULT_DAILY_ENTRIES_SETTINGS: DailyEntriesSettings = {
	dailyEntriesEnabled: true,
	dailyEntriesHeadings: '',
	dailyEntriesLineFormats: '{start} - {end} {text}\n{start} {text}',
	dailyEntriesTimeFormat: 'HH:mm',
	dailyEntriesListOnly: true,
	dailyEntriesIncludeTasks: true,
	dailyEntriesDefaultDuration: 30,
	dailyEntriesNewRangeFormat: '- {start} - {end} {text}',
	dailyEntriesNewPointFormat: '- {start} {text}',
	dailyEntriesInsertPosition: 'sorted',
	dailyEntriesNewHeading: '',
	dailyEntriesColor: '',
	calendarGridStartHour: 0,
	calendarGridEndHour: 24,
	calendarScrollToHour: 7
};

export interface DailyEntry {
	/** Jour de la note quotidienne (YYYY-MM-DD) */
	date: string;
	filePath: string;
	/** Index de ligne (0-based) */
	line: number;
	raw: string;
	/** Début en minutes depuis minuit */
	start: number;
	/** Fin écrite dans la note (minutes), null si absente */
	end: number | null;
	text: string;
	/** Symbole de la case à cocher si la ligne est une tâche */
	statusChar?: string;
	/** Indentation, puce et case à cocher */
	prefix: string;
	/** Position de l'heure de début dans la ligne [début, fin[ */
	startSpan: [number, number];
	endSpan?: [number, number];
}

export function entryKey(entry: Pick<DailyEntry, 'filePath' | 'line'>): string {
	return `entry::${entry.filePath}::${entry.line}`;
}

/** Clé de la tâche correspondante dans l'index des tâches (numéro de ligne 1-based). */
export function entryTaskKey(entry: Pick<DailyEntry, 'filePath' | 'line'>): string {
	return `${entry.filePath}::${entry.line + 1}`;
}

/** Bornes affichées : une entrée ponctuelle dure `defaultDuration`, une fin avant le début va jusqu'à minuit. */
export function entryBounds(entry: Pick<DailyEntry, 'start' | 'end'>, defaultDuration: number): { start: number; end: number; point: boolean } {
	const start = entry.start;
	if (entry.end === null || entry.end === start) {
		return { start, end: Math.min(1440, start + Math.max(5, defaultDuration || 30)), point: true };
	}
	if (entry.end < start) return { start, end: 1440, point: false };
	return { start, end: entry.end, point: false };
}

export function compareEntries(a: DailyEntry, b: DailyEntry): number {
	return a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start) || a.line - b.line;
}

/* ==========================================================================
   Format d'heure
   ========================================================================== */

type TimeTokenKind = 'H' | 'HH' | 'h' | 'hh' | 'm' | 'mm' | 'A' | 'a' | 'lit';

interface TimeToken {
	kind: TimeTokenKind;
	value: string;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class TimeFormat {
	/** Expression régulière (sans groupe capturant) qui reconnaît une heure */
	public readonly source: string;
	private readonly tokens: TimeToken[];
	private readonly full: RegExp;

	constructor(public readonly pattern: string) {
		const fmt = pattern && pattern.trim() ? pattern : 'HH:mm';
		this.tokens = TimeFormat.tokenize(fmt);
		this.source = this.tokens.map(t => TimeFormat.tokenSource(t)).join('');
		this.full = new RegExp(`^${this.tokens.map(t => t.kind === 'lit' ? `(?:${TimeFormat.tokenSource(t)})` : `(${TimeFormat.tokenSource(t)})`).join('')}$`, 'i');
	}

	private static tokenize(fmt: string): TimeToken[] {
		const tokens: TimeToken[] = [];
		const re = /\[([^\]]*)\]|HH|H|hh|h|mm|m|A|a|./g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(fmt)) !== null) {
			if (m[1] !== undefined) tokens.push({ kind: 'lit', value: m[1] });
			else if (['HH', 'H', 'hh', 'h', 'mm', 'm', 'A', 'a'].includes(m[0])) tokens.push({ kind: m[0] as TimeTokenKind, value: m[0] });
			else tokens.push({ kind: 'lit', value: m[0] });
		}
		// Fusionne les littéraux consécutifs
		return tokens.reduce<TimeToken[]>((acc, t) => {
			const last = acc[acc.length - 1];
			if (t.kind === 'lit' && last?.kind === 'lit') last.value += t.value;
			else acc.push({ ...t });
			return acc;
		}, []);
	}

	private static tokenSource(t: TimeToken): string {
		switch (t.kind) {
			case 'H': case 'HH': case 'h': case 'hh': return '\\d{1,2}';
			case 'mm': return '\\d{2}';
			case 'm': return '\\d{1,2}';
			case 'A': case 'a': return '[AaPp]\\.?[Mm]\\.?';
			default: return t.value.split(/(\s+)/).map(part => /^\s+$/.test(part) ? '\\s*' : escapeRegex(part)).join('');
		}
	}

	/** Heure en minutes depuis minuit, ou null si le texte ne correspond pas. */
	public parse(text: string): number | null {
		const m = this.full.exec(text.trim());
		if (!m) return null;
		let hours = 0;
		let minutes = 0;
		let meridiem: 'am' | 'pm' | null = null;
		let g = 1;
		for (const t of this.tokens) {
			if (t.kind === 'lit') continue;
			const v = m[g++];
			if (t.kind === 'A' || t.kind === 'a') meridiem = /^p/i.test(v) ? 'pm' : 'am';
			else if (t.kind === 'm' || t.kind === 'mm') minutes = Number(v);
			else hours = Number(v);
		}
		if (meridiem) {
			if (hours < 1 || hours > 12) return null;
			if (meridiem === 'pm' && hours < 12) hours += 12;
			if (meridiem === 'am' && hours === 12) hours = 0;
		}
		if (minutes > 59 || hours > 24) return null;
		const total = hours * 60 + minutes;
		return total > 1440 ? null : total;
	}

	public format(totalMinutes: number): string {
		const total = Math.max(0, Math.min(1440, Math.round(totalMinutes)));
		const h24 = Math.floor(total / 60);
		const min = total % 60;
		const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
		const pm = h24 >= 12 && h24 < 24;
		return this.tokens.map(t => {
			switch (t.kind) {
				case 'HH': return String(h24).padStart(2, '0');
				case 'H': return String(h24);
				case 'hh': return String(h12).padStart(2, '0');
				case 'h': return String(h12);
				case 'mm': return String(min).padStart(2, '0');
				case 'm': return String(min);
				case 'A': return pm ? 'PM' : 'AM';
				case 'a': return pm ? 'pm' : 'am';
				default: return t.value;
			}
		}).join('');
	}
}

/** « 09:05 » pour l'affichage interne du calendrier (indépendant du format de la note). */
export function formatClock(totalMinutes: number): string {
	const total = Math.max(0, Math.min(1440, Math.round(totalMinutes)));
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function parseClock(value: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 24 || min > 59 || h * 60 + min > 1440) return null;
	return h * 60 + min;
}

/* ==========================================================================
   Formes de ligne : « {start} - {end} {text} »
   ========================================================================== */

interface CompiledLineFormat {
	regex: RegExp;
	/** Rôle de chaque groupe capturant, dans l'ordre */
	roles: Array<'start' | 'end' | 'text' | 'lit' | 'rest'>;
}

function literalSource(lit: string): string {
	let out = '';
	for (const part of lit.split(/(\s+)/)) {
		if (!part) continue;
		if (/^\s+$/.test(part)) {
			out += '\\s*';
			continue;
		}
		for (const ch of part) {
			out += /[-–—]/.test(ch) ? '[-–—]' : escapeRegex(ch);
		}
	}
	return out;
}

function compileLineFormat(format: string, time: TimeFormat): CompiledLineFormat | null {
	const tpl = format.trim();
	if (!tpl.includes('{start}')) return null;
	const parts = tpl.split(/(\{start\}|\{end\}|\{text\})/).filter(p => p !== '');
	const roles: CompiledLineFormat['roles'] = [];
	let src = '^';
	parts.forEach((part, i) => {
		const isLast = i === parts.length - 1;
		if (part === '{start}' || part === '{end}') {
			src += `(${time.source})`;
			roles.push(part === '{start}' ? 'start' : 'end');
		} else if (part === '{text}') {
			src += isLast ? '(.*)' : '(.*?)';
			roles.push('text');
		} else {
			src += `(${literalSource(part)})`;
			roles.push('lit');
		}
	});
	// Le reste de la ligne est conservé (il complète le texte)
	src += '(.*)$';
	roles.push('rest');
	return { regex: new RegExp(src, 'i'), roles };
}

const LIST_PREFIX = /^(\s*)(?:([-*+]|\d+[.)])\s+(?:\[(.)\]\s+)?)?/;

export function normalizeHeading(text: string): string {
	return text
		.replace(/^#+\s*/, '')
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~=]/g, '')
		.replace(/[’']/g, '\'')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export function parseHeadingList(value: string): string[] {
	return (value || '')
		.split(/[,;\n]/)
		.map(h => h.trim())
		.filter(Boolean);
}

/** Analyseur configuré : lit les entrées d'une note, formate les nouvelles lignes. */
export class DailyEntryParser {
	public readonly time: TimeFormat;
	private formats: CompiledLineFormat[];
	private headings: string[];

	constructor(private settings: DailyEntriesSettings) {
		this.time = new TimeFormat(settings.dailyEntriesTimeFormat);
		const lines = (settings.dailyEntriesLineFormats || DEFAULT_DAILY_ENTRIES_SETTINGS.dailyEntriesLineFormats).split(/\r?\n/);
		this.formats = lines.map(l => compileLineFormat(l, this.time)).filter((f): f is CompiledLineFormat => f !== null);
		if (this.formats.length === 0) {
			this.formats = DEFAULT_DAILY_ENTRIES_SETTINGS.dailyEntriesLineFormats.split('\n')
				.map(l => compileLineFormat(l, this.time))
				.filter((f): f is CompiledLineFormat => f !== null);
		}
		this.headings = parseHeadingList(settings.dailyEntriesHeadings).map(normalizeHeading).filter(Boolean);
	}

	/** Met à jour les réglages d'écriture (modèles, position) sans recompiler la lecture. */
	public updateSettings(s: DailyEntriesSettings): void {
		this.settings = s;
	}

	public static settingsKey(s: DailyEntriesSettings): string {
		return JSON.stringify([s.dailyEntriesHeadings, s.dailyEntriesLineFormats, s.dailyEntriesTimeFormat, s.dailyEntriesListOnly, s.dailyEntriesIncludeTasks]);
	}

	/** Analyse le corps d'une ligne (après la puce). */
	public parseBody(body: string): { start: number; end: number | null; text: string; startSpan: [number, number]; endSpan?: [number, number] } | null {
		for (const fmt of this.formats) {
			const m = fmt.regex.exec(body);
			if (!m) continue;
			let offset = 0;
			let start: number | null = null;
			let end: number | null = null;
			let startSpan: [number, number] | undefined;
			let endSpan: [number, number] | undefined;
			let text = '';
			let rest = '';
			let valid = true;
			fmt.roles.forEach((role, i) => {
				const value = m[i + 1] ?? '';
				if (role === 'start') {
					start = this.time.parse(value);
					startSpan = [offset, offset + value.length];
					if (start === null) valid = false;
				} else if (role === 'end') {
					end = this.time.parse(value);
					endSpan = [offset, offset + value.length];
					if (end === null) valid = false;
				} else if (role === 'text') {
					text = value;
				} else if (role === 'rest') {
					rest = value;
				}
				offset += value.length;
			});
			if (!valid || start === null || !startSpan) continue;
			const fullText = `${text}${rest}`.trim();
			return { start, end, text: fullText, startSpan, endSpan };
		}
		return null;
	}

	/** Plages de lignes [début, fin[ des sections lues (corps sans le titre). */
	public sectionRanges(lines: string[]): Array<[number, number]> {
		const bodyStart = frontmatterEnd(lines);
		if (this.headings.length === 0) return [[bodyStart, lines.length]];
		const ranges: Array<[number, number]> = [];
		const fence = fenceMask(lines);
		let current: { start: number; level: number } | null = null;
		for (let i = bodyStart; i < lines.length; i++) {
			if (fence[i]) continue;
			const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
			if (!h) continue;
			const level = h[1].length;
			if (current && level <= current.level) {
				ranges.push([current.start, i]);
				current = null;
			}
			if (!current && this.matchesHeading(h[2])) current = { start: i + 1, level };
		}
		if (current) ranges.push([current.start, lines.length]);
		return ranges;
	}

	private matchesHeading(text: string): boolean {
		const n = normalizeHeading(text);
		return this.headings.some(h => n === h || n.startsWith(h));
	}

	/** Entrées horodatées d'une note. */
	public parse(content: string, filePath: string, date: string): DailyEntry[] {
		const lines = content.split(/\r?\n/);
		const fence = fenceMask(lines);
		const entries: DailyEntry[] = [];
		for (const [from, to] of this.sectionRanges(lines)) {
			for (let i = from; i < to; i++) {
				if (fence[i]) continue;
				const entry = this.parseLine(lines[i]);
				if (!entry) continue;
				entries.push({ ...entry, date, filePath, line: i, raw: lines[i] });
			}
		}
		return entries.sort(compareEntries);
	}

	public parseLine(line: string): Omit<DailyEntry, 'date' | 'filePath' | 'line' | 'raw'> | null {
		if (!line.trim() || /^\s*#/.test(line)) return null;
		const p = LIST_PREFIX.exec(line) as RegExpExecArray;
		const isList = Boolean(p[2]);
		if (this.settings.dailyEntriesListOnly && !isList) return null;
		const statusChar = p[3];
		if (statusChar !== undefined && !this.settings.dailyEntriesIncludeTasks) return null;
		const prefix = p[0];
		const parsed = this.parseBody(line.slice(prefix.length));
		if (!parsed) return null;
		const shift = (span: [number, number]): [number, number] => [span[0] + prefix.length, span[1] + prefix.length];
		return {
			start: parsed.start,
			end: parsed.end,
			text: parsed.text,
			statusChar,
			prefix,
			startSpan: shift(parsed.startSpan),
			endSpan: parsed.endSpan ? shift(parsed.endSpan) : undefined
		};
	}

	/** Ligne complète d'une nouvelle entrée selon les modèles des réglages. */
	public formatNewLine(start: number, end: number | null, text: string): string {
		const tpl = end !== null
			? (this.settings.dailyEntriesNewRangeFormat || DEFAULT_DAILY_ENTRIES_SETTINGS.dailyEntriesNewRangeFormat)
			: (this.settings.dailyEntriesNewPointFormat || DEFAULT_DAILY_ENTRIES_SETTINGS.dailyEntriesNewPointFormat);
		return this.fill(tpl, start, end, text);
	}

	/** Corps (sans puce ni case) d'une entrée, pour réécrire une ligne existante. */
	public formatBody(start: number, end: number | null, text: string): string {
		const line = this.formatNewLine(start, end, text);
		return line.slice((LIST_PREFIX.exec(line) as RegExpExecArray)[0].length);
	}

	private fill(tpl: string, start: number, end: number | null, text: string): string {
		return tpl
			.replace(/\{start\}/g, this.time.format(start))
			.replace(/\{end\}/g, end !== null ? this.time.format(end) : '')
			.replace(/\{text\}/g, text.trim())
			.replace(/\s+$/, '');
	}

	/** Réécrit les heures d'une ligne en gardant le reste intact. */
	public rewriteTimes(entry: DailyEntry, start: number, end: number | null): string {
		const raw = entry.raw;
		if (end !== null && entry.endSpan) {
			const [s, e] = entry.startSpan[0] < entry.endSpan[0] ? [entry.startSpan, entry.endSpan] : [entry.endSpan, entry.startSpan];
			const first = s === entry.startSpan ? this.time.format(start) : this.time.format(end);
			const second = s === entry.startSpan ? this.time.format(end) : this.time.format(start);
			return raw.slice(0, s[0]) + first + raw.slice(s[1], e[0]) + second + raw.slice(e[1]);
		}
		if (end === null && !entry.endSpan) {
			return raw.slice(0, entry.startSpan[0]) + this.time.format(start) + raw.slice(entry.startSpan[1]);
		}
		return entry.prefix + this.formatBody(start, end, entry.text);
	}

	/** Réécrit toute la ligne (texte et heures), en gardant puce, indentation et case à cocher. */
	public rewriteLine(entry: DailyEntry, start: number, end: number | null, text: string): string {
		if (text.trim() === entry.text.trim()) return this.rewriteTimes(entry, start, end);
		return entry.prefix + this.formatBody(start, end, text);
	}

	/**
	 * Insère une ligne d'entrée dans le contenu d'une note quotidienne, dans la première section
	 * reconnue (créée à la fin de la note si elle manque).
	 */
	public insert(content: string, line: string, start: number): string {
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		const ranges = this.sectionRanges(lines);
		const fence = fenceMask(lines);

		if (ranges.length === 0) {
			const heading = this.settings.dailyEntriesNewHeading.trim()
				|| `## ${parseHeadingList(this.settings.dailyEntriesHeadings)[0] || 'Agenda'}`;
			const trimmed = content.replace(/\s+$/, '');
			return `${trimmed}${trimmed ? `${eol}${eol}` : ''}${heading}${eol}${line}${eol}`;
		}

		const [from, to] = ranges[0];
		const wholeNote = this.headings.length === 0;
		let lastContent = -1;
		let firstContent = -1;
		for (let i = from; i < to; i++) {
			if (lines[i].trim() === '') continue;
			if (firstContent === -1) firstContent = i;
			lastContent = i;
		}

		let index: number;
		const position = this.settings.dailyEntriesInsertPosition || 'sorted';
		const endIndex = lastContent === -1 ? from : lastContent + 1;
		if (position === 'start' && !wholeNote) {
			index = firstContent === -1 ? from : firstContent;
		} else if (position === 'sorted') {
			const entries: Array<{ line: number; start: number }> = [];
			for (let i = from; i < to; i++) {
				if (fence[i]) continue;
				const e = this.parseLine(lines[i]);
				if (e) entries.push({ line: i, start: e.start });
			}
			const after = entries.find(e => e.start > start);
			if (after) index = after.line;
			else if (entries.length) index = entries[entries.length - 1].line + 1;
			else index = wholeNote ? endIndex : (firstContent === -1 ? from : endIndex);
		} else {
			index = endIndex;
		}

		// Fin de note sans retour à la ligne final : on en ajoute un
		if (index >= lines.length) {
			const trimmed = lines.join(eol).replace(/\s+$/, '');
			return `${trimmed}${trimmed ? eol : ''}${line}${eol}`;
		}
		lines.splice(index, 0, line);
		return lines.join(eol);
	}
}

/** Index de la première ligne après le frontmatter YAML. */
function frontmatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '---' || lines[i].trim() === '...') return i + 1;
	}
	return 0;
}

/** true pour les lignes situées dans un bloc de code (délimiteurs compris). */
function fenceMask(lines: string[]): boolean[] {
	const mask: boolean[] = new Array(lines.length).fill(false);
	let open: string | null = null;
	lines.forEach((line, i) => {
		const m = /^\s*(`{3,}|~{3,})/.exec(line);
		if (open) {
			mask[i] = true;
			if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
		} else if (m) {
			mask[i] = true;
			open = m[1];
		}
	});
	return mask;
}

/** Retrouve la ligne d'une entrée même si la note a bougé (ligne identique la plus proche). */
export function locateEntryLine(lines: string[], entry: Pick<DailyEntry, 'line' | 'raw'>): number {
	if (lines[entry.line] === entry.raw) return entry.line;
	let best = -1;
	let bestDist = Infinity;
	lines.forEach((l, i) => {
		if (l !== entry.raw) return;
		const d = Math.abs(i - entry.line);
		if (d < bestDist) {
			best = i;
			bestDist = d;
		}
	});
	return best;
}

/* ==========================================================================
   Index des notes quotidiennes (date ↔ fichier) et des entrées lues
   ========================================================================== */

type DailySettingsLike = DailyEntriesSettings & { dailyNotesFolder?: string };

interface MomentLike {
	isValid(): boolean;
	format(fmt: string): string;
}
type MomentFn = (input: string, format?: string, strict?: boolean) => MomentLike;

function getMoment(): MomentFn | null {
	const m = (window as unknown as { moment?: MomentFn }).moment;
	return typeof m === 'function' ? m : null;
}

export class DailyEntryIndex {
	private pathByDate = new Map<string, string>();
	private dateByPath = new Map<string, string>();
	private cache = new Map<string, { mtime: number; entries: DailyEntry[] }>();
	private config: { folder: string; format: string } = { folder: '', format: 'YYYY-MM-DD' };
	private parser: DailyEntryParser | null = null;
	private parserKey = '';
	private loaded: { start: string; end: string } | null = null;
	private built = false;

	constructor(private app: App, private getSettings: () => DailySettingsLike) {}

	public getParser(): DailyEntryParser {
		const s = this.getSettings();
		const key = DailyEntryParser.settingsKey(s);
		if (!this.parser || key !== this.parserKey) {
			this.parser = new DailyEntryParser(s);
			this.parserKey = key;
			this.cache.clear();
		} else {
			// Les modèles d'écriture peuvent changer sans invalider la lecture
			this.parser.updateSettings(s);
		}
		return this.parser;
	}

	/** Recalcule la correspondance date ↔ note (sans lire les fichiers). */
	public rebuild(): void {
		this.config = this.resolveConfig();
		this.pathByDate.clear();
		this.dateByPath.clear();
		this.cache.clear();
		this.loaded = null;
		this.getParser();
		for (const file of this.app.vault.getMarkdownFiles()) this.register(file);
		this.built = true;
	}

	public getConfig(): { folder: string; format: string } {
		return this.config;
	}

	private resolveConfig(): { folder: string; format: string } {
		const s = this.getSettings();
		const anyApp = this.app as unknown as {
			internalPlugins?: { plugins?: Record<string, { enabled?: boolean; instance?: { options?: { folder?: string; format?: string } } }> };
			plugins?: { plugins?: Record<string, { settings?: { daily?: { enabled?: boolean; folder?: string; format?: string } } }> };
		};
		const core = anyApp.internalPlugins?.plugins?.['daily-notes']?.instance?.options;
		const periodic = anyApp.plugins?.plugins?.['periodic-notes']?.settings?.daily;
		const periodicOn = Boolean(periodic?.enabled);
		const folders = [s.dailyNotesFolder, periodicOn ? periodic?.folder : undefined, core?.folder]
			.map(f => (f ? normalizePath(f) : ''))
			.filter(Boolean);
		const existing = folders.find(f => this.app.vault.getAbstractFileByPath(f) instanceof TFolder);
		const folder = existing ?? folders[0] ?? '';
		const format = (periodicOn && periodic?.format) || core?.format || 'YYYY-MM-DD';
		return { folder: folder === '/' ? '' : folder, format };
	}

	/** Date (YYYY-MM-DD) d'une note quotidienne, ou null. */
	public computeDate(path: string, basename: string): string | null {
		const { folder, format } = this.config;
		if (folder && !path.startsWith(`${folder}/`)) return null;
		const rel = (folder ? path.slice(folder.length + 1) : path).replace(/\.md$/i, '');
		const moment = getMoment();
		if (moment) {
			const m = moment(rel, format, true);
			if (m.isValid()) return m.format('YYYY-MM-DD');
			const lastFmt = format.split('/').pop() || format;
			const m2 = moment(basename, lastFmt, true);
			if (m2.isValid()) return m2.format('YYYY-MM-DD');
		}
		// Repli : nom commençant par une date, suivi au plus d'un court jour de semaine (« 09-11-2026 lu »)
		if (/^(\d{4}[-./_]\d{1,2}[-./_]\d{1,2}|\d{1,2}[-./_]\d{1,2}[-./_]\d{4})(\s+\S{1,4})?$/.test(basename)) {
			return CalendarDate.normalize(basename.replace(/_/g, '-'));
		}
		return null;
	}

	/** Enregistre (ou retire) un fichier. Retourne sa date s'il s'agit d'une note quotidienne. */
	public register(file: TFile): string | null {
		const date = file.extension === 'md' ? this.computeDate(file.path, file.basename) : null;
		const previous = this.dateByPath.get(file.path);
		if (previous && previous !== date) {
			this.dateByPath.delete(file.path);
			if (this.pathByDate.get(previous) === file.path) this.pathByDate.delete(previous);
		}
		if (!date) return null;
		this.dateByPath.set(file.path, date);
		const current = this.pathByDate.get(date);
		// Plusieurs notes pour un même jour : on garde la plus courte (le nom canonique)
		if (!current || current === file.path || file.path.length < current.length) this.pathByDate.set(date, file.path);
		return date;
	}

	public removeFile(path: string): boolean {
		const date = this.dateByPath.get(path);
		this.dateByPath.delete(path);
		const had = this.cache.delete(path);
		if (date && this.pathByDate.get(date) === path) {
			this.pathByDate.delete(date);
			for (const [p, d] of this.dateByPath) {
				if (d === date) {
					this.pathByDate.set(date, p);
					break;
				}
			}
		}
		return had;
	}

	public isBuilt(): boolean {
		return this.built;
	}

	public fileFor(date: string): TFile | null {
		const path = this.pathByDate.get(date);
		if (!path) return null;
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	public entriesFor(date: string): DailyEntry[] {
		const path = this.pathByDate.get(date);
		if (!path) return [];
		return this.cache.get(path)?.entries || [];
	}

	/** Clés (format de l'index des tâches) des entrées qui sont des cases à cocher. */
	public taskKeys(): Set<string> {
		const keys = new Set<string>();
		this.cache.forEach(c => c.entries.forEach(e => {
			if (e.statusChar !== undefined) keys.add(entryTaskKey(e));
		}));
		return keys;
	}

	/** Lit les notes des jours [start, end] pas encore chargées. Retourne true si des entrées ont changé. */
	public async ensureRange(start: string, end: string): Promise<boolean> {
		if (!this.built) this.rebuild();
		const parser = this.getParser();
		this.loaded = this.loaded
			? { start: start < this.loaded.start ? start : this.loaded.start, end: end > this.loaded.end ? end : this.loaded.end }
			: { start, end };
		const tasks: Array<Promise<boolean>> = [];
		const days = Math.min(CalendarDate.diffDays(start, end), 800);
		for (let i = 0; i <= days; i++) {
			const date = CalendarDate.addDays(start, i);
			const file = this.fileFor(date);
			if (!file) continue;
			const cached = this.cache.get(file.path);
			if (cached && cached.mtime === file.stat.mtime) continue;
			tasks.push(this.read(file, date, parser));
		}
		if (!tasks.length) return false;
		const results = await Promise.all(tasks);
		return results.some(Boolean);
	}

	/** Relit une note modifiée si elle est déjà chargée ou dans la plage affichée. */
	public async updateFile(file: TFile): Promise<boolean> {
		if (!this.built) return false;
		const before = this.dateByPath.get(file.path);
		const date = this.register(file);
		if (!date) return before !== undefined && this.removeFile(file.path);
		const inRange = this.loaded && date >= this.loaded.start && date <= this.loaded.end;
		if (!this.cache.has(file.path) && !inRange) return before !== date;
		if (this.pathByDate.get(date) !== file.path) return false;
		return this.read(file, date, this.getParser());
	}

	private async read(file: TFile, date: string, parser: DailyEntryParser): Promise<boolean> {
		try {
			const content = await this.app.vault.cachedRead(file);
			const entries = parser.parse(content, file.path, date);
			const previous = this.cache.get(file.path);
			this.cache.set(file.path, { mtime: file.stat.mtime, entries });
			return signature(previous?.entries) !== signature(entries);
		} catch {
			return false;
		}
	}

	/** Chemin attendu de la note quotidienne d'un jour (selon le format configuré). */
	public expectedPath(date: string): string | null {
		const moment = getMoment();
		if (!moment) return null;
		const m = moment(date, 'YYYY-MM-DD', true);
		if (!m.isValid()) return null;
		const name = m.format(this.config.format);
		return normalizePath(this.config.folder ? `${this.config.folder}/${name}.md` : `${name}.md`);
	}
}

function signature(entries?: DailyEntry[]): string {
	return (entries || []).map(e => `${e.line}|${e.raw}`).join('\n');
}
