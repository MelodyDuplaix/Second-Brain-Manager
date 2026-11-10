import { ItemView, WorkspaceLeaf, TFile, TAbstractFile, Menu, Notice, Modal, App, setIcon, normalizePath, debounce } from 'obsidian';
import { ObsidianTask, TaskPriority } from '../models/task';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory, MatrixQuadrant, MatrixFeature } from '../adapters/matrixAdapter';
import { InlineMetaPopover } from './inlineMetaPopover';
import { VaultContextService } from '../services/vaultContextService';
import {
	CalendarDate,
	CalendarDateField,
	TaskIndex,
	TaskWriter,
	bucketTasksByDate,
	compareTasks,
	dayEnergyLoad,
	getTaskDate,
	isTaskOpen,
	taskKey
} from '../services/taskCalendarService';
import { GoogleCalendarService } from '../services/googleCalendarService';
import { GoogleCalendarEvent, CalendarRole } from '../models/googleCalendar';
import { CalendarFilterPopover } from './calendarFilterPopover';
import { LinkTagSuggest } from '../suggesters/linkTagSuggest';
import {
	CalendarFilter,
	DEFAULT_CALENDAR_FILTER,
	activeTaskGroups,
	clearFilterChip,
	describeFilter,
	extractTags,
	isCalendarVisible,
	matchesDescriptionFilter,
	normalizeFilter,
	normalizeTagList,
	sameFilter,
	taskGroupKey
} from '../services/calendarFilters';
import {
	CalendarLegendEntry,
	bucketEventsByDate,
	buildCalendarColors,
	dedupeEvents,
	resolveCalendarId,
	eventDaySpan,
	eventKey,
	formatEventRange,
	formatEventTime,
	localParts,
	shiftEvent,
	toLocalIsoWithOffset
} from '../services/calendarEventsService';
import {
	DailyEntry,
	DailyEntryIndex,
	entryBounds,
	entryKey,
	entryTaskKey,
	formatClock,
	locateEntryLine
} from '../services/dailyEntriesService';
import { CalendarEventModal } from './calendarView';
import { DailyEntryModal, DailyEntryDraft } from './dailyEntryModal';
import { getTaskExclusionRules } from '../services/taskExclusionService';
import { TaskStatusRegistry } from '../models/taskStatusRegistry';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_TASK_CALENDAR = 'sbm-task-calendar-view';

type CalendarMode = 'day' | 'week' | 'month' | 'agenda';
type LayoutSize = 'compact' | 'medium' | 'wide';

/** Élément placé dans la grille horaire (événement Google minuté ou entrée de note quotidienne). */
interface TimedItem {
	kind: 'event' | 'entry';
	key: string;
	day: string;
	/** Minutes depuis minuit sur ce jour */
	start: number;
	end: number;
	/** Commence la veille / finit le lendemain (événements sur plusieurs jours) */
	clippedStart: boolean;
	clippedEnd: boolean;
	point: boolean;
	event?: GoogleCalendarEvent;
	entry?: DailyEntry;
	col: number;
	cols: number;
}

interface GridDrag {
	item: TimedItem;
	el: HTMLElement;
	mode: 'move' | 'resize';
	pointerId: number;
	pointerType: string;
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	/** Minutes entre le début de l'élément et le point saisi */
	grabOffset: number;
	active: boolean;
	holdTimer?: number;
	preview?: HTMLElement;
	targetDay?: string;
	targetStart?: number;
	targetEnd?: number;
	scrollRaf?: number;
}

interface GridSelection {
	day: string;
	col: HTMLElement;
	pointerId: number;
	pointerType: string;
	anchor: number;
	current: number;
	startY: number;
	moved: boolean;
	box?: HTMLElement;
}

interface TaskCalendarState {
	mode: CalendarMode;
	anchor: string;
	dateField: CalendarDateField;
	showDone: boolean;
	miniMonthOpen: boolean;
	collapsed: string[];
	/** Affiche les événements Google Calendar */
	showEvents: boolean;
	/** Agendas masqués (identifiants Google) */
	hiddenCalendars: string[];
	/** Affiche les tâches */
	showTasks: boolean;
	/** Rôles d'agendas masqués d'un coup (ex. secondaires) */
	hiddenRoles: CalendarRole[];
	/** Catégories de tâches gardées (quadrants ou priorités) ; vide : toutes */
	taskGroups: string[];
	/** Texte cherché dans la description (filtre enregistrable dans un préréglage) */
	searchText: string;
	/** Tags exigés (au moins un) ; vide : aucun filtre */
	tags: string[];
	/** Tags exclus */
	excludedTags: string[];
	/** Lignes de titre dans la vue mois : 1, 2 ou 0 (en entier) */
	titleLines: number;
	/** Affichage en barre latérale étroite : liste (agenda) ou grille horaire du jour */
	compactMode: 'agenda' | 'day';
	/** Affiche les entrées horodatées des notes quotidiennes */
	showEntries: boolean;
	/** Hauteur d'une heure dans la grille horaire (px) */
	hourHeight: number;
}

interface DragItem {
	task?: ObsidianTask;
	event?: GoogleCalendarEvent;
	entry?: DailyEntry;
	/** Jour depuis lequel l'événement est saisi (événements sur plusieurs jours) */
	eventDay?: string;
}

interface DragSession extends DragItem {
	sourceEl: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	offsetX: number;
	offsetY: number;
	pointerType: string;
	active: boolean;
	ghost?: HTMLElement;
	ghostLabel?: HTMLElement;
	target?: HTMLElement | null;
	holdTimer?: number;
	navTimer?: number;
	navTarget?: HTMLElement | null;
	scrollRaf?: number;
	lastX: number;
	lastY: number;
}

const COMPACT_MAX = 520;
const WIDE_MIN = 900;
/** Hauteurs d'heure proposées pour la grille horaire (zoom) */
const HOUR_HEIGHTS = [28, 36, 44, 56, 72, 96];
const DEFAULT_HOUR_HEIGHT = 44;
/** Pas d'aimantation dans la grille horaire (minutes) */
const GRID_SNAP = 15;
const AGENDA_DAYS_COMPACT = 14;
const AGENDA_DAYS_WIDE = 28;
const UNDATED_PAGE = 40;
/** Nombre de jours rendus dans le ruban défilant (mode compact). */
const STRIP_SPAN = 91;
/** Jours rendus avant la cible quand le ruban est recentré. */
const STRIP_LEAD = 42;
/** Distance au bord (en jours) qui déclenche le recentrage. */
const STRIP_EDGE = 14;

const QUADRANT_LABELS: Record<string, string> = {
	q1: 'Q1 · Urgent & important',
	q2: 'Q2 · Important, pas urgent',
	q3: 'Q3 · Urgent, pas important',
	q4: 'Q4 · Ni urgent ni important'
};

const PRIORITY_ICONS: Partial<Record<TaskPriority, string>> = {
	highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬'
};

export class TaskCalendarView extends ItemView {
	private plugin: SecondBrainPlugin;
	private index: TaskIndex;
	private writer: TaskWriter;
	private popover = new InlineMetaPopover();

	private state: TaskCalendarState = {
		mode: 'month',
		anchor: CalendarDate.today(),
		dateField: 'due',
		showDone: true,
		miniMonthOpen: false,
		collapsed: [],
		showEvents: true,
		hiddenCalendars: [],
		showTasks: true,
		hiddenRoles: [],
		taskGroups: [],
		searchText: '',
		tags: [],
		excludedTags: [],
		titleLines: 2,
		compactMode: 'agenda',
		showEntries: true,
		hourHeight: DEFAULT_HOUR_HEIGHT
	};

	private layout: LayoutSize = 'wide';
	private today = CalendarDate.today();
	private query = '';
	private undatedLimit = UNDATED_PAGE;
	private loaded = false;
	private flash: { key: string; until: number } | null = null;

	private rootEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private drag: DragSession | null = null;
	private suppressClickUntil = 0;
	private pendingRender = false;
	private resizeObserver: ResizeObserver | null = null;

	// Ruban défilant du mode compact
	private stripEl: HTMLElement | null = null;
	private stripBuckets = new Map<string, ObsidianTask[]>();
	private stripOrigin: string | null = null;
	private stripFirstVisible: string | null = null;
	private stripPendingTarget: string | null = null;
	private stripIdleTimer: number | undefined;
	private stripPanning = false;
	private wheelAccumulator = 0;
	private wheelTargetIdx: number | null = null;
	private titleTextEl: HTMLElement | null = null;

	// Événements Google Calendar
	private events: GoogleCalendarEvent[] = [];
	private eventBuckets = new Map<string, GoogleCalendarEvent[]>();
	private eventsRange: { start: string; end: string } | null = null;
	private eventsLoading = false;
	private eventsError: string | null = null;
	private legend: CalendarLegendEntry[] = [];
	private legendLoaded = false;
	private legendSource: { calendars: Array<{ id: string; name: string; color?: string }>; primaryId?: string } | null = null;

	// Agenda à défilement continu
	private agendaStart: string | null = null;
	private agendaCount = 0;
	private agendaFocus: string | null = null;
	private agendaEl: HTMLElement | null = null;
	private agendaScroller: HTMLElement | null = null;
	private agendaVariant: 'row' | 'card' = 'row';
	private agendaExtending = false;
	/** L'agenda a déjà été placé sur son jour de départ (les rendus suivants gardent la position) */
	private agendaPositioned = false;
	/** Jour en haut de l'agenda avant un nouveau rendu, et son décalage : l'agenda reprend au même endroit */
	private agendaAnchor: { day: string; offset: number } | null = null;
	/** Vrai quand le rendu a replacé l'agenda sur son jour (la restauration en pixels ne doit pas l'écraser) */
	private agendaAnchorRestored = false;
	private agendaScrollRaf: number | undefined;
	/** Pendant un défilement programmé, l'agenda ne s'agrandit pas (cela interromprait l'animation) */
	private agendaScrollLockUntil = 0;
	private taskBuckets = new Map<string, ObsidianTask[]>();

	// Aperçu au survol
	private peekEl: HTMLElement | null = null;
	private peekTimer: number | undefined;

	// Entrées horodatées des notes quotidiennes
	private entries: DailyEntryIndex;
	private entriesLoading = false;
	private entriesPending = false;

	// Grille horaire
	private gridDrag: GridDrag | null = null;
	private gridSelection: GridSelection | null = null;
	/** Position verticale conservée d'une période à l'autre (même zoom) */
	private gridScroll: { top: number; hourHeight: number } | null = null;

	private scheduleRender = debounce(() => this.renderPreservingScroll(), 180, true);

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		const templatesFolder = normalizePath(plugin.settings.templatesFolder || 'Templates');
		this.index = new TaskIndex(
			this.app,
			() => this.plugin.settings,
			(path) => !path.startsWith(`${templatesFolder}/`) && !getTaskExclusionRules(this.app, this.plugin.settings).isPathExcluded(path),
			(tasks) => getTaskExclusionRules(this.app, this.plugin.settings).filter(tasks)
		);
		this.writer = new TaskWriter(this.app, () => this.plugin.settings);
		this.entries = new DailyEntryIndex(this.app, () => this.plugin.settings);
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_CALENDAR;
	}

	getDisplayText(): string {
		return 'Calendrier';
	}

	getIcon(): string {
		return 'calendar-check-2';
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	async setState(state: unknown, result: any): Promise<void> {
		const s = (state || {}) as Partial<TaskCalendarState>;
		if (s.mode === 'day' || s.mode === 'month' || s.mode === 'week' || s.mode === 'agenda') this.state.mode = s.mode;
		if (s.compactMode === 'agenda' || s.compactMode === 'day') this.state.compactMode = s.compactMode;
		if (typeof s.showEntries === 'boolean') this.state.showEntries = s.showEntries;
		if (typeof s.hourHeight === 'number' && s.hourHeight >= 20 && s.hourHeight <= 160) this.state.hourHeight = s.hourHeight;
		if (s.dateField === 'due' || s.dateField === 'scheduled') this.state.dateField = s.dateField;
		if (typeof s.showDone === 'boolean') this.state.showDone = s.showDone;
		if (typeof s.miniMonthOpen === 'boolean') this.state.miniMonthOpen = s.miniMonthOpen;
		if (Array.isArray(s.collapsed)) this.state.collapsed = s.collapsed.filter(c => typeof c === 'string');
		if (typeof s.showEvents === 'boolean') this.state.showEvents = s.showEvents;
		if (Array.isArray(s.hiddenCalendars)) this.state.hiddenCalendars = s.hiddenCalendars.filter(c => typeof c === 'string');
		const f = normalizeFilter(s);
		if (typeof s.showTasks === 'boolean') this.state.showTasks = f.showTasks;
		if (Array.isArray(s.hiddenRoles)) this.state.hiddenRoles = f.hiddenRoles;
		if (Array.isArray(s.taskGroups)) this.state.taskGroups = f.taskGroups;
		if (typeof s.searchText === 'string') this.state.searchText = f.searchText;
		if (Array.isArray(s.tags)) this.state.tags = f.tags;
		if (Array.isArray(s.excludedTags)) this.state.excludedTags = f.excludedTags;
		if (s.titleLines === 0 || s.titleLines === 1 || s.titleLines === 2) this.state.titleLines = s.titleLines;
		// Première restauration de la vue : le préréglage d'ouverture remplace les derniers filtres
		if (!this.stateRestored) {
			this.stateRestored = true;
			this.applyStartupPreset();
		}
		await super.setState(state, result);
		if (this.loaded) this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('sbm-tcal-host');
		this.rootEl = this.contentEl.createDiv({ cls: 'sbm-tcal' });
		this.rootEl.tabIndex = 0;
		this.rootEl.createDiv({ cls: 'sbm-tcal-loading', text: 'Chargement des tâches…' });

		this.layout = this.computeLayout(this.contentEl.clientWidth);
		this.resizeObserver = new ResizeObserver(entries => {
			const width = entries[0]?.contentRect.width ?? this.contentEl.clientWidth;
			const next = this.computeLayout(width);
			if (next !== this.layout) {
				this.layout = next;
				this.agendaPositioned = false;
				if (this.loaded && !this.drag) this.render();
			}
		});
		this.resizeObserver.observe(this.contentEl);

		this.registerDomEvent(this.rootEl, 'keydown', (e) => this.onKeyDown(e));

		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onFileChanged(file)));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			const hadTasks = this.index.removeFile(file.path);
			const hadEntries = this.entries.removeFile(file.path);
			if (hadTasks || hadEntries) this.requestRender();
		}));
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && this.entries.isBuilt() && this.entries.register(file)) this.ensureEntries();
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.index.removeFile(oldPath);
			this.entries.removeFile(oldPath);
			this.onFileChanged(file);
		}));

		// Bascule de jour à minuit, et ligne « maintenant » de la grille horaire
		this.registerInterval(window.setInterval(() => {
			const now = CalendarDate.today();
			if (now !== this.today) {
				this.today = now;
				this.requestRender();
			} else {
				this.updateNowLine();
			}
		}, 60 * 1000));

		// Synchronisation périodique de l'agenda Google
		const syncMinutes = Math.max(5, Number(this.plugin.settings.syncIntervalMinutes) || 15);
		this.registerInterval(window.setInterval(() => {
			if (this.plugin.settings.autoSyncGoogleCalendar !== false && this.googleReady() && this.state.showEvents) {
				void this.refreshEvents(false);
			}
		}, syncMinutes * 60 * 1000));

		this.registerDomEvent(window, 'blur', () => this.hidePeek());

		this.app.workspace.onLayoutReady(async () => {
			await this.index.buildAll();
			this.entries.rebuild();
			if (!this.startupPresetApplied) this.applyStartupPreset();
			this.loaded = true;
			this.render();
		});
	}

	async onClose(): Promise<void> {
		this.popover.close();
		this.filterPopover.close();
		this.hidePeek();
		this.peekEl?.remove();
		this.peekEl = null;
		this.cancelDrag();
		this.cancelGridDrag();
		this.clearGridSelection();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	/** Recharge complètement l'index (commande "Rafraîchir"). */
	public async refresh(): Promise<void> {
		await this.index.buildAll();
		this.entries.rebuild();
		this.render();
		if (this.googleReady() && this.state.showEvents) await this.refreshEvents(true);
	}

	/* ======================================================================
	   Événements Google Calendar
	   ====================================================================== */

	private googleReady(): boolean {
		const s = this.plugin.settings;
		return Boolean(s.googleRefreshToken && s.googleClientId && s.googleClientSecret);
	}

	/** Plage de jours actuellement affichée (pour savoir quels événements charger). */
	private visibleRange(): { start: string; end: string } {
		if (this.layout === 'compact') {
			const origin = this.stripOrigin || CalendarDate.addDays(CalendarDate.startOfWeek(this.state.anchor), -STRIP_LEAD);
			const agendaStart = this.agendaStart || CalendarDate.startOfWeek(this.state.anchor);
			const start = origin < agendaStart ? origin : agendaStart;
			const stripEnd = CalendarDate.addDays(origin, STRIP_SPAN);
			const agendaEnd = CalendarDate.addDays(agendaStart, this.agendaCount || AGENDA_DAYS_COMPACT);
			return { start, end: stripEnd > agendaEnd ? stripEnd : agendaEnd };
		}
		const mode = this.effectiveMode();
		if (mode === 'month') {
			const grid = CalendarDate.monthGrid(this.state.anchor);
			return { start: grid[0], end: grid[41] };
		}
		if (mode === 'week') {
			const days = CalendarDate.weekDays(this.state.anchor);
			return { start: days[0], end: days[6] };
		}
		if (mode === 'day') {
			return { start: this.state.anchor, end: this.state.anchor };
		}
		if (this.agendaStart !== null) {
			return { start: this.agendaStart, end: CalendarDate.addDays(this.agendaStart, this.agendaCount) };
		}
		const start = CalendarDate.startOfWeek(this.state.anchor);
		return { start, end: CalendarDate.addDays(start, AGENDA_DAYS_WIDE) };
	}

	/** Charge les événements manquants pour la plage visible (avec une marge), sans bloquer le rendu. */
	private ensureEvents(): void {
		if (!this.state.showEvents || !this.googleReady() || this.eventsLoading) return;
		const range = this.visibleRange();
		if (this.eventsRange && this.eventsRange.start <= range.start && this.eventsRange.end >= range.end) return;
		void this.fetchEvents(CalendarDate.addDays(range.start, -14), CalendarDate.addDays(range.end, 14));
	}

	private async fetchEvents(start: string, end: string): Promise<void> {
		this.eventsLoading = true;
		this.updateSyncIndicator();
		try {
			await this.loadLegend();
			const settings = this.plugin.settings;
			const calendarIds = this.legend.length ? this.legend.map(l => l.id) : undefined;
			const events = await GoogleCalendarService.getEvents(settings, {
				timeMin: CalendarDate.fromISO(start).toISOString().slice(0, 10) + 'T00:00:00Z',
				timeMax: CalendarDate.addDays(end, 1) + 'T00:00:00Z',
				calendarIds,
				maxResults: 2500
			});
			// Un événement présent dans plusieurs agendas n'est affiché qu'une fois (agenda le mieux classé)
			const rank = new Map(this.legend.map((l, i) => [l.id, i]));
			this.events = dedupeEvents(events, id => rank.get(id) ?? Number.MAX_SAFE_INTEGER);
			this.eventsRange = { start, end };
			this.eventsError = null;
		} catch (err) {
			this.eventsError = err instanceof Error ? err.message : String(err);
			// Mémorise la plage tentée pour ne pas relancer la requête à chaque rendu
			this.eventsRange = { start, end };
		} finally {
			this.eventsLoading = false;
		}
		this.requestRender();
	}

	/** Recharge les événements de la plage visible (bouton de synchronisation, intervalle, après une modification). */
	private async refreshEvents(reloadLegend: boolean): Promise<void> {
		if (reloadLegend) this.legendLoaded = false;
		this.eventsRange = null;
		const range = this.visibleRange();
		await this.fetchEvents(CalendarDate.addDays(range.start, -14), CalendarDate.addDays(range.end, 14));
	}

	private async loadLegend(): Promise<void> {
		if (this.legendLoaded) return;
		const settings = this.plugin.settings;
		let calendars: Array<{ id: string; name: string; color?: string }> = [];
		let primaryId: string | undefined;
		try {
			const list = await GoogleCalendarService.listCalendars(settings);
			calendars = list.map(c => ({ id: c.id, name: c.summary, color: c.backgroundColor }));
			primaryId = list.find(c => c.primary)?.id;
		} catch {
			// Liste indisponible : on se rabat sur les agendas configurés dans les réglages
		}
		const resolve = (id: string) => resolveCalendarId(id, primaryId);
		const configured = Object.keys(settings.calendarsConfig || {}).map(resolve);
		const selected = (settings.selectedCalendarIds || []).filter(id => id !== 'all').map(resolve);
		const defaultId = resolve(settings.defaultCalendarId || 'primary');
		const known = new Set(calendars.map(c => c.id));
		[...configured, ...selected, defaultId].forEach(id => {
			if (id && !known.has(id)) {
				known.add(id);
				calendars.push({ id, name: settings.calendarsConfig?.[id]?.summary || (id === 'primary' ? 'Agenda principal' : id) });
			}
		});
		// Sans configuration explicite des rôles, on se limite aux agendas sélectionnés (ou au principal)
		if (configured.length === 0 && !(settings.selectedCalendarIds || []).includes('all')) {
			const wanted = new Set(selected.length ? selected : [defaultId]);
			calendars = calendars.filter(c => wanted.has(c.id) || c.id === defaultId);
		}
		this.legendSource = { calendars, primaryId };
		this.legend = buildCalendarColors(settings, calendars, undefined, primaryId);
		this.legendLoaded = true;
	}

	/** Recalcule les couleurs des agendas (réglages modifiés) sans interroger Google. */
	public recolor(): void {
		if (this.legendSource) {
			const { calendars, primaryId } = this.legendSource;
			this.legend = buildCalendarColors(this.plugin.settings, calendars, undefined, primaryId);
		}
		this.render();
	}

	private calendarColor(calendarId: string): string {
		return this.legend.find(l => l.id === calendarId)?.color || 'var(--interactive-accent)';
	}

	/* ======================================================================
	   Filtres
	   ====================================================================== */

	private filterPopover = new CalendarFilterPopover({
		getFilter: () => this.getFilter(),
		setFilter: (f) => this.setFilter(f),
		legend: () => this.legend,
		googleReady: () => this.googleReady(),
		entriesAvailable: () => this.plugin.settings.dailyEntriesEnabled !== false,
		matrixEnabled: () => this.plugin.settings.matrixEnabled !== false,
		knownTags: () => this.knownTags(),
		presets: () => this.plugin.settings.calendarFilterPresets || [],
		startupPresetId: () => this.plugin.settings.calendarStartupPreset || '',
		setStartupPresetId: async (id) => {
			this.plugin.settings.calendarStartupPreset = id;
			await this.plugin.saveSettings();
		},
		savePresets: async (presets) => {
			this.plugin.settings.calendarFilterPresets = presets;
			await this.plugin.saveSettings();
		}
	});

	private stateRestored = false;
	private startupPresetApplied = false;

	/** Applique (une fois) le préréglage choisi pour l'ouverture du calendrier, s'il existe encore. */
	private applyStartupPreset(): void {
		this.startupPresetApplied = true;
		const id = this.plugin.settings.calendarStartupPreset;
		const preset = id ? (this.plugin.settings.calendarFilterPresets || []).find(p => p.id === id) : undefined;
		if (!preset) return;
		const f = normalizeFilter(preset.filter);
		Object.assign(this.state, f);
	}

	private getFilter(): CalendarFilter {
		const s = this.state;
		return {
			showTasks: s.showTasks,
			showEvents: s.showEvents,
			showEntries: s.showEntries,
			showDone: s.showDone,
			hiddenRoles: [...s.hiddenRoles],
			hiddenCalendars: [...s.hiddenCalendars],
			taskGroups: [...s.taskGroups],
			searchText: s.searchText || '',
			tags: [...(s.tags || [])],
			excludedTags: [...(s.excludedTags || [])]
		};
	}

	private setFilter(filter: CalendarFilter): void {
		const f = normalizeFilter(filter);
		const s = this.state;
		s.showTasks = f.showTasks;
		s.showEvents = f.showEvents;
		s.showEntries = f.showEntries;
		s.showDone = f.showDone;
		s.hiddenRoles = f.hiddenRoles;
		s.hiddenCalendars = f.hiddenCalendars;
		s.taskGroups = f.taskGroups;
		s.searchText = f.searchText;
		s.tags = f.tags;
		s.excludedTags = f.excludedTags;
		this.undatedLimit = UNDATED_PAGE;
		this.saveState();
		this.renderPreservingScroll();
	}

	/** Tags présents dans les tâches et les entrées, les plus utilisés d'abord (proposés dans les filtres). */
	private knownTags(): string[] {
		const counts = new Map<string, number>();
		const add = (tags: string[]) => {
			for (const tag of normalizeTagList(tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
		};
		for (const task of this.index.getAll()) add(task.domainTags || []);
		if (this.entriesEnabled()) {
			for (const entry of this.entries.allEntries()) add(extractTags(entry.text));
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([tag]) => tag);
	}

	private filterContext() {
		return {
			matrixEnabled: this.plugin.settings.matrixEnabled !== false,
			googleReady: this.googleReady(),
			entriesAvailable: this.plugin.settings.dailyEntriesEnabled !== false,
			legend: this.legend
		};
	}

	/** Préréglage (intégré ou personnel) correspondant exactement aux filtres actuels. */
	private matchingPresetName(): string | null {
		const filter = this.getFilter();
		if (sameFilter(filter, DEFAULT_CALENDAR_FILTER)) return null;
		const preset = (this.plugin.settings.calendarFilterPresets || []).find(p => sameFilter(filter, p.filter));
		return preset ? preset.name : null;
	}

	/** Pastilles des filtres actifs sous la barre d'outils : un clic retire le filtre. */
	private renderFilterBar(): void {
		const chips = describeFilter(this.getFilter(), this.filterContext());
		if (!chips.length) return;
		// Une seule ligne : un préréglage reconnu se résume à son nom, sinon les pastilles défilent
		// horizontalement au lieu de s'empiler au-dessus du calendrier.
		const bar = this.rootEl.createDiv({ cls: 'sbm-tcal-filterbar' });
		const presetName = this.matchingPresetName();
		const summary = chips.map(c => c.detail || c.label).join(' · ');
		const label = bar.createEl('button', { cls: 'sbm-tcal-filterbar-label' });
		setIcon(label.createSpan(), 'filter');
		label.createSpan({ text: presetName || 'Filtres' });
		label.title = `${summary}\nModifier les filtres (F)`;
		label.addEventListener('click', () => this.openFilters());

		if (!presetName) {
			const track = bar.createDiv({ cls: 'sbm-tcal-filterbar-track' });
			chips.forEach(chip => {
				const el = track.createEl('button', { cls: 'sbm-tcal-filterbar-chip' });
				setIcon(el.createSpan({ cls: 'sbm-tcal-filterbar-chip-icon' }), chip.icon);
				el.createSpan({ cls: 'sbm-tcal-filterbar-chip-text', text: chip.label });
				setIcon(el.createSpan({ cls: 'sbm-tcal-filterbar-chip-x' }), 'x');
				el.title = `${chip.detail || chip.label} — retirer ce filtre`;
				el.addEventListener('click', () => this.setFilter(clearFilterChip(this.getFilter(), chip.id, this.legend)));
			});
		} else {
			bar.createDiv({ cls: 'sbm-tcal-filterbar-summary', text: summary }).title = summary;
		}

		const reset = bar.createEl('button', { cls: 'sbm-tcal-filterbar-reset clickable-icon' });
		setIcon(reset, 'x');
		reset.title = 'Tout afficher';
		reset.setAttribute('aria-label', 'Tout afficher');
		reset.addEventListener('click', () => this.setFilter({ ...DEFAULT_CALENDAR_FILTER }));
	}

	private openFilters(): void {
		const btn = this.rootEl.querySelector<HTMLElement>('.sbm-tcal-filter-btn');
		if (btn) this.filterPopover.toggle(btn);
	}


	private getVisibleEvents(): GoogleCalendarEvent[] {
		if (!this.state.showEvents || !this.googleReady()) return [];
		const q = this.query.trim().toLowerCase();
		const filter = this.getFilter();
		const roles = new Map(this.legend.map(l => [l.id, l.role]));
		const known = new Set(this.legend.map(l => l.id));
		return this.events.filter(ev => {
			if (!isCalendarVisible(filter, ev.calendarId, roles.get(ev.calendarId))) return false;
			if (known.size && !known.has(ev.calendarId)) return false;
			// Les événements Google n'ont pas de tags : ceux écrits dans le titre ou la note comptent
			if (!matchesDescriptionFilter(filter, {
				texts: [ev.summary, ev.location, ev.description],
				tags: extractTags(ev.summary, ev.description)
			})) return false;
			if (!q) return true;
			return (ev.summary || '').toLowerCase().includes(q)
				|| (ev.location || '').toLowerCase().includes(q)
				|| (ev.calendarName || '').toLowerCase().includes(q);
		});
	}

	private updateSyncIndicator(): void {
		const btn = this.rootEl?.querySelector<HTMLElement>('.sbm-tcal-sync');
		if (!btn) return;
		btn.toggleClass('is-loading', this.eventsLoading);
		btn.toggleClass('is-error', Boolean(this.eventsError) && !this.eventsLoading);
		btn.empty();
		setIcon(btn, this.eventsError && !this.eventsLoading ? 'cloud-off' : 'refresh-cw');
		btn.title = this.eventsLoading
			? 'Synchronisation de l’agenda Google…'
			: this.eventsError
				? `Agenda Google indisponible : ${this.eventsError}\nCliquer pour réessayer`
				: 'Synchroniser l’agenda Google';
	}

	private openEventModal(ev?: GoogleCalendarEvent, day?: string, startTime?: string, endTime?: string): void {
		new CalendarEventModal(this.app, this.plugin, ev, day, async () => {
			await this.refreshEvents(false);
		}, startTime, endTime).open();
	}

	/** Déplacement optimiste d'un événement de `deltaDays` jours (heures et durée conservées). */
	private async moveEvent(ev: GoogleCalendarEvent, deltaDays: number): Promise<void> {
		if (!deltaDays) return;
		const shift = shiftEvent(ev, deltaDays);
		if (!shift) return;
		const previous = { start: ev.start, end: ev.end };
		ev.start = shift.start;
		ev.end = shift.end;
		this.flash = { key: eventKey(ev), until: Date.now() + 900 };
		this.renderPreservingScroll();
		try {
			await GoogleCalendarService.updateEvent(this.plugin.settings, ev.id, shift.update);
			const span = eventDaySpan(ev);
			if (span) new Notice(`📅 ${ev.summary} → ${CalendarDate.relativeLabel(span.first, this.today)}`, 2500);
		} catch (err) {
			ev.start = previous.start;
			ev.end = previous.end;
			new Notice(`Impossible de déplacer l’événement : ${err instanceof Error ? err.message : String(err)}`);
			this.renderPreservingScroll();
		}
	}

	private openEventMenu(e: MouseEvent, ev: GoogleCalendarEvent, day: string): void {
		const menu = new Menu();
		menu.addItem(i => i.setTitle('Modifier l’événement…').setIcon('pencil').onClick(() => this.openEventModal(ev)));
		if (ev.htmlLink) {
			menu.addItem(i => i.setTitle('Ouvrir dans Google Agenda').setIcon('external-link').onClick(() => window.open(ev.htmlLink, '_blank')));
		}
		menu.addSeparator();
		const choices: Array<[string, string, string]> = [
			['Aujourd\'hui', 'sun', this.today],
			['Demain', 'sunrise', CalendarDate.addDays(this.today, 1)],
			['Une semaine plus tard', 'calendar-plus', CalendarDate.addDays(day, 7)]
		];
		choices.forEach(([label, icon, target]) => {
			if (target === day) return;
			menu.addItem(i => i.setTitle(label).setIcon(icon).onClick(() => this.moveEvent(ev, CalendarDate.diffDays(day, target))));
		});
		menu.addSeparator();
		menu.addItem(i => i.setTitle('Créer une tâche à partir de l’événement').setIcon('check-square').onClick(() => this.createTask(ev.summary || 'Événement', day)));
		menu.addSeparator();
		menu.addItem(i => {
			i.setTitle('Supprimer l’événement').setIcon('trash-2').onClick(() => {
				new ConfirmModal(this.app, `Supprimer « ${ev.summary} » ?`, 'L’événement sera supprimé de Google Agenda.', async () => {
					try {
						await GoogleCalendarService.deleteEvent(this.plugin.settings, ev.id, ev.calendarId);
						this.events = this.events.filter(x => eventKey(x) !== eventKey(ev));
						new Notice(`🗑️ Événement supprimé : ${ev.summary}`);
						this.renderPreservingScroll();
					} catch (err) {
						new Notice(`Suppression impossible : ${err instanceof Error ? err.message : String(err)}`);
					}
				}).open();
			});
			(i as unknown as { setWarning?: (w: boolean) => void }).setWarning?.(true);
		});
		menu.showAtMouseEvent(e);
	}

	/* ======================================================================
	   Aperçu au survol (titre complet et détails)
	   ====================================================================== */

	private attachPeek(chip: HTMLElement, fill: (el: HTMLElement) => void): void {
		chip.addEventListener('pointerenter', (e) => {
			if (e.pointerType !== 'mouse' || this.drag) return;
			if (this.peekTimer) window.clearTimeout(this.peekTimer);
			this.peekTimer = window.setTimeout(() => this.showPeek(chip, fill), 380);
		});
		chip.addEventListener('pointerleave', () => this.hidePeek());
	}

	private showPeek(anchor: HTMLElement, fill: (el: HTMLElement) => void): void {
		if (this.drag || !anchor.isConnected) return;
		if (!this.peekEl) {
			this.peekEl = document.body.createDiv({ cls: 'sbm-tcal-peek' });
		}
		const peek = this.peekEl;
		peek.empty();
		fill(peek);
		peek.removeClass('is-visible');
		peek.style.left = '0px';
		peek.style.top = '0px';
		const rect = anchor.getBoundingClientRect();
		const pw = peek.offsetWidth;
		const ph = peek.offsetHeight;
		const margin = 8;
		let left = rect.left;
		if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
		left = Math.max(margin, left);
		let top = rect.bottom + 6;
		if (top + ph > window.innerHeight - margin) top = rect.top - ph - 6;
		peek.style.left = `${Math.round(left)}px`;
		peek.style.top = `${Math.round(Math.max(margin, top))}px`;
		window.requestAnimationFrame(() => peek.addClass('is-visible'));
	}

	private hidePeek(): void {
		if (this.peekTimer) window.clearTimeout(this.peekTimer);
		this.peekTimer = undefined;
		this.peekEl?.removeClass('is-visible');
	}

	private fillTaskPeek(task: ObsidianTask): (el: HTMLElement) => void {
		return (el) => {
			const date = getTaskDate(task, this.state.dateField);
			const quad = this.quadrantOf(task);
			const accent = this.taskAccent(task, quad);
			if (accent) el.style.setProperty('--chip-accent', accent);
			else el.style.removeProperty('--chip-accent');
			el.createDiv({ cls: 'sbm-tcal-peek-title', text: this.displayTitle(task.title) });
			const meta = el.createDiv({ cls: 'sbm-tcal-peek-meta' });
			if (date) meta.createSpan({ text: `📅 ${CalendarDate.relativeLabel(date, this.today)}` });
			if (task.scheduledDate && this.state.dateField === 'due') meta.createSpan({ text: `⏳ ${CalendarDate.relativeLabel(CalendarDate.normalize(task.scheduledDate) || task.scheduledDate, this.today)}` });
			if (quad) meta.createSpan({ text: quad.toUpperCase() });
			if (task.priority && PRIORITY_ICONS[task.priority]) meta.createSpan({ text: PRIORITY_ICONS[task.priority] as string });
			if (task.energy) meta.createSpan({ text: `⚡${task.energy}` });
			if (task.pieces && this.plugin.isFeatureEnabled('gamification')) meta.createSpan({ text: `🪙${task.pieces}` });
			if (task.recurrence) meta.createSpan({ text: `🔁 ${task.recurrence}` });
			if (task.statusChar !== ' ') meta.createSpan({ text: `[${task.statusChar}] ${TaskStatusRegistry.nameOf(task.statusChar)}` });
			if (task.domainTags.length) {
				const tags = el.createDiv({ cls: 'sbm-tcal-peek-tags' });
				task.domainTags.forEach(t => tags.createSpan({ cls: 'sbm-tcal-meta tag', text: t }));
			}
			el.createDiv({ cls: 'sbm-tcal-peek-file', text: `📄 ${task.filePath.replace(/\.md$/, '')} · ligne ${task.lineNumber}` });
		};
	}

	private fillEventPeek(ev: GoogleCalendarEvent): (el: HTMLElement) => void {
		return (el) => {
			el.style.setProperty('--chip-accent', this.calendarColor(ev.calendarId));
			el.createDiv({ cls: 'sbm-tcal-peek-title', text: ev.summary || '(Sans titre)' });
			const meta = el.createDiv({ cls: 'sbm-tcal-peek-meta' });
			meta.createSpan({ text: `🕒 ${formatEventRange(ev)}` });
			if (ev.location) meta.createSpan({ text: `📍 ${ev.location}` });
			if (ev.attendees?.length) meta.createSpan({ text: `👥 ${ev.attendees.length}` });
			const cal = this.legend.find(l => l.id === ev.calendarId);
			const calLine = el.createDiv({ cls: 'sbm-tcal-peek-file' });
			const dot = calLine.createSpan({ cls: 'sbm-tcal-peek-dot' });
			dot.style.background = this.calendarColor(ev.calendarId);
			calLine.appendText(cal?.name || ev.calendarName || 'Google Agenda');
			if (ev.description) {
				const desc = ev.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
				if (desc) el.createDiv({ cls: 'sbm-tcal-peek-desc', text: desc.length > 220 ? `${desc.slice(0, 220)}…` : desc });
			}
		};
	}

	/* ======================================================================
	   Données
	   ====================================================================== */

	private async onFileChanged(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const [tasksChanged, entriesChanged] = await Promise.all([
			this.index.updateFile(file),
			this.entriesEnabled() ? this.entries.updateFile(file) : Promise.resolve(false)
		]);
		if (tasksChanged || entriesChanged) this.requestRender();
	}

	/* ======================================================================
	   Entrées horodatées des notes quotidiennes
	   ====================================================================== */

	private entriesEnabled(): boolean {
		return this.plugin.settings.dailyEntriesEnabled !== false && this.state.showEntries;
	}

	/** Lit (sans bloquer le rendu) les notes quotidiennes de la plage affichée. */
	private ensureEntries(): void {
		if (!this.entriesEnabled() || !this.loaded) return;
		if (this.entriesLoading) {
			this.entriesPending = true;
			return;
		}
		const range = this.visibleRange();
		this.entriesLoading = true;
		this.entries.ensureRange(CalendarDate.addDays(range.start, -7), CalendarDate.addDays(range.end, 7))
			.then(changed => {
				this.entriesLoading = false;
				if (changed) this.requestRender();
				if (this.entriesPending) {
					this.entriesPending = false;
					this.ensureEntries();
				}
			})
			.catch(() => {
				this.entriesLoading = false;
				this.entriesPending = false;
			});
	}

	/** Entrées d'un jour, filtrées (recherche, tâches terminées). */
	private dayEntries(day: string): DailyEntry[] {
		if (!this.entriesEnabled()) return [];
		const q = this.query.trim().toLowerCase();
		const filter = this.getFilter();
		return this.entries.entriesFor(day).filter(e => {
			if (!this.state.showDone && e.statusChar !== undefined) {
				const type = TaskStatusRegistry.typeOf(e.statusChar);
				if (type === 'DONE' || type === 'CANCELLED') return false;
			}
			if (!matchesDescriptionFilter(filter, { texts: [e.text], tags: extractTags(e.text) })) return false;
			return !q || e.text.toLowerCase().includes(q);
		});
	}

	private entryDuration(): number {
		return Math.max(5, Number(this.plugin.settings.dailyEntriesDefaultDuration) || 30);
	}

	/** Tâche de l'index correspondant à une entrée cochable (pour réutiliser le cycle des statuts). */
	private taskForEntry(entry: DailyEntry): ObsidianTask | undefined {
		if (entry.statusChar === undefined) return undefined;
		const key = entryTaskKey(entry);
		return this.index.getAll().find(t => taskKey(t) === key);
	}

	private entryTitle(entry: DailyEntry): string {
		// Retire les métadonnées de Tasks (dates, priorités) qui encombrent la grille
		const cleaned = entry.text
			.replace(/[✅❌➕🛫⏳📅]️?\s*\d{4}-\d{2}-\d{2}/gu, '')
			.replace(/[🔺⏫🔼🔽⏬]️?/gu, '')
			.replace(/🔁️?\s*[^#\n]*/gu, '');
		return this.displayTitle(cleaned, true);
	}

	private entryRangeLabel(entry: DailyEntry): string {
		return entry.end !== null && entry.end !== entry.start
			? `${formatClock(entry.start)} – ${formatClock(entry.end)}`
			: formatClock(entry.start);
	}

	private async openEntryNote(entry: DailyEntry, newTab = false): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(entry.filePath));
		if (!(file instanceof TFile)) return;
		const leaf = newTab ? this.app.workspace.getLeaf('tab') : this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: entry.line } });
	}

	/** Note quotidienne d'un jour, créée (avec son modèle) si besoin. */
	private async getOrCreateDailyFile(day: string): Promise<TFile> {
		const existing = this.entries.fileFor(day);
		if (existing) return existing;
		const settings = this.plugin.settings;
		const vaultContext = new VaultContextService(this.app, settings);
		// Le format peut contenir des sous-dossiers (ex. YYYY/MM/DD-MM-YYYY) : on les crée d'abord
		const config = vaultContext.getDailyNotesConfig();
		const moment = (window as unknown as { moment?: (d: string, f: string) => { format: (f: string) => string } }).moment;
		if (moment && config.format.includes('/')) {
			const target = normalizePath(`${config.folder}/${moment(day, 'YYYY-MM-DD').format(config.format)}.md`);
			const parent = target.split('/').slice(0, -1).join('/');
			if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
				try { await this.app.vault.createFolder(parent); } catch { /* déjà créé */ }
			}
		}
		const daily = await vaultContext.getOrCreateDailyNote(day, settings.dailyNoteTemplatePath);
		if (!daily.file) throw new Error('note quotidienne introuvable');
		this.entries.register(daily.file);
		return daily.file;
	}

	private async createEntry(draft: DailyEntryDraft): Promise<void> {
		try {
			const parser = this.entries.getParser();
			const file = await this.getOrCreateDailyFile(draft.date);
			const line = parser.formatNewLine(draft.start, draft.end, draft.text);
			await this.app.vault.process(file, content => parser.insert(content, line, draft.start));
			new Notice(`🕒 Ajouté à ${file.basename} : ${formatClock(draft.start)} ${draft.text}`, 2500);
		} catch (err) {
			new Notice(`Impossible d’ajouter l’entrée : ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Remplace (ou supprime si `next` est null) la ligne d'une entrée. */
	private async rewriteEntryLine(entry: DailyEntry, next: string | null): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(entry.filePath));
		if (!(file instanceof TFile)) return false;
		let ok = false;
		await this.app.vault.process(file, content => {
			const eol = content.includes('\r\n') ? '\r\n' : '\n';
			const lines = content.split(/\r?\n/);
			const idx = locateEntryLine(lines, entry);
			if (idx === -1) return content;
			ok = true;
			if (next === null) lines.splice(idx, 1);
			else lines[idx] = next;
			return lines.join(eol);
		});
		if (!ok) new Notice('Entrée introuvable : la note a changé entre-temps.');
		return ok;
	}

	/** Change le jour, les heures et/ou le texte d'une entrée (déplacée dans une autre note si besoin). */
	private async updateEntry(entry: DailyEntry, draft: DailyEntryDraft): Promise<boolean> {
		const parser = this.entries.getParser();
		const line = parser.rewriteLine(entry, draft.start, draft.end, draft.text);
		if (draft.date === entry.date) {
			return line === entry.raw || this.rewriteEntryLine(entry, line);
		}
		try {
			const target = await this.getOrCreateDailyFile(draft.date);
			// La ligne garde sa puce et sa case à cocher, sans l'indentation d'origine
			const moved = line.replace(/^\s+/, '');
			if (!(await this.rewriteEntryLine(entry, null))) return false;
			await this.app.vault.process(target, content => parser.insert(content, moved, draft.start));
			new Notice(`🕒 ${this.entryTitle(entry)} → ${CalendarDate.relativeLabel(draft.date, this.today)}`, 2500);
			return true;
		} catch (err) {
			new Notice(`Déplacement impossible : ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	/** Déplacement optimiste (glisser-déposer) : l'affichage suit immédiatement. */
	private async moveEntry(entry: DailyEntry, day: string, start: number, end: number | null): Promise<void> {
		if (day === entry.date && start === entry.start && end === entry.end) return;
		const previous = { date: entry.date, start: entry.start, end: entry.end };
		this.flash = { key: entryKey(entry), until: Date.now() + 900 };
		if (day === entry.date) {
			entry.start = start;
			entry.end = end;
			this.renderPreservingScroll();
		}
		const original = { ...entry, start: previous.start, end: previous.end };
		const ok = await this.updateEntry(original, { date: day, start, end, text: entry.text });
		if (!ok && day === previous.date) {
			entry.start = previous.start;
			entry.end = previous.end;
			this.renderPreservingScroll();
		}
	}

	private openEntryModal(entry?: DailyEntry, draft?: Partial<DailyEntryDraft>): void {
		this.hidePeek();
		if (entry) {
			new DailyEntryModal(this.app, {
				title: 'Modifier l’entrée',
				fileLabel: `${entry.filePath.replace(/\.md$/, '')} · ligne ${entry.line + 1}`,
				sourcePath: entry.filePath,
				draft: { date: entry.date, start: entry.start, end: entry.end, text: entry.text },
				onSubmit: (d) => this.updateEntry(entry, d),
				onDelete: () => this.confirmDeleteEntry(entry),
				onOpenNote: () => void this.openEntryNote(entry)
			}).open();
			return;
		}
		const start = draft?.start ?? this.defaultNewStart(draft?.date ?? this.today);
		new DailyEntryModal(this.app, {
			title: 'Nouvelle entrée dans la note quotidienne',
			draft: {
				date: draft?.date ?? this.today,
				start,
				end: draft?.end !== undefined ? draft.end : null,
				text: draft?.text ?? ''
			},
			onSubmit: (d) => this.createEntry(d)
		}).open();
	}

	/** Heure proposée pour une nouvelle entrée : l'heure suivante aujourd'hui, sinon l'heure d'ouverture de la grille. */
	private defaultNewStart(day: string): number {
		if (day === this.today) {
			const now = new Date();
			return Math.min(23 * 60, (now.getHours() + 1) * 60);
		}
		return Math.max(0, Math.min(23, Number(this.plugin.settings.calendarScrollToHour) || 9)) * 60;
	}

	private confirmDeleteEntry(entry: DailyEntry): void {
		new ConfirmModal(this.app, `Supprimer « ${this.entryTitle(entry)} » ?`, 'La ligne sera retirée de la note quotidienne.', async () => {
			if (await this.rewriteEntryLine(entry, null)) new Notice(`🗑️ Entrée supprimée : ${this.entryTitle(entry)}`);
		}).open();
	}

	private openEntryMenu(e: MouseEvent, entry: DailyEntry): void {
		const menu = new Menu();
		menu.addItem(i => i.setTitle('Modifier l’entrée…').setIcon('pencil').onClick(() => this.openEntryModal(entry)));
		menu.addItem(i => i.setTitle('Ouvrir la note quotidienne').setIcon('file-text').onClick(() => this.openEntryNote(entry)));
		menu.addItem(i => i.setTitle('Ouvrir dans un nouvel onglet').setIcon('file-plus').onClick(() => this.openEntryNote(entry, true)));
		const task = this.taskForEntry(entry);
		if (task) {
			menu.addSeparator();
			menu.addItem(i => i.setTitle(task.completed ? 'Rouvrir' : 'Terminer').setIcon(task.completed ? 'rotate-ccw' : 'check-circle-2').onClick(() => {
				void this.writer.setCompleted(task, !task.completed);
			}));
		}
		menu.addSeparator();
		const choices: Array<[string, string, string]> = [
			['Aujourd\'hui', 'sun', this.today],
			['Demain', 'sunrise', CalendarDate.addDays(this.today, 1)],
			['Une semaine plus tard', 'calendar-plus', CalendarDate.addDays(entry.date, 7)]
		];
		choices.forEach(([label, icon, target]) => {
			if (target === entry.date) return;
			menu.addItem(i => i.setTitle(label).setIcon(icon).onClick(() => this.moveEntry(entry, target, entry.start, entry.end)));
		});
		menu.addSeparator();
		menu.addItem(i => {
			i.setTitle('Supprimer l’entrée').setIcon('trash-2').onClick(() => this.confirmDeleteEntry(entry));
			(i as unknown as { setWarning?: (w: boolean) => void }).setWarning?.(true);
		});
		menu.showAtMouseEvent(e);
	}

	private fillEntryPeek(entry: DailyEntry): (el: HTMLElement) => void {
		return (el) => {
			el.style.setProperty('--chip-accent', 'var(--sbm-entry-color)');
			el.createDiv({ cls: 'sbm-tcal-peek-title', text: this.entryTitle(entry) });
			const meta = el.createDiv({ cls: 'sbm-tcal-peek-meta' });
			meta.createSpan({ text: `🕒 ${this.entryRangeLabel(entry)}` });
			if (entry.statusChar !== undefined) meta.createSpan({ text: `[${entry.statusChar}] ${TaskStatusRegistry.nameOf(entry.statusChar)}` });
			const tags = entry.text.match(/(^|\s)#[^\s#]+/g);
			if (tags?.length) {
				const tagsEl = el.createDiv({ cls: 'sbm-tcal-peek-tags' });
				tags.forEach(t => tagsEl.createSpan({ cls: 'sbm-tcal-meta tag', text: t.trim() }));
			}
			el.createDiv({ cls: 'sbm-tcal-peek-file', text: `📓 ${entry.filePath.replace(/\.md$/, '')} · ligne ${entry.line + 1}` });
		};
	}

	private requestRender(): void {
		if (!this.loaded) return;
		// Pas de rendu pendant un glisser ou une sélection de créneau (il les interromprait)
		if (this.drag || this.gridDrag || this.gridSelection) {
			this.pendingRender = true;
			return;
		}
		this.scheduleRender();
	}

	private getVisibleTasks(): ObsidianTask[] {
		if (!this.state.showTasks) return [];
		const q = this.query.trim().toLowerCase();
		const matrix = this.plugin.settings.matrixEnabled !== false;
		const groups = activeTaskGroups(this.getFilter(), matrix);
		const filter = this.getFilter();
		return this.index.getAll().filter(t => {
			if (t.status === 'cancelled' && !this.state.showDone) return false;
			if (groups && !groups.has(taskGroupKey(t.priority, this.quadrantOf(t), matrix))) return false;
			if (!this.state.showDone && !isTaskOpen(t)) return false;
			if (!matchesDescriptionFilter(filter, { texts: [t.title, t.cleanText], tags: t.domainTags })) return false;
			if (!q) return true;
			return t.title.toLowerCase().includes(q)
				|| t.filePath.toLowerCase().includes(q)
				|| t.domainTags.some(tag => tag.toLowerCase().includes(q));
		});
	}

	private computeLayout(width: number): LayoutSize {
		if (width > 0 && width < COMPACT_MAX) return 'compact';
		if (width >= WIDE_MIN) return 'wide';
		return 'medium';
	}

	private isInSidebar(): boolean {
		const root = this.leaf.getRoot();
		return root === this.app.workspace.rightSplit || root === this.app.workspace.leftSplit;
	}

	private saveState(): void {
		this.app.workspace.requestSaveLayout();
	}

	/* ======================================================================
	   Rendu général
	   ====================================================================== */

	private renderPreservingScroll(): void {
		const scrollers = Array.from(this.rootEl.querySelectorAll<HTMLElement>('[data-scroll-id]'));
		const positions = new Map(scrollers.map(el => [el.dataset.scrollId as string, el.scrollTop]));
		this.render();
		this.rootEl.querySelectorAll<HTMLElement>('[data-scroll-id]').forEach(el => {
			// L'agenda s'est déjà replacé sur son jour : une position en pixels le décalerait
			if (this.agendaAnchorRestored && (el === this.agendaScroller || el === this.agendaEl)) return;
			const top = positions.get(el.dataset.scrollId as string);
			if (top !== undefined) el.scrollTop = top;
		});
	}

	private render(): void {
		if (!this.rootEl) return;
		this.pendingRender = false;
		const hadFocus = this.rootEl.contains(document.activeElement);
		const searchFocused = document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('sbm-tcal-search');
		const caret = searchFocused ? (document.activeElement as HTMLInputElement).selectionStart : null;

		this.hidePeek();
		this.clearGridSelection();
		// Mémorise le jour en haut de l'agenda avant de tout redessiner (modification, synchronisation…)
		this.agendaAnchor = this.captureAgendaAnchor();
		this.agendaAnchorRestored = false;
		this.rootEl.empty();
		this.rootEl.className = `sbm-tcal is-${this.layout} mode-${this.effectiveMode()} titles-${this.state.titleLines || 'full'}`;

		// Les cases à cocher horodatées des notes quotidiennes s'affichent comme entrées (pas en double)
		const entryTaskKeys = this.entriesEnabled() ? this.entries.taskKeys() : new Set<string>();
		const tasks = this.getVisibleTasks().filter(t => !entryTaskKeys.has(taskKey(t)));
		const buckets = bucketTasksByDate(tasks, this.state.dateField);
		this.taskBuckets = buckets;
		this.eventBuckets = bucketEventsByDate(this.getVisibleEvents());
		this.agendaEl = null;
		this.agendaScroller = null;

		this.renderToolbar();
		this.renderFilterBar();
		this.filterPopover.refresh(this.rootEl.querySelector<HTMLElement>('.sbm-tcal-filter-btn'));
		this.bodyEl = this.rootEl.createDiv({ cls: 'sbm-tcal-body' });

		if (this.layout === 'compact') {
			this.renderCompact(tasks, buckets);
		} else {
			const main = this.bodyEl.createDiv({ cls: 'sbm-tcal-main' });
			const mode = this.effectiveMode();
			if (mode === 'month') this.renderMonth(main, buckets);
			else if (mode === 'week') this.renderTimeGrid(main, CalendarDate.weekDays(this.state.anchor), buckets);
			else if (mode === 'day') this.renderTimeGrid(main, [this.state.anchor], buckets);
			else this.renderAgenda(main, buckets, AGENDA_DAYS_WIDE, 'row');
			this.renderTrays(this.layout === 'wide' ? this.bodyEl.createDiv({ cls: 'sbm-tcal-side' }) : this.bodyEl.createDiv({ cls: 'sbm-tcal-bottom' }), tasks);
		}

		this.ensureEvents();
		this.ensureEntries();

		if (searchFocused) {
			const input = this.rootEl.querySelector<HTMLInputElement>('.sbm-tcal-search');
			if (input) {
				input.focus();
				if (caret !== null) input.setSelectionRange(caret, caret);
			}
		} else if (hadFocus) {
			this.rootEl.focus({ preventScroll: true });
		}
	}

	private effectiveMode(): CalendarMode {
		return this.layout === 'compact' ? this.state.compactMode : this.state.mode;
	}

	private isGridMode(): boolean {
		const mode = this.effectiveMode();
		return mode === 'day' || mode === 'week';
	}

	/* ======================================================================
	   Barre d'outils
	   ====================================================================== */

	private renderToolbar(): void {
		const bar = this.rootEl.createDiv({ cls: 'sbm-tcal-toolbar' });

		const nav = bar.createDiv({ cls: 'sbm-tcal-nav' });
		const prev = this.iconButton(nav, 'chevron-left', 'Période précédente (←)', () => this.shift(-1));
		prev.dataset.dropNav = '-1';
		const todayBtn = nav.createEl('button', { cls: 'sbm-tcal-today-btn', text: 'Aujourd\'hui' });
		todayBtn.title = 'Revenir à aujourd\'hui (T)';
		todayBtn.addEventListener('click', () => this.goTo(this.today));
		const next = this.iconButton(nav, 'chevron-right', 'Période suivante (→)', () => this.shift(1));
		next.dataset.dropNav = '1';

		const title = bar.createDiv({ cls: 'sbm-tcal-title' });
		this.titleTextEl = title.createSpan({ cls: 'sbm-tcal-title-text', text: this.periodTitle() });
		if (this.layout === 'compact') {
			title.addClass('is-clickable');
			title.title = 'Afficher / masquer le mois';
			const caretEl = title.createSpan({ cls: 'sbm-tcal-title-caret' });
			setIcon(caretEl, this.state.miniMonthOpen ? 'chevron-up' : 'chevron-down');
			title.addEventListener('click', () => {
				this.state.miniMonthOpen = !this.state.miniMonthOpen;
				this.saveState();
				this.render();
			});
		}

		const tools = bar.createDiv({ cls: 'sbm-tcal-tools' });

		if (this.layout !== 'compact') {
			const seg = tools.createDiv({ cls: 'sbm-tcal-segmented' });
			const modes: Array<[CalendarMode, string, string]> = [
				['day', 'Jour', 'J'], ['week', 'Semaine', 'S'], ['month', 'Mois', 'M'], ['agenda', 'Agenda', 'A']
			];
			modes.forEach(([mode, label, key]) => {
				const b = seg.createEl('button', { text: label, cls: this.state.mode === mode ? 'is-active' : '' });
				b.title = `${label} (${key})`;
				b.addEventListener('click', () => this.setMode(mode));
			});
		} else {
			const isDay = this.state.compactMode === 'day';
			const toggle = this.iconButton(tools, isDay ? 'list' : 'clock', isDay ? 'Afficher l’agenda (liste)' : 'Afficher la grille horaire du jour', () => {
				this.state.compactMode = isDay ? 'agenda' : 'day';
				if (!isDay) this.state.anchor = this.stripFirstVisible && this.state.anchor < this.stripFirstVisible ? this.stripFirstVisible : this.state.anchor;
				this.agendaFocus = this.state.anchor;
				this.saveState();
				this.render();
			});
			toggle.addClass('sbm-tcal-compact-toggle');
		}

		const searchWrap = tools.createDiv({ cls: 'sbm-tcal-search-wrap' });
		const searchIcon = searchWrap.createSpan({ cls: 'sbm-tcal-search-icon' });
		setIcon(searchIcon, 'search');
		const search = searchWrap.createEl('input', { type: 'search', cls: 'sbm-tcal-search' });
		search.placeholder = 'Filtrer…';
		search.value = this.query;
		search.addEventListener('input', debounce(() => {
			this.query = search.value;
			this.undatedLimit = UNDATED_PAGE;
			this.render();
		}, 200, true));

		if (this.googleReady() && this.state.showEvents) {
			const sync = this.iconButton(tools, 'refresh-cw', 'Synchroniser l’agenda Google', () => void this.refreshEvents(true));
			sync.addClass('sbm-tcal-sync');
			this.updateSyncIndicator();
		}

		const activeFilters = describeFilter(this.getFilter(), this.filterContext()).length;
		const filterBtn = this.iconButton(tools, 'filter', activeFilters ? `Filtres (${activeFilters} actif${activeFilters > 1 ? 's' : ''}) — F` : 'Filtres (F)', () => this.openFilters());
		filterBtn.addClass('sbm-tcal-filter-btn');
		filterBtn.setAttribute('aria-haspopup', 'dialog');
		if (activeFilters) {
			filterBtn.addClass('is-filtered');
			filterBtn.createSpan({ cls: 'sbm-tcal-filter-badge', text: String(activeFilters) });
		}
		if (this.filterPopover.isOpen()) filterBtn.addClass('is-open');

		this.iconButton(tools, 'more-horizontal', 'Options', (e) => this.openOptionsMenu(e));
	}

	private periodTitle(): string {
		const mode = this.effectiveMode();
		const a = this.state.anchor;
		if (mode === 'day' && this.layout !== 'compact') {
			const sameYear = a.slice(0, 4) === this.today.slice(0, 4);
			return CalendarDate.format(a, sameYear
				? { weekday: 'long', day: 'numeric', month: 'long' }
				: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
		}
		if (mode === 'week' || this.layout === 'compact') {
			const days = CalendarDate.weekDays(a);
			const first = days[0];
			const last = days[6];
			if (this.layout === 'compact') {
				return CalendarDate.format(a, { month: 'long', year: 'numeric' });
			}
			const sameMonth = first.slice(0, 7) === last.slice(0, 7);
			const start = CalendarDate.format(first, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
			const end = CalendarDate.format(last, { day: 'numeric', month: 'long', year: 'numeric' });
			return `${start} – ${end} · S${CalendarDate.isoWeekNumber(first)}`;
		}
		if (mode === 'agenda') {
			const start = CalendarDate.startOfWeek(a);
			const end = CalendarDate.addDays(start, AGENDA_DAYS_WIDE - 1);
			return `${CalendarDate.format(start, { day: 'numeric', month: 'short' })} – ${CalendarDate.format(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
		}
		return CalendarDate.format(a, { month: 'long', year: 'numeric' });
	}

	private openOptionsMenu(e: MouseEvent): void {
		const menu = new Menu();
		menu.addItem(i => i.setTitle('Filtres…').setIcon('filter').onClick(() => this.openFilters()));
		menu.addSeparator();
		const lineChoices: Array<[number, string]> = [[1, 'Titres sur 1 ligne'], [2, 'Titres sur 2 lignes'], [0, 'Titres en entier']];
		lineChoices.forEach(([n, label]) => {
			menu.addItem(i => i.setTitle(label).setIcon('text').setChecked(this.state.titleLines === n).onClick(() => {
				this.state.titleLines = n;
				this.saveState();
				this.render();
			}));
		});
		if (this.isGridMode()) {
			menu.addSeparator();
			const idx = HOUR_HEIGHTS.indexOf(this.closestHourHeight());
			menu.addItem(i => i.setTitle('Grille horaire plus aérée').setIcon('zoom-in').setDisabled(idx >= HOUR_HEIGHTS.length - 1).onClick(() => this.zoomGrid(1)));
			menu.addItem(i => i.setTitle('Grille horaire plus compacte').setIcon('zoom-out').setDisabled(idx <= 0).onClick(() => this.zoomGrid(-1)));
		}
		menu.addSeparator();
		menu.addItem(i => i.setTitle('Placer selon l\'échéance 📅').setIcon('calendar').setChecked(this.state.dateField === 'due').onClick(() => this.setDateField('due')));
		menu.addItem(i => i.setTitle('Placer selon la date prévue ⏳').setIcon('hourglass').setChecked(this.state.dateField === 'scheduled').onClick(() => this.setDateField('scheduled')));
		menu.addSeparator();
		if (this.isInSidebar()) {
			menu.addItem(i => i.setTitle('Ouvrir en grand dans la vue principale').setIcon('maximize-2').onClick(() => this.plugin.activateTaskCalendarView('main')));
		} else {
			menu.addItem(i => i.setTitle('Ouvrir dans la barre latérale').setIcon('panel-right').onClick(() => this.plugin.activateTaskCalendarView('sidebar')));
		}
		menu.addItem(i => i.setTitle('Nouvelle tâche aujourd\'hui').setIcon('plus').onClick(() => this.promptNewTask(this.today, this.rootEl.querySelector('.sbm-tcal-toolbar') as HTMLElement)));
		if (this.plugin.settings.dailyEntriesEnabled !== false) {
			menu.addItem(i => i.setTitle('Nouvelle entrée dans la note quotidienne').setIcon('clock').onClick(() => this.openEntryModal(undefined, { date: this.today })));
		}
		menu.addItem(i => i.setTitle('Rafraîchir').setIcon('refresh-cw').onClick(() => this.refresh()));
		menu.showAtMouseEvent(e);
	}

	private closestHourHeight(): number {
		const h = this.state.hourHeight || DEFAULT_HOUR_HEIGHT;
		return HOUR_HEIGHTS.reduce((best, v) => Math.abs(v - h) < Math.abs(best - h) ? v : best, HOUR_HEIGHTS[0]);
	}

	/** Zoom de la grille horaire en gardant l'heure du haut de l'écran. */
	private zoomGrid(direction: 1 | -1): void {
		const idx = HOUR_HEIGHTS.indexOf(this.closestHourHeight());
		const next = HOUR_HEIGHTS[Math.max(0, Math.min(HOUR_HEIGHTS.length - 1, idx + direction))];
		if (next === this.state.hourHeight) return;
		const scroller = this.rootEl.querySelector<HTMLElement>('.sbm-tcal-tg-scroll');
		const topMinutes = scroller ? scroller.scrollTop / this.state.hourHeight * 60 : null;
		this.state.hourHeight = next;
		this.gridScroll = topMinutes !== null ? { top: topMinutes / 60 * next, hourHeight: next } : null;
		this.saveState();
		this.render();
	}

	private setMode(mode: CalendarMode): void {
		if (mode === 'agenda' && this.state.mode !== 'agenda') {
			this.agendaStart = null;
			this.agendaFocus = this.state.anchor;
		}
		this.state.mode = mode;
		this.saveState();
		this.render();
	}

	private setDateField(field: CalendarDateField): void {
		this.state.dateField = field;
		this.saveState();
		this.render();
	}

	private shift(direction: number): void {
		const mode = this.effectiveMode();
		if (this.layout === 'compact' && mode === 'day' && !this.state.miniMonthOpen) {
			// Grille du jour en barre latérale : un jour à la fois, le ruban suit
			this.state.anchor = CalendarDate.addDays(this.state.anchor, direction);
			this.stripPendingTarget = CalendarDate.startOfWeek(this.state.anchor);
			this.saveState();
			this.render();
			return;
		}
		if (this.layout === 'compact') {
			if (this.state.miniMonthOpen) {
				this.state.anchor = CalendarDate.addMonths(this.state.anchor, direction);
				this.stripPendingTarget = CalendarDate.startOfWeek(this.state.anchor);
			} else {
				// Le ruban avance d'une semaine depuis la position affichée, l'agenda suit
				const from = this.stripFirstVisible || CalendarDate.startOfWeek(this.state.anchor);
				this.stripPendingTarget = CalendarDate.addDays(from, 7 * direction);
				this.state.anchor = CalendarDate.addDays(this.state.anchor, 7 * direction);
			}
		} else if (mode === 'month') {
			this.state.anchor = CalendarDate.addMonths(this.state.anchor, direction);
		} else if (mode === 'week') {
			this.state.anchor = CalendarDate.addDays(this.state.anchor, 7 * direction);
		} else if (mode === 'day') {
			this.state.anchor = CalendarDate.addDays(this.state.anchor, direction);
		} else {
			const from = this.firstVisibleAgendaDay() || CalendarDate.startOfWeek(this.state.anchor);
			const target = CalendarDate.addDays(CalendarDate.startOfWeek(from), 7 * direction);
			this.state.anchor = target;
			this.saveState();
			if (this.drag) {
				// Pendant un glisser-déposer : défilement instantané pour garder la cible sous le pointeur
				this.scrollAgendaTo(target, false);
			} else {
				this.scrollAgendaTo(target, true);
			}
			return;
		}
		if (this.layout === 'compact') this.agendaFocus = CalendarDate.startOfWeek(this.state.anchor);
		this.saveState();
		this.render();
	}

	private goTo(date: string, scrollToDay = true): void {
		this.state.anchor = date;
		this.stripPendingTarget = CalendarDate.startOfWeek(date);
		this.saveState();
		if (this.effectiveMode() === 'agenda' && this.agendaEl && scrollToDay) {
			// L'agenda est déjà affiché : défilement fluide depuis la position actuelle
			this.renderPreservingScroll();
			this.scrollAgendaTo(date, true);
			return;
		}
		this.agendaFocus = date;
		this.render();
		if (scrollToDay) this.scrollToDay(date);
	}

	private scrollToDay(date: string): void {
		window.requestAnimationFrame(() => this.scrollAgendaTo(date, true));
	}

	private onKeyDown(e: KeyboardEvent): void {
		const target = e.target as HTMLElement;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			if (e.key === 'Escape') target.blur();
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		switch (e.key) {
			case 'ArrowLeft': this.shift(-1); break;
			case 'ArrowRight': this.shift(1); break;
			case 't': case 'T': this.goTo(this.today); break;
			case 'm': case 'M': if (this.layout !== 'compact') this.setMode('month'); break;
			case 'j': case 'J': case 'd': case 'D': if (this.layout !== 'compact') this.setMode('day'); break;
			case '+': case '=': if (this.isGridMode()) this.zoomGrid(1); break;
			case '-': if (this.isGridMode()) this.zoomGrid(-1); break;
			case 's': case 'S': case 'w': case 'W': if (this.layout !== 'compact') this.setMode('week'); break;
			case 'a': case 'A': if (this.layout !== 'compact') this.setMode('agenda'); break;
			case 'f': case 'F': this.openFilters(); break;
			case '/': {
				const input = this.rootEl.querySelector<HTMLInputElement>('.sbm-tcal-search');
				input?.focus();
				break;
			}
			default: return;
		}
		e.preventDefault();
	}

	/* ======================================================================
	   Vue Mois
	   ====================================================================== */

	private renderMonth(container: HTMLElement, buckets: Map<string, ObsidianTask[]>): void {
		const wrap = container.createDiv({ cls: 'sbm-tcal-month' });
		const head = wrap.createDiv({ cls: 'sbm-tcal-weekdays' });
		head.createDiv({ cls: 'sbm-tcal-weeknum-head' });
		CalendarDate.weekDays(this.today).forEach(d => {
			head.createDiv({ text: CalendarDate.format(d, { weekday: 'short' }).replace('.', '') });
		});

		const grid = wrap.createDiv({ cls: 'sbm-tcal-month-grid' });
		grid.dataset.scrollId = 'month';
		const days = CalendarDate.monthGrid(this.state.anchor);
		const currentMonth = this.state.anchor.slice(0, 7);

		for (let w = 0; w < 6; w++) {
			const row = grid.createDiv({ cls: 'sbm-tcal-month-row' });
			const weekDays = days.slice(w * 7, w * 7 + 7);
			const wn = row.createDiv({ cls: 'sbm-tcal-weeknum', text: String(CalendarDate.isoWeekNumber(weekDays[0])) });
			wn.title = 'Ouvrir cette semaine';
			wn.addEventListener('click', () => {
				this.state.anchor = weekDays[0];
				this.setMode('week');
			});

			weekDays.forEach(day => {
				const dayTasks = buckets.get(day) || [];
				const dayEvents = this.eventBuckets.get(day) || [];
				const cell = row.createDiv({ cls: 'sbm-tcal-cell' });
				this.decorateDayCell(cell, day, currentMonth);

				const header = cell.createDiv({ cls: 'sbm-tcal-cell-head' });
				const num = header.createSpan({ cls: 'sbm-tcal-daynum' });
				num.setText(day.endsWith('-01')
					? CalendarDate.format(day, { day: 'numeric', month: 'short' })
					: String(Number(day.slice(8))));
				num.title = 'Voir la semaine';
				num.addEventListener('click', () => {
					this.state.anchor = day;
					this.setMode('week');
				});
				this.renderLoadMeter(header, dayTasks);
				this.addQuickAddButton(header, day);

				// Tout est visible : la case s'agrandit, la grille du mois défile
				const list = cell.createDiv({ cls: 'sbm-tcal-cell-list' });
				this.renderDayItems(list, day, 'mini', dayTasks, dayEvents);

				cell.addEventListener('dblclick', (e) => {
					if ((e.target as HTMLElement).closest('.sbm-tcal-chip')) return;
					this.promptNewTask(day, cell);
				});
			});
		}
	}

	/**
	 * Contenu d'un jour dans une liste (mois, agenda) : événements « journée », puis
	 * événements minutés et entrées de la note quotidienne dans l'ordre des heures, puis tâches.
	 */
	private renderDayItems(
		list: HTMLElement,
		day: string,
		variant: 'mini' | 'card' | 'row',
		dayTasks: ObsidianTask[],
		dayEvents: GoogleCalendarEvent[]
	): void {
		const timed: Array<{ at: number; render: () => void }> = [];
		dayEvents.forEach(ev => {
			if (ev.allDay || !ev.start?.dateTime) {
				this.renderEventChip(list, ev, variant, day);
				return;
			}
			const s = localParts(ev.start.dateTime);
			const at = s.date < day ? -1 : Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5));
			timed.push({ at, render: () => this.renderEventChip(list, ev, variant, day) });
		});
		this.dayEntries(day).forEach(entry => timed.push({ at: entry.start, render: () => this.renderEntryChip(list, entry, variant) }));
		timed.sort((a, b) => a.at - b.at).forEach(t => t.render());
		dayTasks.forEach(t => this.renderChip(list, t, variant));
	}

	/* ======================================================================
	   Grille horaire (vues Jour et Semaine)
	   ====================================================================== */

	private gridHours(): { startH: number; endH: number } {
		const s = this.plugin.settings;
		const startH = Math.max(0, Math.min(23, Math.floor(Number(s.calendarGridStartHour) || 0)));
		const rawEnd = Number(s.calendarGridEndHour);
		const endH = Math.max(startH + 1, Math.min(24, Math.floor(Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : 24)));
		return { startH, endH };
	}

	private renderTimeGrid(container: HTMLElement, days: string[], buckets: Map<string, ObsidianTask[]>): void {
		const { startH, endH } = this.gridHours();
		const hh = this.state.hourHeight || DEFAULT_HOUR_HEIGHT;
		const single = days.length === 1;
		const wrap = container.createDiv({ cls: `sbm-tcal-tg ${single ? 'is-single' : 'is-multi'}` });
		wrap.style.setProperty('--tg-hour', `${hh}px`);
		wrap.style.setProperty('--tg-cols', String(days.length));

		// En-têtes des jours
		const head = wrap.createDiv({ cls: 'sbm-tcal-tg-head' });
		const corner = head.createDiv({ cls: 'sbm-tcal-tg-gutter sbm-tcal-tg-corner' });
		if (!single) corner.setText(`S${CalendarDate.isoWeekNumber(days[0])}`);
		days.forEach(day => {
			const dayTasks = buckets.get(day) || [];
			const h = head.createDiv({ cls: 'sbm-tcal-tg-dayhead' });
			this.decorateDayCell(h, day);
			const line = h.createDiv({ cls: 'sbm-tcal-tg-dayline' });
			line.createSpan({ cls: 'sbm-tcal-tg-dayname', text: CalendarDate.format(day, { weekday: single ? 'long' : 'short' }).replace('.', '') });
			const num = line.createSpan({ cls: 'sbm-tcal-tg-daynum', text: String(Number(day.slice(8))) });
			if (!single) {
				num.title = 'Voir la journée';
				num.addEventListener('click', () => {
					this.state.anchor = day;
					this.setMode('day');
				});
			}
			this.addQuickAddButton(line, day);
			this.renderLoadMeter(h, dayTasks, true);
		});

		// Bandeau « journée » : événements sur la journée entière et tâches
		const allday = wrap.createDiv({ cls: 'sbm-tcal-tg-allday' });
		allday.dataset.scrollId = 'tg-allday';
		allday.createDiv({ cls: 'sbm-tcal-tg-gutter sbm-tcal-tg-allday-label', text: 'Journée' });
		days.forEach(day => {
			const cell = allday.createDiv({ cls: 'sbm-tcal-tg-allday-cell' });
			this.decorateDayCell(cell, day);
			const variant = single && this.layout !== 'compact' ? 'card' : 'mini';
			(this.eventBuckets.get(day) || []).forEach(ev => {
				if (ev.allDay || !ev.start?.dateTime) this.renderEventChip(cell, ev, 'mini', day);
			});
			(buckets.get(day) || []).forEach(t => this.renderChip(cell, t, variant));
			cell.addEventListener('dblclick', (e) => {
				if ((e.target as HTMLElement).closest('.sbm-tcal-chip')) return;
				this.promptNewTask(day, cell);
			});
		});

		// Grille
		const scroller = wrap.createDiv({ cls: 'sbm-tcal-tg-scroll' });
		scroller.dataset.scrollId = 'tg';
		const grid = scroller.createDiv({ cls: 'sbm-tcal-tg-grid' });
		grid.style.height = `${(endH - startH) * hh}px`;
		grid.dataset.startHour = String(startH);
		const gutter = grid.createDiv({ cls: 'sbm-tcal-tg-gutter sbm-tcal-tg-hours' });
		for (let h = startH; h < endH; h++) {
			const label = gutter.createDiv({ cls: 'sbm-tcal-tg-hour', text: `${String(h).padStart(2, '0')}:00` });
			label.style.top = `${(h - startH) * hh}px`;
		}

		days.forEach(day => {
			const col = grid.createDiv({ cls: 'sbm-tcal-tg-col' });
			this.decorateDayCell(col, day);
			col.dataset.gridDay = day;
			const items = this.layoutTimedItems(this.timedItemsFor(day), hh);
			items.forEach(item => this.renderGridItem(col, item, startH, endH, hh));
			if (day === this.today) col.createDiv({ cls: 'sbm-tcal-tg-now' });
			col.addEventListener('pointerdown', (e) => this.onGridPointerDown(e, col, day));
		});
		this.updateNowLine(wrap);

		scroller.addEventListener('scroll', () => {
			if (scroller.clientHeight > 0) this.gridScroll = { top: scroller.scrollTop, hourHeight: hh };
		}, { passive: true });
		scroller.addEventListener('wheel', (e) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			this.zoomGrid(e.deltaY < 0 ? 1 : -1);
		}, { passive: false });

		// Position : celle de la période précédente, sinon l'heure d'ouverture (ou maintenant)
		const remembered = this.gridScroll && this.gridScroll.hourHeight === hh ? this.gridScroll.top : null;
		const focusHour = days.includes(this.today)
			? Math.max(startH, new Date().getHours() - 1)
			: Math.max(startH, Number(this.plugin.settings.calendarScrollToHour) || 7);
		const target = remembered ?? Math.max(0, (Math.min(focusHour, endH - 1) - startH) * hh);
		scroller.scrollTop = target;
		if (scroller.clientHeight > 0) this.gridScroll = { top: target, hourHeight: hh };
	}

	/** Événements minutés et entrées d'un jour, en minutes sur ce jour. */
	private timedItemsFor(day: string): TimedItem[] {
		const items: TimedItem[] = [];
		(this.eventBuckets.get(day) || []).forEach(ev => {
			if (ev.allDay || !ev.start?.dateTime) return;
			const s = localParts(ev.start.dateTime);
			const e = ev.end?.dateTime ? localParts(ev.end.dateTime) : null;
			const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
			const clippedStart = s.date < day;
			const start = clippedStart ? 0 : toMin(s.time);
			let end: number;
			let clippedEnd = false;
			if (!e) end = start + 60;
			else if (e.date > day) {
				end = 1440;
				clippedEnd = !(e.time === '00:00' && CalendarDate.addDays(day, 1) === e.date);
			} else end = toMin(e.time);
			if (end <= start) end = Math.min(1440, start + GRID_SNAP);
			items.push({ kind: 'event', key: eventKey(ev), day, start, end, clippedStart, clippedEnd, point: false, event: ev, col: 0, cols: 1 });
		});
		this.dayEntries(day).forEach(entry => {
			const b = entryBounds(entry, this.entryDuration());
			items.push({ kind: 'entry', key: entryKey(entry), day, start: b.start, end: b.end, clippedStart: false, clippedEnd: entry.end !== null && entry.end < entry.start, point: b.point, entry, col: 0, cols: 1 });
		});
		return items;
	}

	/** Répartit les éléments qui se chevauchent en colonnes côte à côte. */
	private layoutTimedItems(items: TimedItem[], hourHeight: number): TimedItem[] {
		// Hauteur minimale visible : deux éléments très courts proches ne se recouvrent pas
		const minSpan = Math.ceil(20 / hourHeight * 60);
		const visualEnd = (i: TimedItem) => Math.max(i.end, i.start + minSpan);
		const sorted = [...items].sort((a, b) => a.start - b.start || visualEnd(b) - visualEnd(a));
		let cluster: TimedItem[] = [];
		let clusterEnd = -1;
		let colEnds: number[] = [];
		const flush = () => {
			cluster.forEach(i => { i.cols = colEnds.length; });
			cluster = [];
			colEnds = [];
		};
		for (const item of sorted) {
			if (cluster.length && item.start >= clusterEnd) flush();
			let col = colEnds.findIndex(end => end <= item.start);
			if (col === -1) {
				col = colEnds.length;
				colEnds.push(visualEnd(item));
			} else {
				colEnds[col] = visualEnd(item);
			}
			item.col = col;
			cluster.push(item);
			clusterEnd = Math.max(clusterEnd, visualEnd(item));
		}
		flush();
		return sorted;
	}

	private renderGridItem(col: HTMLElement, item: TimedItem, startH: number, endH: number, hh: number): HTMLElement {
		const rangeStart = startH * 60;
		const rangeEnd = endH * 60;
		const top = Math.max(rangeStart, Math.min(item.start, rangeEnd - GRID_SNAP));
		const bottom = Math.max(top + GRID_SNAP, Math.min(item.end, rangeEnd));
		const heightPx = Math.max(18, (bottom - top) / 60 * hh - 2);

		const el = col.createDiv({ cls: `sbm-tcal-tg-item kind-${item.kind}` });
		el.dataset.key = item.key;
		el.style.top = `${(top - rangeStart) / 60 * hh + 1}px`;
		el.style.height = `${heightPx}px`;
		el.style.left = `calc(${(item.col / item.cols) * 100}% + 2px)`;
		el.style.width = `calc(${100 / item.cols}% - 4px)`;
		if (heightPx < 34) el.addClass('is-short');
		if (item.point) el.addClass('is-point');
		if (item.clippedStart) el.addClass('is-clipped-start');
		if (item.clippedEnd) el.addClass('is-clipped-end');
		if (this.flash && this.flash.key === item.key && Date.now() < this.flash.until) el.addClass('is-landed');

		if (item.event) {
			const ev = item.event;
			el.style.setProperty('--chip-accent', this.calendarColor(ev.calendarId));
			const role = this.legend.find(l => l.id === ev.calendarId)?.role || 'primary';
			el.addClass(`role-${role}`);
			const endMs = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : null;
			if (endMs !== null && endMs < Date.now()) el.addClass('is-past-event');
			el.createSpan({ cls: 'sbm-tcal-tg-item-time', text: item.clippedStart ? '↳' : formatClock(item.start) });
			el.createSpan({ cls: 'sbm-tcal-tg-item-title', text: ev.summary || '(Sans titre)' });
			if (ev.location && heightPx >= 52) el.createDiv({ cls: 'sbm-tcal-tg-item-sub', text: `📍 ${ev.location}` });
			this.attachPeek(el, this.fillEventPeek(ev));
			el.addEventListener('click', () => {
				if (Date.now() < this.suppressClickUntil) return;
				this.hidePeek();
				this.openEventModal(ev);
			});
			el.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.hidePeek();
				this.openEventMenu(e, ev, item.day);
			});
		} else if (item.entry) {
			const entry = item.entry;
			if (entry.statusChar !== undefined) {
				const type = TaskStatusRegistry.typeOf(entry.statusChar);
				if (type === 'DONE' || type === 'CANCELLED') el.addClass('is-done');
				const task = this.taskForEntry(entry);
				const check = el.createEl('button', { cls: 'sbm-tcal-check' });
				if (type === 'DONE') setIcon(check, 'check');
				else if (type === 'CANCELLED') check.addClass('is-cancelled');
				else if (entry.statusChar !== ' ') check.createSpan({ cls: 'sbm-tcal-check-symbol', text: entry.statusChar });
				check.title = `${TaskStatusRegistry.nameOf(entry.statusChar)} → ${TaskStatusRegistry.nameOf(TaskStatusRegistry.nextSymbol(entry.statusChar))}`;
				check.addEventListener('pointerdown', (e) => e.stopPropagation());
				check.addEventListener('click', (e) => {
					e.stopPropagation();
					if (task) this.toggleTask(task, el, check);
				});
				if (!task) check.disabled = true;
			}
			el.createSpan({ cls: 'sbm-tcal-tg-item-time', text: formatClock(entry.start) });
			el.createSpan({ cls: 'sbm-tcal-tg-item-title', text: this.entryTitle(entry) });
			this.attachPeek(el, this.fillEntryPeek(entry));
			el.addEventListener('click', (e) => {
				if (Date.now() < this.suppressClickUntil) return;
				if (e.ctrlKey || e.metaKey) void this.openEntryNote(entry, true);
				else this.openEntryModal(entry);
			});
			el.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.hidePeek();
				this.openEntryMenu(e, entry);
			});
		}

		// Déplacement et redimensionnement (pas pour les événements qui débordent sur d'autres jours)
		const movable = !(item.clippedStart || (item.kind === 'event' && item.clippedEnd));
		if (movable) {
			el.addClass('is-movable');
			const handle = el.createDiv({ cls: 'sbm-tcal-tg-resize' });
			handle.addEventListener('pointerdown', (e) => this.onGridItemPointerDown(e, item, el, 'resize'));
			el.addEventListener('pointerdown', (e) => this.onGridItemPointerDown(e, item, el, 'move'));
		} else {
			el.addEventListener('pointerdown', (e) => e.stopPropagation());
		}
		return el;
	}

	/** Place la ligne « maintenant » de la colonne du jour. */
	private updateNowLine(scope: HTMLElement = this.rootEl): void {
		if (!scope) return;
		const line = scope.querySelector<HTMLElement>('.sbm-tcal-tg-now');
		if (!line) return;
		const { startH, endH } = this.gridHours();
		const now = new Date();
		const minutes = now.getHours() * 60 + now.getMinutes();
		const hh = this.state.hourHeight || DEFAULT_HOUR_HEIGHT;
		line.toggleClass('is-hidden', minutes < startH * 60 || minutes > endH * 60);
		line.style.top = `${(minutes - startH * 60) / 60 * hh}px`;
	}

	/** Minute (aimantée) sous le pointeur dans une colonne de la grille. */
	private minuteAt(col: HTMLElement, clientY: number, snap = GRID_SNAP, mode: 'round' | 'floor' = 'round'): number {
		const { startH, endH } = this.gridHours();
		const hh = this.state.hourHeight || DEFAULT_HOUR_HEIGHT;
		const rect = col.getBoundingClientRect();
		const raw = startH * 60 + (clientY - rect.top) / hh * 60;
		const snapped = (mode === 'floor' ? Math.floor(raw / snap) : Math.round(raw / snap)) * snap;
		return Math.max(startH * 60, Math.min(endH * 60, snapped));
	}

	/* ----- Glisser un élément de la grille (déplacer / redimensionner) ----- */

	private onGridItemPointerDown(e: PointerEvent, item: TimedItem, el: HTMLElement, mode: 'move' | 'resize'): void {
		e.stopPropagation();
		if (e.button !== 0 || this.gridDrag || this.drag) return;
		this.hidePeek();
		const col = el.parentElement as HTMLElement;
		const grabbed = this.minuteAt(col, e.clientY, 1);
		this.gridDrag = {
			item, el, mode,
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			startX: e.clientX,
			startY: e.clientY,
			lastX: e.clientX,
			lastY: e.clientY,
			grabOffset: Math.max(0, grabbed - item.start),
			active: false
		};
		if (e.pointerType !== 'mouse') {
			// Tactile : appui long pour saisir, sinon la grille défile normalement
			this.gridDrag.holdTimer = window.setTimeout(() => {
				if (this.gridDrag && !this.gridDrag.active) this.startGridDrag();
			}, 280);
		}
		document.addEventListener('pointermove', this.onGridPointerMove, { passive: false });
		document.addEventListener('pointerup', this.onGridPointerUp);
		document.addEventListener('pointercancel', this.onGridPointerCancel);
		document.addEventListener('keydown', this.onGridKey, true);
		document.addEventListener('touchmove', this.onGridTouchMove, { passive: false });
	}

	private onGridTouchMove = (e: TouchEvent): void => {
		if (this.gridDrag?.active || this.gridSelection?.moved) e.preventDefault();
	};

	private startGridDrag(): void {
		const d = this.gridDrag;
		if (!d) return;
		d.active = true;
		d.el.addClass('is-grid-source');
		this.rootEl.addClass('is-grid-dragging');
		document.body.addClass('sbm-tcal-dragging');
		const preview = d.el.cloneNode(true) as HTMLElement;
		preview.removeClass('is-grid-source', 'is-landed');
		preview.addClass('is-preview');
		preview.querySelector('.sbm-tcal-tg-resize')?.remove();
		const label = preview.createDiv({ cls: 'sbm-tcal-tg-preview-label' });
		label.setText('');
		d.preview = preview;
		if (navigator.vibrate && d.pointerType === 'touch') {
			try { navigator.vibrate(12); } catch { /* ignore */ }
		}
		this.updateGridDrag();
	}

	private onGridPointerMove = (e: PointerEvent): void => {
		const d = this.gridDrag;
		if (!d || e.pointerId !== d.pointerId) return;
		d.lastX = e.clientX;
		d.lastY = e.clientY;
		const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
		if (!d.active) {
			if (d.pointerType === 'mouse') {
				if (dist > 4) this.startGridDrag();
			} else if (dist > 10) {
				this.cancelGridDrag();
			}
			return;
		}
		e.preventDefault();
		this.updateGridDrag();
		this.autoScrollGrid();
	};

	private updateGridDrag(): void {
		const d = this.gridDrag;
		if (!d?.active || !d.preview) return;
		const { startH, endH } = this.gridHours();
		const hh = this.state.hourHeight || DEFAULT_HOUR_HEIGHT;
		const sourceCol = d.el.parentElement as HTMLElement;
		let col = sourceCol;
		if (d.mode === 'move') {
			const under = document.elementFromPoint(d.lastX, d.lastY) as HTMLElement | null;
			const found = under?.closest<HTMLElement>('.sbm-tcal-tg-col');
			if (found && this.rootEl.contains(found)) col = found;
		}
		const day = col.dataset.gridDay as string;
		const duration = d.item.end - d.item.start;
		let start = d.item.start;
		let end = d.item.end;
		if (d.mode === 'move') {
			const pointer = this.minuteAt(col, d.lastY, 1);
			start = Math.round((pointer - d.grabOffset) / GRID_SNAP) * GRID_SNAP;
			start = Math.max(0, Math.min(1440 - Math.min(duration, 1440), start));
			end = start + duration;
		} else {
			end = Math.max(d.item.start + GRID_SNAP, this.minuteAt(col, d.lastY));
		}
		d.targetDay = day;
		d.targetStart = start;
		d.targetEnd = end;

		if (d.preview.parentElement !== col) col.appendChild(d.preview);
		const top = Math.max(startH * 60, start);
		const bottom = Math.min(endH * 60, Math.max(top + GRID_SNAP, end));
		d.preview.style.top = `${(top - startH * 60) / 60 * hh + 1}px`;
		d.preview.style.height = `${Math.max(18, (bottom - top) / 60 * hh - 2)}px`;
		d.preview.style.left = '2px';
		d.preview.style.width = 'calc(100% - 4px)';
		const time = d.preview.querySelector('.sbm-tcal-tg-item-time');
		time?.setText(formatClock(start));
		const label = d.preview.querySelector('.sbm-tcal-tg-preview-label');
		const dayLabel = day !== d.item.day ? ` · ${CalendarDate.format(day, { weekday: 'short', day: 'numeric' })}` : '';
		const showEnd = !(d.item.point && d.mode === 'move');
		label?.setText(`${formatClock(start)}${showEnd ? ` – ${formatClock(end)}` : ''}${dayLabel}`);
	}

	private autoScrollGrid(): void {
		const d = this.gridDrag;
		if (!d || d.scrollRaf) return;
		const step = () => {
			const drag = this.gridDrag;
			if (!drag?.active) return;
			drag.scrollRaf = undefined;
			const scroller = this.rootEl.querySelector<HTMLElement>('.sbm-tcal-tg-scroll');
			if (!scroller) return;
			const rect = scroller.getBoundingClientRect();
			const edge = 40;
			let dy = 0;
			if (drag.lastY < rect.top + edge) dy = -Math.ceil((rect.top + edge - drag.lastY) / 3);
			else if (drag.lastY > rect.bottom - edge) dy = Math.ceil((drag.lastY - (rect.bottom - edge)) / 3);
			if (dy !== 0) {
				scroller.scrollTop += dy;
				this.updateGridDrag();
				drag.scrollRaf = window.requestAnimationFrame(step);
			}
		};
		d.scrollRaf = window.requestAnimationFrame(step);
	}

	private onGridPointerUp = (e: PointerEvent): void => {
		const d = this.gridDrag;
		if (!d || e.pointerId !== d.pointerId) return;
		const wasActive = d.active;
		const { item, mode, targetDay, targetStart, targetEnd } = d;
		this.cleanupGridDrag();
		if (!wasActive) return;
		this.suppressClickUntil = Date.now() + 250;
		if (targetDay === undefined || targetStart === undefined || targetEnd === undefined) {
			if (this.pendingRender) this.renderPreservingScroll();
			return;
		}
		if (item.entry) {
			const entry = item.entry;
			// Une entrée ponctuelle déplacée reste ponctuelle ; redimensionnée, elle reçoit une heure de fin
			const end = mode === 'move' && entry.end === null ? null : targetEnd >= 1440 ? 1440 : targetEnd;
			void this.moveEntry(entry, targetDay, targetStart, end === targetStart ? null : end);
		} else if (item.event) {
			void this.moveEventTo(item.event, targetDay, targetStart, targetEnd);
		}
		if (this.pendingRender) this.renderPreservingScroll();
	};

	private onGridPointerCancel = (): void => this.cancelGridDrag();

	private onGridKey = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape') return;
		if (this.gridDrag || this.gridSelection) {
			e.preventDefault();
			e.stopPropagation();
			this.cancelGridDrag();
			this.clearGridSelection();
		}
	};

	private cancelGridDrag(): void {
		if (!this.gridDrag) return;
		const wasActive = this.gridDrag.active;
		this.cleanupGridDrag();
		if (wasActive) this.suppressClickUntil = Date.now() + 250;
		if (this.pendingRender) this.renderPreservingScroll();
	}

	private cleanupGridDrag(): void {
		const d = this.gridDrag;
		if (!d) return;
		if (d.holdTimer) window.clearTimeout(d.holdTimer);
		if (d.scrollRaf) window.cancelAnimationFrame(d.scrollRaf);
		d.preview?.remove();
		d.el.removeClass('is-grid-source');
		this.rootEl?.removeClass('is-grid-dragging');
		document.body.removeClass('sbm-tcal-dragging');
		document.removeEventListener('pointermove', this.onGridPointerMove);
		document.removeEventListener('pointerup', this.onGridPointerUp);
		document.removeEventListener('pointercancel', this.onGridPointerCancel);
		document.removeEventListener('keydown', this.onGridKey, true);
		document.removeEventListener('touchmove', this.onGridTouchMove);
		this.gridDrag = null;
	}

	/** Déplace un événement Google à un jour et une heure donnés (optimiste). */
	private async moveEventTo(ev: GoogleCalendarEvent, day: string, start: number, end: number): Promise<void> {
		const startDate = CalendarDate.fromISO(day);
		startDate.setHours(Math.floor(start / 60), start % 60, 0, 0);
		const endDate = CalendarDate.fromISO(day);
		endDate.setHours(0, 0, 0, 0);
		endDate.setMinutes(end);
		const previous = { start: ev.start, end: ev.end };
		const newStart = toLocalIsoWithOffset(startDate);
		const newEnd = toLocalIsoWithOffset(endDate);
		if (newStart === toLocalIsoWithOffset(new Date(ev.start.dateTime as string)) && ev.end?.dateTime && newEnd === toLocalIsoWithOffset(new Date(ev.end.dateTime))) return;
		ev.start = { ...ev.start, dateTime: newStart };
		ev.end = { ...ev.end, dateTime: newEnd };
		this.flash = { key: eventKey(ev), until: Date.now() + 900 };
		this.renderPreservingScroll();
		const s = localParts(newStart);
		const e = localParts(newEnd);
		try {
			await GoogleCalendarService.updateEvent(this.plugin.settings, ev.id, {
				calendarId: ev.calendarId,
				startDate: s.date,
				startTime: s.time,
				endDate: e.date,
				endTime: e.time
			});
			new Notice(`📅 ${ev.summary} → ${CalendarDate.relativeLabel(s.date, this.today)} ${s.time}`, 2500);
		} catch (err) {
			ev.start = previous.start;
			ev.end = previous.end;
			new Notice(`Impossible de déplacer l’événement : ${err instanceof Error ? err.message : String(err)}`);
			this.renderPreservingScroll();
		}
	}

	/* ----- Sélection d'un créneau vide pour créer ----- */

	private onGridPointerDown(e: PointerEvent, col: HTMLElement, day: string): void {
		if (e.button !== 0 || this.drag || this.gridDrag) return;
		if ((e.target as HTMLElement).closest('.sbm-tcal-tg-item, .sbm-tcal-chip')) return;
		this.clearGridSelection();
		const anchor = this.minuteAt(col, e.clientY, GRID_SNAP, 'floor');
		this.gridSelection = {
			day, col,
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			anchor,
			current: anchor,
			startY: e.clientY,
			moved: false
		};
		document.addEventListener('pointermove', this.onSelectMove, { passive: false });
		document.addEventListener('pointerup', this.onSelectUp);
		document.addEventListener('pointercancel', this.onSelectCancel);
		document.addEventListener('keydown', this.onGridKey, true);
	}

	private onSelectMove = (e: PointerEvent): void => {
		const sel = this.gridSelection;
		if (!sel || e.pointerId !== sel.pointerId || sel.box?.dataset.locked) return;
		if (!sel.moved) {
			if (Math.abs(e.clientY - sel.startY) < 6) return;
			// Au doigt, glisser fait défiler la grille : seule une touche simple crée
			if (sel.pointerType !== 'mouse') {
				this.clearGridSelection();
				return;
			}
			sel.moved = true;
		}
		e.preventDefault();
		sel.current = this.minuteAt(sel.col, e.clientY);
		this.drawSelection();
	};

	private onSelectUp = (e: PointerEvent): void => {
		const sel = this.gridSelection;
		if (!sel || e.pointerId !== sel.pointerId || sel.box?.dataset.locked) return;
		this.detachSelectListeners();
		let start: number;
		let end: number;
		if (sel.moved) {
			start = Math.min(sel.anchor, sel.current);
			end = Math.max(sel.anchor, sel.current);
			if (end - start < GRID_SNAP) end = start + GRID_SNAP;
		} else {
			start = sel.anchor;
			end = Math.min(1440, start + this.entryDuration());
		}
		sel.anchor = start;
		sel.current = end;
		this.drawSelection();
		if (sel.box) sel.box.dataset.locked = '1';
		this.openCreateMenu(e, sel.day, start, end, sel.moved);
	};

	private onSelectCancel = (): void => this.clearGridSelection();

	private detachSelectListeners(): void {
		document.removeEventListener('pointermove', this.onSelectMove);
		document.removeEventListener('pointerup', this.onSelectUp);
		document.removeEventListener('pointercancel', this.onSelectCancel);
		if (!this.gridDrag) document.removeEventListener('keydown', this.onGridKey, true);
	}

	private drawSelection(): void {
		const sel = this.gridSelection;
		if (!sel) return;
		const { startH } = this.gridHours();
		const hh = this.state.hourHeight || DEFAULT_HOUR_HEIGHT;
		const start = Math.min(sel.anchor, sel.current);
		const end = Math.max(sel.anchor, sel.current, start + GRID_SNAP);
		if (!sel.box) sel.box = sel.col.createDiv({ cls: 'sbm-tcal-tg-selection' });
		sel.box.style.top = `${(start - startH * 60) / 60 * hh}px`;
		sel.box.style.height = `${(end - start) / 60 * hh}px`;
		sel.box.setText(`${formatClock(start)} – ${formatClock(end)}`);
	}

	private clearGridSelection(): void {
		if (!this.gridSelection) return;
		this.gridSelection.box?.remove();
		this.gridSelection = null;
		this.detachSelectListeners();
		if (this.pendingRender) this.scheduleRender();
	}

	/** Menu de création sur un créneau : entrée de note quotidienne, événement Google ou tâche. */
	private openCreateMenu(e: MouseEvent, day: string, start: number, end: number, explicitEnd: boolean): void {
		const entriesOn = this.plugin.settings.dailyEntriesEnabled !== false;
		const menu = new Menu();
		const label = `${formatClock(start)} – ${formatClock(end)}`;
		if (entriesOn) {
			menu.addItem(i => i.setTitle(`Entrée dans la note quotidienne (${label})`).setIcon('clock').onClick(() =>
				this.openEntryModal(undefined, { date: day, start, end: explicitEnd ? end : null })));
		}
		if (this.googleReady()) {
			menu.addItem(i => i.setTitle(`Événement Google (${label})`).setIcon('calendar-plus').onClick(() =>
				this.openEventModal(undefined, day, formatClock(start), formatClock(Math.min(end, 1439)))));
		}
		menu.addItem(i => i.setTitle('Tâche ce jour-là').setIcon('check-square').onClick(() => {
			const anchor = this.rootEl.querySelector<HTMLElement>(`.sbm-tcal-tg-dayhead[data-drop-date="${day}"]`) || this.rootEl;
			this.promptNewTask(day, anchor);
		}));
		menu.onHide(() => window.setTimeout(() => this.clearGridSelection(), 0));
		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	}

	/* ======================================================================
	   Vue Agenda (large) et liste du mode compact
	   ====================================================================== */

	/**
	 * Agenda à défilement continu : une fenêtre de jours qui s'agrandit vers le haut ou vers le bas
	 * quand on approche d'un bord, sans saut visible. Les flèches font glisser d'une semaine.
	 */
	private renderAgenda(
		container: HTMLElement,
		buckets: Map<string, ObsidianTask[]>,
		dayCount: number,
		variant: 'row' | 'card',
		startDate?: string
	): void {
		const list = container.createDiv({ cls: 'sbm-tcal-agenda' });
		list.dataset.scrollId = 'agenda';
		this.agendaEl = list;
		this.agendaVariant = variant;
		this.agendaScroller = this.layout === 'compact' ? container : list;

		// Fenêtre de jours : conservée d'un rendu à l'autre, recentrée lors d'une navigation explicite
		const base = startDate || CalendarDate.startOfWeek(this.state.anchor);
		const focus = this.agendaFocus;
		const inWindow = (day: string) => this.agendaStart !== null
			&& day >= this.agendaStart
			&& day < CalendarDate.addDays(this.agendaStart, this.agendaCount);
		if (this.agendaStart === null || (focus && !inWindow(focus))) {
			this.agendaStart = CalendarDate.addDays(focus ? CalendarDate.startOfWeek(focus) : base, -7);
			this.agendaCount = dayCount + 7;
			this.agendaPositioned = false;
		}

		const fragment = document.createDocumentFragment();
		for (let i = 0; i < this.agendaCount; i++) {
			this.renderAgendaDay(fragment, CalendarDate.addDays(this.agendaStart, i), variant, buckets);
		}
		list.appendChild(fragment);

		const scroller = this.agendaScroller;
		scroller.addEventListener('scroll', () => this.onAgendaScroll(), { passive: true });

		// Première ouverture ou navigation : on se place sur le jour demandé
		if (focus || !this.agendaPositioned) {
			const target = focus || (this.layout === 'compact' ? base : CalendarDate.startOfWeek(this.state.anchor));
			this.agendaFocus = null;
			this.agendaPositioned = true;
			window.requestAnimationFrame(() => this.scrollAgendaTo(target, false));
		} else if (this.agendaAnchor) {
			// Simple mise à jour : on reprend exactement au même jour, même si des journées ont changé de hauteur
			this.restoreAgendaAnchor(this.agendaAnchor);
		}
	}

	/** Jour visible en haut de l'agenda et son décalage par rapport au haut de la zone qui défile. */
	private captureAgendaAnchor(): { day: string; offset: number } | null {
		const scroller = this.agendaScroller;
		const list = this.agendaEl;
		if (!scroller || !list || !scroller.isConnected) return null;
		const top = scroller.getBoundingClientRect().top;
		for (const section of Array.from(list.querySelectorAll<HTMLElement>('.sbm-tcal-agenda-day'))) {
			const rect = section.getBoundingClientRect();
			if (rect.bottom > top + 1 && section.dataset.day) return { day: section.dataset.day, offset: rect.top - top };
		}
		return null;
	}

	private restoreAgendaAnchor(anchor: { day: string; offset: number }): void {
		const scroller = this.agendaScroller;
		const section = this.agendaEl?.querySelector<HTMLElement>(`.sbm-tcal-agenda-day[data-day="${anchor.day}"]`);
		if (!scroller || !section) return;
		const apply = () => {
			const delta = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
			if (Math.abs(delta) >= 1) {
				// Pas d'extension de la fenêtre déclenchée par ce repositionnement
				this.agendaScrollLockUntil = Date.now() + 150;
				scroller.scrollTop += delta;
			}
		};
		apply();
		this.agendaAnchorRestored = true;
		// Les intégrations (bases, images) peuvent changer la hauteur juste après : on recale une fois
		window.requestAnimationFrame(apply);
	}

	private renderAgendaDay(
		parent: ParentNode,
		day: string,
		variant: 'row' | 'card',
		buckets: Map<string, ObsidianTask[]>,
		before?: Node | null
	): void {
		{
			const dayTasks = buckets.get(day) || [];
			const dayEvents = this.eventBuckets.get(day) || [];
			const entryCount = this.dayEntries(day).length;
			const section = createDiv({ cls: 'sbm-tcal-agenda-day' });
			parent.insertBefore(section, before ?? null);
			section.dataset.day = day;
			this.decorateDayCell(section, day);
			if (dayTasks.length === 0 && dayEvents.length === 0 && entryCount === 0) section.addClass('is-empty');
			if (CalendarDate.weekdayIndex(day) === 0) section.addClass('is-week-start');
			if (day.endsWith('-01')) {
				const monthLabel = createDiv({ cls: 'sbm-tcal-agenda-month', text: CalendarDate.format(day, { month: 'long', year: 'numeric' }) });
				parent.insertBefore(monthLabel, section);
			}

			const head = section.createDiv({ cls: 'sbm-tcal-agenda-head' });
			const badge = head.createDiv({ cls: 'sbm-tcal-agenda-date' });
			badge.createSpan({ cls: 'sbm-tcal-agenda-dnum', text: String(Number(day.slice(8))) });
			badge.createSpan({ cls: 'sbm-tcal-agenda-dname', text: CalendarDate.format(day, { weekday: 'short' }).replace('.', '') });
			const label = head.createDiv({ cls: 'sbm-tcal-agenda-label' });
			const diff = CalendarDate.diffDays(this.today, day);
			label.createSpan({
				cls: 'sbm-tcal-agenda-rel',
				text: Math.abs(diff) <= 1 ? CalendarDate.relativeLabel(day, this.today) : CalendarDate.format(day, { weekday: 'long', day: 'numeric', month: 'long' })
			});
			if (dayTasks.length || dayEvents.length || entryCount) {
				const open = dayTasks.filter(isTaskOpen).length;
				const parts: string[] = [];
				if (dayEvents.length) parts.push(`${dayEvents.length} événement${dayEvents.length > 1 ? 's' : ''}`);
				if (entryCount) parts.push(`${entryCount} entrée${entryCount > 1 ? 's' : ''}`);
				if (dayTasks.length) parts.push(open ? `${open} à faire` : 'tout est fait ✨');
				label.createSpan({ cls: 'sbm-tcal-agenda-count', text: parts.join(' · ') });
			}
			this.renderLoadMeter(head, dayTasks);
			this.addQuickAddButton(head, day);

			const items = section.createDiv({ cls: 'sbm-tcal-agenda-items' });
			this.renderDayItems(items, day, variant, dayTasks, dayEvents);
		}
	}

	/** Premier jour visible en haut de l'agenda. */
	private firstVisibleAgendaDay(): string | null {
		const scroller = this.agendaScroller;
		const list = this.agendaEl;
		if (!scroller || !list) return null;
		const top = scroller.getBoundingClientRect().top + 4;
		const sections = list.querySelectorAll<HTMLElement>('.sbm-tcal-agenda-day');
		for (const section of Array.from(sections)) {
			if (section.getBoundingClientRect().bottom > top) return section.dataset.day || null;
		}
		return null;
	}

	/** Fait défiler l'agenda jusqu'à un jour, en agrandissant la fenêtre si besoin. */
	private scrollAgendaTo(day: string, smooth: boolean): void {
		if (!this.agendaEl || !this.agendaScroller || this.agendaStart === null) return;
		// Charge d'abord assez de jours autour de la cible : aucune extension ne se produira pendant l'animation
		const marginDays = 14;
		while (CalendarDate.diffDays(this.agendaStart, day) < marginDays) this.extendAgenda(-1);
		while (CalendarDate.diffDays(day, CalendarDate.addDays(this.agendaStart, this.agendaCount)) < marginDays) this.extendAgenda(1);
		const section = this.agendaEl.querySelector<HTMLElement>(`.sbm-tcal-agenda-day[data-day="${day}"]`);
		if (!section) return;
		const scroller = this.agendaScroller;
		const offset = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 4;
		this.agendaScrollLockUntil = Date.now() + (smooth ? 1000 : 150);
		scroller.scrollTo({ top: Math.max(0, offset), behavior: smooth ? 'smooth' : 'auto' });
		this.updateAgendaTitle();
	}

	private onAgendaScroll(): void {
		if (this.agendaScrollRaf) return;
		this.agendaScrollRaf = window.requestAnimationFrame(() => {
			this.agendaScrollRaf = undefined;
			const scroller = this.agendaScroller;
			if (!scroller || this.agendaExtending) return;
			if (Date.now() < this.agendaScrollLockUntil) {
				this.updateAgendaTitle();
				return;
			}
			const margin = 500;
			if (scroller.scrollTop < margin) this.extendAgenda(-1);
			else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < margin) this.extendAgenda(1);
			this.updateAgendaTitle();
		});
	}

	/** Ajoute 3 semaines avant (-1) ou après (+1), en gardant la position visuelle. */
	private extendAgenda(direction: 1 | -1): void {
		const list = this.agendaEl;
		const scroller = this.agendaScroller;
		if (!list || !scroller || this.agendaStart === null) return;
		const chunk = 21;
		this.agendaExtending = true;
		if (direction > 0) {
			const from = CalendarDate.addDays(this.agendaStart, this.agendaCount);
			const fragment = document.createDocumentFragment();
			for (let i = 0; i < chunk; i++) {
				this.renderAgendaDay(fragment, CalendarDate.addDays(from, i), this.agendaVariant, this.taskBuckets);
			}
			list.appendChild(fragment);
			this.agendaCount += chunk;
		} else {
			const newStart = CalendarDate.addDays(this.agendaStart, -chunk);
			const fragment = document.createDocumentFragment();
			for (let i = 0; i < chunk; i++) {
				this.renderAgendaDay(fragment, CalendarDate.addDays(newStart, i), this.agendaVariant, this.taskBuckets);
			}
			const before = scroller.scrollHeight;
			list.insertBefore(fragment, list.firstChild);
			// Compense la hauteur ajoutée au-dessus : le contenu visible ne bouge pas
			scroller.scrollTop += scroller.scrollHeight - before;
			this.agendaStart = newStart;
			this.agendaCount += chunk;
		}
		this.agendaExtending = false;
		this.ensureEvents();
		this.ensureEntries();
	}

	/** Le titre (et l'ancre) suivent les jours visibles de l'agenda. */
	private updateAgendaTitle(): void {
		if (this.effectiveMode() !== 'agenda' || this.layout === 'compact') return;
		const first = this.firstVisibleAgendaDay();
		if (!first || !this.titleTextEl || !this.agendaScroller) return;
		const height = this.agendaScroller.clientHeight;
		const approxDays = Math.max(1, Math.round(height / 60));
		const last = CalendarDate.addDays(first, approxDays);
		this.state.anchor = first;
		this.titleTextEl.setText(first.slice(0, 7) === last.slice(0, 7)
			? CalendarDate.format(first, { month: 'long', year: 'numeric' })
			: `${CalendarDate.format(first, { month: 'short' })} – ${CalendarDate.format(last, { month: 'short', year: 'numeric' })}`);
	}

	private renderCompact(tasks: ObsidianTask[], buckets: Map<string, ObsidianTask[]>): void {
		this.renderStrip(buckets);

		if (this.state.miniMonthOpen) this.renderMiniMonth(this.bodyEl, buckets);

		// Bacs « En retard » et « Sans date » : fixés en haut, hors de la zone qui défile (repliables)
		const trays = this.bodyEl.createDiv({ cls: 'sbm-tcal-compact-trays' });
		trays.dataset.scrollId = 'compact-trays';
		const overdue = tasks.filter(t => isTaskOpen(t) && (getTaskDate(t, this.state.dateField) || '9999') < this.today).sort(compareTasks);
		this.renderTray(trays, 'overdue', 'En retard', overdue, 'card', 'alert-circle');
		const undated = tasks.filter(t => isTaskOpen(t) && !getTaskDate(t, this.state.dateField) && t.indentLevel === 0).sort(compareTasks);
		this.renderTray(trays, 'undated', 'Sans date', undated, 'card', 'inbox', true);

		if (this.state.compactMode === 'day') {
			const gridWrap = this.bodyEl.createDiv({ cls: 'sbm-tcal-compact-grid' });
			this.renderTimeGrid(gridWrap, [this.state.anchor], buckets);
			return;
		}
		const scroll = this.bodyEl.createDiv({ cls: 'sbm-tcal-compact-scroll' });
		scroll.dataset.scrollId = 'compact';
		this.renderAgenda(scroll, buckets, AGENDA_DAYS_COMPACT, 'card', CalendarDate.startOfWeek(this.state.anchor));
	}

	private renderMiniMonth(container: HTMLElement, buckets: Map<string, ObsidianTask[]>): void {
		const mini = container.createDiv({ cls: 'sbm-tcal-mini' });
		const head = mini.createDiv({ cls: 'sbm-tcal-mini-head' });
		CalendarDate.weekDays(this.today).forEach(d => head.createDiv({ text: CalendarDate.format(d, { weekday: 'narrow' }) }));
		const grid = mini.createDiv({ cls: 'sbm-tcal-mini-grid' });
		const currentMonth = this.state.anchor.slice(0, 7);
		CalendarDate.monthGrid(this.state.anchor).forEach(day => {
			const cell = grid.createDiv({ cls: 'sbm-tcal-mini-cell' });
			this.decorateDayCell(cell, day, currentMonth);
			if (day === this.state.anchor) cell.addClass('is-selected');
			cell.createSpan({ text: String(Number(day.slice(8))) });
			const open = (buckets.get(day) || []).filter(isTaskOpen).length;
			if (open) {
				cell.addClass('has-tasks');
				cell.style.setProperty('--sbm-heat', String(Math.min(1, open / 5)));
			}
			cell.addEventListener('click', () => {
				this.state.anchor = day;
				this.stripPendingTarget = CalendarDate.startOfWeek(day);
				this.saveState();
				this.renderPreservingScroll();
				this.scrollToDay(day);
			});
		});
	}

	/* ======================================================================
	   Bacs : En retard / Sans date
	   ====================================================================== */

	private renderTrays(container: HTMLElement, tasks: ObsidianTask[]): void {
		const overdue = tasks.filter(t => isTaskOpen(t) && (getTaskDate(t, this.state.dateField) || '9999') < this.today).sort(compareTasks);
		const undated = tasks.filter(t => isTaskOpen(t) && !getTaskDate(t, this.state.dateField) && t.indentLevel === 0).sort(compareTasks);
		container.dataset.scrollId = 'side';
		this.renderTray(container, 'overdue', 'En retard', overdue, 'card', 'alert-circle');
		this.renderTray(container, 'undated', 'Sans date', undated, 'card', 'inbox', true);
	}

	private renderTray(
		container: HTMLElement,
		id: 'overdue' | 'undated',
		title: string,
		tasks: ObsidianTask[],
		variant: 'card' | 'row',
		icon: string,
		isDropZone = false
	): void {
		const collapsed = this.state.collapsed.includes(id);
		const tray = container.createDiv({ cls: `sbm-tcal-tray tray-${id} ${collapsed ? 'is-collapsed' : ''}` });
		if (isDropZone) tray.dataset.dropDate = '';

		const head = tray.createDiv({ cls: 'sbm-tcal-tray-head' });
		const iconEl = head.createSpan({ cls: 'sbm-tcal-tray-icon' });
		setIcon(iconEl, icon);
		head.createSpan({ cls: 'sbm-tcal-tray-title', text: title });
		head.createSpan({ cls: 'sbm-tcal-tray-count', text: String(tasks.length) });
		const chevron = head.createSpan({ cls: 'sbm-tcal-tray-chevron' });
		setIcon(chevron, 'chevron-down');
		head.addEventListener('click', () => {
			this.state.collapsed = collapsed
				? this.state.collapsed.filter(c => c !== id)
				: [...this.state.collapsed, id];
			this.saveState();
			this.renderPreservingScroll();
		});

		const body = tray.createDiv({ cls: 'sbm-tcal-tray-body' });
		if (collapsed) return;
		if (tasks.length === 0) {
			body.createDiv({
				cls: 'sbm-tcal-empty-hint',
				text: id === 'overdue' ? 'Rien en retard 🎉' : 'Glisser une tâche ici pour retirer sa date'
			});
			return;
		}
		const limit = id === 'undated' ? this.undatedLimit : tasks.length;
		tasks.slice(0, limit).forEach(t => this.renderChip(body, t, variant, true));
		if (tasks.length > limit) {
			const more = body.createEl('button', { cls: 'sbm-tcal-more', text: `Afficher ${Math.min(UNDATED_PAGE, tasks.length - limit)} de plus (${tasks.length - limit} restantes)` });
			more.addEventListener('click', () => {
				this.undatedLimit += UNDATED_PAGE;
				this.renderPreservingScroll();
			});
		}
	}

	/* ======================================================================
	   Éléments communs
	   ====================================================================== */

	private decorateDayCell(el: HTMLElement, day: string, currentMonth?: string): void {
		el.dataset.dropDate = day;
		if (day === this.today) el.addClass('is-today');
		if (day < this.today) el.addClass('is-past');
		if (CalendarDate.isWeekend(day)) el.addClass('is-weekend');
		if (currentMonth && day.slice(0, 7) !== currentMonth) el.addClass('is-outside');
	}

	private renderLoadMeter(container: HTMLElement, dayTasks: ObsidianTask[], wide = false): void {
		const load = dayEnergyLoad(dayTasks);
		if (!load) return;
		const capacity = Math.max(10, (this.plugin.settings.energyLevel || 5) * 3);
		const ratio = Math.min(1, load / capacity);
		const meter = container.createDiv({ cls: `sbm-tcal-load ${wide ? 'is-wide' : ''}` });
		meter.title = `Charge d'énergie : ${load} (capacité estimée ${capacity})`;
		const fill = meter.createDiv({ cls: 'sbm-tcal-load-fill' });
		fill.style.setProperty('--sbm-load', String(ratio));
		if (ratio >= 1) meter.addClass('is-over');
		else if (ratio >= 0.7) meter.addClass('is-high');
	}

	private renderDots(container: HTMLElement, dayTasks: ObsidianTask[], dayEvents: GoogleCalendarEvent[] = [], entryCount = 0): void {
		const dots = container.createDiv({ cls: 'sbm-tcal-dots' });
		dayEvents.slice(0, 2).forEach(ev => {
			const dot = dots.createSpan({ cls: 'sbm-tcal-dot is-event' });
			dot.style.setProperty('--sbm-cal-color', this.calendarColor(ev.calendarId));
		});
		const ringCount = Math.min(2, dayEvents.length) + (entryCount ? 1 : 0);
		if (entryCount) dots.createSpan({ cls: 'sbm-tcal-dot is-event is-entry' });
		dayTasks.slice(0, Math.max(0, 4 - ringCount)).forEach(t => {
			const dot = dots.createSpan({ cls: 'sbm-tcal-dot' });
			if (!isTaskOpen(t)) dot.addClass('is-done');
			const q = this.quadrantOf(t);
			if (q) dot.addClass(`quad-${q}`);
			if (t.priority) dot.addClass(`prio-${t.priority}`);
		});
	}

	private addQuickAddButton(container: HTMLElement, day: string): void {
		const btn = container.createEl('button', { cls: 'sbm-tcal-add clickable-icon' });
		setIcon(btn, 'plus');
		const label = CalendarDate.format(day, { day: 'numeric', month: 'long' });
		const entriesOn = this.plugin.settings.dailyEntriesEnabled !== false;
		btn.title = this.googleReady() || entriesOn ? `Ajouter le ${label}` : `Nouvelle tâche le ${label}`;
		btn.addEventListener('pointerdown', (e) => e.stopPropagation());
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!this.googleReady() && !entriesOn) {
				this.promptNewTask(day, btn);
				return;
			}
			const menu = new Menu();
			menu.addItem(i => i.setTitle('Nouvelle tâche').setIcon('check-square').onClick(() => this.promptNewTask(day, btn)));
			if (entriesOn) {
				menu.addItem(i => i.setTitle('Nouvelle entrée dans la note quotidienne').setIcon('clock').onClick(() => this.openEntryModal(undefined, { date: day })));
			}
			if (this.googleReady()) {
				menu.addItem(i => i.setTitle('Nouvel événement Google').setIcon('calendar-plus').onClick(() => this.openEventModal(undefined, day)));
			}
			menu.showAtMouseEvent(e);
		});
	}

	private iconButton(container: HTMLElement, icon: string, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
		const btn = container.createEl('button', { cls: 'sbm-tcal-icon-btn clickable-icon' });
		setIcon(btn, icon);
		btn.title = title;
		btn.setAttribute('aria-label', title);
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** Couleur d'une tâche : son quadrant, ou sa priorité quand les quadrants sont désactivés. */
	private taskAccent(task: ObsidianTask, quad: MatrixQuadrant): string | null {
		if (quad) return `var(--tcal-${quad})`;
		const prio = task.priority;
		if (!prio || prio === 'normal') return null;
		if (this.plugin.settings.matrixEnabled === false) return `var(--tcal-prio-${prio})`;
		return prio === 'highest' || prio === 'high' ? 'var(--tcal-q1)' : null;
	}

	private quadrantOf(task: ObsidianTask): MatrixQuadrant {
		const adapter = MatrixAdapterFactory.createAdapter(this.plugin.settings.matrixProvider, this.plugin.settings.customMatrixMapping);
		return adapter.getQuadrant(task);
	}

	/* ======================================================================
	   Puce de tâche
	   ====================================================================== */

	private renderChip(container: HTMLElement, task: ObsidianTask, variant: 'mini' | 'card' | 'row', showDate = false): HTMLElement {
		const key = taskKey(task);
		const open = isTaskOpen(task);
		const date = getTaskDate(task, this.state.dateField);
		const chip = container.createDiv({ cls: `sbm-tcal-chip variant-${variant}` });
		chip.dataset.key = key;
		if (!open) chip.addClass('is-done');
		if (task.status === 'cancelled') chip.addClass('is-cancelled');
		if (task.isPaused || task.status === 'paused') chip.addClass('is-paused');
		if (open && date && date < this.today) chip.addClass('is-overdue');
		if (task.priority) chip.addClass(`prio-${task.priority}`);
		const quad = this.quadrantOf(task);
		if (quad) chip.addClass(`quad-${quad}`);
		if (this.flash && this.flash.key === key && Date.now() < this.flash.until) chip.addClass('is-landed');

		const check = chip.createEl('button', { cls: 'sbm-tcal-check' });
		check.setAttribute('role', 'checkbox');
		check.setAttribute('aria-checked', String(task.completed));
		check.title = task.completed ? 'Rouvrir la tâche' : 'Terminer la tâche';
		if (task.status === 'cancelled') check.addClass('is-cancelled');
		else if (task.completed) setIcon(check, 'check');
		else if (task.statusChar !== ' ') {
			// Statut personnalisé (ex. [3] progress) : le symbole s'affiche dans la case
			check.createSpan({ cls: 'sbm-tcal-check-symbol', text: task.statusChar });
		}
		const nextSymbol = TaskStatusRegistry.nextSymbol(task.statusChar);
		check.title = `${TaskStatusRegistry.nameOf(task.statusChar)} → ${TaskStatusRegistry.nameOf(nextSymbol)}`;
		check.addEventListener('pointerdown', (e) => e.stopPropagation());
		check.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleTask(task, chip, check);
		});

		const content = chip.createDiv({ cls: 'sbm-tcal-chip-content' });
		const titleEl = content.createDiv({ cls: 'sbm-tcal-chip-title' });
		const prioIcon = task.priority ? PRIORITY_ICONS[task.priority] : undefined;
		if (prioIcon && variant !== 'mini') titleEl.createSpan({ cls: 'sbm-tcal-prio', text: prioIcon });
		titleEl.appendText(this.displayTitle(task.title, variant !== 'row'));

		if (variant !== 'mini') {
			const meta = content.createDiv({ cls: 'sbm-tcal-chip-meta' });
			if (showDate && date) {
				meta.createSpan({ cls: `sbm-tcal-meta date ${open && date < this.today ? 'is-late' : ''}`, text: CalendarDate.relativeLabel(date, this.today) });
			}
			if (quad) meta.createSpan({ cls: `sbm-tcal-meta quad quad-${quad}`, text: quad.toUpperCase() });
			if (task.energy) meta.createSpan({ cls: 'sbm-tcal-meta', text: `⚡${task.energy}` });
			if (task.pieces && this.plugin.isFeatureEnabled('gamification')) meta.createSpan({ cls: 'sbm-tcal-meta', text: `🪙${task.pieces}` });
			if (task.recurrence) {
				const rec = meta.createSpan({ cls: 'sbm-tcal-meta', text: '🔁' });
				rec.title = task.recurrence;
			}
			if (task.isPaused || task.status === 'paused') meta.createSpan({ cls: 'sbm-tcal-meta', text: '⏸️' });
			if (!task.completed && task.status !== 'cancelled' && task.statusChar !== ' ' && task.statusName) {
				meta.createSpan({ cls: 'sbm-tcal-meta status', text: `[${task.statusChar}] ${task.statusName}` });
			}
			const file = meta.createSpan({ cls: 'sbm-tcal-meta file', text: task.filePath.split('/').pop()?.replace(/\.md$/, '') || task.filePath });
			file.title = task.filePath;
			if (variant === 'row' && task.domainTags.length) {
				task.domainTags.slice(0, 3).forEach(tag => meta.createSpan({ cls: 'sbm-tcal-meta tag', text: tag }));
			}
		}

		this.attachPeek(chip, this.fillTaskPeek(task));

		chip.addEventListener('pointerdown', (e) => this.onChipPointerDown(e, { task }, chip));
		chip.addEventListener('click', (e) => {
			if (Date.now() < this.suppressClickUntil) return;
			this.openTask(task, e.ctrlKey || e.metaKey);
		});
		chip.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.drag?.active) return;
			this.cancelDrag();
			this.openTaskMenu(e, task, chip);
		});
		chip.addEventListener('mouseover', (e) => {
			this.app.workspace.trigger('hover-link', {
				event: e,
				source: VIEW_TYPE_TASK_CALENDAR,
				hoverParent: this,
				targetEl: chip,
				linktext: task.filePath,
				sourcePath: task.filePath,
				state: { scroll: task.lineNumber - 1 }
			});
		});
		return chip;
	}

	/** Puce d'un événement Google : barre colorée selon l'agenda, heure, pas de case à cocher. */
	private renderEventChip(container: HTMLElement, ev: GoogleCalendarEvent, variant: 'mini' | 'card' | 'row', day: string): HTMLElement {
		const key = eventKey(ev);
		const color = this.calendarColor(ev.calendarId);
		const role = this.legend.find(l => l.id === ev.calendarId)?.role || 'primary';
		const chip = container.createDiv({ cls: `sbm-tcal-chip sbm-tcal-event variant-${variant} role-${role}` });
		chip.dataset.key = key;
		chip.style.setProperty('--chip-accent', color);
		if (ev.allDay) chip.addClass('is-allday');
		const span = eventDaySpan(ev);
		if (span && span.first !== span.last) chip.addClass('is-multiday');
		const endMs = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : null;
		if ((endMs !== null && endMs < Date.now()) || (span && span.last < this.today)) chip.addClass('is-past-event');
		if (this.flash && this.flash.key === key && Date.now() < this.flash.until) chip.addClass('is-landed');

		const time = formatEventTime(ev, day);
		chip.createSpan({ cls: `sbm-tcal-event-time ${time.continues ? 'is-continuation' : ''}`, text: time.label });

		const content = chip.createDiv({ cls: 'sbm-tcal-chip-content' });
		content.createDiv({ cls: 'sbm-tcal-chip-title', text: ev.summary || '(Sans titre)' });
		if (variant !== 'mini') {
			const meta = content.createDiv({ cls: 'sbm-tcal-chip-meta' });
			if (!ev.allDay) meta.createSpan({ cls: 'sbm-tcal-meta', text: formatEventRange(ev) });
			if (ev.location) meta.createSpan({ cls: 'sbm-tcal-meta file', text: `📍 ${ev.location}` });
			const cal = this.legend.find(l => l.id === ev.calendarId);
			if (cal && cal.role !== 'primary') meta.createSpan({ cls: 'sbm-tcal-meta calendar', text: cal.ownerName || cal.name });
		}

		this.attachPeek(chip, this.fillEventPeek(ev));
		chip.addEventListener('pointerdown', (e) => this.onChipPointerDown(e, { event: ev, eventDay: day }, chip));
		chip.addEventListener('click', () => {
			if (Date.now() < this.suppressClickUntil) return;
			this.hidePeek();
			this.openEventModal(ev);
		});
		chip.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.drag?.active) return;
			this.cancelDrag();
			this.hidePeek();
			this.openEventMenu(e, ev, day);
		});
		return chip;
	}

	/** Puce d'une entrée de note quotidienne : heure, texte, case à cocher s'il s'agit d'une tâche. */
	private renderEntryChip(container: HTMLElement, entry: DailyEntry, variant: 'mini' | 'card' | 'row'): HTMLElement {
		const key = entryKey(entry);
		const chip = container.createDiv({ cls: `sbm-tcal-chip sbm-tcal-event sbm-tcal-entry variant-${variant}` });
		chip.dataset.key = key;
		if (this.flash && this.flash.key === key && Date.now() < this.flash.until) chip.addClass('is-landed');
		const bounds = entryBounds(entry, this.entryDuration());
		if (entry.date < this.today || (entry.date === this.today && bounds.end <= new Date().getHours() * 60 + new Date().getMinutes())) {
			chip.addClass('is-past-event');
		}

		if (entry.statusChar !== undefined) {
			const type = TaskStatusRegistry.typeOf(entry.statusChar);
			if (type === 'DONE' || type === 'CANCELLED') chip.addClass('is-done');
			const task = this.taskForEntry(entry);
			const check = chip.createEl('button', { cls: 'sbm-tcal-check' });
			if (type === 'DONE') setIcon(check, 'check');
			else if (type === 'CANCELLED') check.addClass('is-cancelled');
			else if (entry.statusChar !== ' ') check.createSpan({ cls: 'sbm-tcal-check-symbol', text: entry.statusChar });
			check.addEventListener('pointerdown', (e) => e.stopPropagation());
			check.addEventListener('click', (e) => {
				e.stopPropagation();
				if (task) this.toggleTask(task, chip, check);
			});
			if (!task) check.disabled = true;
		}

		chip.createSpan({ cls: 'sbm-tcal-event-time', text: formatClock(entry.start) });
		const content = chip.createDiv({ cls: 'sbm-tcal-chip-content' });
		content.createDiv({ cls: 'sbm-tcal-chip-title', text: this.entryTitle(entry) });
		if (variant !== 'mini') {
			const meta = content.createDiv({ cls: 'sbm-tcal-chip-meta' });
			if (entry.end !== null && entry.end !== entry.start) meta.createSpan({ cls: 'sbm-tcal-meta', text: this.entryRangeLabel(entry) });
			meta.createSpan({ cls: 'sbm-tcal-meta calendar', text: 'Note du jour' });
		}

		this.attachPeek(chip, this.fillEntryPeek(entry));
		chip.addEventListener('pointerdown', (e) => this.onChipPointerDown(e, { entry }, chip));
		chip.addEventListener('click', (e) => {
			if (Date.now() < this.suppressClickUntil) return;
			this.hidePeek();
			if (e.ctrlKey || e.metaKey) void this.openEntryNote(entry, true);
			else this.openEntryModal(entry);
		});
		chip.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.drag?.active) return;
			this.cancelDrag();
			this.hidePeek();
			this.openEntryMenu(e, entry);
		});
		return chip;
	}

	/** Titre lisible : liens simplifiés et, si demandé, tags retirés (ils restent visibles dans l'aperçu). */
	private displayTitle(title: string, stripTags = false): string {
		const base = stripTags ? title.replace(/(^|\s)#[^\s#]+/g, '$1') : title;
		return base
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/\s+/g, ' ')
			.trim() || '(sans titre)';
	}

	/* ======================================================================
	   Actions sur les tâches
	   ====================================================================== */

	private async openTask(task: ObsidianTask, newTab = false): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(task.filePath));
		if (!(file instanceof TFile)) return;
		const leaf = newTab ? this.app.workspace.getLeaf('tab') : this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: task.lineNumber - 1 } });
	}

	/** Clic sur la case : passe au statut suivant défini dans Tasks (terminée, ou étape suivante). */
	private async toggleTask(task: ObsidianTask, chip: HTMLElement, check: HTMLElement): Promise<void> {
		const next = TaskStatusRegistry.nextSymbol(task.statusChar);
		const nextType = TaskStatusRegistry.typeOf(next);
		this.showOptimisticStatus(chip, check, next);

		// Signale une action utilisateur pour la gamification (récompense en pièces)
		if (nextType === 'DONE') this.plugin.recordUserCheckboxInteraction(task.filePath);

		const result = await this.writer.toggle(task);
		if (result === null) {
			new Notice(`Impossible de retrouver la tâche : ${task.title}`);
			await this.refresh();
		} else if (nextType !== 'DONE' && result !== ' ') {
			new Notice(`Statut : [${result}] ${TaskStatusRegistry.nameOf(result)}`, 2000);
		}
	}

	/** Terminer / rouvrir explicitement (menu contextuel), quel que soit le statut suivant. */
	private async setTaskDone(task: ObsidianTask, chip: HTMLElement, done: boolean): Promise<void> {
		const check = chip.querySelector('.sbm-tcal-check') as HTMLElement;
		this.showOptimisticStatus(chip, check, done ? TaskStatusRegistry.firstSymbolOfType('DONE', 'x') : ' ');
		if (done) this.plugin.recordUserCheckboxInteraction(task.filePath);
		const ok = await this.writer.setCompleted(task, done);
		if (!ok) {
			new Notice(`Impossible de retrouver la tâche : ${task.title}`);
			await this.refresh();
		}
	}

	/** Statut choisi dans le menu : écrit le symbole en gérant les dates comme Tasks. */
	private async setTaskStatus(task: ObsidianTask, chip: HTMLElement, symbol: string): Promise<void> {
		const check = chip.querySelector('.sbm-tcal-check') as HTMLElement;
		this.showOptimisticStatus(chip, check, symbol);
		if (TaskStatusRegistry.typeOf(symbol) === 'DONE') this.plugin.recordUserCheckboxInteraction(task.filePath);
		await this.mutate(task, line => {
			const current = /^\s*[-*+]\s+\[(.)\]/.exec(line)?.[1] ?? ' ';
			return TaskWriter.applyStatus(line, current, symbol, this.plugin.settings);
		}, `Statut : [${symbol}] ${TaskStatusRegistry.nameOf(symbol)}`);
	}

	private showOptimisticStatus(chip: HTMLElement, check: HTMLElement | null, symbol: string): void {
		const type = TaskStatusRegistry.typeOf(symbol);
		const done = type === 'DONE';
		chip.toggleClass('is-done', done || type === 'CANCELLED');
		chip.addClass('is-toggling');
		if (!check) return;
		check.empty();
		check.toggleClass('is-cancelled', type === 'CANCELLED');
		if (done) setIcon(check, 'check');
		else if (symbol !== ' ' && type !== 'CANCELLED') check.createSpan({ cls: 'sbm-tcal-check-symbol', text: symbol });
		check.setAttribute('aria-checked', String(done));
	}

	private async setTaskDate(task: ObsidianTask, date: string | null): Promise<boolean> {
		if (this.state.dateField === 'scheduled' && task.scheduledDate) {
			return this.writer.setScheduledDate(task, date);
		}
		return this.writer.setDueDate(task, date);
	}

	/** Déplacement optimiste : l'interface bouge tout de suite, le fichier suit. */
	private async moveTask(task: ObsidianTask, date: string | null): Promise<void> {
		const current = getTaskDate(task, this.state.dateField);
		if (current === date) return;

		const usesScheduled = this.state.dateField === 'scheduled' && Boolean(task.scheduledDate);
		const previous = usesScheduled ? task.scheduledDate : task.dueDate;
		if (usesScheduled) task.scheduledDate = date || undefined;
		else task.dueDate = date || undefined;

		this.flash = { key: taskKey(task), until: Date.now() + 900 };
		this.renderPreservingScroll();

		const ok = await this.setTaskDate(task, date);
		if (!ok) {
			if (usesScheduled) task.scheduledDate = previous;
			else task.dueDate = previous;
			new Notice(`Impossible de modifier la tâche : ${task.title}`);
			this.renderPreservingScroll();
			return;
		}
		new Notice(date ? `📅 ${this.displayTitle(task.title)} → ${CalendarDate.relativeLabel(date, this.today)}` : `🧹 Date retirée : ${this.displayTitle(task.title)}`, 2500);
	}

	private async mutate(task: ObsidianTask, fn: (line: string) => string, success?: string): Promise<void> {
		const res = await this.writer.mutate(task, fn);
		if (res === null) new Notice(`Impossible de retrouver la tâche : ${task.title}`);
		else if (success) new Notice(success, 2500);
	}

	private openTaskMenu(e: MouseEvent, task: ObsidianTask, chip: HTMLElement): void {
		const settings = this.plugin.settings;
		const menu = new Menu();
		const paused = Boolean(task.isPaused || task.status === 'paused');
		const date = getTaskDate(task, this.state.dateField);

		menu.addItem(i => i.setTitle('Ouvrir la note').setIcon('file-text').onClick(() => this.openTask(task)));
		menu.addItem(i => i.setTitle('Ouvrir dans un nouvel onglet').setIcon('file-plus').onClick(() => this.openTask(task, true)));
		menu.addSeparator();

		menu.addItem(i => i.setTitle(task.completed ? 'Rouvrir' : 'Terminer').setIcon(task.completed ? 'rotate-ccw' : 'check-circle-2').onClick(() => {
			void this.setTaskDone(task, chip, !task.completed);
		}));
		menu.addItem(i => i.setTitle(`Statut : [${task.statusChar}] ${TaskStatusRegistry.nameOf(task.statusChar)}…`).setIcon('list-checks').onClick(() => {
			// Second menu avec tous les statuts de Tasks
			const statusMenu = new Menu();
			TaskStatusRegistry.all().filter(st => st.type !== 'NON_TASK').forEach(st => {
				statusMenu.addItem(si => si.setTitle(`[${st.symbol}] ${st.name}`).setChecked(st.symbol === task.statusChar).onClick(() => {
					if (st.symbol !== task.statusChar) void this.setTaskStatus(task, chip, st.symbol);
				}));
			});
			statusMenu.showAtMouseEvent(e);
		}));
		if (!task.completed) {
			menu.addItem(i => i.setTitle(paused ? 'Reprendre' : 'Mettre en pause').setIcon(paused ? 'play' : 'pause').onClick(() =>
				this.mutate(task, l => TaskMutator.setPaused(l, !paused, settings), paused ? '▶️ Tâche reprise' : '⏸️ Tâche en pause')));
		}
		menu.addSeparator();

		const nextMonday = CalendarDate.addDays(CalendarDate.startOfWeek(this.today), 7);
		const dateChoices: Array<[string, string, string]> = [
			['Aujourd\'hui', 'sun', this.today],
			['Demain', 'sunrise', CalendarDate.addDays(this.today, 1)],
			[`Lundi prochain (${CalendarDate.format(nextMonday, { day: 'numeric', month: 'short' })})`, 'calendar-range', nextMonday],
			['Dans une semaine', 'calendar-plus', CalendarDate.addDays(date || this.today, 7)]
		];
		dateChoices.forEach(([label, icon, value]) => {
			if (value === date) return;
			menu.addItem(i => i.setTitle(label).setIcon(icon).onClick(() => this.moveTask(task, value)));
		});
		menu.addItem(i => i.setTitle('Choisir une date…').setIcon('calendar-days').onClick(() => {
			this.popover.open(chip, {
				title: 'Nouvelle date',
				type: 'date',
				initialValue: date || this.today,
				onSubmit: (val) => this.moveTask(task, CalendarDate.normalize(val))
			});
		}));
		if (date) menu.addItem(i => i.setTitle('Retirer la date').setIcon('calendar-x').onClick(() => this.moveTask(task, null)));
		menu.addSeparator();

		menu.addItem(i => i.setTitle(`Priorité…${task.priority && task.priority !== 'normal' ? ` (${PRIORITY_ICONS[task.priority] || ''})` : ''}`).setIcon('flag').onClick(() => {
			this.popover.open(chip, {
				title: 'Priorité',
				type: 'priority-select',
				initialValue: task.priority || 'normal',
				onSubmit: (val) => this.mutate(task, l => TaskMutator.setPriority(l, val as TaskPriority, settings), 'Priorité mise à jour')
			});
		}));
		menu.addItem(i => i.setTitle(`Énergie…${task.energy ? ` (⚡${task.energy})` : ''}`).setIcon('zap').onClick(() => {
			this.popover.open(chip, {
				title: 'Énergie requise (1-10)',
				type: 'number',
				initialValue: String(task.energy || 3),
				min: 1,
				max: 10,
				onSubmit: (val) => {
					const n = parseInt(val, 10);
					if (!isNaN(n)) this.mutate(task, l => TaskMutator.setControlledTag(l, 'energie', Math.max(1, Math.min(10, n)), settings), `Énergie : ⚡${n}`);
				}
			});
		}));
		if (this.plugin.isFeatureEnabled('gamification')) menu.addItem(i => i.setTitle(`Pièces…${task.pieces ? ` (🪙${task.pieces})` : ''}`).setIcon('coins').onClick(() => {
			this.popover.open(chip, {
				title: 'Récompense en pièces',
				type: 'number',
				initialValue: String(task.pieces || 1),
				min: 1,
				max: 100,
				onSubmit: (val) => {
					const n = parseInt(val, 10);
					if (!isNaN(n)) this.mutate(task, l => TaskMutator.setControlledTag(l, 'pieces', Math.max(1, n), settings), `Récompense : 🪙${n}`);
				}
			});
		}));

		if (MatrixFeature.isEnabled()) {
			const adapter = MatrixAdapterFactory.createAdapter(settings.matrixProvider, settings.customMatrixMapping);
			const currentQuad = adapter.getQuadrant(task);
			menu.addSeparator();
			(['q1', 'q2', 'q3', 'q4'] as MatrixQuadrant[]).forEach(q => {
				menu.addItem(i => i.setTitle(QUADRANT_LABELS[q as string]).setIcon('grid-2x2').setChecked(currentQuad === q).onClick(() =>
					this.mutate(task, l => adapter.setQuadrant(l, currentQuad === q ? null : q), currentQuad === q ? 'Quadrant retiré' : `Classée en ${String(q).toUpperCase()}`)));
			});
		}
		menu.addSeparator();

		menu.addItem(i => {
			i.setTitle('Supprimer la tâche').setIcon('trash-2').onClick(() => {
				new ConfirmModal(this.app, `Supprimer « ${this.displayTitle(task.title)} » ?`, 'La ligne et ses sous-tâches seront retirées de la note.', async () => {
					const ok = await this.writer.deleteTask(task);
					new Notice(ok ? `🗑️ Tâche supprimée : ${this.displayTitle(task.title)}` : `Impossible de retrouver la tâche : ${task.title}`);
				}).open();
			});
			(i as unknown as { setWarning?: (w: boolean) => void }).setWarning?.(true);
		});

		menu.showAtMouseEvent(e);
	}

	private promptNewTask(day: string, anchorEl: HTMLElement): void {
		this.popover.open(anchorEl, {
			title: `Nouvelle tâche · ${CalendarDate.relativeLabel(day, this.today)}`,
			type: 'text',
			placeholder: 'Que faut-il faire ? [[note]] #tag',
			initialValue: '',
			attachSuggest: (input) => new LinkTagSuggest(this.app, input),
			onSubmit: (val) => this.createTask(val, day)
		});
	}

	/** Ajoute la tâche dans la note quotidienne du jour (créée si besoin). */
	private async createTask(title: string, day: string): Promise<void> {
		const clean = title.trim();
		if (!clean) return;
		const settings = this.plugin.settings;
		const line = this.state.dateField === 'scheduled'
			? TaskMutator.setScheduledDate(`- [ ] ${clean}`, day, settings)
			: TaskMutator.setDueDate(`- [ ] ${clean}`, day, settings);
		try {
			const vaultContext = new VaultContextService(this.app, settings);
			const daily = await vaultContext.getOrCreateDailyNote(this.today, settings.dailyNoteTemplatePath);
			if (!daily.file) throw new Error('note quotidienne introuvable');
			await this.app.vault.process(daily.file, (content) => {
				const eol = content.includes('\r\n') ? '\r\n' : '\n';
				const trimmed = content.replace(/\s+$/, '');
				return `${trimmed}${trimmed ? eol : ''}${line}${eol}`;
			});
			new Notice(`✅ Tâche ajoutée à ${daily.file.basename}`, 2500);
		} catch (err) {
			new Notice(`Impossible de créer la tâche : ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/* ======================================================================
	   Glisser-déposer (pointer events : souris, stylet et tactile)
	   ====================================================================== */

	private onChipPointerDown(e: PointerEvent, item: DragItem, chip: HTMLElement): void {
		if (e.button !== 0 || this.drag) return;
		this.hidePeek();
		const rect = chip.getBoundingClientRect();
		this.drag = {
			...item,
			sourceEl: chip,
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			lastX: e.clientX,
			lastY: e.clientY,
			offsetX: e.clientX - rect.left,
			offsetY: e.clientY - rect.top,
			pointerType: e.pointerType,
			active: false
		};

		if (e.pointerType !== 'mouse') {
			// Tactile : appui long pour attraper la tâche, sinon on laisse défiler
			this.drag.holdTimer = window.setTimeout(() => {
				if (this.drag && !this.drag.active) this.startDrag();
			}, 260);
		}

		document.addEventListener('pointermove', this.onPointerMove, { passive: false });
		document.addEventListener('pointerup', this.onPointerUp);
		document.addEventListener('pointercancel', this.onPointerCancel);
		document.addEventListener('keydown', this.onDragKey, true);
		document.addEventListener('touchmove', this.onTouchMove, { passive: false });
	}

	private onTouchMove = (e: TouchEvent): void => {
		if (this.drag?.active) e.preventDefault();
	};

	private onPointerMove = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		d.lastX = e.clientX;
		d.lastY = e.clientY;
		const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);

		if (!d.active) {
			if (d.pointerType === 'mouse') {
				if (dist > 5) this.startDrag();
			} else if (dist > 10) {
				// L'utilisateur fait défiler : on abandonne
				this.cancelDrag();
			}
			return;
		}

		e.preventDefault();
		this.positionGhost(e.clientX, e.clientY);
		this.updateDropTarget(e.clientX, e.clientY);
		this.autoScroll();
	};

	private onPointerUp = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		if (!d.active) {
			this.cleanupDrag();
			return;
		}
		const target = d.target;
		const { task, event, eventDay, entry } = d;
		this.suppressClickUntil = Date.now() + 250;
		this.cleanupDrag();

		if (target && target.dataset.dropDate !== undefined) {
			const date = target.dataset.dropDate || null;
			if (event && eventDay && date) void this.moveEvent(event, CalendarDate.diffDays(eventDay, date));
			else if (entry && date) {
				// Déposée dans la grille horaire : l'entrée prend l'heure visée
				if (target.dataset.gridDay) {
					const start = Math.min(1440 - GRID_SNAP, this.minuteAt(target, d.lastY));
					const duration = entry.end !== null && entry.end > entry.start ? entry.end - entry.start : null;
					void this.moveEntry(entry, date, start, duration !== null ? Math.min(1440, start + duration) : null);
				} else {
					void this.moveEntry(entry, date, entry.start, entry.end);
				}
			}
			else if (task) void this.moveTask(task, date);
		} else if (this.pendingRender) {
			this.renderPreservingScroll();
		}
	};

	private onPointerCancel = (): void => this.cancelDrag();

	private onDragKey = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.drag) {
			e.preventDefault();
			e.stopPropagation();
			this.cancelDrag();
		}
	};

	private startDrag(): void {
		const d = this.drag;
		if (!d) return;
		d.active = true;
		this.popover.close();

		const rect = d.sourceEl.getBoundingClientRect();
		const ghost = d.sourceEl.cloneNode(true) as HTMLElement;
		ghost.addClass('sbm-tcal-ghost');
		ghost.removeClass('is-landed');
		ghost.style.width = `${Math.min(Math.max(rect.width, 160), 320)}px`;
		const label = ghost.createDiv({ cls: 'sbm-tcal-ghost-label' });
		d.ghostLabel = label;
		document.body.appendChild(ghost);
		d.ghost = ghost;
		d.offsetX = Math.min(d.offsetX, Math.min(Math.max(rect.width, 160), 320) - 12);

		d.sourceEl.addClass('is-drag-source');
		this.rootEl.addClass('is-dragging');
		document.body.addClass('sbm-tcal-dragging');
		if (navigator.vibrate && d.pointerType === 'touch') {
			try { navigator.vibrate(12); } catch { /* ignore */ }
		}

		this.positionGhost(d.lastX, d.lastY);
		this.updateDropTarget(d.lastX, d.lastY);
	}

	private positionGhost(x: number, y: number): void {
		const d = this.drag;
		if (!d?.ghost) return;
		d.ghost.style.transform = `translate3d(${x - d.offsetX}px, ${y - d.offsetY}px, 0) rotate(-1.5deg)`;
	}

	private updateDropTarget(x: number, y: number): void {
		const d = this.drag;
		if (!d) return;
		const el = document.elementFromPoint(x, y) as HTMLElement | null;
		const inView = el && this.rootEl.contains(el);

		// Survol des flèches : change de période après un court délai
		const nav = inView ? el.closest<HTMLElement>('[data-drop-nav]') : null;
		if (nav !== d.navTarget) {
			if (d.navTimer) window.clearTimeout(d.navTimer);
			d.navTarget?.removeClass('is-drop-nav');
			d.navTarget = nav;
			if (nav) {
				nav.addClass('is-drop-nav');
				const dir = Number(nav.dataset.dropNav);
				const repeat = () => {
					if (!this.drag || this.drag.navTarget !== nav) return;
					this.shiftDuringDrag(dir);
					this.drag.navTimer = window.setTimeout(repeat, 800);
				};
				d.navTimer = window.setTimeout(repeat, 550);
			}
		}

		const target = inView ? el.closest<HTMLElement>('[data-drop-date]') : null;
		if (target === d.target) return;
		d.target?.removeClass('is-drop-target');
		d.target = target;

		if (!target) {
			d.ghostLabel?.setText('');
			d.ghost?.removeClass('has-target');
			return;
		}
		target.addClass('is-drop-target');
		const date = target.dataset.dropDate || null;
		// Un événement ou une entrée de note quotidienne ne peut pas être « sans date »
		if ((d.event || d.entry) && !date) {
			target.removeClass('is-drop-target');
			d.target = null;
			d.ghostLabel?.setText('');
			d.ghost?.removeClass('has-target');
			return;
		}
		const current = d.event ? d.eventDay || null : d.entry ? d.entry.date : getTaskDate(d.task as ObsidianTask, this.state.dateField);
		const same = date === current;
		d.ghost?.toggleClass('has-target', !same);
		d.ghostLabel?.setText(same ? '' : date ? `→ ${CalendarDate.relativeLabel(date, this.today)}` : '→ Sans date');
	}

	/** Change de période pendant un glisser sans casser la session. */
	private shiftDuringDrag(dir: number): void {
		const d = this.drag;
		if (!d) return;
		d.target = null;
		this.shift(dir);
		// La source a été détruite par le rendu : on la remplace si elle est encore visible
		const key = d.event ? eventKey(d.event) : d.entry ? entryKey(d.entry) : taskKey(d.task as ObsidianTask);
		const fresh = this.rootEl.querySelector<HTMLElement>(`.sbm-tcal-chip[data-key="${CSS.escape(key)}"]`);
		if (fresh) {
			fresh.addClass('is-drag-source');
			d.sourceEl = fresh;
		}
		this.rootEl.addClass('is-dragging');
		this.updateDropTarget(d.lastX, d.lastY);
	}

	private autoScroll(): void {
		const d = this.drag;
		if (!d || d.scrollRaf) return;
		const step = () => {
			const drag = this.drag;
			if (!drag?.active) return;
			drag.scrollRaf = undefined;
			const el = document.elementFromPoint(drag.lastX, drag.lastY) as HTMLElement | null;
			const scroller = el?.closest<HTMLElement>('[data-scroll-id], [data-scroll-axis="x"]');
			if (!scroller || !this.rootEl.contains(scroller)) return;
			const rect = scroller.getBoundingClientRect();
			if (scroller.dataset.scrollAxis === 'x') {
				const xEdge = 36;
				let dx = 0;
				if (drag.lastX < rect.left + xEdge) dx = -Math.ceil((rect.left + xEdge - drag.lastX) / 3);
				else if (drag.lastX > rect.right - xEdge) dx = Math.ceil((drag.lastX - (rect.right - xEdge)) / 3);
				if (dx !== 0) {
					scroller.scrollLeft += dx;
					this.updateDropTarget(drag.lastX, drag.lastY);
					drag.scrollRaf = window.requestAnimationFrame(step);
				}
				return;
			}
			const edge = 48;
			let dy = 0;
			if (drag.lastY < rect.top + edge) dy = -Math.ceil((rect.top + edge - drag.lastY) / 4);
			else if (drag.lastY > rect.bottom - edge) dy = Math.ceil((drag.lastY - (rect.bottom - edge)) / 4);
			if (dy !== 0) {
				scroller.scrollTop += dy;
				this.updateDropTarget(drag.lastX, drag.lastY);
				drag.scrollRaf = window.requestAnimationFrame(step);
			}
		};
		d.scrollRaf = window.requestAnimationFrame(step);
	}

	private cancelDrag(): void {
		if (!this.drag) return;
		const wasActive = this.drag.active;
		this.cleanupDrag();
		if (wasActive) this.suppressClickUntil = Date.now() + 250;
		if (this.pendingRender) this.renderPreservingScroll();
	}

	private cleanupDrag(): void {
		const d = this.drag;
		if (!d) return;
		if (d.holdTimer) window.clearTimeout(d.holdTimer);
		if (d.navTimer) window.clearTimeout(d.navTimer);
		if (d.scrollRaf) window.cancelAnimationFrame(d.scrollRaf);
		d.ghost?.remove();
		d.target?.removeClass('is-drop-target');
		d.navTarget?.removeClass('is-drop-nav');
		d.sourceEl.removeClass('is-drag-source');
		this.rootEl?.removeClass('is-dragging');
		document.body.removeClass('sbm-tcal-dragging');
		document.removeEventListener('pointermove', this.onPointerMove);
		document.removeEventListener('pointerup', this.onPointerUp);
		document.removeEventListener('pointercancel', this.onPointerCancel);
		document.removeEventListener('keydown', this.onDragKey, true);
		document.removeEventListener('touchmove', this.onTouchMove);
		this.drag = null;
	}

	/* ======================================================================
	   Ruban des jours défilant (mode compact)
	   Une fenêtre de STRIP_SPAN jours est rendue ; elle est recentrée
	   silencieusement quand on approche d'un bord, ce qui donne un défilement infini.
	   ====================================================================== */

	private renderStrip(buckets: Map<string, ObsidianTask[]>): void {
		const previousVisible = this.stripFirstVisible;
		const target = this.stripPendingTarget || this.stripFirstVisible || CalendarDate.startOfWeek(this.state.anchor);
		this.stripPendingTarget = null;

		// Recentre la fenêtre si la cible en sort (ou s'approche trop d'un bord)
		const offset = this.stripOrigin ? CalendarDate.diffDays(this.stripOrigin, target) : -1;
		if (!this.stripOrigin || offset < STRIP_EDGE || offset > STRIP_SPAN - 7 - STRIP_EDGE) {
			this.stripOrigin = CalendarDate.addDays(target, -STRIP_LEAD);
		}

		const wrap = this.bodyEl.createDiv({ cls: 'sbm-tcal-strip-wrap' });
		const strip = wrap.createDiv({ cls: 'sbm-tcal-strip' });
		strip.dataset.scrollAxis = 'x';
		this.stripEl = strip;
		this.stripBuckets = buckets;
		this.fillStrip();

		strip.addEventListener('scroll', () => this.onStripScroll(), { passive: true });
		strip.addEventListener('wheel', (e) => this.onStripWheel(e), { passive: false });
		this.attachStripPan(strip);

		// Position initiale : on part de l'ancienne position puis on glisse en douceur vers la cible
		window.requestAnimationFrame(() => {
			if (this.stripEl !== strip) return;
			const animate = Boolean(previousVisible && previousVisible !== target);
			this.scrollStripTo(previousVisible && animate ? previousVisible : target, false);
			if (animate) this.scrollStripTo(target, true);
			this.stripFirstVisible = target;
			this.updateStripTitle();
		});
	}

	private fillStrip(): void {
		const strip = this.stripEl;
		const origin = this.stripOrigin;
		if (!strip || !origin) return;
		strip.empty();
		for (let i = 0; i < STRIP_SPAN; i++) {
			const day = CalendarDate.addDays(origin, i);
			const dayTasks = this.stripBuckets.get(day) || [];
			const pill = strip.createDiv({ cls: 'sbm-tcal-pill' });
			this.decorateDayCell(pill, day);
			if (day === this.state.anchor) pill.addClass('is-selected');
			if (CalendarDate.weekdayIndex(day) === 0) pill.addClass('is-week-start');
			if (day.endsWith('-01')) pill.addClass('is-month-start');
			const name = day.endsWith('-01')
				? CalendarDate.format(day, { month: 'short' }).replace('.', '')
				: CalendarDate.format(day, { weekday: 'narrow' });
			pill.createDiv({ cls: 'sbm-tcal-pill-name', text: name });
			pill.createDiv({ cls: 'sbm-tcal-pill-num', text: String(Number(day.slice(8))) });
			this.renderDots(pill, dayTasks, this.eventBuckets.get(day) || [], this.dayEntries(day).length);
			pill.addEventListener('click', () => {
				if (Date.now() < this.suppressClickUntil) return;
				this.state.anchor = day;
				this.saveState();
				this.renderPreservingScroll();
				if (this.state.compactMode !== 'day') this.scrollToDay(day);
			});
		}
	}

	/** Largeur d'un jour dans le ruban (pastille + espacement). */
	private stripStep(): number {
		const strip = this.stripEl;
		if (!strip) return 1;
		const pills = strip.children;
		if (pills.length >= 2) {
			const step = (pills[1] as HTMLElement).offsetLeft - (pills[0] as HTMLElement).offsetLeft;
			if (step > 0) return step;
		}
		return Math.max(1, strip.clientWidth / 7);
	}

	private scrollStripTo(day: string, smooth: boolean): void {
		const strip = this.stripEl;
		if (!strip || !this.stripOrigin) return;
		const left = CalendarDate.diffDays(this.stripOrigin, day) * this.stripStep();
		strip.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
	}

	private firstVisibleIndex(): number {
		const strip = this.stripEl;
		if (!strip) return 0;
		return Math.round(strip.scrollLeft / this.stripStep());
	}

	private onStripScroll(): void {
		const strip = this.stripEl;
		if (!strip || !this.stripOrigin) return;
		const idx = this.firstVisibleIndex();
		this.stripFirstVisible = CalendarDate.addDays(this.stripOrigin, idx);
		this.updateStripTitle();

		// Prolonge le ruban une fois le défilement terminé (évite les à-coups pendant le geste)
		if (this.stripIdleTimer) window.clearTimeout(this.stripIdleTimer);
		this.stripIdleTimer = window.setTimeout(() => {
			this.stripIdleTimer = undefined;
			this.wheelTargetIdx = null;
			this.extendStripIfNeeded();
		}, 140);
	}

	private extendStripIfNeeded(): void {
		const strip = this.stripEl;
		if (!strip || !this.stripOrigin || this.stripPanning) return;
		const idx = this.firstVisibleIndex();
		if (idx >= STRIP_EDGE && idx <= STRIP_SPAN - 7 - STRIP_EDGE) return;
		const first = CalendarDate.addDays(this.stripOrigin, idx);
		this.stripOrigin = CalendarDate.addDays(first, -STRIP_LEAD);
		this.fillStrip();
		strip.scrollLeft = STRIP_LEAD * this.stripStep();
		if (this.drag?.active) this.updateDropTarget(this.drag.lastX, this.drag.lastY);
	}

	/** Molette verticale → un jour par cran ; défilement horizontal natif (pavé tactile) conservé. */
	private onStripWheel(e: WheelEvent): void {
		const strip = this.stripEl;
		if (!strip) return;
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
		e.preventDefault();
		const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * strip.clientWidth : e.deltaY;
		this.wheelAccumulator += px;
		const threshold = Math.abs(px) >= 50 ? 1 : 40;
		if (Math.abs(this.wheelAccumulator) < threshold) return;
		const days = Math.abs(px) >= 50 ? Math.sign(this.wheelAccumulator) : Math.trunc(this.wheelAccumulator / 40);
		this.wheelAccumulator = 0;
		if (this.wheelTargetIdx === null) this.wheelTargetIdx = this.firstVisibleIndex();
		this.wheelTargetIdx += days;
		strip.scrollTo({ left: this.wheelTargetIdx * this.stripStep(), behavior: 'smooth' });
	}

	/** Glisser à la souris pour faire défiler le ruban (le tactile utilise le défilement natif). */
	private attachStripPan(strip: HTMLElement): void {
		let startX = 0;
		let startLeft = 0;
		let pointerId: number | null = null;

		strip.addEventListener('pointerdown', (e) => {
			if (e.pointerType !== 'mouse' || e.button !== 0 || this.drag) return;
			pointerId = e.pointerId;
			startX = e.clientX;
			startLeft = strip.scrollLeft;
		});
		strip.addEventListener('pointermove', (e) => {
			if (pointerId !== e.pointerId) return;
			const dx = e.clientX - startX;
			if (!this.stripPanning && Math.abs(dx) > 5) {
				this.stripPanning = true;
				strip.addClass('is-panning');
				strip.setPointerCapture(e.pointerId);
			}
			if (this.stripPanning) strip.scrollLeft = startLeft - dx;
		});
		const end = (e: PointerEvent) => {
			if (pointerId !== e.pointerId) return;
			pointerId = null;
			if (!this.stripPanning) return;
			this.stripPanning = false;
			this.suppressClickUntil = Date.now() + 250;
			strip.removeClass('is-panning');
			if (strip.hasPointerCapture(e.pointerId)) strip.releasePointerCapture(e.pointerId);
			strip.scrollTo({ left: this.firstVisibleIndex() * this.stripStep(), behavior: 'smooth' });
		};
		strip.addEventListener('pointerup', end);
		strip.addEventListener('pointercancel', end);
	}

	/** Le titre suit le mois des jours visibles dans le ruban. */
	private updateStripTitle(): void {
		if (this.layout !== 'compact' || this.state.miniMonthOpen || !this.titleTextEl || !this.stripFirstVisible) return;
		const first = this.stripFirstVisible;
		const last = CalendarDate.addDays(first, 6);
		const text = first.slice(0, 7) === last.slice(0, 7)
			? CalendarDate.format(first, { month: 'long', year: 'numeric' })
			: first.slice(0, 4) === last.slice(0, 4)
				? `${CalendarDate.format(first, { month: 'short' })} – ${CalendarDate.format(last, { month: 'short', year: 'numeric' })}`
				: `${CalendarDate.format(first, { month: 'short', year: 'numeric' })} – ${CalendarDate.format(last, { month: 'short', year: 'numeric' })}`;
		this.titleTextEl.setText(text);
	}
}

class ConfirmModal extends Modal {
	constructor(app: App, private heading: string, private message: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createEl('p', { text: this.message });
		const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = row.createEl('button', { text: 'Annuler' });
		cancel.addEventListener('click', () => this.close());
		const ok = row.createEl('button', { text: 'Supprimer', cls: 'mod-warning' });
		ok.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
		window.setTimeout(() => ok.focus(), 30);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
