import { Setting, setIcon, Notice, normalizePath, debounce } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup, SectionOptions } from '../settingGroup';
import { FolderSuggest } from '../../suggesters/folderSuggest';
import { FileSuggest } from '../../suggesters/fileSuggest';
import { SecretsManagementModal, SUPPORTED_PROVIDERS } from '../../modals/secretsManagementModal';
import { ModelDiscoveryService } from '../../services/modelDiscoveryService';
import { GoogleCalendarService } from '../../services/googleCalendarService';
import { GoogleCalendarListEntry, CalendarRole } from '../../models/googleCalendar';
import { STARTUP_SIDEBAR_VIEWS, UiDensity } from '../../main';
import { TaskStatusRegistry, TasksStatusType } from '../../models/taskStatusRegistry';
import { getTaskExclusionRules, ExclusionReason, TaskExclusionSettings } from '../../services/taskExclusionService';
import { TaskParser } from '../../parsers/taskParser';
import { MatrixFeature } from '../../adapters/matrixAdapter';
import { DailyEntryParser, DailyEntryInsertPosition, formatClock } from '../../services/dailyEntriesService';
import { OTHER_PERSON_COLOR, SECONDARY_PALETTE } from '../../services/calendarEventsService';
import { describeFilter, isPresetModified, restoreDefaultPreset, restoreAllDefaultPresets, BUILTIN_FILTER_PRESETS } from '../../services/calendarFilters';
import type { CalendarFilterPreset } from '../../services/calendarFilters';
import { renderRewardsGroups } from './rewardsPage';

export class MainPage extends BaseSettingsPage {
	private discoveredCalendars: GoogleCalendarListEntry[] | null = null;
	private entrySample = '- 11:30 - 12:00 Dentiste #santé\n- 13:16 [[Projet]]\n- [ ] 18:45 - 19:45 Cours de danse';
	private refreshCalendarViews = debounce(() => this.plugin.refreshTaskViews(), 600, true);

	/** Couleur d'une variable du thème convertie en hexadécimal (valeur affichée par le sélecteur quand rien n'est choisi). */
	private themeColorHex(cssColor: string, fallback: string): string {
		const probe = document.body.createDiv();
		probe.style.display = 'none';
		probe.style.color = cssColor;
		const rgb = getComputedStyle(probe).color;
		probe.remove();
		const m = rgb.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
		if (!m) return fallback;
		return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
	}

	/** Sélecteur de couleur avec bouton de retour à la couleur par défaut ('' = défaut). */
	private addColorControl(setting: Setting, get: () => string, set: (value: string) => void, defaultColor: () => string): void {
		const custom = (get() || '').trim();
		if (!custom) setting.descEl.createSpan({ cls: 'sbm-color-default-hint', text: ' (couleur par défaut)' });
		setting
			.addColorPicker((picker) => {
				picker.setValue(custom || defaultColor()).onChange(async (val) => {
					set(val);
					await this.plugin.saveSettings();
					this.plugin.refreshCalendarColors();
					setting.descEl.querySelector('.sbm-color-default-hint')?.remove();
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon('rotate-ccw').setTooltip('Couleur par défaut').onClick(async () => {
					set('');
					await this.plugin.saveSettings();
					this.plugin.refreshCalendarColors();
					this.rerender();
				});
			});
	}

	/** Couleurs des catégories affichées dans le calendrier (tâches, entrées, agendas Google). */
	private renderCalendarColorSettings(): void {
		const s = this.plugin.settings;
		const group = new SettingGroup(this.containerEl).setHeading(
			'Couleurs du calendrier',
			'palette',
			'Couleur de chaque catégorie dans le calendrier : tâches (par quadrant, ou par priorité si les quadrants sont désactivés), entrées des notes quotidiennes et agendas Google. Le bouton ↺ rend la couleur par défaut.'
		);
		const theme = (cssColor: string, fallback: string) => () => this.themeColorHex(cssColor, fallback);
		const add = (name: string, desc: string, key: 'taskColorQ1' | 'taskColorQ2' | 'taskColorQ3' | 'taskColorQ4' | 'taskColorPrioHighest' | 'taskColorPrioHigh' | 'taskColorPrioMedium' | 'taskColorPrioLow' | 'taskColorPrioLowest' | 'taskColorDefault' | 'dailyEntriesColor' | 'calendarTodayColor' | 'primaryCalendarColor' | 'otherPersonCalendarColor', defaultColor: () => string) => {
			group.addSetting((setting: Setting) => {
				setting.setName(name).setDesc(desc);
				this.addColorControl(setting, () => s[key] || '', (v) => { s[key] = v; }, defaultColor);
			});
		};

		if (s.matrixEnabled !== false) {
			add('Tâches Q1 · urgent et important', 'Aussi utilisée pour les tâches de priorité haute ou maximale.', 'taskColorQ1', theme('var(--color-red)', '#e93147'));
			add('Tâches Q2 · important, pas urgent', 'Quadrant 2 de la matrice d’Eisenhower.', 'taskColorQ2', theme('var(--interactive-accent)', '#8a5cf5'));
			add('Tâches Q3 · urgent, pas important', 'Quadrant 3 de la matrice d’Eisenhower.', 'taskColorQ3', theme('var(--color-orange)', '#ec7500'));
			add('Tâches Q4 · ni urgent ni important', 'Quadrant 4 de la matrice d’Eisenhower.', 'taskColorQ4', theme('var(--text-faint)', '#999999'));
			add('Autres tâches', 'Tâches sans quadrant ni priorité haute.', 'taskColorDefault', theme('var(--background-modifier-border-hover, var(--text-faint))', '#bdbdbd'));
		} else {
			const prioDesc = 'Quadrants désactivés : les tâches sont colorées selon leur priorité.';
			add('Tâches 🔺 priorité maximale', prioDesc, 'taskColorPrioHighest', theme('var(--color-red)', '#e93147'));
			add('Tâches ⏫ priorité haute', prioDesc, 'taskColorPrioHigh', theme('var(--color-orange)', '#ec7500'));
			add('Tâches 🔼 priorité moyenne', prioDesc, 'taskColorPrioMedium', theme('var(--color-yellow)', '#e0ac00'));
			add('Tâches 🔽 priorité basse', prioDesc, 'taskColorPrioLow', theme('var(--color-blue)', '#086ddd'));
			add('Tâches ⏬ priorité minimale', prioDesc, 'taskColorPrioLowest', theme('var(--text-faint)', '#999999'));
			add('Autres tâches', 'Tâches sans priorité.', 'taskColorDefault', theme('var(--background-modifier-border-hover, var(--text-faint))', '#bdbdbd'));
		}
		add('Entrées de la note quotidienne', 'Lignes horodatées (« - 11:30 - 12:00 Dentiste ») affichées dans le calendrier.', 'dailyEntriesColor', theme('var(--color-purple, #a855f7)', '#a855f7'));
		add('Aujourd’hui', 'Repère du jour actuel (en-tête, case du jour, ligne de l’heure).', 'calendarTodayColor', theme('var(--interactive-accent)', '#8a5cf5'));
		add('Agenda Google principal', 'Événements de l’agenda de référence.', 'primaryCalendarColor', theme('var(--interactive-accent)', '#8a5cf5'));
		add('Agendas d’autres personnes', 'Événements des agendas consultatifs.', 'otherPersonCalendarColor', () => OTHER_PERSON_COLOR);

		group.addSetting((setting: Setting) => {
			setting
				.setName('Reprendre les couleurs de Google Agenda')
				.setDesc('Les agendas sans couleur choisie prennent la couleur définie dans Google Agenda. Les agendas secondaires ont sinon une couleur automatique ; chaque agenda peut recevoir sa propre couleur dans Calendrier › Google Agenda.')
				.addToggle((toggle) => {
					toggle.setValue(!!s.useGoogleCalendarColors).onChange(async (val) => {
						s.useGoogleCalendarColors = val;
						await this.plugin.saveSettings();
						this.plugin.refreshCalendarColors();
					});
				});
		});
	}

	/** Où écrire les tâches créées par l'IA (briefing du matin, chat, agenda). */
	private renderTaskCreationSettings(): void {
		const s = this.plugin.settings;
		const group = new SettingGroup(this.containerEl).setHeading(
			'Création de tâches',
			'list-plus',
			'Emplacement des tâches ajoutées quand vous acceptez une proposition de l’IA (briefing du matin, chat) ou importez les rendez-vous de l’agenda.'
		);
		group.addSetting((setting: Setting) => {
			setting
				.setName('Section des nouvelles tâches')
				.setDesc('Titre de la section qui reçoit les tâches, si la note en contient une (ex. « A faire aujourd’hui »). Le début du titre suffit, sans les # ni la casse. Vide : détection automatique (« À faire », « Tâches », « Prochaines étapes »…). Les tâches ne sont jamais écrites dans les propriétés.')
				.addText((text) => {
					text
						.setPlaceholder('A faire aujourd’hui')
						.setValue(s.taskInsertHeading || '')
						.onChange(async (val) => {
							s.taskInsertHeading = val.replace(/^#+\s*/, '').trim();
							await this.plugin.saveSettings();
						});
				});
		});
	}

	/** Préréglages de filtres créés depuis le bouton Filtres du calendrier : renommer, supprimer. */
	private renderCalendarFilterPresetSettings(): void {
		const s = this.plugin.settings;
		const group = new SettingGroup(this.containerEl).setHeading(
			'Préréglages de filtres',
			'filter',
			'Préréglages proposés par le bouton Filtres du calendrier (touche F), par défaut compris. Pour changer les filtres d’un préréglage : appliquez-le, ajustez les filtres, puis « Modifier » › « Remplacer par les filtres actuels » dans le panneau.'
		);
		const save = async (next: CalendarFilterPreset[]) => {
			s.calendarFilterPresets = next;
			await this.plugin.saveSettings();
			this.refreshCalendarViews();
			this.rerender();
		};
		const presets = s.calendarFilterPresets || [];

		group.addSetting((setting: Setting) => {
			setting
				.setName('Préréglage à l’ouverture')
				.setDesc('Filtres appliqués à chaque ouverture du calendrier (y compris au démarrage d’Obsidian). Aussi réglable depuis le menu d’un préréglage dans le panneau Filtres.')
				.addDropdown((dropdown) => {
					dropdown.addOption('', 'Derniers filtres utilisés');
					presets.forEach(p => dropdown.addOption(p.id, p.name));
					const current = presets.some(p => p.id === s.calendarStartupPreset) ? s.calendarStartupPreset : '';
					dropdown.setValue(current).onChange(async (val) => {
						s.calendarStartupPreset = val;
						await this.plugin.saveSettings();
					});
				});
		});

		const legend = Object.values(s.calendarsConfig || {}).map(c => ({ id: c.id, name: c.summary || c.id, role: c.role }));

		if (!presets.length) {
			group.addSetting((setting: Setting) => {
				setting
					.setName('Aucun préréglage')
					.setDesc('Rétablissez les préréglages par défaut ci-dessous, ou enregistrez-en depuis le panneau Filtres du calendrier.');
			});
		}

		presets.forEach((preset, index) => {
			group.addSetting((setting: Setting) => {
				const chips = describeFilter(preset.filter, {
					matrixEnabled: s.matrixEnabled !== false,
					googleReady: true,
					entriesAvailable: s.dailyEntriesEnabled !== false,
					legend
				});
				const summary = chips.length ? chips.map(c => c.detail || c.label).join(' · ') : 'Tout afficher';
				const origin = preset.builtin ? (isPresetModified(preset) ? 'Par défaut, modifié' : 'Par défaut') : 'Personnel';
				setting
					.setName(preset.name)
					.setDesc(`${origin} — ${summary}`)
					.addText((text) => {
						text.setPlaceholder('Nom').setValue(preset.name).onChange(async (val) => {
							const name = val.trim();
							if (!name) return;
							preset.name = name;
							setting.setName(name);
							await this.plugin.saveSettings();
							this.refreshCalendarViews();
						});
						text.inputEl.style.width = '150px';
					})
					.addExtraButton((btn) => {
						btn.setIcon('arrow-up').setTooltip('Monter').setDisabled(index === 0).onClick(() => {
							const next = [...presets];
							[next[index - 1], next[index]] = [next[index], next[index - 1]];
							void save(next);
						});
					})
					.addExtraButton((btn) => {
						btn.setIcon('arrow-down').setTooltip('Descendre').setDisabled(index === presets.length - 1).onClick(() => {
							const next = [...presets];
							[next[index + 1], next[index]] = [next[index], next[index + 1]];
							void save(next);
						});
					});
				if (preset.builtin && isPresetModified(preset)) {
					setting.addExtraButton((btn) => {
						btn.setIcon('rotate-ccw').setTooltip('Rétablir le préréglage d’origine').onClick(() => void save(restoreDefaultPreset(presets, preset.id)));
					});
				}
				setting.addExtraButton((btn) => {
					btn.setIcon('trash-2').setTooltip('Supprimer ce préréglage').onClick(() => {
						if (s.calendarStartupPreset === preset.id) s.calendarStartupPreset = '';
						void save(presets.filter(p => p.id !== preset.id));
					});
				});
			});
		});

		group.addSetting((setting: Setting) => {
			const missing = BUILTIN_FILTER_PRESETS.filter(b => !presets.some(p => p.id === b.id)).length;
			const modified = presets.filter(p => p.builtin && isPresetModified(p)).length;
			setting
				.setName('Rétablir les préréglages par défaut')
				.setDesc(missing || modified
					? `Remet Tout, Mon agenda, Tâches, Rendez-vous et À faire dans leur état d’origine (${[missing ? `${missing} supprimé${missing > 1 ? 's' : ''}` : '', modified ? `${modified} modifié${modified > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}). Vos préréglages personnels sont conservés.`
					: 'Les préréglages par défaut sont dans leur état d’origine.')
				.addButton((btn) => {
					btn.setButtonText('Rétablir').setDisabled(!missing && !modified).onClick(() => void save(restoreAllDefaultPresets(presets)));
				});
		});
	}

	/** Calendrier : grille horaire et entrées horodatées des notes quotidiennes. */
	private renderCalendarEntriesSettings(): void {
		const s = this.plugin.settings;
		const group = new SettingGroup(this.containerEl).setHeading(
			'Grille horaire & entrées de la note quotidienne',
			'calendar-clock',
			'Grille horaire des vues Jour et Semaine, et lignes horodatées des notes quotidiennes (ex. « - 11:30 - 12:00 Dentiste ») affichées et ajoutées depuis le calendrier'
		);
		const save = async () => {
			await this.plugin.saveSettings();
			this.refreshCalendarViews();
		};
		let updatePreview: () => void = () => {};

		group.addSetting((setting: Setting) => {
			setting
				.setName('Afficher les entrées des notes quotidiennes')
				.setDesc('Lit les lignes horodatées des notes quotidiennes et les place dans le calendrier (mois, agenda, grille horaire). Le bouton + permet aussi d’en ajouter.')
				.addToggle((toggle) => {
					toggle.setValue(s.dailyEntriesEnabled !== false).onChange(async (val) => {
						s.dailyEntriesEnabled = val;
						await save();
					});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Sections lues')
				.setDesc('Titres des sections de la note quotidienne à lire, séparés par des virgules (ex. « Recap du jour, Agenda »). Le texte du titre suffit, sans les #. Vide : toute la note.')
				.addText((text) => {
					text
						.setPlaceholder('Recap du jour')
						.setValue(s.dailyEntriesHeadings || '')
						.onChange(async (val) => {
							s.dailyEntriesHeadings = val;
							updatePreview();
							await save();
						});
				});
		});

		group.addSetting((setting: Setting) => {
			setting.settingEl.addClass('sbm-setting-textarea');
			setting
				.setName('Formes de ligne reconnues')
				.setDesc('Une forme par ligne, essayées dans l’ordre, avec {start}, {end} et {text}. La puce (« - », « - [ ] »…) est gérée automatiquement ; un tiret accepte aussi « – » et « — », les espaces sont facultatifs.')
				.addTextArea((area) => {
					area
						.setPlaceholder('{start} - {end} {text}\n{start} {text}')
						.setValue(s.dailyEntriesLineFormats || '')
						.onChange(async (val) => {
							s.dailyEntriesLineFormats = val;
							updatePreview();
							await save();
						});
					area.inputEl.rows = 3;
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Format d’heure')
				.setDesc('Jetons : HH / H (heures 0-23), hh / h (1-12), mm (minutes), A / a (AM-PM) ; texte littéral entre crochets. Ex. HH:mm → 09:30, H[h]mm → 9h30, h:mm a → 9:30 am.')
				.addDropdown((dropdown) => {
					const presets = ['HH:mm', 'H:mm', 'HH[h]mm', 'H[h]mm', 'hh:mm A', 'h:mm a'];
					presets.forEach(p => dropdown.addOption(p, p));
					if (!presets.includes(s.dailyEntriesTimeFormat)) dropdown.addOption(s.dailyEntriesTimeFormat, s.dailyEntriesTimeFormat);
					dropdown.setValue(s.dailyEntriesTimeFormat || 'HH:mm');
					dropdown.onChange(async (val) => {
						s.dailyEntriesTimeFormat = val;
						updatePreview();
						await save();
						this.rerender();
					});
				})
				.addText((text) => {
					text
						.setPlaceholder('Personnalisé')
						.setValue(s.dailyEntriesTimeFormat || 'HH:mm')
						.onChange(async (val) => {
							if (!val.trim()) return;
							s.dailyEntriesTimeFormat = val.trim();
							updatePreview();
							await save();
						});
					text.inputEl.style.width = '110px';
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Éléments de liste uniquement')
				.setDesc('Ne lit que les lignes commençant par une puce (« - », « * », « + », « 1. »). Désactivé : toute ligne qui commence par une heure.')
				.addToggle((toggle) => {
					toggle.setValue(s.dailyEntriesListOnly !== false).onChange(async (val) => {
						s.dailyEntriesListOnly = val;
						updatePreview();
						await save();
					});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Inclure les tâches horodatées')
				.setDesc('Lit aussi les cases à cocher (« - [ ] 10:00 … »). Elles s’affichent à leur heure, avec leur case, au lieu d’apparaître comme tâches classiques.')
				.addToggle((toggle) => {
					toggle.setValue(s.dailyEntriesIncludeTasks !== false).onChange(async (val) => {
						s.dailyEntriesIncludeTasks = val;
						updatePreview();
						await save();
					});
				});
		});

		group.addSetting((setting: Setting) => {
			setting.settingEl.addClass('sbm-setting-textarea');
			setting
				.setName('Essai')
				.setDesc('Collez des lignes de votre note quotidienne pour vérifier ce qui est reconnu.');
			const preview = setting.descEl.createDiv({ cls: 'sbm-entry-preview' });
			setting.addTextArea((area) => {
				area.setValue(this.entrySample).onChange((val) => {
					this.entrySample = val;
					updatePreview();
				});
				area.inputEl.rows = 3;
			});
			updatePreview = () => {
				preview.empty();
				const parser = new DailyEntryParser(s);
				this.entrySample.split(/\r?\n/).filter(l => l.trim()).forEach(line => {
					const e = parser.parseLine(line);
					const row = preview.createDiv({ cls: e ? 'is-ok' : 'is-ko' });
					if (!e) {
						row.setText(`✗ ${line.trim()}`);
						return;
					}
					const range = e.end !== null ? `${formatClock(e.start)} → ${formatClock(e.end)}` : formatClock(e.start);
					row.setText(`✓ ${range} · ${e.text}${e.statusChar !== undefined ? ` · tâche [${e.statusChar}]` : ''}`);
				});
			};
			updatePreview();
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Nouvelle entrée avec heure de fin')
				.setDesc('Ligne écrite dans la note quotidienne depuis le calendrier ({start}, {end}, {text}).')
				.addText((text) => {
					text
						.setPlaceholder('- {start} - {end} {text}')
						.setValue(s.dailyEntriesNewRangeFormat || '')
						.onChange(async (val) => {
							s.dailyEntriesNewRangeFormat = val;
							await save();
						});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Nouvelle entrée sans heure de fin')
				.setDesc('Ligne écrite quand aucune heure de fin n’est donnée ({start}, {text}).')
				.addText((text) => {
					text
						.setPlaceholder('- {start} {text}')
						.setValue(s.dailyEntriesNewPointFormat || '')
						.onChange(async (val) => {
							s.dailyEntriesNewPointFormat = val;
							await save();
						});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Place des nouvelles entrées')
				.setDesc('Dans la première section lue (ou à la fin de la note si aucune section n’est choisie).')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('sorted', 'Triées par heure')
						.addOption('end', 'À la fin de la section')
						.addOption('start', 'Au début de la section')
						.setValue(s.dailyEntriesInsertPosition || 'sorted')
						.onChange(async (val) => {
							s.dailyEntriesInsertPosition = val as DailyEntryInsertPosition;
							await save();
						});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Titre créé si la section manque')
				.setDesc('Ajouté à la fin de la note quotidienne avant la première entrée. Vide : « ## » suivi du premier titre de section.')
				.addText((text) => {
					text
						.setPlaceholder('## Recap du jour')
						.setValue(s.dailyEntriesNewHeading || '')
						.onChange(async (val) => {
							s.dailyEntriesNewHeading = val;
							await save();
						});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Durée d’une entrée sans heure de fin')
				.setDesc('Hauteur donnée dans la grille horaire aux entrées « - HH:mm texte » (minutes).')
				.addSlider((slider) => {
					slider
						.setLimits(5, 120, 5)
						.setValue(Number(s.dailyEntriesDefaultDuration) || 30)
						.setDynamicTooltip()
						.onChange(async (val) => {
							s.dailyEntriesDefaultDuration = val;
							await save();
						});
				});
		});

		const hourOptions = (dropdown: { addOption: (v: string, l: string) => unknown }, from: number, to: number) => {
			for (let h = from; h <= to; h++) dropdown.addOption(String(h), `${String(h).padStart(2, '0')}:00`);
		};

		group.addSetting((setting: Setting) => {
			setting
				.setName('Heures affichées dans la grille')
				.setDesc('Première et dernière heure des vues Jour et Semaine.')
				.addDropdown((dropdown) => {
					hourOptions(dropdown, 0, 23);
					dropdown.setValue(String(s.calendarGridStartHour ?? 0)).onChange(async (val) => {
						s.calendarGridStartHour = Number(val);
						if (s.calendarGridEndHour <= s.calendarGridStartHour) s.calendarGridEndHour = Math.min(24, s.calendarGridStartHour + 1);
						await save();
					});
				})
				.addDropdown((dropdown) => {
					hourOptions(dropdown, 1, 24);
					dropdown.setValue(String(s.calendarGridEndHour ?? 24)).onChange(async (val) => {
						s.calendarGridEndHour = Number(val);
						if (s.calendarGridEndHour <= s.calendarGridStartHour) s.calendarGridStartHour = Math.max(0, s.calendarGridEndHour - 1);
						await save();
					});
				});
		});

		group.addSetting((setting: Setting) => {
			setting
				.setName('Heure visible à l’ouverture')
				.setDesc('Heure placée en haut de la grille (le jour même, la grille s’ouvre sur l’heure actuelle).')
				.addDropdown((dropdown) => {
					hourOptions(dropdown, 0, 23);
					dropdown.setValue(String(s.calendarScrollToHour ?? 7)).onChange(async (val) => {
						s.calendarScrollToHour = Number(val);
						await save();
					});
				});
		});
	}

	render(): void {
		this.containerEl.empty();
		this.containerEl.addClass('sbm-main-settings-page');
		const s = this.plugin.settings;

		this.section({
			id: 'general',
			name: 'Général',
			icon: 'settings-2',
			desc: 'Apparence, vues ouvertes au démarrage, dossiers et modèles de notes.',
			displayValue: () => ({ comfortable: 'Confortable', compact: 'Compacte', dense: 'Très compacte' } as Record<string, string>)[s.uiDensity || 'compact'] || ''
		}, () => {
			this.renderAppearanceSettings();
			this.renderStartupSettings();
			this.renderVaultSettings();
		});

		this.section({
			id: 'tasks',
			name: 'Tâches',
			icon: 'list-checks',
			desc: 'Syntaxe des métadonnées, statuts, mise en pause, matrice d’Eisenhower et exclusions.',
			displayValue: () => s.matrixEnabled === false ? 'Sans quadrants' : 'Avec quadrants'
		}, () => {
			this.renderTaskSyntaxSettings();
			this.renderTaskCreationSettings();
			this.renderStatusSettings();
			this.renderPauseSettings();
			this.renderMatrixSettings();
			this.renderExclusionSettings();
		});

		this.section({
			id: 'calendar',
			name: 'Calendrier',
			icon: 'calendar-days',
			desc: 'Grille horaire, entrées des notes quotidiennes, couleurs et Google Agenda.',
			displayValue: () => s.googleRefreshToken ? 'Google connecté' : ''
		}, () => {
			this.renderCalendarEntriesSettings();
			this.renderCalendarColorSettings();
			this.renderCalendarFilterPresetSettings();
			this.section({
				id: 'google',
				name: 'Google Agenda',
				icon: 'calendar',
				desc: 'Connexion OAuth, agendas lus, rôle et couleur de chaque agenda.',
				displayValue: () => s.googleRefreshToken ? 'Connecté' : 'Non connecté'
			}, () => this.renderGoogleSettings());
		});

		this.section({
			id: 'ai',
			name: 'Intelligence artificielle',
			icon: 'bot',
			desc: 'Fournisseur et modèle, prompts de l’éditeur, confidentialité et règles de priorité du briefing.',
			displayValue: () => s.llmModel || ''
		}, () => {
			this.renderAiSettings();
			this.renderAiPrivacySettings();
			this.renderAiPrioritySettings();
		});

		this.section({
			id: 'voice',
			name: 'Dictée vocale',
			icon: 'mic',
			desc: 'Moteur de reconnaissance vocale, modèle Whisper et langue.',
			displayValue: () => s.sttEngine === 'web-speech' ? 'Navigateur' : 'Whisper local'
		}, () => this.renderVoiceSettings());

		this.section({
			id: 'gamification',
			name: 'Gamification & boutique',
			icon: 'gift',
			desc: 'Énergie de base et boutique de récompenses.',
			displayValue: () => {
				const n = this.plugin.pluginData.rewards.filter(r => r.enabled).length;
				return n ? `${n} récompense${n > 1 ? 's' : ''}` : '';
			}
		}, () => this.renderGamificationSettings());
	}

	/** Section : sous-page native (Obsidian ≥ 1.13) ou bloc repliable (affichage classique). */
	private section(opts: SectionOptions, build: () => void): void {
		const previous = this.containerEl;
		SettingGroup.section(this.containerEl, opts, (contentEl) => {
			this.containerEl = contentEl;
			try {
				build();
			} finally {
				this.containerEl = previous;
			}
		});
	}


	private renderAiSettings(): void {
		// =========================================================================
		// 1. Intelligence Artificielle & Fournisseurs
		// =========================================================================
		const aiGroup = new SettingGroup(this.containerEl).setHeading(
			'Fournisseur & modèle',
			'bot',
			'Configuration des clés d\'API, sélection du modèle actif et instructions système'
		);

		// 1.1 Gestionnaire centralisé de clés d'API et secrets (Popup multi-fournisseurs)
		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Gestionnaire de clés d\'API & Secrets')
				.setDesc('Configurez, liez ou déliez vos clés pour Gemini, OpenAI, OpenRouter et Infomaniak AI Services.')
				.addButton((btn) => {
					btn
						.setButtonText('🔑 Gérer les clés d\'API...')
						.setCta()
						.onClick(() => {
							new SecretsManagementModal(this.plugin.app, this.plugin, () => this.rerender()).open();
						});
				});

			// Badges récapitulatifs des fournisseurs configurés
			const badgesEl = activeDocument.createElement('div');
			badgesEl.addClass('sbm-configured-providers-badges');

			SUPPORTED_PROVIDERS.forEach(p => {
				const isConfigured = !!p.getSecretId(this.plugin);
				const badge = badgesEl.createSpan({
					cls: `sbm-provider-status-pill ${isConfigured ? 'active' : 'inactive'}`,
					text: `${p.name}: ${isConfigured ? '✓' : '—'}`
				});
				badge.title = isConfigured ? `Secret lié : ${p.getSecretId(this.plugin)}` : 'Non configuré';
			});

			setting.descEl.appendChild(badgesEl);
		});

		// 1.2 Sélection du Fournisseur LLM actif
		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur LLM')
				.setDesc('Sélectionnez le fournisseur d\'intelligence artificielle pour le chat et les briefings')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('gemini', 'Google Gemini (Gemini 3.5 / 2.5 / 1.5)')
						.addOption('openai', 'OpenAI ChatGPT (GPT-4o, o3-mini, o1)')
						.addOption('openrouter', 'OpenRouter (Claude 3.5, Llama 3.3, DeepSeek R1...)')
						.addOption('infomaniak', 'Infomaniak AI Services (Souverain / Suisse - Qwen, Mistral, Apertus)')
						.addOption('ollama', 'Ollama (Local sans clé API)')
						.addOption('lmstudio', 'LM Studio (Local sans clé API)')
						.setValue(this.plugin.settings.llmProvider)
						.onChange(async (value: 'gemini' | 'openai' | 'openrouter' | 'infomaniak' | 'ollama' | 'lmstudio') => {
							this.plugin.settings.llmProvider = value;
							if (value === 'gemini') {
								this.plugin.settings.llmModel = 'gemini-2.5-flash';
							} else if (value === 'openai') {
								this.plugin.settings.llmModel = 'gpt-4o-mini';
							} else if (value === 'openrouter') {
								this.plugin.settings.llmEndpoint = 'https://openrouter.ai/api/v1';
								this.plugin.settings.llmModel = 'anthropic/claude-3.5-sonnet';
							} else if (value === 'infomaniak') {
								this.plugin.settings.llmEndpoint = 'https://api.infomaniak.com';
								this.plugin.settings.llmModel = 'qwen3';
							} else if (value === 'ollama') {
								this.plugin.settings.llmEndpoint = 'http://localhost:11434';
								this.plugin.settings.llmModel = 'llama3.2';
							} else if (value === 'lmstudio') {
								this.plugin.settings.llmEndpoint = 'http://localhost:1234';
								this.plugin.settings.llmModel = 'local-model';
							}
							await this.plugin.saveSettings();
							this.rerender();
						});
				});
		});

		const currentProvider = this.plugin.settings.llmProvider;
		const knownModels = ModelDiscoveryService.getFallbackForProvider(currentProvider);

		// 1.3 Modèle par défaut avec détection live
		aiGroup.addSetting((setting: Setting) => {
			setting.settingEl.addClass('sbm-model-setting-item');
			setting
				.setName('Modèle par défaut')
				.setDesc('Sélectionnez le modèle IA actif ou actualisez la liste en direct depuis l\'API')
				.addDropdown((dropdown) => {
					let isCurrentInList = false;
					knownModels.forEach(m => {
						const label = m.name.length > 38 ? `${m.name.slice(0, 35)}...` : m.name;
						dropdown.addOption(m.name, label);
						if (m.name === this.plugin.settings.llmModel) isCurrentInList = true;
					});

					if (!isCurrentInList && this.plugin.settings.llmModel) {
						const currLabel = this.plugin.settings.llmModel.length > 38 ? `${this.plugin.settings.llmModel.slice(0, 35)}...` : this.plugin.settings.llmModel;
						dropdown.addOption(this.plugin.settings.llmModel, `⭐ ${currLabel}`);
					}

					dropdown.addOption('__custom__', '✏️ Saisir un modèle personnalisé...');
					dropdown.setValue(isCurrentInList ? this.plugin.settings.llmModel : (this.plugin.settings.llmModel ? this.plugin.settings.llmModel : '__custom__'));

					dropdown.onChange(async (val) => {
						if (val === '__custom__') {
							this.rerender();
						} else {
							this.plugin.settings.llmModel = val;
							await this.plugin.saveSettings();
							this.rerender();
						}
					});
				})
				.addButton((btn) => {
					btn
						.setButtonText('🔄 Détecter via API')
						.setTooltip('Interroger l\'API du fournisseur pour détecter les nouveaux modèles disponibles')
						.onClick(async () => {
							try {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Recherche...');
								const apiKey = await this.plugin.getSecretApiKey(this.plugin.settings.llmProvider);
								const live = await ModelDiscoveryService.fetchLiveModels(
									this.plugin.settings.llmProvider,
									apiKey,
									this.plugin.settings.llmEndpoint,
									this.plugin.settings.infomaniakProductId
								);
								btn.setDisabled(false);
								btn.setButtonText('🔄 Détecter via API');
								new Notice(`📡 ${live.length} modèle(s) détecté(s) auprès de ${this.plugin.settings.llmProvider.toUpperCase()}`);
								this.rerender();
							} catch {
								btn.setDisabled(false);
								btn.setButtonText('🔄 Détecter via API');
								new Notice('Impossible de contacter l\'API du fournisseur pour lister les modèles.');
							}
						});
				});
		});

		const isPreset = knownModels.some(m => m.name === this.plugin.settings.llmModel);
		if (!isPreset) {
			aiGroup.addSetting((setting: Setting) => {
				setting
					.setName('Nom du modèle personnalisé')
					.setDesc('Saisissez l\'identifiant exact du modèle souhaité (ex: gemini-3.5-flash, custom-model-name)')
					.addText((text) => {
						text
							.setPlaceholder('ex: gemini-3.5-flash')
							.setValue(this.plugin.settings.llmModel)
							.onChange(async (val) => {
								this.plugin.settings.llmModel = val.trim() || 'gemini-2.5-flash';
								await this.plugin.saveSettings();
							});
					});
			});
		}

		if (this.plugin.settings.llmProvider === 'ollama' || this.plugin.settings.llmProvider === 'lm-studio' || this.plugin.settings.llmProvider === 'lmstudio') {
			aiGroup.addSetting((setting: Setting) => {
				setting
					.setName('URL du serveur local')
					.setDesc('URL du serveur IA local (ex: http://localhost:11434)')
					.addText((text) => {
						text
							.setValue(this.plugin.settings.llmEndpoint)
							.onChange(async (value) => {
								this.plugin.settings.llmEndpoint = value.trim();
								await this.plugin.saveSettings();
							});
					});
			});
		}

		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Instructions personnalisées pour le prompt (Custom System Instructions)')
				.setDesc('Règles, préférences ou consignes additionnelles injectées dans tous les prompts de l\'IA (Briefing du matin, Décongestion/Reprise, Revue du soir, Chat Copilot).')
				.addTextArea((textArea) => {
					textArea
						.setPlaceholder('Exemple :\n- Sois concis et direct dans tes synthèses.\n- Mon fuseau horaire est Europe/Paris.\n- Ne me propose jamais de réunions le vendredi après-midi.\n- Tiens compte de mes objectifs du trimestre...')
						.setValue(this.plugin.settings.customPromptInstructions || '')
						.onChange(async (val) => {
							this.plugin.settings.customPromptInstructions = val;
							await this.plugin.saveSettings();
						});
					textArea.inputEl.rows = 5;
					textArea.inputEl.style.width = '100%';
					textArea.inputEl.style.minHeight = '100px';
					textArea.inputEl.style.fontFamily = 'monospace';
					textArea.inputEl.style.fontSize = '12px';
				});
			// Champ long : libellé au-dessus, zone de saisie sur toute la largeur
			setting.settingEl.addClass('sbm-setting-stacked');
		});

		// 1.9 Configuration des Prompts & Actions IA (Sous-page)
		aiGroup.addPageLink({
			pageType: 'prompts-page',
			name: 'Prompts & Actions IA personnalisés',
			desc: 'Personnaliser les prompts de l\'éditeur, assigner un modèle léger dédié (ex: correction d\'orthographe) et configurer leur visibilité',
			icon: 'sparkles',
			open: () => this.openPage('prompts-page')
		});
	}

	private renderAppearanceSettings(): void {
		// =========================================================================
		// Apparence : densité de l'interface
		// =========================================================================
		const appearanceGroup = new SettingGroup(this.containerEl).setHeading(
			'Apparence',
			'layout-template',
			'Taille des textes, boutons et espacements dans toutes les vues du plugin.'
		);

		appearanceGroup.addSetting((setting: Setting) => {
			setting
				.setName('Densité de l’interface')
				.setDesc('Compacte réduit les marges, les boutons et les titres. Très compacte maximise l’information affichée, idéal dans la barre latérale.')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('comfortable', 'Confortable (taille d’origine)')
						.addOption('compact', 'Compacte')
						.addOption('dense', 'Très compacte')
						.setValue(this.plugin.settings.uiDensity || 'compact')
						.onChange(async (value) => {
							this.plugin.settings.uiDensity = value as UiDensity;
							this.plugin.applyUiDensity();
							await this.plugin.saveSettings();
						});
				});
		});
	}

	private renderStartupSettings(): void {
		// =========================================================================
		// Démarrage : vues ouvertes automatiquement dans la barre latérale
		// =========================================================================
		const startupGroup = new SettingGroup(this.containerEl).setHeading(
			'Démarrage & barre latérale',
			'panel-right',
			'Vues ouvertes automatiquement dans la barre latérale droite au lancement d’Obsidian, en arrière-plan (sans prendre le focus). Une vue déjà ouverte n’est pas dupliquée.'
		);

		STARTUP_SIDEBAR_VIEWS.forEach((view) => {
			startupGroup.addSetting((setting: Setting) => {
				setting
					.setName(view.name)
					.addToggle((toggle) => {
						toggle
							.setValue((this.plugin.settings.startupSidebarViews || []).includes(view.type))
							.onChange(async (value) => {
								const current = new Set(this.plugin.settings.startupSidebarViews || []);
								if (value) current.add(view.type);
								else current.delete(view.type);
								// Conserve l'ordre du catalogue (ordre des onglets)
								this.plugin.settings.startupSidebarViews = STARTUP_SIDEBAR_VIEWS
									.map(v => v.type)
									.filter(type => current.has(type));
								await this.plugin.saveSettings();
							});
					});
				const iconEl = activeDocument.createElement('span');
				iconEl.addClass('sbm-group-heading-icon');
				setIcon(iconEl, view.icon);
				setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
			});
		});

		startupGroup.addSetting((setting: Setting) => {
			setting
				.setName('Ouvrir maintenant')
				.setDesc('Applique la sélection tout de suite, sans redémarrer Obsidian.')
				.addButton((btn) => {
					btn.setButtonText('Ouvrir les vues sélectionnées').onClick(async () => {
						await this.plugin.openStartupSidebarViews();
						new Notice('Vues ouvertes dans la barre latérale.');
					});
				});
		});
	}

	private renderVaultSettings(): void {
		// =========================================================================
		// 2. Structure du Coffre & Modèles de Notes (Templates)
		// =========================================================================
		const foldersGroup = new SettingGroup(this.containerEl).setHeading(
			'Dossiers & modèles de notes',
			'folder',
			'Dossiers de stockage, répertoire des modèles/templates et gestion du journal quotidien'
		);

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier boîte de réception (Inbox)')
				.setDesc('Dossier dans lequel les nouvelles notes brutes et captures sont créées')
				.addText((text) => {
					text
						.setPlaceholder('00 - Inbox')
						.setValue(this.plugin.settings.inboxFolder)
						.onChange(async (value) => {
							this.plugin.settings.inboxFolder = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier des modèles & templates')
				.setDesc('Dossier où sont stockés vos modèles de notes (fiches personnes, projets, comptes-rendus). Compatible Obsidian Templates, Templater et QuickAdd.')
				.addText((text) => {
					text
						.setPlaceholder('Templates')
						.setValue(this.plugin.settings.templatesFolder || 'Templates')
						.onChange(async (value) => {
							this.plugin.settings.templatesFolder = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier du journal (Daily notes)')
				.setDesc('Dossier contenant les notes quotidiennes du journal')
				.addText((text) => {
					text
						.setPlaceholder('04 - Journal')
						.setValue(this.plugin.settings.dailyNotesFolder)
						.onChange(async (value) => {
							this.plugin.settings.dailyNotesFolder = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Modèle de note quotidienne (Template journalier)')
				.setDesc('Chemin du fichier modèle (.md) utilisé pour initialiser automatiquement la note quotidienne. Compatible Templater (<% ... %>) et Obsidian Templates.')
				.addText((text) => {
					text
						.setPlaceholder('Templates/Daily Note Template.md')
						.setValue(this.plugin.settings.dailyNoteTemplatePath || '')
						.onChange(async (value) => {
							this.plugin.settings.dailyNoteTemplatePath = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FileSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Créer et ouvrir automatiquement la note quotidienne lors du briefing')
				.setDesc('Si activé, le lancement du briefing du matin crée la note quotidienne avec le modèle configuré et l\'ouvre dans votre espace de travail.')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.autoOpenDailyNoteOnBriefing !== false)
						.onChange(async (value) => {
							this.plugin.settings.autoOpenDailyNoteOnBriefing = value;
							await this.plugin.saveSettings();
						});
				});
		});
	}

	private renderTaskSyntaxSettings(): void {
		// =========================================================================
		// 3. Gestion des Tâches & Syntaxes de Métadonnées
		// =========================================================================
		const syntaxGroup = new SettingGroup(this.containerEl).setHeading(
			'Syntaxe des métadonnées',
			'check-square',
			'Format des échéances, des priorités, des niveaux d\'énergie et des récompenses'
		);

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format principal des métadonnées de tâches')
				.setDesc('Format utilisé pour insérer ou mettre à jour les échéances, dates et statuts (Emojis Obsidian Tasks, Dataview [due:: ...], ou Tags #due/...)')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('emoji', 'Tasks Emojis (📅, ⏳, 🛫, ✅, 🔺)')
						.addOption('dataview', 'Tasks Dataview ([due:: ...], [scheduled:: ...], [completion:: ...])')
						.addOption('tag', 'Tags (#due/..., #scheduled/..., #done/...)')
						.setValue(this.plugin.settings.taskFormat || 'emoji')
						.onChange(async (value: 'emoji' | 'dataview' | 'tag') => {
							this.plugin.settings.taskFormat = value;
							if (value === 'dataview') {
								this.plugin.settings.priorityMode = 'emoji';
							} else if (value === 'tag') {
								this.plugin.settings.priorityMode = 'tag';
							}
							await this.plugin.saveSettings();
							this.rerender();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format des priorités')
				.setDesc('Choisissez entre les émojis Obsidian Tasks (🔺 ⏫ 🔼 🔽 ⏬) ou les tags (#priorite/haute, #priority/high...)')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('emoji', 'Emojis Obsidian Tasks (🔺 ⏫ 🔼 🔽 ⏬)')
						.addOption('tag', 'Tags (#priorite/haute, #priority/high...)')
						.setValue(this.plugin.settings.priorityMode)
						.onChange(async (value: 'emoji' | 'tag') => {
							this.plugin.settings.priorityMode = value;
							await this.plugin.saveSettings();
							this.rerender();
						});
				});
		});

		if (this.plugin.settings.priorityMode === 'tag') {
			syntaxGroup.addSetting((setting: Setting) => {
				setting
					.setName('Nom du tag racine de priorité')
					.setDesc('Préfixe utilisé pour les niveaux de priorité sous forme de tags (ex: priorite -> #priorite/haute, #priorite/urgente)')
					.addText((text) => {
						text
							.setPlaceholder('priorite')
							.setValue(this.plugin.settings.priorityTagPrefix)
							.onChange(async (value) => {
								this.plugin.settings.priorityTagPrefix = value.trim() || 'priorite';
								await this.plugin.saveSettings();
							});
					});
			});
		}

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Préfixe du tag d\'énergie')
				.setDesc('Préfixe des tags d\'énergie (ex: energie -> #energie/4)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.energyTagPrefix)
						.onChange(async (value) => {
							this.plugin.settings.energyTagPrefix = value.trim() || 'energie';
							await this.plugin.saveSettings();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Préfixe du tag de pièces')
				.setDesc('Préfixe des tags de récompense gamifiée (ex: pieces -> #pieces/5)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.piecesTagPrefix)
						.onChange(async (value) => {
							this.plugin.settings.piecesTagPrefix = value.trim() || 'pieces';
							await this.plugin.saveSettings();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format des dates')
				.setDesc('Format Moment.js (ex: YYYY-MM-DD)')
				.addText((text) => {
					text
						.setPlaceholder('YYYY-MM-DD')
						.setValue(this.plugin.settings.dateFormat)
						.onChange(async (value) => {
							this.plugin.settings.dateFormat = value.trim() || 'YYYY-MM-DD';
							await this.plugin.saveSettings();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dates sous forme de liens wikilinks')
				.setDesc('Encadrer les dates dans des wikilinks [[YYYY-MM-DD]]')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.useWikilinks)
						.onChange(async (value) => {
							this.plugin.settings.useWikilinks = value;
							await this.plugin.saveSettings();
						});
				});
		});
	}

	private renderPauseSettings(): void {
		// =========================================================================
		// 4. Mise en Pause des Tâches (On Hold)
		// =========================================================================
		const pauseGroup = new SettingGroup(this.containerEl).setHeading(
			'Mise en pause',
			'pause-circle',
			'Mise en veille temporaire des tâches et filtrage lors des briefings'
		);

		pauseGroup.addSetting((setting: Setting) => {
			setting
				.setName('Mode de mise en pause')
				.setDesc('Choisissez comment marquer une tâche mise en pause dans vos notes Markdown : via un tag dédié (#pause) ou via un symbole de statut Obsidian Tasks (- [?], - [p]).')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('tag', '🏷️ Tag dédié (ex: #pause)')
						.addOption('status', '🔣 Symbole de statut Markdown (ex: - [?], - [p])')
						.setValue(this.plugin.settings.pauseMode || 'tag')
						.onChange(async (value: 'tag' | 'status') => {
							this.plugin.settings.pauseMode = value;
							await this.plugin.saveSettings();
							this.rerender();
						});
				});
		});

		if (this.plugin.settings.pauseMode === 'tag') {
			pauseGroup.addSetting((setting: Setting) => {
				setting
					.setName('Tag utilisé pour la pause')
					.setDesc('Nom du tag ajouté aux tâches en pause (ex: pause -> #pause, en-pause -> #en-pause, on-hold -> #on-hold).')
					.addText((text) => {
						text
							.setPlaceholder('pause')
							.setValue(this.plugin.settings.pauseTag || 'pause')
							.onChange(async (value) => {
								this.plugin.settings.pauseTag = value.trim().replace(/^#/, '') || 'pause';
								await this.plugin.saveSettings();
							});
					});
			});
		} else {
			pauseGroup.addSetting((setting: Setting) => {
				setting
					.setName('Symbole de statut Markdown pour la pause')
					.setDesc('Caractère placé entre crochets dans la checkbox pour indiquer la pause (ex: ? pour - [?], p pour - [p]). Compatible avec Obsidian Tasks.')
					.addText((text) => {
						text
							.setPlaceholder('?')
							.setValue(this.plugin.settings.pauseStatusSymbol || '?')
							.onChange(async (value) => {
								const sym = value.trim() || '?';
								this.plugin.settings.pauseStatusSymbol = sym;
								if (!this.plugin.settings.statusSymbols.includes(sym)) {
									this.plugin.settings.statusSymbols.push(sym);
								}
								await this.plugin.saveSettings();
							});
					});
			});
		}
	}

	private renderMatrixSettings(): void {
		// =========================================================================
		// 5. Matrice Eisenhower
		// =========================================================================
		const matrixGroup = new SettingGroup(this.containerEl).setHeading(
			'Matrice d’Eisenhower',
			'layout-grid',
			'Organisation et classification des tâches selon l\'urgence et l\'importance'
		);

		matrixGroup.addSetting((setting: Setting) => {
			setting
				.setName('Activer les quadrants')
				.setDesc('Désactivé : plus aucun quadrant n’est lu ni proposé. L’IA, le briefing, la reprise, les pièces et les trophées n’en tiennent plus compte, et les boutons de quadrant disparaissent. Les tags déjà présents dans vos notes ne sont pas modifiés.')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.matrixEnabled !== false)
						.onChange(async (value) => {
							this.plugin.settings.matrixEnabled = value;
							MatrixFeature.setEnabled(value);
							await this.plugin.saveSettings();
							this.plugin.applyCalendarColors();
							this.plugin.refreshTaskViews();
							this.plugin.refreshGamificationViews();
							this.rerender();
						});
				});
		});

		if (this.plugin.settings.matrixEnabled !== false) matrixGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur de matrice')
				.setDesc('Sélectionnez le format de tag de matrice utilisé dans votre coffre')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('task-matrix', 'TaskMatrix (#tm/qN)')
						.addOption('focus-first', 'Focus First (#focus, #qN)')
						.addOption('custom', 'Tags personnalisés (#q1, #q2...)')
						.setValue(this.plugin.settings.matrixProvider)
						.onChange(async (value: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom') => {
							this.plugin.settings.matrixProvider = value;
							await this.plugin.saveSettings();
						});
				});
		});
	}

	private renderStatusSettings(): void {
		// =========================================================================
		// Statuts de tâche du plugin Tasks
		// =========================================================================
		const statusGroup = new SettingGroup(this.containerEl).setHeading(
			'Statuts de tâche (plugin Tasks)',
			'list-checks',
			'Reprend les statuts personnalisés de Tasks : nom, type et statut suivant au clic sur la case, cases « non-tâche » ignorées, filtre global respecté.'
		);

		statusGroup.addSetting((setting: Setting) => {
			setting
				.setName('Utiliser les statuts du plugin Tasks')
				.setDesc('Les réglages de Tasks sont relus automatiquement dès qu’ils changent.')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.useTasksPluginStatuses !== false)
						.onChange(async (value) => {
							this.plugin.settings.useTasksPluginStatuses = value;
							await this.plugin.saveSettings();
							await this.plugin.syncTasksPluginStatuses();
							this.plugin.refreshTaskViews();
							this.rerender();
						});
				})
				.addExtraButton((btn) => {
					btn.setIcon('refresh-cw').setTooltip('Relire les réglages de Tasks').onClick(async () => {
						const n = await this.plugin.syncTasksPluginStatuses();
						this.plugin.refreshTaskViews();
						new Notice(n ? `${n} statuts lus depuis le plugin Tasks.` : 'Plugin Tasks introuvable : statuts par défaut utilisés.');
						this.rerender();
					});
				});
		});

		statusGroup.addSetting((setting: Setting) => {
			const fromTasks = TaskStatusRegistry.isFromTasksPlugin();
			setting
				.setName(fromTasks ? 'Statuts reconnus' : 'Statuts reconnus (par défaut)')
				.setDesc(fromTasks
					? `Lus depuis le plugin Tasks${TaskStatusRegistry.globalFilter ? ` · filtre global : « ${TaskStatusRegistry.globalFilter} »` : ''}.`
					: 'Le plugin Tasks n’est pas installé dans ce coffre, ou l’option est désactivée.');
			setting.settingEl.addClass('sbm-setting-stacked');
			const typeLabels: Record<TasksStatusType, string> = {
				TODO: 'À faire', DONE: 'Terminée', IN_PROGRESS: 'En cours', CANCELLED: 'Annulée', ON_HOLD: 'En attente', NON_TASK: 'Non-tâche'
			};
			const list = setting.controlEl.createDiv({ cls: 'sbm-status-list' });
			TaskStatusRegistry.all().forEach(st => {
				const row = list.createDiv({ cls: `sbm-status-chip type-${st.type.toLowerCase()}` });
				row.createSpan({ cls: 'sbm-status-symbol', text: `[${st.symbol}]` });
				row.createSpan({ cls: 'sbm-status-name', text: st.name });
				row.createSpan({ cls: 'sbm-status-type', text: typeLabels[st.type] });
				row.createSpan({ cls: 'sbm-status-next', text: `→ [${st.nextStatusSymbol}]` });
			});
		});
	}

	private renderExclusionSettings(): void {
		// =========================================================================
		// Exclusion de tâches (toutes les requêtes du plugin)
		// =========================================================================
		const exclusionGroup = new SettingGroup(this.containerEl).setHeading(
			'Exclusion de tâches',
			'filter-x',
			'Tâches ignorées partout : tableau de bord, calendrier, briefing, revue du soir, reprise et recherches de l’IA. Les sous-tâches suivent leur tâche parente. Les pièces restent gagnées si vous les cochez.'
		);

		// Les vues sont actualisées peu après la fin de la saisie
		const refreshViews = debounce(() => this.plugin.refreshTaskViews(), 700, true);
		const exclusionField = (
			key: keyof TaskExclusionSettings,
			name: string,
			desc: string,
			placeholder: string
		) => {
			exclusionGroup.addSetting((setting: Setting) => {
				setting
					.setName(name)
					.setDesc(desc)
					.addTextArea((textarea) => {
						textarea
							.setPlaceholder(placeholder)
							.setValue(this.plugin.settings[key] || '')
							.onChange(async (value) => {
								this.plugin.settings[key] = value;
								await this.plugin.saveSettings();
								refreshViews();
							});
						textarea.inputEl.rows = 2;
					});
			});
		};

		exclusionField(
			'taskExcludeTags',
			'Tags',
			'Un tag exclut aussi ses sous-tags (#projet exclut #projet/client). Les tags de la note (frontmatter ou corps) comptent aussi.',
			'ex : #archive, #un-jour, #modèle, #idée'
		);
		exclusionField(
			'taskExcludeWords',
			'Mots ou expressions',
			'Recherchés dans le titre de la tâche, sans tenir compte des majuscules. Une expression régulière s’écrit entre barres obliques : /^brouillon/.',
			'ex : à voir plus tard, exemple, /^test\\b/'
		);
		exclusionField(
			'taskExcludePaths',
			'Dossiers ou fichiers',
			'Un dossier exclut tout son contenu. * remplace n’importe quels caractères (ex. *Brouillon*, Archives/2024*).',
			'ex : Archives, Modèles, 99 - Corbeille, *Brouillon*'
		);
		exclusionField(
			'taskExcludeStatuses',
			'Statuts',
			'Caractères de case à ignorer (voir la liste des statuts ci-dessus), ex. - pour les tâches annulées.',
			'ex : -, >, I'
		);

		exclusionGroup.addSetting((setting: Setting) => {
			const resultEl = createDiv({ cls: 'sbm-exclusion-result' });
			setting
				.setName('Tester les règles')
				.setDesc('Compte les tâches exclues dans le coffre et en montre quelques-unes.')
				.addButton((btn) => {
					btn.setButtonText('Tester').onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText('Analyse…');
						const reasonLabels: Record<ExclusionReason, string> = {
							tag: 'tag', 'note-tag': 'tag de la note', word: 'mot', path: 'dossier/fichier', status: 'statut', parent: 'tâche parente'
						};
						const rules = getTaskExclusionRules(this.plugin.app, this.plugin.settings);
						let total = 0;
						const samples: Array<{ title: string; path: string; reason: string }> = [];
						let excluded = 0;
						for (const file of this.plugin.app.vault.getMarkdownFiles()) {
							const content = await this.plugin.app.vault.cachedRead(file);
							const tasks = TaskParser.parseAllTasks(content, file.path, this.plugin.settings);
							total += tasks.length;
							const kept = new Set(rules.filter(tasks));
							for (const t of tasks) {
								if (kept.has(t)) continue;
								excluded++;
								if (samples.length < 6) {
									samples.push({ title: t.title, path: file.path, reason: reasonLabels[rules.reasonFor(t) || 'parent'] });
								}
							}
						}
						resultEl.empty();
						resultEl.createDiv({ cls: 'sbm-exclusion-summary', text: `${excluded} tâche${excluded > 1 ? 's' : ''} exclue${excluded > 1 ? 's' : ''} sur ${total}.` });
						const ul = resultEl.createEl('ul');
						samples.forEach(sm => {
							const li = ul.createEl('li');
							li.createSpan({ text: sm.title || '(sans titre)' });
							li.createSpan({ cls: 'sbm-exclusion-meta', text: ` · ${sm.reason} · ${sm.path}` });
						});
						btn.setDisabled(false);
						btn.setButtonText('Tester');
					});
				});
			setting.descEl.appendChild(resultEl);
		});
	}

	private renderAiPrivacySettings(): void {
		// =========================================================================
		// 6. Confidentialité & Filtres d'Exclusion IA
		// =========================================================================
		const filtersGroup = new SettingGroup(this.containerEl).setHeading(
			'Confidentialité de l’IA',
			'shield',
			'Notes, dossiers, tags et métadonnées protégés ne devant jamais être envoyés à l\'IA'
		);

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossiers exclus de l\'IA')
				.setDesc('Dossiers dont les fichiers et tâches ne seront jamais indexés, analysés ni envoyés à l\'IA (séparés par des virgules ou retours à la ligne).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: Chaos/Archives, 99 - Privé, Templates, .trash')
						.setValue(this.plugin.settings.excludedFolders || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedFolders = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fichiers exclus de l\'IA')
				.setDesc('Fichiers ou motifs avec jokers (*) à exclure totalement des requêtes IA (séparés par des virgules ou retours à la ligne).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: MotsDePasse.md, Journal Intime.md, *.secret.md, *Confidentiel*')
						.setValue(this.plugin.settings.excludedFiles || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedFiles = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Tags exclus de l\'IA')
				.setDesc('Tags empêchant l\'envoi d\'une note ou d\'une tâche à l\'IA si elle le contient (séparés par des virgules ou retours à la ligne, ex: #secret, #prive).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: #secret, #prive, #confidentiel, #perso, #no-ai')
						.setValue(this.plugin.settings.excludedTags || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedTags = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Propriétés frontmatter exclues de l\'IA')
				.setDesc('Propriétés YAML de note excluant la note de l\'IA (ex: private, secret: true, publish: false, no-ai).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: private, secret: true, publish: false, confidential: true, no-ai')
						.setValue(this.plugin.settings.excludedProperties || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedProperties = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});
	}

	private renderAiPrioritySettings(): void {
		// =========================================================================
		// 7. Règles de Priorité & Valorisation IA (Briefing)
		// =========================================================================
		const priorityGroup = new SettingGroup(this.containerEl).setHeading(
			'Priorités du briefing',
			'sparkles',
			'Tags et propriétés frontmatter accordant une priorité maximale lors du briefing matinal'
		);

		priorityGroup.addSetting((setting: Setting) => {
			setting
				.setName('Tags prioritaires')
				.setDesc('Tags accordant une priorité maximale aux notes et tâches correspondantes lors de l\'analyse du matin et de la sélection des priorités (séparés par des virgules ou retours à la ligne).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: #urgent, #prioritaire, #important, #focus, #p1')
						.setValue(this.plugin.settings.priorityTags || '')
						.onChange(async (value) => {
							this.plugin.settings.priorityTags = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		priorityGroup.addSetting((setting: Setting) => {
			setting
				.setName('Propriétés frontmatter prioritaires')
				.setDesc('Propriétés YAML valorisant la priorité des notes et de leurs tâches pour l\'IA (ex: priorite: haute, focus: true, statut: actif, priority: high).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: priorite: haute, focus: true, statut: actif, priority: high')
						.setValue(this.plugin.settings.priorityProperties || '')
						.onChange(async (value) => {
							this.plugin.settings.priorityProperties = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});
	}

	private renderVoiceSettings(): void {
		// =========================================================================
		// 8. Reconnaissance Vocale & Dictée (Voice-to-Text)
		// =========================================================================
		const sttGroup = new SettingGroup(this.containerEl).setHeading(
			'Reconnaissance vocale',
			'mic',
			'Transcription vocale locale Whisper WebAssembly ou reconnaissance système'
		);

		sttGroup.addSetting((setting: Setting) => {
			setting
				.setName('Moteur de transcription')
				.setDesc('Choisissez entre le modèle Whisper local (100% privé, sans serveur) et la reconnaissance vocale système (Web Speech API).')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('whisper-local', '🧠 Modèle Whisper WebAssembly local (100% Privé & Hors-ligne)')
						.addOption('web-speech', '⚡ Reconnaissance vocale système native (Web Speech API - 0 Mo)')
						.setValue(this.plugin.settings.sttEngine || 'whisper-local')
						.onChange(async (val: any) => {
							this.plugin.settings.sttEngine = val;
							await this.plugin.saveSettings();
							this.rerender();
						});
				});
		});

		if ((this.plugin.settings.sttEngine || 'whisper-local') === 'whisper-local') {
			sttGroup.addSetting((setting: Setting) => {
				setting
					.setName('Modèle Whisper')
					.setDesc('Taille du modèle Whisper quantifié chargé dans le navigateur. "Whisper Base" est vivement recommandé pour le français.')
					.addDropdown((dropdown) => {
						dropdown
							.addOption('whisper-base', '⚖️ Whisper Base (~73 Mo - Précision recommandée en français)')
							.addOption('whisper-tiny', '⚡ Whisper Tiny (~39 Mo - Ultra-rapide & léger)')
							.addOption('whisper-small', '🎯 Whisper Small (~240 Mo - Haute fidélité & précision)')
							.setValue(this.plugin.settings.sttModel || 'whisper-base')
							.onChange(async (val: any) => {
								this.plugin.settings.sttModel = val;
								await this.plugin.saveSettings();
							});
					});
			});
		}

		sttGroup.addSetting((setting: Setting) => {
			setting
				.setName('Langue par défaut de transcription')
				.setDesc('Langue de reconnaissance pour la transcription vocale (Français par défaut).')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('fr', '🇫🇷 Français (Par défaut)')
						.addOption('en', '🇬🇧 Anglais')
						.addOption('auto', '🌐 Détection automatique multilingue')
						.setValue(this.plugin.settings.sttLanguage || 'fr')
						.onChange(async (val: any) => {
							this.plugin.settings.sttLanguage = val;
							await this.plugin.saveSettings();
						});
				});
		});

		sttGroup.addSetting((setting: Setting) => {
			setting
				.setName('Envoi automatique après la dictée')
				.setDesc('Si activé, le message transcrit sera directement soumis à l\'IA dès l\'arrêt de l\'enregistrement vocal.')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.sttAutoSend ?? false)
						.onChange(async (val) => {
							this.plugin.settings.sttAutoSend = val;
							await this.plugin.saveSettings();
						});
				});
		});
	}

	private renderGoogleSettings(): void {
		// =========================================================================
		// 9. Google Calendar & Synchronisation Agendas
		// =========================================================================
		const calGroup = new SettingGroup(this.containerEl).setHeading(
			'Connexion',
			'calendar',
			'Connexion OAuth, synchronisation des calendriers et distinction des rôles'
		);

		calGroup.addSetting((setting: Setting) => {
			setting
				.setName('Client ID Google (Obligatoire)')
				.setDesc('Votre Google Cloud OAuth Client ID (Type Application de bureau ou Application Web).')
				.addText((text) => {
					text
						.setPlaceholder('ex: 123456789-xxx.apps.googleusercontent.com')
						.setValue(this.plugin.settings.googleClientId || '')
						.onChange(async (val) => {
							this.plugin.settings.googleClientId = val.trim();
							await this.plugin.saveSettings();
						});
				});
		});

		calGroup.addSetting((setting: Setting) => {
			setting
				.setName('Client Secret Google (Obligatoire)')
				.setDesc('Votre Google Cloud OAuth Client Secret (GOCSPX-...).')
				.addText((text) => {
					text
						.setPlaceholder('GOCSPX-...')
						.setValue(this.plugin.settings.googleClientSecret || '')
						.onChange(async (val) => {
							this.plugin.settings.googleClientSecret = val.trim();
							await this.plugin.saveSettings();
						});
					text.inputEl.type = 'password';
				});
		});

		const isLoggedIn = !!this.plugin.settings.googleRefreshToken;

		if (isLoggedIn) {
			calGroup.addSetting((setting: Setting) => {
				setting
					.setName('Statut : 🟢 Connecté à Google Calendar')
					.setDesc('Votre compte est authentifié. Personnalisez ci-dessous le rôle et le propriétaire de chaque calendrier pour guider précisément l\'IA.')
					.addButton((btn) => {
						btn
							.setButtonText('🔄 Actualiser la liste')
							.setTooltip('Interroger l\'API Google pour lister tous vos calendriers')
							.onClick(async () => {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Chargement...');
								try {
									this.discoveredCalendars = await GoogleCalendarService.listCalendars(this.plugin.settings);
									btn.setDisabled(false);
									btn.setButtonText('🔄 Actualiser la liste');
									new Notice(`📅 ${this.discoveredCalendars.length} calendrier(s) synchronisé(s).`);
									this.rerender();
								} catch (err: unknown) {
									btn.setDisabled(false);
									btn.setButtonText('🔄 Actualiser la liste');
									const msg = err instanceof Error ? err.message : String(err);
									new Notice(`❌ Erreur récupération calendriers : ${msg}`);
								}
							});
					})
					.addButton((btn) => {
						btn
							.setButtonText('🔄 Tester la connexion')
							.onClick(async () => {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Test...');
								try {
									const events = await GoogleCalendarService.getEvents(this.plugin.settings);
									btn.setDisabled(false);
									btn.setButtonText('🔄 Tester la connexion');
									new Notice(`✅ Connexion réussie ! ${events.length} événement(s) récupéré(s).`);
								} catch (err: unknown) {
									btn.setDisabled(false);
									btn.setButtonText('🔄 Tester la connexion');
									const msg = err instanceof Error ? err.message : String(err);
									new Notice(`❌ Erreur connexion : ${msg}`);
								}
							});
					})
					.addButton((btn) => {
						btn
							.setButtonText('Déconnecter')
							.setWarning()
							.onClick(async () => {
								await GoogleCalendarService.logoutGoogle(this.plugin);
								this.discoveredCalendars = null;
								this.rerender();
							});
					});
			});

			if (!this.plugin.settings.calendarsConfig) {
				this.plugin.settings.calendarsConfig = {};
			}

			// Chargé seulement à l'affichage réel (jamais pendant l'indexation de la recherche)
			calGroup.afterRender(() => {
				if (this.discoveredCalendars !== null) return;
				this.discoveredCalendars = [];
				GoogleCalendarService.listCalendars(this.plugin.settings).then((cals) => {
					this.discoveredCalendars = cals;
					if (cals.length > 0) this.rerender();
				}).catch(() => {
					this.discoveredCalendars = [];
				});
			});

			if (this.discoveredCalendars && this.discoveredCalendars.length > 0) {
				const calendarListGroup = new SettingGroup(this.containerEl).setHeading(
					'Rôle et couleur de chaque agenda',
					'calendar-check',
					'Définissez si chaque calendrier est principal, secondaire ou consultatif'
				);

				this.discoveredCalendars.forEach((c) => {
					const defaultCalId = this.plugin.settings.defaultCalendarId || 'primary';
					const isPrimaryByDefault = c.id === defaultCalId || (defaultCalId === 'primary' && !!c.primary);

					if (!this.plugin.settings.calendarsConfig![c.id]) {
						this.plugin.settings.calendarsConfig![c.id] = {
							id: c.id,
							summary: c.summary,
							role: isPrimaryByDefault ? 'primary' : 'other_person'
						};
					}

					const conf = this.plugin.settings.calendarsConfig![c.id];

					calendarListGroup.addSetting((setting: Setting) => {
						const primaryBadge = c.primary ? ' (Compte principal)' : '';
						setting
							.setName(`📅 ${c.summary}${primaryBadge}`)
							.setDesc(`ID : ${c.id}${c.description ? ` — ${c.description.slice(0, 50)}` : ''}`)
							.addDropdown((dropdown) => {
								dropdown.addOption('primary', '🌟 Calendrier principal (Mon agenda de référence)');
								dropdown.addOption('secondary', '🎯 Calendrier secondaire (Mes événements perso/flexibles)');
								dropdown.addOption('other_person', '👥 Calendrier d\'une autre personne (Consultatif)');
								dropdown.addOption('ignore', '🚫 Ne pas requêter (Ignoré)');

								dropdown.setValue(conf.role);

								dropdown.onChange(async (val) => {
									conf.role = val as CalendarRole;
									if (val === 'primary') {
										this.plugin.settings.defaultCalendarId = c.id;
									}
									await this.plugin.saveSettings();
									this.rerender();
								});
							});

						if (conf.role !== 'ignore') {
							const roleColor = conf.role === 'other_person'
								? () => (this.plugin.settings.otherPersonCalendarColor || '').trim() || OTHER_PERSON_COLOR
								: conf.role === 'primary'
									? () => (this.plugin.settings.primaryCalendarColor || '').trim() || this.themeColorHex('var(--interactive-accent)', '#8a5cf5')
									: () => (this.plugin.settings.useGoogleCalendarColors && c.backgroundColor) || SECONDARY_PALETTE[0];
							this.addColorControl(setting, () => conf.color || '', (v) => { conf.color = v; },
								() => (this.plugin.settings.useGoogleCalendarColors && c.backgroundColor) || roleColor());
						}

						if (conf.role === 'other_person') {
							setting.addText((text) => {
								text
									.setPlaceholder('Qui ? (ex: Sophie (conjointe), Équipe Tech...)')
									.setValue(conf.ownerName || '')
									.onChange(async (name) => {
										conf.ownerName = name.trim();
										await this.plugin.saveSettings();
									});
								text.inputEl.style.width = '200px';
							});
						}
					});
				});
			}
		} else {
			calGroup.addSetting((setting: Setting) => {
				setting
					.setName('Lancer l\'approbation Google Calendar')
					.setDesc('Démarre le serveur local temporaire et ouvre la page d\'autorisation Google dans votre navigateur. Assurez-vous d\'avoir ajouté l\'URI de redirection "http://127.0.0.1:42813/callback" dans votre console Google Cloud.')
					.addButton((btn) => {
						btn
							.setButtonText('🔗 Se connecter à Google Calendar')
							.setCta()
							.onClick(async () => {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Attente d\'approbation...');
								await GoogleCalendarService.startGoogleLogin(this.plugin, (success) => {
									btn.setDisabled(false);
									btn.setButtonText('🔗 Se connecter à Google Calendar');
									if (success) {
										this.rerender();
									}
								});
							});
					});
			});
		}
	}

	private renderGamificationSettings(): void {
		// =========================================================================
		// 10. Gamification & Boutique de Récompenses
		// =========================================================================
		const gamificationGroup = new SettingGroup(this.containerEl).setHeading(
			'Énergie',
			'zap'
		);

		gamificationGroup.addSetting((setting: Setting) => {
			setting
				.setName('Niveau d\'énergie initial')
				.setDesc('Votre niveau d\'énergie de base par défaut (de 1 à 10)')
				.addSlider((slider) => {
					slider
						.setLimits(1, 10, 1)
						.setValue(this.plugin.settings.energyLevel)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.energyLevel = value;
							await this.plugin.saveSettings();
						});
				});
		});

		// Boutique affichée directement dans la section (plus de sous-page à un seul lien)
		renderRewardsGroups(this.containerEl, this.plugin, () => this.rerender());
	}
}
