import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App } from 'obsidian';
import { GoogleCalendarEvent, CalendarViewType } from '../models/googleCalendar';
import { GoogleCalendarService } from '../services/googleCalendarService';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_CALENDAR = 'sbm-calendar-view';

export class CalendarView extends ItemView {
	private plugin: SecondBrainPlugin;
	private currentViewMode: CalendarViewType = 'day';
	private currentDate: Date = new Date();
	private miniCalMonth: Date = new Date();
	private allMonthEvents: GoogleCalendarEvent[] = [];
	private monthlyEventsMap: Map<string, GoogleCalendarEvent[]> = new Map();
	private isLoading = false;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.miniCalMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
	}

	getViewType(): string {
		return VIEW_TYPE_CALENDAR;
	}

	getDisplayText(): string {
		return 'Agenda Google';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen(): Promise<void> {
		await this.refreshEvents();
	}

	public async refreshEvents(): Promise<void> {
		this.isLoading = true;
		await this.render();

		if (this.plugin.settings.googleRefreshToken && this.plugin.settings.googleClientId && this.plugin.settings.googleClientSecret) {
			try {
				const year = this.miniCalMonth.getFullYear();
				const month = this.miniCalMonth.getMonth();
				const startOfMonth = new Date(year, month, 1);
				const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

				// Période couvrant tout le mois visible avec marges
				const timeMin = new Date(startOfMonth.getTime() - 7 * 86400000).toISOString();
				const timeMax = new Date(endOfMonth.getTime() + 14 * 86400000).toISOString();

				this.allMonthEvents = await GoogleCalendarService.getEvents(this.plugin.settings, {
					timeMin,
					timeMax
				});

				// Indexation par date YYYY-MM-DD
				this.monthlyEventsMap.clear();
				this.allMonthEvents.forEach(ev => {
					const dateKey = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : '');
					if (dateKey) {
						if (!this.monthlyEventsMap.has(dateKey)) {
							this.monthlyEventsMap.set(dateKey, []);
						}
						this.monthlyEventsMap.get(dateKey)!.push(ev);
					}
				});
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn('[Second Brain Manager] Erreur chargement agenda:', err);
				new Notice(`Erreur Google Calendar: ${msg}`);
			}
		}

		this.isLoading = false;
		await this.render();
	}

	private getEventsForCurrentView(): GoogleCalendarEvent[] {
		const { timeMin, timeMax } = this.calculateDateRange();
		const minStr = timeMin.toISOString().split('T')[0];
		const maxStr = timeMax.toISOString().split('T')[0];

		return this.allMonthEvents.filter(ev => {
			const evDate = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : '');
			return evDate >= minStr && evDate <= maxStr;
		});
	}

	private calculateDateRange(): { timeMin: Date; timeMax: Date } {
		const base = new Date(this.currentDate);
		base.setHours(0, 0, 0, 0);

		if (this.currentViewMode === 'day') {
			const timeMin = new Date(base);
			const timeMax = new Date(base);
			timeMax.setHours(23, 59, 59, 999);
			return { timeMin, timeMax };
		} else if (this.currentViewMode === 'week') {
			const dayOfWeek = (base.getDay() + 6) % 7; // Lundi = 0
			const timeMin = new Date(base);
			timeMin.setDate(timeMin.getDate() - dayOfWeek);
			const timeMax = new Date(timeMin);
			timeMax.setDate(timeMax.getDate() + 6);
			timeMax.setHours(23, 59, 59, 999);
			return { timeMin, timeMax };
		} else {
			// Planning : 14 prochains jours
			const timeMin = new Date(base);
			const timeMax = new Date(base);
			timeMax.setDate(timeMax.getDate() + 14);
			timeMax.setHours(23, 59, 59, 999);
			return { timeMin, timeMax };
		}
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('sbm-calendar-view-container');

		// 1. Header avec navigation et contrôles
		const headerEl = container.createDiv({ cls: 'sbm-calendar-header' });

		const navRow = headerEl.createDiv({ cls: 'sbm-calendar-nav-row' });
		
		const titleGroup = navRow.createDiv({ cls: 'sbm-calendar-title-group' });
		const calIcon = titleGroup.createSpan({ cls: 'sbm-calendar-header-icon' });
		setIcon(calIcon, 'calendar');
		titleGroup.createEl('h3', { text: 'Agenda Google', cls: 'sbm-calendar-main-title' });

		const controlsGroup = navRow.createDiv({ cls: 'sbm-calendar-controls-group' });

		// Boutons de navigation temporelle
		const prevBtn = controlsGroup.createEl('button', { cls: 'sbm-cal-nav-btn', title: 'Précédent' });
		setIcon(prevBtn, 'chevron-left');
		prevBtn.addEventListener('click', async () => {
			this.navigateTime(-1);
			await this.refreshEvents();
		});

		const todayBtn = controlsGroup.createEl('button', { cls: 'sbm-cal-nav-btn sbm-cal-today-btn', text: 'Aujourd\'hui' });
		todayBtn.addEventListener('click', async () => {
			this.currentDate = new Date();
			this.miniCalMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
			await this.refreshEvents();
		});

		const nextBtn = controlsGroup.createEl('button', { cls: 'sbm-cal-nav-btn', title: 'Suivant' });
		setIcon(nextBtn, 'chevron-right');
		nextBtn.addEventListener('click', async () => {
			this.navigateTime(1);
			await this.refreshEvents();
		});

		// Sélecteur de mode de vue (Jour / Semaine / Planning)
		const modeGroup = controlsGroup.createDiv({ cls: 'sbm-cal-mode-selector' });
		const modes: Array<{ id: CalendarViewType; label: string }> = [
			{ id: 'day', label: 'Jour' },
			{ id: 'week', label: 'Semaine' },
			{ id: 'schedule', label: 'Planning' }
		];

		modes.forEach(m => {
			const btn = modeGroup.createEl('button', {
				cls: `sbm-cal-mode-btn ${this.currentViewMode === m.id ? 'is-active' : ''}`,
				text: m.label
			});
			btn.addEventListener('click', async () => {
				this.currentViewMode = m.id;
				await this.refreshEvents();
			});
		});

		// Bouton Ajouter Événement
		const addEventBtn = controlsGroup.createEl('button', { cls: 'sbm-cal-action-btn mod-cta', title: 'Ajouter un événement' });
		setIcon(addEventBtn, 'plus');
		addEventBtn.createSpan({ text: 'Événement' });
		addEventBtn.addEventListener('click', () => {
			const selectedDateStr = this.formatDateKey(this.currentDate);
			new CalendarEventModal(this.app, this.plugin, undefined, selectedDateStr, async () => {
				await this.refreshEvents();
			}).open();
		});

		// Bouton Actualiser
		const refreshBtn = controlsGroup.createEl('button', { cls: 'sbm-cal-action-btn', title: 'Actualiser l\'agenda' });
		setIcon(refreshBtn, 'rotate-cw');
		if (this.isLoading) refreshBtn.addClass('is-loading');
		refreshBtn.addEventListener('click', async () => {
			await this.refreshEvents();
		});

		// 2. Corps de la vue
		const bodyEl = container.createDiv({ cls: 'sbm-calendar-body' });

		if (!this.plugin.settings.googleRefreshToken) {
			this.renderNotConnectedCard(bodyEl);
			return;
		}

		// Rendu du Mini-Calendrier interactif compact (idéal pour sidebar)
		this.renderMiniCalendar(bodyEl);

		if (this.isLoading) {
			const loadingEl = bodyEl.createDiv({ cls: 'sbm-cal-loading-state' });
			loadingEl.createDiv({ cls: 'sbm-cal-spinner' });
			loadingEl.createSpan({ text: 'Chargement des événements...' });
			return;
		}

		// 3. Section des événements affichés en dessous du calendrier
		const eventsSection = bodyEl.createDiv({ cls: 'sbm-cal-events-container' });

		const periodHeader = eventsSection.createDiv({ cls: 'sbm-calendar-date-label-row' });
		periodHeader.createSpan({ text: this.getPeriodDisplayLabel(), cls: 'sbm-calendar-period-label' });

		const visibleEvents = this.getEventsForCurrentView();

		if (visibleEvents.length === 0) {
			const emptyEl = eventsSection.createDiv({ cls: 'sbm-cal-empty-state' });
			setIcon(emptyEl.createDiv({ cls: 'sbm-cal-empty-icon' }), 'calendar-x');
			emptyEl.createEl('h4', { text: 'Aucun événement pour cette date' });
			emptyEl.createEl('p', { text: 'Votre agenda est totalement libre.' });
			const createBtn = emptyEl.createEl('button', { cls: 'mod-cta', text: '➕ Créer un événement' });
			createBtn.addEventListener('click', () => {
				const selectedDateStr = this.formatDateKey(this.currentDate);
				new CalendarEventModal(this.app, this.plugin, undefined, selectedDateStr, async () => {
					await this.refreshEvents();
				}).open();
			});
			return;
		}

		this.renderEventsList(eventsSection, visibleEvents);
	}

	/**
	 * Rendu du mini-calendrier mensuel compact adapté à la barre latérale
	 */
	private renderMiniCalendar(parentEl: HTMLElement): void {
		const miniCalWrap = parentEl.createDiv({ cls: 'sbm-mini-cal-wrapper' });

		// En-tête du mini-calendrier (Mois Année + Navigation)
		const miniHeader = miniCalWrap.createDiv({ cls: 'sbm-mini-cal-header' });

		const prevMonthBtn = miniHeader.createEl('button', { cls: 'sbm-mini-cal-nav-btn', title: 'Mois précédent' });
		setIcon(prevMonthBtn, 'chevron-left');
		prevMonthBtn.addEventListener('click', async () => {
			this.miniCalMonth.setMonth(this.miniCalMonth.getMonth() - 1);
			await this.refreshEvents();
		});

		const monthLabel = miniHeader.createSpan({ cls: 'sbm-mini-cal-month-label' });
		const monthName = this.miniCalMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
		monthLabel.setText(monthName.charAt(0).toUpperCase() + monthName.slice(1));
		monthLabel.addEventListener('click', async () => {
			this.currentDate = new Date();
			this.miniCalMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
			await this.refreshEvents();
		});

		const nextMonthBtn = miniHeader.createEl('button', { cls: 'sbm-mini-cal-nav-btn', title: 'Mois suivant' });
		setIcon(nextMonthBtn, 'chevron-right');
		nextMonthBtn.addEventListener('click', async () => {
			this.miniCalMonth.setMonth(this.miniCalMonth.getMonth() + 1);
			await this.refreshEvents();
		});

		// Grille des jours
		const grid = miniCalWrap.createDiv({ cls: 'sbm-mini-cal-grid' });

		// En-têtes (Lu, Ma, Me...)
		const dayNames = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
		dayNames.forEach(name => {
			grid.createDiv({ cls: 'sbm-mini-cal-day-name', text: name });
		});

		const year = this.miniCalMonth.getFullYear();
		const month = this.miniCalMonth.getMonth();
		const firstDayOfMonth = new Date(year, month, 1);
		const lastDayOfMonth = new Date(year, month + 1, 0);

		const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // Lundi = 0

		const todayStr = this.formatDateKey(new Date());
		const selectedStr = this.formatDateKey(this.currentDate);

		// Jours du mois précédent
		const prevMonthLastDay = new Date(year, month, 0).getDate();
		for (let i = startDayOfWeek - 1; i >= 0; i--) {
			const dayNum = prevMonthLastDay - i;
			const cellDate = new Date(year, month - 1, dayNum);
			this.renderMiniCalCell(grid, cellDate, true, todayStr, selectedStr);
		}

		// Jours du mois en cours
		for (let dayNum = 1; dayNum <= lastDayOfMonth.getDate(); dayNum++) {
			const cellDate = new Date(year, month, dayNum);
			this.renderMiniCalCell(grid, cellDate, false, todayStr, selectedStr);
		}

		// Jours du mois suivant
		const totalRendered = startDayOfWeek + lastDayOfMonth.getDate();
		const remaining = (7 - (totalRendered % 7)) % 7;
		for (let dayNum = 1; dayNum <= remaining; dayNum++) {
			const cellDate = new Date(year, month + 1, dayNum);
			this.renderMiniCalCell(grid, cellDate, true, todayStr, selectedStr);
		}
	}

	private renderMiniCalCell(
		gridEl: HTMLElement,
		date: Date,
		isOtherMonth: boolean,
		todayStr: string,
		selectedStr: string
	): void {
		const dateStr = this.formatDateKey(date);
		const dayEvents = this.monthlyEventsMap.get(dateStr) || [];
		const hasEvents = dayEvents.length > 0;
		const isToday = dateStr === todayStr;
		const isSelected = dateStr === selectedStr;

		const cell = gridEl.createDiv({
			cls: `sbm-mini-cal-cell ${isOtherMonth ? 'is-other-month' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${hasEvents ? 'has-events' : ''}`
		});

		// Numéro du jour
		cell.createSpan({ cls: 'sbm-mini-cal-day-num', text: String(date.getDate()) });

		// Point(s) indicateur(s) d'événements
		if (hasEvents) {
			const dotsWrap = cell.createDiv({ cls: 'sbm-mini-cal-dots' });
			const dotCount = Math.min(dayEvents.length, 3);
			for (let i = 0; i < dotCount; i++) {
				dotsWrap.createSpan({ cls: 'sbm-mini-cal-dot' });
			}

			const eventSummaries = dayEvents.map(e => `• ${e.summary}`).join('\n');
			cell.title = `${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}\n${dayEvents.length} événement(s) :\n${eventSummaries}`;
		} else {
			cell.title = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
		}

		// Clic sur la date -> Déplace la sélection sur ce jour et bascule en mode Jour
		cell.addEventListener('click', async () => {
			this.currentDate = new Date(date);
			this.currentViewMode = 'day';
			await this.refreshEvents();
		});
	}

	private formatDateKey(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	private navigateTime(direction: number): void {
		if (this.currentViewMode === 'day') {
			this.currentDate.setDate(this.currentDate.getDate() + direction);
		} else if (this.currentViewMode === 'week') {
			this.currentDate.setDate(this.currentDate.getDate() + direction * 7);
		} else {
			this.currentDate.setDate(this.currentDate.getDate() + direction * 14);
		}
		this.miniCalMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
	}

	private getPeriodDisplayLabel(): string {
		const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
		if (this.currentViewMode === 'day') {
			const isToday = this.formatDateKey(this.currentDate) === this.formatDateKey(new Date());
			const formatted = this.currentDate.toLocaleDateString('fr-FR', options);
			const title = formatted.charAt(0).toUpperCase() + formatted.slice(1);
			return isToday ? `📍 Aujourd'hui (${title})` : `📅 ${title}`;
		} else if (this.currentViewMode === 'week') {
			const { timeMin, timeMax } = this.calculateDateRange();
			const startStr = timeMin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
			const endStr = timeMax.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
			return `Semaine du ${startStr} au ${endStr}`;
		} else {
			const { timeMin, timeMax } = this.calculateDateRange();
			const startStr = timeMin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
			const endStr = timeMax.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
			return `Planning du ${startStr} au ${endStr}`;
		}
	}

	private renderNotConnectedCard(parentEl: HTMLElement): void {
		const card = parentEl.createDiv({ cls: 'sbm-cal-connect-card' });
		const iconSpan = card.createDiv({ cls: 'sbm-cal-connect-icon' });
		setIcon(iconSpan, 'calendar-off');

		card.createEl('h3', { text: 'Google Calendar non connecté' });
		card.createEl('p', {
			text: 'Connectez votre compte Google pour permettre à l\'IA de consulter votre agenda et de visualiser vos événements ici.'
		});

		const actionsRow = card.createDiv({ cls: 'sbm-cal-connect-actions' });

		const hasCredentials = !!(this.plugin.settings.googleClientId && this.plugin.settings.googleClientSecret);

		if (hasCredentials) {
			const loginBtn = actionsRow.createEl('button', {
				cls: 'mod-cta sbm-cal-login-btn',
				text: '🔗 Se connecter à Google Calendar'
			});
			loginBtn.addEventListener('click', async () => {
				loginBtn.disabled = true;
				loginBtn.setText('⏳ Connexion en cours...');
				await GoogleCalendarService.startGoogleLogin(this.plugin, async (success) => {
					loginBtn.disabled = false;
					loginBtn.setText('🔗 Se connecter à Google Calendar');
					if (success) {
						await this.refreshEvents();
					}
				});
			});
		}

		const settingsBtn = actionsRow.createEl('button', {
			text: hasCredentials ? '⚙️ Réglages Google Calendar' : '⚙️ Renseigner Client ID & Secret dans les Réglages',
			cls: hasCredentials ? '' : 'mod-cta'
		});
		settingsBtn.addEventListener('click', () => {
			(this.app as any).setting?.open?.();
			(this.app as any).setting?.openTabById?.(this.plugin.manifest.id);
		});
	}

	private renderEventsList(parentEl: HTMLElement, eventsToRender: GoogleCalendarEvent[]): void {
		// Groupement des événements par date (YYYY-MM-DD)
		const grouped = new Map<string, GoogleCalendarEvent[]>();

		eventsToRender.forEach(ev => {
			const dateKey = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : 'Sans date');
			if (!grouped.has(dateKey)) {
				grouped.set(dateKey, []);
			}
			grouped.get(dateKey)!.push(ev);
		});

		const sortedDates = Array.from(grouped.keys()).sort();

		sortedDates.forEach(dateKey => {
			const dayEvents = grouped.get(dateKey)!;
			const daySection = parentEl.createDiv({ cls: 'sbm-cal-day-section' });

			// En-tête du jour (si plusieurs jours affichés comme en mode semaine)
			if (this.currentViewMode !== 'day') {
				const dayHeader = daySection.createDiv({ cls: 'sbm-cal-day-header' });
				let headerLabel = dateKey;
				try {
					const d = new Date(`${dateKey}T00:00:00`);
					const formatted = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
					headerLabel = formatted.charAt(0).toUpperCase() + formatted.slice(1);
				} catch {
					// fallback
				}

				const isToday = dateKey === this.formatDateKey(new Date());
				dayHeader.createSpan({ cls: `sbm-cal-day-title ${isToday ? 'is-today' : ''}`, text: isToday ? `📍 Aujourd'hui (${headerLabel})` : headerLabel });
				dayHeader.createSpan({ cls: 'sbm-cal-day-count', text: `${dayEvents.length} événement${dayEvents.length > 1 ? 's' : ''}` });
			}

			// Cartes d'événements du jour
			const eventsGrid = daySection.createDiv({ cls: 'sbm-cal-events-grid' });

			dayEvents.forEach(ev => {
				this.renderEventCard(eventsGrid, ev);
			});
		});
	}

	private renderEventCard(parentEl: HTMLElement, ev: GoogleCalendarEvent): void {
		const card = parentEl.createDiv({ cls: 'sbm-cal-event-card' });

		// Horaires
		let timeStr = 'Toute la journée';
		if (ev.start.dateTime && ev.end.dateTime) {
			const startTime = new Date(ev.start.dateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
			const endTime = new Date(ev.end.dateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
			timeStr = `${startTime} - ${endTime}`;
		}

		card.createSpan({ cls: `sbm-cal-time-badge ${ev.allDay ? 'all-day' : ''}`, text: timeStr });

		const contentWrap = card.createDiv({ cls: 'sbm-cal-card-content' });
		contentWrap.createEl('h4', { cls: 'sbm-cal-card-title', text: ev.summary });

		if (ev.location) {
			const locSpan = contentWrap.createDiv({ cls: 'sbm-cal-location-pill' });
			setIcon(locSpan.createSpan({ cls: 'sbm-cal-loc-icon' }), 'map-pin');
			locSpan.createSpan({ text: ev.location });
		}

		if (ev.description) {
			contentWrap.createDiv({ cls: 'sbm-cal-desc-preview', text: ev.description.slice(0, 120) });
		}

		if (ev.calendarName) {
			contentWrap.createSpan({ cls: 'sbm-cal-source-badge', text: `📅 ${ev.calendarName}` });
		}

		// Actions rapides
		const actionsWrap = card.createDiv({ cls: 'sbm-cal-card-actions' });

		const editBtn = actionsWrap.createEl('button', { cls: 'sbm-cal-item-action-btn', title: 'Modifier' });
		setIcon(editBtn, 'edit-2');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new CalendarEventModal(this.app, this.plugin, ev, undefined, async () => {
				await this.refreshEvents();
			}).open();
		});

		const deleteBtn = actionsWrap.createEl('button', { cls: 'sbm-cal-item-action-btn is-delete', title: 'Supprimer' });
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (window.confirm(`Voulez-vous supprimer l'événement "${ev.summary}" de Google Calendar ?`)) {
				try {
					await GoogleCalendarService.deleteEvent(this.plugin.settings, ev.id, ev.calendarId);
					new Notice(`Événement "${ev.summary}" supprimé.`);
					await this.refreshEvents();
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					new Notice(`Erreur lors de la suppression: ${msg}`);
				}
			}
		});

		if (ev.htmlLink) {
			const linkBtn = actionsWrap.createEl('a', { cls: 'sbm-cal-item-action-btn', href: ev.htmlLink, title: 'Ouvrir dans Google Calendar' });
			setIcon(linkBtn, 'external-link');
		}
	}
}

export class CalendarEventModal extends Modal {
	private plugin: SecondBrainPlugin;
	private existingEvent?: GoogleCalendarEvent;
	private presetDate?: string;
	private onSaved: () => Promise<void>;

	private titleInput!: HTMLInputElement;
	private startDateInput!: HTMLInputElement;
	private startTimeInput!: HTMLInputElement;
	private endDateInput!: HTMLInputElement;
	private endTimeInput!: HTMLInputElement;
	private allDayToggle!: HTMLInputElement;
	private locationInput!: HTMLInputElement;
	private descInput!: HTMLTextAreaElement;

	constructor(app: App, plugin: SecondBrainPlugin, existingEvent?: GoogleCalendarEvent, presetDate?: string, onSaved?: () => Promise<void>) {
		super(app);
		this.plugin = plugin;
		this.existingEvent = existingEvent;
		this.presetDate = presetDate;
		this.onSaved = onSaved || (async () => {});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sbm-cal-event-modal');

		const isEdit = !!this.existingEvent;
		contentEl.createEl('h2', { text: isEdit ? 'Modifier l\'événement Google Calendar' : 'Nouvel événement Google Calendar' });

		const form = contentEl.createEl('form', { cls: 'sbm-cal-event-form' });

		// Titre
		const titleGroup = form.createDiv({ cls: 'sbm-form-group' });
		titleGroup.createEl('label', { text: 'Titre de l\'événement *' });
		this.titleInput = titleGroup.createEl('input', { type: 'text', placeholder: 'Ex: Rendez-vous client, Point d\'équipe...', value: this.existingEvent?.summary || '' });
		this.titleInput.required = true;

		// Date & Heure
		const now = new Date();
		const defaultDate = this.presetDate || now.toISOString().split('T')[0];
		const defaultTime = `${String(now.getHours()).padStart(2, '0')}:00`;

		const defaultStartDateTime = this.existingEvent?.start.dateTime;
		const defaultStartDate = this.existingEvent?.start.date || (defaultStartDateTime ? defaultStartDateTime.split('T')[0] : defaultDate);
		const defaultStartTime = defaultStartDateTime ? defaultStartDateTime.split('T')[1].slice(0, 5) : defaultTime;

		const isAllDayInit = this.existingEvent ? this.existingEvent.allDay : false;

		const allDayRow = form.createDiv({ cls: 'sbm-form-group-inline' });
		this.allDayToggle = allDayRow.createEl('input', { type: 'checkbox', id: 'sbm-cal-all-day' });
		this.allDayToggle.checked = isAllDayInit;
		allDayRow.createEl('label', { text: 'Événement sur toute la journée', attr: { for: 'sbm-cal-all-day' } });

		const startRow = form.createDiv({ cls: 'sbm-form-row' });
		const startDateGroup = startRow.createDiv({ cls: 'sbm-form-group' });
		startDateGroup.createEl('label', { text: 'Date de début *' });
		this.startDateInput = startDateGroup.createEl('input', { type: 'date', value: defaultStartDate });

		const startTimeGroup = startRow.createDiv({ cls: 'sbm-form-group' });
		startTimeGroup.createEl('label', { text: 'Heure de début' });
		this.startTimeInput = startTimeGroup.createEl('input', { type: 'time', value: defaultStartTime });
		if (isAllDayInit) startTimeGroup.style.display = 'none';

		this.allDayToggle.addEventListener('change', () => {
			startTimeGroup.style.display = this.allDayToggle.checked ? 'none' : 'block';
		});

		// Lieu
		const locGroup = form.createDiv({ cls: 'sbm-form-group' });
		locGroup.createEl('label', { text: 'Lieu ou lien de réunion' });
		this.locationInput = locGroup.createEl('input', { type: 'text', placeholder: 'Ex: Bureau, Zoom, Paris...', value: this.existingEvent?.location || '' });

		// Description
		const descGroup = form.createDiv({ cls: 'sbm-form-group' });
		descGroup.createEl('label', { text: 'Description / Ordre du jour' });
		this.descInput = descGroup.createEl('textarea', { placeholder: 'Notes, détails...', rows: 3 });
		this.descInput.value = this.existingEvent?.description || '';

		// Boutons
		const actionsRow = form.createDiv({ cls: 'sbm-modal-actions-row' });
		const cancelBtn = actionsRow.createEl('button', { type: 'button', text: 'Annuler' });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = actionsRow.createEl('button', { type: 'submit', cls: 'mod-cta', text: isEdit ? '💾 Enregistrer les modifications' : '➕ Créer l\'événement' });

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const summary = this.titleInput.value.trim();
			if (!summary) {
				new Notice('Le titre de l\'événement est obligatoire.');
				return;
			}

			saveBtn.disabled = true;
			saveBtn.setText('Enregistrement...');

			try {
				const isAllDay = this.allDayToggle.checked;
				const startDate = this.startDateInput.value;
				const startTime = isAllDay ? undefined : this.startTimeInput.value;

				if (this.existingEvent) {
					await GoogleCalendarService.updateEvent(this.plugin.settings, this.existingEvent.id, {
						summary,
						startDate,
						startTime,
						location: this.locationInput.value.trim() || undefined,
						description: this.descInput.value.trim() || undefined,
						calendarId: this.existingEvent.calendarId
					});
					new Notice(`Événement "${summary}" mis à jour.`);
				} else {
					await GoogleCalendarService.createEvent(this.plugin.settings, {
						summary,
						startDate,
						startTime,
						location: this.locationInput.value.trim() || undefined,
						description: this.descInput.value.trim() || undefined
					});
					new Notice(`Événement "${summary}" créé dans Google Calendar.`);
				}

				this.close();
				await this.onSaved();
			} catch (err: unknown) {
				saveBtn.disabled = false;
				saveBtn.setText(isEdit ? 'Enregistrer' : 'Créer');
				const msg = err instanceof Error ? err.message : String(err);
				new Notice(`Erreur: ${msg}`);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
