import { Menu, Notice, setIcon } from 'obsidian';
import { CalendarLegendEntry } from '../services/calendarEventsService';
import {
	CalendarFilter,
	CalendarFilterPreset,
	DEFAULT_CALENDAR_FILTER,
	GOOGLE_ONLY_PRESETS,
	ROLE_LABELS,
	isPresetModified,
	restoreDefaultPreset,
	activeTaskGroups,
	isCalendarVisible,
	newPresetId,
	sameFilter,
	soloCalendar,
	taskGroupOptions,
	toggleCalendarInFilter,
	toggleRoleInFilter
} from '../services/calendarFilters';

export interface FilterPopoverHost {
	getFilter(): CalendarFilter;
	setFilter(filter: CalendarFilter): void;
	legend(): CalendarLegendEntry[];
	googleReady(): boolean;
	entriesAvailable(): boolean;
	matrixEnabled(): boolean;
	/** Tous les préréglages, par défaut compris (liste modifiable) */
	presets(): CalendarFilterPreset[];
	savePresets(presets: CalendarFilterPreset[]): Promise<void>;
	/** Préréglage appliqué à l'ouverture du calendrier ('' : derniers filtres utilisés) */
	startupPresetId(): string;
	setStartupPresetId(id: string): Promise<void>;
}

/**
 * Panneau des filtres du calendrier : préréglages, types affichés, agendas et catégories de tâches.
 * Chaque clic s'applique tout de suite ; le panneau reste ouvert pour enchaîner les réglages.
 */
export class CalendarFilterPopover {
	private el: HTMLElement | null = null;
	private anchor: HTMLElement | null = null;
	/** Saisie d'un nom : nouveau préréglage, ou renommage d'un préréglage existant */
	private naming: { id: string | null } | null = null;
	/** Mode édition des préréglages : un clic ouvre le menu au lieu d'appliquer */
	private editingPresets = false;
	private cleanup: Array<() => void> = [];

	constructor(private host: FilterPopoverHost) {}

	isOpen(): boolean {
		return this.el !== null;
	}

	toggle(anchor: HTMLElement): void {
		if (this.el) this.close();
		else this.open(anchor);
	}

	open(anchor: HTMLElement): void {
		this.close();
		this.anchor = anchor;
		const doc = anchor.ownerDocument;
		this.el = doc.body.createDiv({ cls: 'sbm-tcal-filter-pop' });
		this.el.setAttribute('role', 'dialog');
		this.el.setAttribute('aria-label', 'Filtres du calendrier');
		this.render();
		this.position();

		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target || this.el?.contains(target) || target.closest('.sbm-tcal-filter-btn')) return;
			// Les menus d'Obsidian ouverts depuis le panneau ne le ferment pas
			if (target.closest('.menu, .modal-container')) return;
			this.close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				this.close();
				this.anchor?.focus();
			}
		};
		const onResize = () => this.position();
		doc.addEventListener('pointerdown', onPointerDown, true);
		doc.addEventListener('keydown', onKey, true);
		doc.defaultView?.addEventListener('resize', onResize);
		this.cleanup.push(() => {
			doc.removeEventListener('pointerdown', onPointerDown, true);
			doc.removeEventListener('keydown', onKey, true);
			doc.defaultView?.removeEventListener('resize', onResize);
		});
		window.requestAnimationFrame(() => this.el?.addClass('is-visible'));
	}

	close(): void {
		this.cleanup.forEach(fn => fn());
		this.cleanup = [];
		this.el?.remove();
		this.el = null;
		this.naming = null;
		this.editingPresets = false;
	}

	/** Le calendrier a été redessiné : nouvelle ancre (bouton recréé) et contenu à jour. */
	refresh(anchor?: HTMLElement | null): void {
		if (!this.el) return;
		if (anchor) this.anchor = anchor;
		this.render();
		this.position();
	}

	private apply(filter: CalendarFilter): void {
		this.host.setFilter(filter);
		this.render();
	}

	private position(): void {
		if (!this.el || !this.anchor) return;
		const win = this.anchor.ownerDocument.defaultView || window;
		const rect = this.anchor.getBoundingClientRect();
		const width = Math.min(340, win.innerWidth - 16);
		this.el.style.width = `${width}px`;
		const left = Math.max(8, Math.min(rect.right - width, win.innerWidth - width - 8));
		const top = rect.bottom + 6;
		this.el.style.left = `${left}px`;
		this.el.style.top = `${top}px`;
		this.el.style.maxHeight = `${Math.max(200, win.innerHeight - top - 12)}px`;
	}

	/* ----- Rendu ----- */

	private render(): void {
		const el = this.el;
		if (!el) return;
		const scroll = el.scrollTop;
		el.empty();
		const filter = this.host.getFilter();

		const head = el.createDiv({ cls: 'sbm-tcal-filter-head' });
		head.createSpan({ cls: 'sbm-tcal-filter-title', text: 'Filtres' });
		const reset = head.createEl('button', { cls: 'sbm-tcal-filter-reset', text: 'Tout afficher' });
		reset.disabled = sameFilter(filter, DEFAULT_CALENDAR_FILTER);
		reset.addEventListener('click', () => this.apply({ ...DEFAULT_CALENDAR_FILTER }));

		this.renderPresets(el, filter);
		this.renderTypes(el, filter);
		if (this.host.googleReady() && this.host.legend().length) this.renderCalendars(el, filter);
		if (filter.showTasks) this.renderTaskGroups(el, filter);

		el.scrollTop = scroll;
	}

	private section(parent: HTMLElement, title: string, hint?: string): HTMLElement {
		const sec = parent.createDiv({ cls: 'sbm-tcal-filter-section' });
		const h = sec.createDiv({ cls: 'sbm-tcal-filter-section-title', text: title });
		if (hint) h.createSpan({ cls: 'sbm-tcal-filter-hint', text: hint });
		return sec;
	}

	private chip(parent: HTMLElement, label: string, opts: { active: boolean; icon?: string; color?: string; title?: string; onClick: () => void }): HTMLButtonElement {
		const b = parent.createEl('button', { cls: 'sbm-tcal-filter-chip' });
		b.toggleClass('is-active', opts.active);
		b.setAttribute('aria-pressed', String(opts.active));
		if (opts.color) {
			const dot = b.createSpan({ cls: 'sbm-tcal-filter-dot' });
			dot.style.setProperty('--dot-color', opts.color);
		} else if (opts.icon) {
			setIcon(b.createSpan({ cls: 'sbm-tcal-filter-chip-icon' }), opts.icon);
		}
		b.createSpan({ text: label });
		if (opts.title) b.title = opts.title;
		b.addEventListener('click', opts.onClick);
		return b;
	}

	private renderPresets(parent: HTMLElement, filter: CalendarFilter): void {
		const sec = parent.createDiv({ cls: 'sbm-tcal-filter-section' });
		const title = sec.createDiv({ cls: 'sbm-tcal-filter-section-title', text: 'Préréglages' });
		const all = this.host.presets();
		const google = this.host.googleReady();
		const presets = all.filter(p => google || !GOOGLE_ONLY_PRESETS.has(p.id));

		if (presets.length) {
			const toggle = title.createEl('button', { cls: 'sbm-tcal-filter-edit', text: this.editingPresets ? 'Terminé' : 'Modifier' });
			toggle.title = this.editingPresets ? 'Revenir à l’application des préréglages' : 'Renommer, mettre à jour, réordonner ou supprimer les préréglages (ou clic droit sur un préréglage)';
			toggle.addEventListener('click', () => {
				this.editingPresets = !this.editingPresets;
				this.naming = null;
				this.render();
			});
		}

		const row = sec.createDiv({ cls: 'sbm-tcal-filter-chips' });
		row.toggleClass('is-editing', this.editingPresets);
		for (const preset of presets) {
			const active = sameFilter(filter, preset.filter);
			const chip = this.chip(row, preset.name, {
				active: active && !this.editingPresets,
				icon: preset.icon || 'bookmark',
				title: this.editingPresets ? 'Modifier ce préréglage' : undefined,
				onClick: () => {
					if (this.editingPresets) return;
					this.apply({ ...preset.filter });
				}
			});
			chip.addClass('is-preset');
			if (preset.id === this.host.startupPresetId()) {
				chip.addClass('is-startup');
				chip.title = `${chip.title ? `${chip.title} · ` : ''}Appliqué à l’ouverture du calendrier`;
			}
			if (this.editingPresets) {
				setIcon(chip.createSpan({ cls: 'sbm-tcal-filter-chip-more' }), 'more-horizontal');
				chip.addEventListener('click', (e) => this.openPresetMenu(e, preset, filter));
			}
			chip.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this.openPresetMenu(e, preset, filter);
			});
		}

		const matches = presets.some(p => sameFilter(filter, p.filter));
		if (!this.naming && !this.editingPresets) {
			const add = this.chip(row, 'Enregistrer…', {
				active: false,
				icon: 'plus',
				title: 'Enregistrer les filtres actuels comme préréglage',
				onClick: () => {
					this.naming = { id: null };
					this.render();
				}
			});
			add.addClass('is-add');
			add.disabled = matches;
			if (matches) add.title = 'Ces filtres correspondent déjà à un préréglage';
		}
		if (this.naming) this.renderNameForm(sec, filter);
	}

	/** Menu d'un préréglage : mettre à jour, renommer, déplacer, rétablir, supprimer. */
	private openPresetMenu(e: MouseEvent, preset: CalendarFilterPreset, filter: CalendarFilter): void {
		e.stopPropagation();
		const all = this.host.presets();
		const idx = all.findIndex(p => p.id === preset.id);
		const save = async (next: CalendarFilterPreset[], notice: string) => {
			await this.host.savePresets(next);
			new Notice(notice);
			this.render();
		};
		const menu = new Menu();
		menu.addItem(i => i
			.setTitle('Remplacer par les filtres actuels')
			.setIcon('refresh-cw')
			.setDisabled(sameFilter(filter, preset.filter))
			.onClick(() => void save(all.map(p => p.id === preset.id ? { ...p, filter: { ...filter } } : p), `« ${preset.name} » mis à jour avec les filtres actuels`)));
		menu.addItem(i => i.setTitle('Renommer…').setIcon('pencil').onClick(() => {
			this.naming = { id: preset.id };
			this.render();
		}));
		const isStartup = this.host.startupPresetId() === preset.id;
		menu.addItem(i => i
			.setTitle('Appliquer à l’ouverture du calendrier')
			.setIcon('power')
			.setChecked(isStartup)
			.onClick(async () => {
				await this.host.setStartupPresetId(isStartup ? '' : preset.id);
				new Notice(isStartup ? 'Le calendrier s’ouvrira avec les derniers filtres utilisés' : `Le calendrier s’ouvrira avec « ${preset.name} »`);
				this.render();
			}));
		menu.addSeparator();
		menu.addItem(i => i.setTitle('Déplacer vers la gauche').setIcon('arrow-left').setDisabled(idx <= 0).onClick(() => {
			const next = [...all];
			[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
			void save(next, `« ${preset.name} » déplacé`);
		}));
		menu.addItem(i => i.setTitle('Déplacer vers la droite').setIcon('arrow-right').setDisabled(idx === -1 || idx >= all.length - 1).onClick(() => {
			const next = [...all];
			[next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
			void save(next, `« ${preset.name} » déplacé`);
		}));
		if (preset.builtin) {
			menu.addSeparator();
			menu.addItem(i => i
				.setTitle('Rétablir le préréglage d’origine')
				.setIcon('rotate-ccw')
				.setDisabled(!isPresetModified(preset))
				.onClick(() => void save(restoreDefaultPreset(all, preset.id), `« ${preset.name} » rétabli`)));
		}
		menu.addSeparator();
		menu.addItem(i => {
			i.setTitle('Supprimer').setIcon('trash-2').onClick(async () => {
				if (isStartup) await this.host.setStartupPresetId('');
				await save(all.filter(p => p.id !== preset.id), `Préréglage « ${preset.name} » supprimé${preset.builtin ? ' (rétablissable dans les réglages)' : ''}`);
			});
			(i as unknown as { setWarning?: (w: boolean) => void }).setWarning?.(true);
		});
		menu.showAtMouseEvent(e);
	}

	/** Champ de nom : enregistrer les filtres actuels comme nouveau préréglage, ou renommer. */
	private renderNameForm(sec: HTMLElement, filter: CalendarFilter): void {
		const naming = this.naming;
		if (!naming) return;
		const all = this.host.presets();
		const renaming = naming.id ? all.find(p => p.id === naming.id) : undefined;
		const form = sec.createDiv({ cls: 'sbm-tcal-filter-save' });
		const input = form.createEl('input', { type: 'text', cls: 'sbm-tcal-filter-save-input' });
		input.placeholder = 'Nom du préréglage';
		if (renaming) input.value = renaming.name;
		const ok = form.createEl('button', { cls: 'mod-cta', text: renaming ? 'Renommer' : 'Enregistrer' });
		const cancel = form.createEl('button', { text: 'Annuler' });
		const close = () => {
			this.naming = null;
			this.render();
		};
		const submit = async () => {
			const name = input.value.trim();
			if (!name) {
				input.focus();
				return;
			}
			if (renaming) {
				await this.host.savePresets(all.map(p => p.id === renaming.id ? { ...p, name } : p));
				new Notice(`Préréglage renommé en « ${name} »`);
			} else {
				const preset: CalendarFilterPreset = { id: newPresetId(), name, filter: { ...filter } };
				await this.host.savePresets([...all, preset]);
				new Notice(`Préréglage « ${name} » enregistré`);
			}
			close();
		};
		ok.addEventListener('click', () => void submit());
		cancel.addEventListener('click', close);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void submit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				close();
			}
		});
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	private renderTypes(parent: HTMLElement, filter: CalendarFilter): void {
		const sec = this.section(parent, 'Afficher');
		const row = sec.createDiv({ cls: 'sbm-tcal-filter-chips' });
		this.chip(row, 'Tâches', { active: filter.showTasks, icon: 'list-checks', onClick: () => this.apply({ ...filter, showTasks: !filter.showTasks }) });
		this.chip(row, 'Terminées', { active: filter.showDone, icon: 'check-circle-2', title: 'Tâches et entrées terminées ou annulées', onClick: () => this.apply({ ...filter, showDone: !filter.showDone }) });
		if (this.host.entriesAvailable()) {
			this.chip(row, 'Entrées', { active: filter.showEntries, icon: 'clock', title: 'Lignes horodatées des notes quotidiennes', onClick: () => this.apply({ ...filter, showEntries: !filter.showEntries }) });
		}
		if (this.host.googleReady()) {
			this.chip(row, 'Événements', { active: filter.showEvents, icon: 'calendar', title: 'Événements Google Agenda', onClick: () => this.apply({ ...filter, showEvents: !filter.showEvents }) });
		}
	}

	private renderCalendars(parent: HTMLElement, filter: CalendarFilter): void {
		const legend = this.host.legend();
		const sec = this.section(parent, 'Agendas Google');
		sec.toggleClass('is-muted', !filter.showEvents);

		// Un clic masque ou réaffiche tout un rôle (ex. les agendas secondaires)
		const roles = (['primary', 'secondary', 'other_person'] as const).filter(r => legend.some(l => l.role === r));
		if (roles.length > 1) {
			const row = sec.createDiv({ cls: 'sbm-tcal-filter-chips' });
			for (const role of roles) {
				const members = legend.filter(l => l.role === role);
				const visible = filter.showEvents && members.some(l => isCalendarVisible(filter, l.id, l.role));
				this.chip(row, ROLE_LABELS[role], {
					active: visible,
					color: members[0].color,
					title: visible ? `Masquer ${members.length > 1 ? `les ${members.length} agendas` : 'cet agenda'}` : 'Afficher',
					onClick: () => this.apply(toggleRoleInFilter(filter, role, legend))
				});
			}
		}

		const list = sec.createDiv({ cls: 'sbm-tcal-filter-cals' });
		for (const cal of legend) {
			const visible = filter.showEvents && isCalendarVisible(filter, cal.id, cal.role);
			const item = list.createDiv({ cls: 'sbm-tcal-filter-cal' });
			item.toggleClass('is-hidden', !visible);
			item.setAttribute('role', 'checkbox');
			item.setAttribute('aria-checked', String(visible));
			item.tabIndex = 0;
			const box = item.createSpan({ cls: 'sbm-tcal-filter-cal-box' });
			box.style.setProperty('--dot-color', cal.color);
			if (visible) setIcon(box, 'check');
			const name = item.createSpan({ cls: 'sbm-tcal-filter-cal-name', text: cal.name });
			if (cal.role === 'other_person' && cal.ownerName) name.createSpan({ cls: 'sbm-tcal-filter-hint', text: ` · ${cal.ownerName}` });
			const toggle = () => this.apply(filter.showEvents ? toggleCalendarInFilter(filter, cal.id, legend) : soloCalendar(filter, cal.id, legend));
			item.addEventListener('click', toggle);
			item.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					toggle();
				}
			});
			if (legend.length > 1) {
				const only = item.createEl('button', { cls: 'sbm-tcal-filter-only', text: 'Seulement' });
				only.title = 'N’afficher que cet agenda';
				only.addEventListener('click', (e) => {
					e.stopPropagation();
					this.apply(soloCalendar(filter, cal.id, legend));
				});
			}
		}
	}

	private renderTaskGroups(parent: HTMLElement, filter: CalendarFilter): void {
		const matrix = this.host.matrixEnabled();
		const options = taskGroupOptions(matrix);
		const selected = activeTaskGroups(filter, matrix);
		const sec = this.section(parent, matrix ? 'Quadrants' : 'Priorités', selected ? '' : 'toutes les tâches');
		const row = sec.createDiv({ cls: 'sbm-tcal-filter-chips' });
		for (const opt of options) {
			const active = selected?.has(opt.key) ?? false;
			this.chip(row, opt.label, {
				active,
				color: opt.color,
				onClick: () => {
					const next = new Set(selected ?? []);
					if (next.has(opt.key)) next.delete(opt.key);
					else next.add(opt.key);
					// Toutes cochées = aucun filtre
					const keys = next.size === options.length ? [] : [...next];
					this.apply({ ...filter, taskGroups: keys });
				}
			});
		}
	}
}
