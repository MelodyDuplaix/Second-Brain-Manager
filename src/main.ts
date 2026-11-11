import { Plugin, Notice, PluginSettingTab, App, TFile, normalizePath, Editor, MarkdownView, WorkspaceLeaf, setIcon, debounce, Command } from 'obsidian';
import { TaskParser } from './parsers/taskParser';
import { CustomMatrixTagMapping, MatrixFeature } from './adapters/matrixAdapter';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from './models/syntaxConfig';
import { DashboardView, VIEW_TYPE_DASHBOARD } from './views/dashboardView';
import { GamificationHistoryView, VIEW_TYPE_GAMIFICATION_HISTORY } from './views/gamificationHistoryView';
import { ChatView, VIEW_TYPE_CHAT } from './views/chatView';
import { BriefingView, VIEW_TYPE_BRIEFING } from './views/briefingView';
import { EveningReviewView, VIEW_TYPE_EVENING_REVIEW } from './views/eveningReviewView';
import { CalendarView, VIEW_TYPE_CALENDAR } from './views/calendarView';
import { VIEW_TYPE_RECOVERY } from './views/recoveryView';
import { TaskCalendarView, VIEW_TYPE_TASK_CALENDAR } from './views/taskCalendarView';
import { Wallet, Reward, CompletionEvent, StreakData, UserBadge, WorkflowCounts, RewardPurchase } from './models/gamification';
import { GamificationService, PluginData } from './services/gamificationService';
import { PluginDataSyncService, SyncableData, WalletBaseline } from './services/pluginDataSyncService';
import { SettingsPageManager, SettingsPageType } from './settings/settingsPageManager';
import { SettingGroup } from './settings/settingGroup';
import { MainPage } from './settings/pages/mainPage';
import { PromptsPage } from './settings/pages/promptsPage';
import { RewardsPage } from './settings/pages/rewardsPage';
import * as ObsidianApi from 'obsidian';
import type { SettingDefinitionItem, SettingPage } from 'obsidian';
import { EnergyLevelModal } from './modals/energyLevelModal';
import { GoogleCalendarSettings, DEFAULT_GOOGLE_CALENDAR_SETTINGS } from './models/googleCalendar';
import { NoteActionsService } from './services/noteActionsService';
import { ConfiguredPrompt, DEFAULT_CONFIGURED_PROMPTS, LEGACY_CORRECT_INSTRUCTIONS } from './models/prompt';
import { VaultContextService } from './services/vaultContextService';
import { CalendarTaskSyncService } from './services/calendarTaskSyncService';
import { TaskStatusRegistry } from './models/taskStatusRegistry';
import { TaskExclusionSettings, DEFAULT_TASK_EXCLUSION_SETTINGS, getTaskExclusionRules } from './services/taskExclusionService';
import { DailyEntriesSettings, DEFAULT_DAILY_ENTRIES_SETTINGS } from './services/dailyEntriesService';
import { seedFilterPresets } from './services/calendarFilters';
import {
	FeatureKey,
	FeatureSettings,
	DEFAULT_FEATURE_SETTINGS,
	featureDefinition,
	isFeatureEnabled
} from './models/features';
import type { CalendarFilterPreset } from './services/calendarFilters';
import { DelegationFeature, DelegationSettings, DEFAULT_DELEGATION_SETTINGS } from './models/delegation';

export interface SecondBrainSettings extends TaskSyntaxConfig, GoogleCalendarSettings, TaskExclusionSettings, DailyEntriesSettings, FeatureSettings, DelegationSettings {
	energyLevel: number;
	defaultCoinsPerTask: number;
	/** Active la fonctionnalité des quadrants (matrice d'Eisenhower) dans tout le plugin */
	matrixEnabled: boolean;
	matrixProvider: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom';
	customMatrixMapping: CustomMatrixTagMapping;
	inboxFolder: string;
	templatesFolder: string;
	dailyNotesFolder: string;
	dailyNoteTemplatePath: string;
	autoOpenDailyNoteOnBriefing: boolean;

	// Vues ouvertes automatiquement (en arrière-plan) dans la barre latérale au démarrage
	startupSidebarViews: string[];

	// Densité visuelle de l'interface du plugin
	uiDensity: UiDensity;

	// Couleurs du calendrier (vide : couleur du thème)
	taskColorQ1: string;
	taskColorQ2: string;
	taskColorQ3: string;
	taskColorQ4: string;
	// Quadrants désactivés : couleur selon la priorité
	taskColorPrioHighest: string;
	taskColorPrioHigh: string;
	taskColorPrioMedium: string;
	taskColorPrioLow: string;
	taskColorPrioLowest: string;
	taskColorDefault: string;
	calendarTodayColor: string;

	// Préréglages de filtres du calendrier créés par l'utilisateur
	calendarFilterPresets: CalendarFilterPreset[];
	/** Vrai une fois les préréglages par défaut copiés dans la liste modifiable */
	calendarFilterPresetsSeeded: boolean;
	/** Préréglage appliqué à l'ouverture du calendrier (vide : derniers filtres utilisés) */
	calendarStartupPreset: string;

	// Titre de la section où l'IA ajoute les tâches acceptées (vide : détection automatique)
	taskInsertHeading: string;

	// Statuts de tâche lus dans les réglages du plugin Tasks (statuts personnalisés, statut suivant…)
	useTasksPluginStatuses: boolean;

	// Filtres de confidentialité & exclusion IA
	excludedFolders: string;
	excludedFiles: string;
	excludedTags: string;
	excludedProperties: string;

	// Éléments et règles de priorité IA (Briefing & planification)
	priorityTags: string;
	priorityProperties: string;

	// Instructions personnalisées pour les prompts du LLM
	customPromptInstructions: string;

	// Paramètres de Reconnaissance Vocale (Voice-to-Text / STT)
	sttEngine: 'whisper-local' | 'web-speech';
	sttModel: 'whisper-tiny' | 'whisper-base' | 'whisper-small';
	sttLanguage: 'auto' | 'fr' | 'en';
	sttAutoSend: boolean;

	llmProvider: 'gemini' | 'openai' | 'openrouter' | 'infomaniak' | 'ollama' | 'lm-studio' | 'lmstudio';
	llmEndpoint: string;
	llmModel: string;

	geminiSecretId?: string;
	openaiSecretId?: string;
	openrouterSecretId?: string;
	infomaniakSecretId?: string;
	infomaniakProductId?: string;

	configuredPrompts?: ConfiguredPrompt[];
}

/** Variable CSS globale ↔ réglage de couleur. */
export const CALENDAR_COLOR_VARS: Array<[string, keyof SecondBrainSettings]> = [
	['--sbm-color-q1', 'taskColorQ1'],
	['--sbm-color-q2', 'taskColorQ2'],
	['--sbm-color-q3', 'taskColorQ3'],
	['--sbm-color-q4', 'taskColorQ4'],
	['--sbm-color-prio-highest', 'taskColorPrioHighest'],
	['--sbm-color-prio-high', 'taskColorPrioHigh'],
	['--sbm-color-prio-medium', 'taskColorPrioMedium'],
	['--sbm-color-prio-low', 'taskColorPrioLow'],
	['--sbm-color-prio-lowest', 'taskColorPrioLowest'],
	['--sbm-color-task', 'taskColorDefault'],
	['--sbm-color-entry', 'dailyEntriesColor'],
	['--sbm-color-today', 'calendarTodayColor']
];

export const DEFAULT_SETTINGS: SecondBrainSettings = {
	...DEFAULT_SYNTAX_CONFIG,
	...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
	...DEFAULT_TASK_EXCLUSION_SETTINGS,
	...DEFAULT_DAILY_ENTRIES_SETTINGS,
	...DEFAULT_FEATURE_SETTINGS,
	...DEFAULT_DELEGATION_SETTINGS,
	energyLevel: 5,
	defaultCoinsPerTask: 1,
	matrixEnabled: true,
	matrixProvider: 'task-matrix',
	customMatrixMapping: {
		q1Tag: '#q1',
		q2Tag: '#q2',
		q3Tag: '#q3',
		q4Tag: '#q4',
	},
	inboxFolder: '00 - Inbox',
	templatesFolder: 'Templates',
	dailyNotesFolder: '04 - Journal',
	dailyNoteTemplatePath: '',
	autoOpenDailyNoteOnBriefing: true,

	startupSidebarViews: [],

	uiDensity: 'compact',

	taskColorQ1: '',
	taskColorQ2: '',
	taskColorQ3: '',
	taskColorQ4: '',
	taskColorPrioHighest: '',
	taskColorPrioHigh: '',
	taskColorPrioMedium: '',
	taskColorPrioLow: '',
	taskColorPrioLowest: '',
	taskColorDefault: '',
	calendarTodayColor: '',

	calendarFilterPresets: [],
	calendarFilterPresetsSeeded: false,
	calendarStartupPreset: '',

	taskInsertHeading: '',

	useTasksPluginStatuses: true,

	excludedFolders: '',
	excludedFiles: '',
	excludedTags: '',
	excludedProperties: '',

	priorityTags: '',
	priorityProperties: '',

	customPromptInstructions: '',

	sttEngine: 'whisper-local',
	sttModel: 'whisper-base',
	sttLanguage: 'fr',
	sttAutoSend: false,

	llmProvider: 'gemini',
	llmEndpoint: 'https://generativelanguage.googleapis.com',
	llmModel: 'gemini-1.5-flash',

	geminiSecretId: undefined,
	openaiSecretId: undefined,
	openrouterSecretId: undefined,
	infomaniakSecretId: undefined,
	infomaniakProductId: undefined,
	configuredPrompts: [],
};

interface StoredData {
	settings: SecondBrainSettings;
	/** Horodatage du dernier enregistrement des réglages (arbitrage entre deux appareils) */
	settingsUpdatedAt?: string;
	wallet: Wallet;
	rewards: Reward[];
	completionEvents: Record<string, CompletionEvent>;
	streak?: StreakData;
	badges?: Record<string, UserBadge>;
	workflowCounts?: WorkflowCounts;
	lastActiveSession?: string;
	rewardPurchases?: RewardPurchase[];
	deletedCompletions?: Record<string, string>;
	deletedPurchases?: Record<string, string>;
	gamificationResetAt?: string;
	walletBaseline?: WalletBaseline;
}

const DEFAULT_STORED_DATA: StoredData = {
	settings: DEFAULT_SETTINGS,
	wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
	rewards: [
		{ id: 'pause-jeu', name: '30 minutes de jeu', description: 'Une pause choisie sans culpabilité', cost: 20, enabled: true },
		{ id: 'pause-cafe', name: 'Pause Café Gourmet', description: 'Prendre le temps d\'une vraie pause', cost: 10, enabled: true }
	],
	completionEvents: {},
	streak: { currentStreak: 0, longestStreak: 0 },
	badges: {},
	workflowCounts: {
		morningBriefings: 0,
		eveningReviews: 0,
		recoveries: 0,
		notesMovedOrCleaned: 0
	}
};

export type UiDensity = 'comfortable' | 'compact' | 'dense';

/** Vues pouvant être ouvertes automatiquement dans la barre latérale au démarrage (ordre des onglets). */
export const STARTUP_SIDEBAR_VIEWS: Array<{ type: string; name: string; icon: string }> = [
	{ type: VIEW_TYPE_DASHBOARD, name: 'Tableau de bord', icon: 'layout-dashboard' },
	{ type: VIEW_TYPE_TASK_CALENDAR, name: 'Calendrier (tâches & agenda Google)', icon: 'calendar-check-2' },
	{ type: VIEW_TYPE_BRIEFING, name: 'Briefing du matin', icon: 'sun' },
	{ type: VIEW_TYPE_EVENING_REVIEW, name: 'Revue du soir', icon: 'moon' },
	{ type: VIEW_TYPE_CHAT, name: 'Assistant IA (chat)', icon: 'bot' },
	{ type: VIEW_TYPE_GAMIFICATION_HISTORY, name: 'Historique des pièces et statistiques', icon: 'coins' },
];

/** Icône et titre de chaque vue du plugin, pour redessiner les onglets non chargés. */
const VIEW_TAB_HEADERS: Record<string, { icon: string; title: string }> = {
	[VIEW_TYPE_DASHBOARD]: { icon: 'layout-dashboard', title: 'Tableau de bord' },
	[VIEW_TYPE_TASK_CALENDAR]: { icon: 'calendar-check-2', title: 'Calendrier' },
	[VIEW_TYPE_BRIEFING]: { icon: 'sun', title: 'Briefing du matin' },
	[VIEW_TYPE_EVENING_REVIEW]: { icon: 'moon', title: 'Revue du soir' },
	[VIEW_TYPE_RECOVERY]: { icon: 'coffee', title: 'Reprise après pause' },
	[VIEW_TYPE_CHAT]: { icon: 'bot', title: 'Assistant IA' },
	[VIEW_TYPE_CALENDAR]: { icon: 'calendar', title: 'Agenda Google' },
	[VIEW_TYPE_GAMIFICATION_HISTORY]: { icon: 'coins', title: 'Gamification, séries et trophées' },
};

export default class SecondBrainPlugin extends Plugin {
	settings: SecondBrainSettings;
	pluginData: PluginData;

	private lastUserCheckboxTime = 0;
	private lastUserCheckboxFilePath: string | null = null;
	private lastUserEditorChangeTime = 0;
	private lastUserEditorFilePath: string | null = null;
	public isPluginPerformingTaskAction = false;
	private registeredPromptCommandIds = new Set<string>();
	private statusBarItemEl: HTMLElement | null = null;
	/** Dernier contenu écrit dans `data.json` par cette instance : distingue nos écritures de celles d'un autre appareil. */
	private lastWrittenData: string | null = null;
	/** Horodatage du dernier enregistrement des réglages sur cet appareil. */
	private settingsUpdatedAt: string | undefined;
	/** Empreinte du dernier état de gamification affiché, pour ne rafraîchir qu'en cas de changement. */
	private lastGamificationSignature: string | null = null;
	/** Icônes du ruban créées pour une fonctionnalité (clé « fonctionnalité:icône ») */
	private featureRibbons = new Map<string, HTMLElement>();
	/** Identifiants courts des commandes de fonctionnalités actuellement enregistrées */
	private featureCommandIds = new Set<string>();

	public getPrompts(): ConfiguredPrompt[] {
		if (!this.settings.configuredPrompts || this.settings.configuredPrompts.length === 0) {
			this.settings.configuredPrompts = JSON.parse(JSON.stringify(DEFAULT_CONFIGURED_PROMPTS));
		} else {
			for (const def of DEFAULT_CONFIGURED_PROMPTS) {
				if (!this.settings.configuredPrompts.some(p => p.id === def.id)) {
					this.settings.configuredPrompts.push(JSON.parse(JSON.stringify(def)));
				}
			}
			// Migration : met à jour le prompt de correction s'il n'a jamais été personnalisé
			const correct = this.settings.configuredPrompts.find(p => p.id === 'correct');
			const newDefault = DEFAULT_CONFIGURED_PROMPTS.find(p => p.id === 'correct');
			if (correct && newDefault && LEGACY_CORRECT_INSTRUCTIONS.includes(correct.systemInstruction)) {
				correct.systemInstruction = newDefault.systemInstruction;
			}
		}
		return this.settings.configuredPrompts;
	}

	public getPrompt(id: string): ConfiguredPrompt | undefined {
		return this.getPrompts().find(p => p.id === id);
	}

	public registerCustomPromptCommands(): void {
		if (!this.isFeatureEnabled('ai')) return;
		const prompts = this.getPrompts();
		for (const prompt of prompts) {
			if (prompt.actionType === 'custom' && prompt.enabled && prompt.showInCommandPalette) {
				const commandId = `custom-prompt-${prompt.id}`;
				if (!this.registeredPromptCommandIds.has(commandId)) {
					this.registeredPromptCommandIds.add(commandId);
					this.addCommand({
						id: commandId,
						name: prompt.name,
						editorCallback: (editor: Editor, view: MarkdownView) => {
							const currentPrompt = this.getPrompt(prompt.id);
							if (currentPrompt && currentPrompt.enabled) {
								NoteActionsService.handleCustomPromptCommand(this.app, this, currentPrompt, editor, view);
							}
						}
					});
				}
			}
		}
	}

	public executePromptAction(prompt: ConfiguredPrompt, editor: Editor, view: MarkdownView): void {
		if (prompt.actionType === 'builtin') {
			switch (prompt.builtinType) {
				case 'correct':
					NoteActionsService.handleCorrectCommand(this.app, this, editor, view);
					break;
				case 'summarize':
					NoteActionsService.handleSummarizeCommand(this.app, this, editor, view);
					break;
				case 'rephrase':
					NoteActionsService.handleRephraseCommand(this.app, this, editor, view);
					break;
				case 'extract_tasks':
					NoteActionsService.handleExtractTasksCommand(this.app, this, editor, view);
					break;
				case 'breakdown_task':
					NoteActionsService.handleBreakdownTaskCommand(this.app, this, editor, view);
					break;
			}
		} else {
			NoteActionsService.handleCustomPromptCommand(this.app, this, prompt, editor, view);
		}
	}

	async onload() {
		await this.loadPluginData();
		MatrixFeature.setEnabled(this.settings.matrixEnabled !== false);
		this.applyDelegationSettings();
		this.touchActiveSession();
		this.registerCustomPromptCommands();
		await this.syncTasksPluginStatuses();
		this.applyUiDensity();
		this.register(() => document.body.removeClass('sbm-density-compact', 'sbm-density-dense'));
		this.applyCalendarColors();
		this.register(() => {
			CALENDAR_COLOR_VARS.forEach(([cssVar]) => document.body.style.removeProperty(cssVar));
			document.body.removeClass('sbm-tasks-by-priority');
		});

		// Enregistrement des vues
		this.registerView(
			VIEW_TYPE_DASHBOARD,
			(leaf) => new DashboardView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_GAMIFICATION_HISTORY,
			(leaf) => new GamificationHistoryView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) => new ChatView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_BRIEFING,
			(leaf) => new BriefingView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_EVENING_REVIEW,
			(leaf) => new EveningReviewView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf) => new CalendarView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_TASK_CALENDAR,
			(leaf) => new TaskCalendarView(leaf, this)
		);

		// Aperçu de la note au survol (Ctrl/Cmd) depuis le calendrier des tâches
		this.registerHoverLinkSource(VIEW_TYPE_TASK_CALENDAR, {
			display: 'Calendrier des tâches',
			defaultMod: true
		});

		// Icônes dans le ruban latéral
		this.addRibbonIcon('layout-dashboard', 'Tableau de bord', () => {
			this.activateDashboardView();
		});

		// Icônes et commandes des fonctionnalités activables (calendrier, IA, briefings, gamification)
		this.syncFeatureUi();

		// Ouverture des vues choisies dans la barre latérale, en arrière-plan
		this.app.workspace.onLayoutReady(() => {
			this.closeDisabledFeatureViews();
			void this.mergeLegacyCalendarLeaves();
			void this.openStartupSidebarViews();
			// Après un rechargement du plugin, les onglets restés en arrière-plan perdent leur icône :
			// on la redessine tout de suite, puis une seconde fois une fois qu'Obsidian a reconstruit les onglets.
			this.restoreViewTabHeaders();
			window.setTimeout(() => this.restoreViewTabHeaders(), 400);
		});

		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();

		// Traçage des interactions utilisateur sur les cases à cocher dans l'interface Obsidian.
		// Écoute en phase de capture : le plugin Tasks arrête la propagation du clic sur les cases
		// de ses requêtes (stopPropagation), qui n'atteindrait donc jamais un écouteur classique.
		const onCheckboxEvent = (evt: Event) => {
			const target = evt.target as HTMLElement | null;
			if (!target || !target.classList) return;
			if (
				target.classList.contains('task-list-item-checkbox') ||
				target.classList.contains('cm-task-checkbox') ||
				(target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox')
			) {
				this.recordUserCheckboxInteraction();
			}
		};
		const watchCheckboxes = (doc: Document) => {
			this.registerDomEvent(doc, 'click', onCheckboxEvent, { capture: true });
			this.registerDomEvent(doc, 'change', onCheckboxEvent, { capture: true });
		};
		watchCheckboxes(document);
		// Fenêtres détachées : leur document est distinct de celui de la fenêtre principale
		this.registerEvent(this.app.workspace.on('window-open', (win) => watchCheckboxes(win.doc)));

		// Traçage des modifications actives dans l'éditeur Markdown
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				this.lastUserEditorChangeTime = Date.now();
				const activeFile = (info as any)?.file || this.app.workspace.getActiveFile();
				this.lastUserEditorFilePath = activeFile?.path || null;
			})
		);

		// Réglages du plugin Tasks modifiés (statuts personnalisés…) : on les relit et on actualise les vues
		const tasksSettingsChanged = debounce(async () => {
			await this.syncTasksPluginStatuses();
			this.refreshTaskViews();
		}, 800, true);
		// Nos propres données modifiées par un autre appareil (synchronisation des fichiers, plugin ouvert
		// des deux côtés) : on fusionne au lieu de laisser la dernière écriture écraser l'autre.
		const ownDataPath = normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`);
		const ownDataChanged = debounce(() => {
			void this.reconcileExternalDataChange();
		}, 1500, true);
		this.registerEvent((this.app.vault as unknown as {
			on(name: 'raw', cb: (path: string) => void): import('obsidian').EventRef;
		}).on('raw', (path: string) => {
			if (path.endsWith('obsidian-tasks-plugin/data.json')) tasksSettingsChanged();
			else if (normalizePath(path) === ownDataPath) ownDataChanged();
		}));

		// Filet de sécurité : certains outils de synchronisation écrivent sans qu'Obsidian signale le
		// fichier. On revérifie donc à chaque retour sur la fenêtre (lecture de data.json, peu coûteuse).
		this.registerDomEvent(window, 'focus', () => ownDataChanged());

		// Écouteur automatique de complétion de tâches dans les fichiers Markdown
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					await this.checkFileForCompletedTasks(file);
				}
			})
		);

		// Commandes de la palette
		this.addCommand({
			id: 'ouvrir-dashboard',
			name: 'Ouvrir le tableau de bord',
			callback: () => {
				this.activateDashboardView();
			}
		});

		this.addCommand({
			id: 'indiquer-energie',
			name: 'Indiquer mon niveau d\'énergie',
			callback: () => {
				new EnergyLevelModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'analyser-taches',
			name: 'Analyser les tâches du coffre',
			callback: async () => {
				const files = this.app.vault.getMarkdownFiles();
				const rules = getTaskExclusionRules(this.app, this.settings);
				let count = 0;
				let excluded = 0;
				for (const file of files) {
					const content = await this.app.vault.cachedRead(file);
					const tasks = TaskParser.parseAllTasks(content, file.path, this.settings);
					const kept = rules.filter(tasks).length;
					count += kept;
					excluded += tasks.length - kept;
				}
				new Notice(`Analyse terminée : ${count} tâches trouvées dans le coffre${excluded ? ` (${excluded} exclues par vos règles)` : ''}.`);
			}
		});

		// Commandes contextuelles d'édition IA sur les notes
		// Intégration dynamique des Prompts & Actions IA dans le menu contextuel clic-droit
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (!this.isFeatureEnabled('ai')) return;
				const prompts = this.getPrompts();
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const isTaskLine = /^[-*0-9.]*\s*\[[ xX/]\]/.test(line.trim());
				const selection = editor.getSelection();
				const hasSelection = Boolean(selection.trim());

				let hasAddedSeparator = false;

				for (const prompt of prompts) {
					if (!prompt.enabled || !prompt.showInContextMenu) continue;

					if (prompt.builtinType === 'breakdown_task' && !isTaskLine) {
						continue;
					}
					if (prompt.requiresSelection && !hasSelection) {
						continue;
					}

					if (!hasAddedSeparator) {
						menu.addSeparator();
						hasAddedSeparator = true;
					}

					menu.addItem((item) => {
						const title = prompt.name.startsWith('Second Brain')
							? prompt.name
							: `Second Brain: ${prompt.name}`;
						item.setTitle(title)
							.setIcon(prompt.icon || 'sparkles')
							.onClick(() => {
								this.executePromptAction(prompt, editor, view as MarkdownView);
							});
					});
				}
			})
		);

		this.addSettingTab(new SecondBrainSettingTab(this.app, this));
	}

	/**
	 * Lit les statuts de tâche définis dans le plugin Tasks (data.json de son dossier) pour les
	 * interpréter comme lui : statuts personnalisés, statut suivant, non-tâches, filtre global.
	 * Retourne le nombre de statuts chargés (0 si Tasks est absent ou l'option désactivée).
	 */
	public async syncTasksPluginStatuses(): Promise<number> {
		if (this.settings.useTasksPluginStatuses === false) {
			TaskStatusRegistry.reset();
			return 0;
		}
		try {
			const path = normalizePath(`${this.app.vault.configDir}/plugins/obsidian-tasks-plugin/data.json`);
			if (!(await this.app.vault.adapter.exists(path))) {
				TaskStatusRegistry.reset();
				return 0;
			}
			const conf = TaskStatusRegistry.parseTasksPluginData(JSON.parse(await this.app.vault.adapter.read(path)));
			if (!conf) {
				TaskStatusRegistry.reset();
				return 0;
			}
			TaskStatusRegistry.configure(conf);
			return conf.statuses.length;
		} catch (e) {
			console.warn('[Second Brain Manager] Lecture des réglages du plugin Tasks impossible :', e);
			TaskStatusRegistry.reset();
			return 0;
		}
	}

	/** Recharge les vues qui listent des tâches (après un changement de règles ou de statuts). */
	public refreshTaskViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_CALENDAR).forEach(leaf => {
			if (leaf.view instanceof TaskCalendarView) void leaf.view.refresh();
		});
		this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD).forEach(leaf => {
			if (leaf.view instanceof DashboardView) void leaf.view.render();
		});
	}

	/** Recharge la vue des pièces et trophées (ex. après activation / désactivation des quadrants). */
	public refreshGamificationViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_GAMIFICATION_HISTORY).forEach(leaf => {
			if (leaf.view instanceof GamificationHistoryView) void leaf.view.render();
		});
	}

	/**
	 * Empreinte de l'état de gamification affiché (solde, historique, série, trophées, échanges).
	 * Elle sert à ne rafraîchir les vues que lorsque l'affichage changerait vraiment.
	 */
	private getGamificationSignature(): string {
		if (!this.pluginData) return '';
		const w = this.pluginData.wallet;
		const unlocked = Object.values(this.pluginData.badges || {}).filter(b => b?.unlockedAt).length;
		return [
			w.balance,
			w.lifetimeEarned,
			w.lifetimeSpent,
			Object.keys(this.pluginData.completionEvents || {}).length,
			(this.pluginData.rewardPurchases || []).length,
			(this.pluginData.rewards || []).length,
			this.pluginData.streak?.currentStreak || 0,
			this.pluginData.streak?.longestStreak || 0,
			unlocked
		].join('|');
	}

	/** Rafraîchissement groupé des vues qui affichent des pièces (plusieurs changements rapprochés = un seul rendu). */
	private readonly refreshCoinViews = debounce(() => {
		this.updateStatusBar();
		this.refreshGamificationViews();
		this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD).forEach(leaf => {
			if (leaf.view instanceof DashboardView) void leaf.view.render();
		});
	}, 120, false);

	/**
	 * À appeler après toute modification des pièces : barre d'état, vue « Gamification & Trophées » et
	 * tableau de bord sont remis à jour tout de suite, sans attendre une réouverture de la vue.
	 */
	public notifyGamificationChanged(force = false): void {
		if (!this.pluginData) return;
		const signature = this.getGamificationSignature();
		if (!force && signature === this.lastGamificationSignature) return;
		this.lastGamificationSignature = signature;
		this.updateStatusBar();
		this.refreshCoinViews();
	}

	/* ======================================================================
	   Fonctionnalités activables (calendrier, IA, briefings, gamification)
	   ====================================================================== */

	/** Vues propres à chaque fonctionnalité : fermées dès qu’elle est désactivée. */
	private static readonly FEATURE_VIEWS: Record<FeatureKey, string[]> = {
		calendar: [VIEW_TYPE_TASK_CALENDAR, VIEW_TYPE_CALENDAR],
		ai: [VIEW_TYPE_CHAT],
		briefings: [VIEW_TYPE_BRIEFING, VIEW_TYPE_EVENING_REVIEW, VIEW_TYPE_RECOVERY],
		gamification: [VIEW_TYPE_GAMIFICATION_HISTORY],
		delegated: []
	};

	public isFeatureEnabled(key: FeatureKey): boolean {
		return isFeatureEnabled(this.settings, key);
	}

	/**
	 * Personnes dans les tâches : active la lecture du jeton (et son sens) dans le parseur.
	 * Rien n'est lu (ni affiché) tant que la fonctionnalité est coupée.
	 */
	public applyDelegationSettings(): void {
		const before = DelegationFeature.signature();
		DelegationFeature.configure(
			this.isFeatureEnabled('delegated'),
			this.settings.delegatedTaskToken,
			this.settings.delegationMode,
			this.settings.delegationMyNames
		);
		const after = DelegationFeature.signature();
		// Les tâches déjà lues par le calendrier doivent être relues avec la nouvelle règle
		if (before !== after) this.app.workspace.trigger('sbm:delegation-changed');
	}

	/** Fonctionnalité dont dépend une vue (null : vue toujours disponible, ex. tableau de bord). */
	public featureOfViewType(viewType: string): FeatureKey | null {
		for (const [key, views] of Object.entries(SecondBrainPlugin.FEATURE_VIEWS)) {
			if (views.includes(viewType)) return key as FeatureKey;
		}
		return null;
	}

	public isViewTypeEnabled(viewType: string): boolean {
		const feature = this.featureOfViewType(viewType);
		return !feature || this.isFeatureEnabled(feature);
	}

	/** Vue d’une fonctionnalité désactivée : on prévient au lieu d’ouvrir. */
	private featureUnavailable(key: FeatureKey): boolean {
		if (this.isFeatureEnabled(key)) return false;
		const def = featureDefinition(key);
		new Notice(`« ${def.name} » est désactivé dans les réglages de Second Brain Manager.`);
		return true;
	}

	/** Icônes du ruban qui dépendent d’une fonctionnalité. */
	private featureRibbonDefs(): Array<{ feature: FeatureKey; icon: string; title: string; click: (evt: MouseEvent) => void }> {
		return [
			{ feature: 'briefings', icon: 'sun', title: 'Briefing du matin (avec tri & reprise)', click: () => this.activateBriefingView() },
			{ feature: 'briefings', icon: 'moon', title: 'Revue du soir', click: () => this.activateEveningReviewView() },
			{
				feature: 'calendar',
				icon: 'calendar-check-2',
				title: 'Calendrier (tâches & agenda Google)',
				// Ctrl/Cmd + clic : ouverture en grand dans la vue principale
				click: (evt: MouseEvent) => this.activateTaskCalendarView(evt.ctrlKey || evt.metaKey ? 'main' : 'sidebar')
			},
			{ feature: 'gamification', icon: 'coins', title: 'Historique des pièces et statistiques', click: () => this.activateHistoryView() },
			{ feature: 'ai', icon: 'bot', title: 'Assistant IA', click: () => this.activateChatView() }
		];
	}

	/** Commandes qui dépendent d’une fonctionnalité (retirées de la palette quand elle est désactivée). */
	private featureCommandDefs(): Array<{ feature: FeatureKey; command: Command }> {
		return [
			{ feature: 'briefings', command: { id: 'ouvrir-briefing', name: 'Ouvrir le briefing du matin', callback: () => void this.activateBriefingView() } },
			{ feature: 'briefings', command: { id: 'ouvrir-revue-soir', name: 'Ouvrir la revue du soir', callback: () => void this.activateEveningReviewView() } },
			{ feature: 'briefings', command: { id: 'ouvrir-reprise-pause', name: 'Reprendre après une pause', callback: () => void this.activateBriefingView() } },
			{ feature: 'ai', command: { id: 'ouvrir-chat-ia', name: 'Ouvrir le chat IA', callback: () => void this.activateChatView() } },
			{
				feature: 'ai',
				command: {
					id: 'inclure-dossier-exclu-chat',
					name: 'Inclure temporairement un dossier exclu dans le chat',
					callback: async () => {
						await this.activateChatView();
						const chatLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
						if (chatLeaf && chatLeaf.view instanceof ChatView) {
							chatLeaf.view.openIncludeExcludedFolderModal();
						}
					}
				}
			},
			{ feature: 'calendar', command: { id: 'ouvrir-calendrier-taches', name: 'Ouvrir le calendrier (barre latérale)', callback: () => void this.activateTaskCalendarView('sidebar') } },
			{ feature: 'calendar', command: { id: 'ouvrir-calendrier-taches-grand', name: 'Ouvrir le calendrier en grand (vue principale)', callback: () => void this.activateTaskCalendarView('main') } },
			{ feature: 'calendar', command: { id: 'ouvrir-agenda-google', name: 'Ouvrir l’agenda Google Calendar (calendrier unifié)', callback: () => void this.activateCalendarView() } },
			{
				feature: 'calendar',
				command: {
					id: 'importer-rdv-note-quotidienne',
					name: 'Importer les RDV de l’agenda en tâches dans la note quotidienne',
					callback: async () => {
						const res = await CalendarTaskSyncService.syncCalendarEventsToDailyNote(this.app, this, { openDailyNote: true });
						if (!res.success) {
							new Notice(`[Second Brain] ${res.error || 'Erreur lors de l’importation de l’agenda.'}`);
							return;
						}
						if (res.eventsFound === 0) {
							new Notice(`[Second Brain] Aucun rendez-vous trouvé dans votre agenda pour aujourd’hui (${res.date}).`);
							return;
						}
						if (res.tasksCreated === 0) {
							new Notice(`[Second Brain] Tous les rendez-vous (${res.eventsFound}) sont déjà présents dans votre note quotidienne.`);
							return;
						}
						const plural = res.tasksCreated > 1 ? 's' : '';
						const alreadyText = res.tasksAlreadyExisting > 0 ? ` (${res.tasksAlreadyExisting} déjà présent${res.tasksAlreadyExisting > 1 ? 's' : ''})` : '';
						new Notice(`📅 ${res.tasksCreated} rendez-vous importé${plural} en tâche${plural} dans votre note quotidienne${alreadyText} !`);
					}
				}
			},
			{ feature: 'gamification', command: { id: 'ouvrir-historique-pieces', name: 'Ouvrir l’historique des pièces et statistiques', callback: () => void this.activateHistoryView() } },
			// Commandes contextuelles d’édition IA sur les notes
			{ feature: 'ai', command: { id: 'extraire-taches-note', name: 'Extraire les tâches de la note ou de la sélection', editorCallback: (editor: Editor, view: MarkdownView) => NoteActionsService.handleExtractTasksCommand(this.app, this, editor, view) } },
			{ feature: 'ai', command: { id: 'decomposer-tache-curseur', name: 'Décomposer la tâche sous le curseur', editorCallback: (editor: Editor, view: MarkdownView) => NoteActionsService.handleBreakdownTaskCommand(this.app, this, editor, view) } },
			{ feature: 'ai', command: { id: 'resumer-note-selection', name: 'Résumer la note ou la sélection', editorCallback: (editor: Editor, view: MarkdownView) => NoteActionsService.handleSummarizeCommand(this.app, this, editor, view) } },
			{ feature: 'ai', command: { id: 'reformuler-selection', name: 'Reformuler la sélection pour améliorer la clarté', editorCallback: (editor: Editor, view: MarkdownView) => NoteActionsService.handleRephraseCommand(this.app, this, editor, view) } },
			{ feature: 'ai', command: { id: 'corriger-sans-reformuler', name: 'Corriger sans reformuler', editorCallback: (editor: Editor, view: MarkdownView) => NoteActionsService.handleCorrectCommand(this.app, this, editor, view) } }
		];
	}

	/**
	 * Aligne l’interface sur les fonctionnalités actives : icônes du ruban, commandes de la palette,
	 * vues ouvertes et barre d’état. Appelée au chargement et à chaque changement de réglage.
	 */
	public syncFeatureUi(): void {
		this.applyDelegationSettings();
		for (const def of this.featureRibbonDefs()) {
			const key = `${def.feature}:${def.icon}`;
			const existing = this.featureRibbons.get(key);
			const enabled = this.isFeatureEnabled(def.feature);
			if (enabled && !existing) {
				this.featureRibbons.set(key, this.addRibbonIcon(def.icon, def.title, def.click));
			} else if (!enabled && existing) {
				existing.remove();
				this.featureRibbons.delete(key);
			}
		}

		for (const def of this.featureCommandDefs()) {
			const enabled = this.isFeatureEnabled(def.feature);
			const registered = this.featureCommandIds.has(def.command.id);
			if (enabled && !registered) {
				this.addCommand(def.command);
				this.featureCommandIds.add(def.command.id);
			} else if (!enabled && registered) {
				this.removeCommandById(def.command.id);
				this.featureCommandIds.delete(def.command.id);
			}
		}

		if (!this.isFeatureEnabled('ai')) {
			for (const id of this.registeredPromptCommandIds) this.removeCommandById(id);
			this.registeredPromptCommandIds.clear();
		} else {
			this.registerCustomPromptCommands();
		}

		this.closeDisabledFeatureViews();
		this.updateStatusBar();
	}

	/** Retire une commande de la palette (API interne : absente des types publics d’Obsidian). */
	private removeCommandById(id: string): void {
		const commands = (this.app as unknown as { commands?: { removeCommand?: (fullId: string) => void } }).commands;
		commands?.removeCommand?.(`${this.manifest.id}:${id}`);
	}

	/** Ferme les vues des fonctionnalités désactivées (elles resteraient ouvertes après un changement). */
	private closeDisabledFeatureViews(): void {
		for (const [key, views] of Object.entries(SecondBrainPlugin.FEATURE_VIEWS)) {
			if (this.isFeatureEnabled(key as FeatureKey)) continue;
			for (const viewType of views) {
				this.app.workspace.getLeavesOfType(viewType).forEach(leaf => leaf.detach());
			}
		}
	}

	/** Applique la densité choisie via une classe sur <body> (lue par styles.css). */
	public applyUiDensity(): void {
		const density = this.settings.uiDensity || 'compact';
		document.body.toggleClass('sbm-density-compact', density === 'compact');
		document.body.toggleClass('sbm-density-dense', density === 'dense');
	}

	/** Couleurs choisies dans les réglages, exposées en variables CSS (vues, aperçus et fantômes de glisser). */
	public applyCalendarColors(): void {
		for (const [cssVar, key] of CALENDAR_COLOR_VARS) {
			const value = String(this.settings[key] || '').trim();
			if (value) document.body.style.setProperty(cssVar, value);
			else document.body.style.removeProperty(cssVar);
		}
		// Sans quadrants, les tâches sont colorées selon leur priorité
		document.body.toggleClass('sbm-tasks-by-priority', this.settings.matrixEnabled === false);
	}

	/** Applique un changement de couleur : variables CSS et couleurs des agendas, sans recharger les événements. */
	public refreshCalendarColors(): void {
		this.applyCalendarColors();
		this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_CALENDAR).forEach(leaf => {
			if (leaf.view instanceof TaskCalendarView) leaf.view.recolor();
		});
	}

	onunload() {
		// Nettoyage automatique assuré par Obsidian pour les vues et événements enregistrés
	}

	public recordUserCheckboxInteraction(filePath?: string): void {
		this.lastUserCheckboxTime = Date.now();
		const targetPath = filePath || this.app.workspace.getActiveFile()?.path;
		this.lastUserCheckboxFilePath = targetPath || null;
	}

	public isLocalUserTaskCheck(filePath: string): boolean {
		const now = Date.now();
		const isRecentPluginAction = this.isPluginPerformingTaskAction;
		const isRecentCheckbox = (now - this.lastUserCheckboxTime < 3500);
		const isRecentEditor = (now - this.lastUserEditorChangeTime < 3500) && (!this.lastUserEditorFilePath || this.lastUserEditorFilePath === filePath);
		return isRecentPluginAction || isRecentCheckbox || isRecentEditor;
	}

	public async checkFileForCompletedTasks(file: TFile): Promise<void> {
		// Gamification désactivée : aucune pièce distribuée, aucun historique enregistré
		if (!this.isFeatureEnabled('gamification')) return;
		const isLocal = this.isLocalUserTaskCheck(file.path);
		const content = await this.app.vault.read(file);
		const tasks = TaskParser.parseAllTasks(content, file.path, this.settings);

		let dataModified = false;
		let awardedTasks = 0;
		let awardedCoins = 0;
		const unlockedBadges = new Map<string, { name: string; description: string }>();
		// Doublons exacts (même titre, même date ✅) dans le fichier : numérotés pour rester distincts
		const seen = new Map<string, number>();

		for (const task of tasks) {
			// Tâche attribuée à quelqu'un d'autre : ses pièces ne sont pas les miennes
			if (task.forOthers && DelegationFeature.hidesOthers()) continue;
			if (task.completed || task.status === 'done') {
				const baseId = GamificationService.getStableTaskId(task);
				const occurrence = seen.get(baseId) || 0;
				seen.set(baseId, occurrence + 1);
				if (isLocal) {
					const res = GamificationService.processCompletion(task, this.pluginData, this.settings.matrixProvider, undefined, occurrence);
					if (res.rewardGranted) {
						dataModified = true;
						awardedTasks++;
						awardedCoins += res.coinsEarned;
						// Les notifications attendent l'enregistrement : le solde annoncé est alors celui
						// qui tient compte des pièces arrivées d'un autre appareil.
						for (const badge of res.newlyUnlockedBadges || []) {
							unlockedBadges.set(badge.id, { name: badge.name, description: badge.description });
						}
					}
				} else {
					// Tâche cochée hors Obsidian (ex: synchronisation depuis un autre appareil / sync distant)
					// On enregistre silencieusement pour éviter de distribuer des pièces ou notifications en double
					const syncRes = GamificationService.recordSyncCompletion(task, this.pluginData, this.settings.matrixProvider, occurrence);
					if (syncRes.newlyRecorded) {
						dataModified = true;
					}
				}
			}
		}

		if (dataModified) {
			await this.savePluginData();
		}

		if (awardedTasks > 0) {
			const label = awardedTasks > 1 ? `${awardedTasks} tâches terminées !` : 'Tâche terminée !';
			new Notice(`${label} +${awardedCoins} 🪙 (Solde : ${this.pluginData.wallet.balance} 🪙 | Série : ${this.pluginData.streak.currentStreak}j 🔥)`);
			for (const badge of unlockedBadges.values()) {
				new Notice(`🏆 NOUVEAU BADGE DÉBLOQUÉ : ${badge.name} !\n${badge.description}`, 7000);
			}
		}
	}

	async activateDashboardView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
			if (leaf.view instanceof DashboardView) {
				await (leaf.view as DashboardView).render();
			}
		}
	}

	async activateBriefingView(requestedEnergy?: number) {
		if (this.featureUnavailable('briefings')) return;
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_BRIEFING)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_BRIEFING, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
			if (leaf.view instanceof BriefingView) {
				if (requestedEnergy !== undefined) {
					await (leaf.view as BriefingView).launchBriefingWithEnergy(requestedEnergy);
				}
			}
		}

		if (this.settings.autoOpenDailyNoteOnBriefing !== false) {
			try {
				const vaultContext = new VaultContextService(this.app, this.settings);
				const todayStr = new Date().toISOString().split('T')[0];
				const dailyRes = await vaultContext.getOrCreateDailyNote(todayStr, this.settings.dailyNoteTemplatePath);
				if (dailyRes.file) {
					await vaultContext.openDailyNoteInWorkspace(dailyRes.file);
				}
			} catch (e) {
				console.warn('[Second Brain Manager] Impossible d\'ouvrir la note quotidienne:', e);
			}
		}
	}

	async activateEveningReviewView() {
		if (this.featureUnavailable('briefings')) return;
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_EVENING_REVIEW)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_EVENING_REVIEW, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateRecoveryView() {
		if (this.featureUnavailable('briefings')) return;
		// La reprise après pause et le tri large sont intégrés directement dans le Briefing du matin
		await this.activateBriefingView();
	}

	async activateHistoryView() {
		if (this.featureUnavailable('gamification')) return;
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_GAMIFICATION_HISTORY)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_GAMIFICATION_HISTORY, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Fusion des calendriers : chaque onglet de l'ancien « Agenda Google » est remplacé par le
	 * calendrier unifié, ou fermé si un calendrier unifié existe déjà au même endroit.
	 */
	private async mergeLegacyCalendarLeaves(): Promise<void> {
		const { workspace } = this.app;
		const isSide = (leaf: WorkspaceLeaf) => {
			const root = leaf.getRoot();
			return root === workspace.rightSplit || root === workspace.leftSplit;
		};
		for (const leaf of workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)) {
			const side = isSide(leaf);
			const duplicate = workspace.getLeavesOfType(VIEW_TYPE_TASK_CALENDAR).some(l => isSide(l) === side);
			if (duplicate) {
				leaf.detach();
			} else {
				await leaf.setViewState({ type: VIEW_TYPE_TASK_CALENDAR, active: false });
			}
		}
	}

	/**
	 * Redessine l'icône et le titre des onglets du plugin.
	 * Les onglets non chargés (« deferred », Obsidian ≥ 1.7) ne sont pas réaffichés par Obsidian
	 * après un rechargement du plugin : on corrige leur en-tête sans charger la vue,
	 * pour ne pas déclencher ses traitements (lecture du coffre, synchronisation…).
	 */
	private restoreViewTabHeaders(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const header = VIEW_TAB_HEADERS[leaf.getViewState().type];
			if (!header) return;

			const internal = leaf as unknown as {
				tabHeaderInnerIconEl?: HTMLElement;
				tabHeaderInnerTitleEl?: HTMLElement;
				tabHeaderEl?: HTMLElement;
				updateHeader?: () => void;
			};

			if (!leaf.isDeferred) {
				internal.updateHeader?.();
				return;
			}

			if (internal.tabHeaderInnerIconEl) {
				internal.tabHeaderInnerIconEl.empty();
				setIcon(internal.tabHeaderInnerIconEl, header.icon);
				internal.tabHeaderInnerTitleEl?.setText(header.title);
				internal.tabHeaderEl?.setAttribute('aria-label', header.title);
			} else {
				// API interne absente : on charge la vue en dernier recours
				void leaf.loadIfDeferred();
			}
		});
	}

	/**
	 * Ouvre dans la barre latérale droite les vues cochées dans les réglages, sans les afficher
	 * ni leur donner le focus. Les vues déjà présentes (restaurées par Obsidian) sont ignorées.
	 */
	async openStartupSidebarViews(): Promise<void> {
		const { workspace } = this.app;
		const wanted = (this.settings.startupSidebarViews || [])
			.filter(type => STARTUP_SIDEBAR_VIEWS.some(v => v.type === type))
			// Une vue dont la fonctionnalité est désactivée ne s'ouvre pas au démarrage
			.filter(type => this.isViewTypeEnabled(type));
		const ordered = STARTUP_SIDEBAR_VIEWS.filter(v => wanted.includes(v.type));
		if (ordered.length === 0) return;

		// Mémorise l'onglet visible de chaque groupe de la barre droite pour le restaurer ensuite
		type TabGroup = { currentTab?: number; children?: WorkspaceLeaf[]; selectTabIndex?: (i: number) => void };
		const visibleBefore = new Map<TabGroup, number>();
		const rememberTabs = () => {
			workspace.iterateAllLeaves(leaf => {
				if (leaf.getRoot() !== workspace.rightSplit) return;
				const group = leaf.parent as unknown as TabGroup;
				if (group && typeof group.currentTab === 'number' && !visibleBefore.has(group)) {
					visibleBefore.set(group, group.currentTab);
				}
			});
		};
		rememberTabs();

		for (const view of ordered) {
			if (workspace.getLeavesOfType(view.type).length > 0) continue;
			try {
				const leaf = workspace.getRightLeaf(false);
				if (!leaf) continue;
				await leaf.setViewState({ type: view.type, active: false });
			} catch (e) {
				console.warn(`[Second Brain Manager] Ouverture au démarrage impossible : ${view.name}`, e);
			}
		}

		visibleBefore.forEach((index, group) => {
			if (group.currentTab !== index && typeof group.selectTabIndex === 'function') {
				group.selectTabIndex(index);
			}
		});
	}

	/**
	 * Ouvre le calendrier des tâches dans la barre latérale droite ou dans la zone principale.
	 * Réutilise une vue existante au même emplacement plutôt que d'en créer une seconde.
	 */
	async activateTaskCalendarView(location: 'sidebar' | 'main' = 'sidebar') {
		if (this.featureUnavailable('calendar')) return;
		const { workspace } = this.app;
		const isSide = (leaf: WorkspaceLeaf) => {
			const root = leaf.getRoot();
			return root === workspace.rightSplit || root === workspace.leftSplit;
		};
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_CALENDAR);
		let leaf: WorkspaceLeaf | null = existing.find(l => (location === 'sidebar') === isSide(l)) || null;

		if (!leaf) {
			const previousState = existing[0]?.view?.getState();
			leaf = location === 'sidebar' ? workspace.getRightLeaf(false) : workspace.getLeaf('tab');
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_TASK_CALENDAR, active: true, state: previousState });
		}

		await workspace.revealLeaf(leaf);
	}

	/** L'agenda Google est désormais intégré au calendrier unifié. */
	async activateCalendarView() {
		if (this.featureUnavailable('calendar')) return;
		await this.activateTaskCalendarView('sidebar');
	}

	async activateChatView() {
		if (this.featureUnavailable('ai')) return;
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Ouvre le chat avec une conversation prédéfinie et déclenche la suite de la discussion.
	 */
	async openChatWithConversation(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp?: string }>, autoTrigger = false): Promise<void> {
		await this.activateChatView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
		if (leaf && leaf.view instanceof ChatView) {
			await (leaf.view as ChatView).setConversation(messages, autoTrigger);
		}
	}

	/**
	 * Récupération sécurisée des clés d'API via le Secret Storage d'Obsidian (docs.obsidian.md/plugins/guides/secret-storage)
	 */
	async getSecretApiKey(provider: string): Promise<string | undefined> {
		let secretId: string | undefined;
		if (provider === 'gemini') {
			secretId = this.settings.geminiSecretId;
		} else if (provider === 'openai') {
			secretId = this.settings.openaiSecretId;
		} else if (provider === 'openrouter') {
			secretId = this.settings.openrouterSecretId;
		} else if (provider === 'infomaniak') {
			secretId = this.settings.infomaniakSecretId;
		}

		if (!secretId) {
			return undefined;
		}

		// Utilisation de l'API officielle de stockage des secrets si disponible sur l'instance Obsidian
		const secretStorage = (this.app as unknown as { secretStorage?: { getSecret: (key: string) => Promise<string | null> } }).secretStorage;
		if (secretStorage && typeof secretStorage.getSecret === 'function') {
			const secret = await secretStorage.getSecret(secretId);
			if (secret) return secret;
		}

		// Fallback sur le stockage local de l'instance
		return window.localStorage.getItem(`sbm_secret_${secretId}`) || undefined;
	}

	async loadPluginData() {
		const stored = await this.loadData();
		this.lastWrittenData = stored ? JSON.stringify(stored) : null;
		const raw: StoredData = Object.assign({}, DEFAULT_STORED_DATA, stored);
		this.settingsUpdatedAt = raw.settingsUpdatedAt;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
		// Préréglages de filtres par défaut copiés une fois dans la liste, pour pouvoir les modifier
		if (!this.settings.calendarFilterPresetsSeeded) {
			this.settings.calendarFilterPresets = seedFilterPresets(this.settings.calendarFilterPresets);
			this.settings.calendarFilterPresetsSeeded = true;
		}
		if (Array.isArray(this.settings.startupSidebarViews) && this.settings.startupSidebarViews.includes(VIEW_TYPE_CALENDAR)) {
			const merged = new Set(this.settings.startupSidebarViews.map(t => t === VIEW_TYPE_CALENDAR ? VIEW_TYPE_TASK_CALENDAR : t));
			this.settings.startupSidebarViews = [...merged];
		}
		if (this.settings.autoOpenDailyNoteOnBriefing === undefined) {
			this.settings.autoOpenDailyNoteOnBriefing = true;
		}

		// Normalisation des chemins configurés
		if (this.settings.inboxFolder) {
			this.settings.inboxFolder = normalizePath(this.settings.inboxFolder);
		}
		if (this.settings.dailyNotesFolder) {
			this.settings.dailyNotesFolder = normalizePath(this.settings.dailyNotesFolder);
		}

		this.pluginData = {
			wallet: raw.wallet || DEFAULT_STORED_DATA.wallet,
			rewards: raw.rewards || DEFAULT_STORED_DATA.rewards,
			completionEvents: raw.completionEvents || DEFAULT_STORED_DATA.completionEvents,
			streak: raw.streak || DEFAULT_STORED_DATA.streak || { currentStreak: 0, longestStreak: 0 },
			badges: raw.badges || DEFAULT_STORED_DATA.badges || {},
			workflowCounts: raw.workflowCounts || DEFAULT_STORED_DATA.workflowCounts || {
				morningBriefings: 0,
				eveningReviews: 0,
				recoveries: 0,
				notesMovedOrCleaned: 0
			},
			lastActiveSession: raw.lastActiveSession,
			rewardPurchases: raw.rewardPurchases || [],
			deletedCompletions: raw.deletedCompletions || {},
			deletedPurchases: raw.deletedPurchases || {},
			gamificationResetAt: raw.gamificationResetAt,
			walletBaseline: raw.walletBaseline
		};

		GamificationService.ensureDataStructures(this.pluginData);
		// Nettoyage des anciennes tâches cochées enregistrées en masse à 0 pièce (identifiants liés aux numéros de ligne)
		const pruned = GamificationService.pruneHistoricalSyncEvents(this.pluginData);
		PluginDataSyncService.recomputeWallet(this.pluginData);
		GamificationService.checkAndUnlockBadges(this.pluginData);
		if (pruned > 0 || raw.walletBaseline === undefined) {
			if (pruned > 0) {
				console.info(`[Second Brain Manager] ${pruned} complétion(s) historique(s) en double retirée(s) de l'historique.`);
			}
			await this.savePluginData();
		}
		this.getPrompts();
	}

	/** État complet du plugin tel qu'il serait écrit dans `data.json`. */
	private buildStoredData(): StoredData {
		return {
			settings: this.settings,
			settingsUpdatedAt: this.settingsUpdatedAt,
			wallet: this.pluginData.wallet,
			rewards: this.pluginData.rewards,
			completionEvents: this.pluginData.completionEvents,
			streak: this.pluginData.streak,
			badges: this.pluginData.badges,
			workflowCounts: this.pluginData.workflowCounts,
			lastActiveSession: this.pluginData.lastActiveSession,
			rewardPurchases: this.pluginData.rewardPurchases || [],
			deletedCompletions: this.pluginData.deletedCompletions || {},
			deletedPurchases: this.pluginData.deletedPurchases || {},
			gamificationResetAt: this.pluginData.gamificationResetAt,
			walletBaseline: this.pluginData.walletBaseline
		};
	}

	/**
	 * Applique un état fusionné à l'instance. Les champs de `pluginData` sont remplacés sur place :
	 * les vues gardent ainsi leur référence à l'objet.
	 */
	private applyStoredData(data: StoredData): void {
		this.settings = data.settings;
		this.settingsUpdatedAt = data.settingsUpdatedAt;
		this.pluginData.wallet = data.wallet;
		this.pluginData.rewards = data.rewards;
		this.pluginData.completionEvents = data.completionEvents;
		if (data.streak) this.pluginData.streak = data.streak;
		if (data.badges) this.pluginData.badges = data.badges;
		if (data.workflowCounts) this.pluginData.workflowCounts = data.workflowCounts;
		this.pluginData.lastActiveSession = data.lastActiveSession;
		this.pluginData.rewardPurchases = data.rewardPurchases || [];
		this.pluginData.deletedCompletions = data.deletedCompletions || {};
		this.pluginData.deletedPurchases = data.deletedPurchases || {};
		this.pluginData.gamificationResetAt = data.gamificationResetAt;
		this.pluginData.walletBaseline = data.walletBaseline;
		GamificationService.ensureDataStructures(this.pluginData);
	}

	/**
	 * Enregistre les données. Le fichier `data.json` est d'abord relu : s'il a été modifié par un autre
	 * appareil (plugin ouvert des deux côtés, synchronisation des fichiers), les deux états sont fusionnés
	 * au lieu d'être écrasés. C'est ce qui garantit le même nombre de pièces partout.
	 */
	async savePluginData() {
		let dataToStore = this.buildStoredData();
		try {
			const onDisk = (await this.loadData()) as StoredData | null;
			if (onDisk && JSON.stringify(onDisk) !== this.lastWrittenData) {
				dataToStore = PluginDataSyncService.merge(
					dataToStore as SyncableData<SecondBrainSettings>,
					Object.assign({}, DEFAULT_STORED_DATA, onDisk) as SyncableData<SecondBrainSettings>
				) as StoredData;
				GamificationService.pruneHistoricalSyncEvents(dataToStore as unknown as PluginData);
				PluginDataSyncService.recomputeWallet(dataToStore);
				this.applyStoredData(dataToStore);
				GamificationService.checkAndUnlockBadges(this.pluginData);
				dataToStore = this.buildStoredData();
			}
		} catch (e) {
			console.warn('[Second Brain Manager] Fusion des données synchronisées impossible, écriture directe :', e);
		}
		this.lastWrittenData = JSON.stringify(dataToStore);
		await this.saveData(dataToStore);
		// Toute modification des pièces passe par ici : les vues se mettent à jour immédiatement.
		this.notifyGamificationChanged();
	}

	/**
	 * `data.json` modifié en dehors de cette instance (autre appareil + synchronisation de fichiers) :
	 * on fusionne les deux états, on réécrit le résultat pour que les deux appareils convergent, puis on
	 * rafraîchit l'affichage.
	 */
	private async reconcileExternalDataChange(): Promise<void> {
		if (!this.pluginData) return;
		let onDisk: StoredData | null;
		try {
			onDisk = (await this.loadData()) as StoredData | null;
		} catch (e) {
			console.warn('[Second Brain Manager] Relecture de data.json impossible :', e);
			return;
		}
		if (!onDisk) return;
		const diskSerialized = JSON.stringify(onDisk);
		// Modification provoquée par notre propre écriture : rien à faire
		if (diskSerialized === this.lastWrittenData) return;

		const local = this.buildStoredData();
		const merged = PluginDataSyncService.merge(
			local as SyncableData<SecondBrainSettings>,
			Object.assign({}, DEFAULT_STORED_DATA, onDisk) as SyncableData<SecondBrainSettings>
		) as StoredData;
		GamificationService.pruneHistoricalSyncEvents(merged as unknown as PluginData);
		PluginDataSyncService.recomputeWallet(merged);

		const previousBalance = this.pluginData.wallet.balance;
		this.applyStoredData(merged);
		GamificationService.checkAndUnlockBadges(this.pluginData);

		const mergedSerialized = JSON.stringify(this.buildStoredData());
		if (mergedSerialized !== diskSerialized) {
			// L'autre appareil n'a pas (encore) tout : on republie l'état fusionné.
			await this.savePluginData();
		} else {
			this.lastWrittenData = mergedSerialized;
		}

		// Réglages venus de l'autre appareil : fonctionnalités activées ou coupées là-bas
		this.syncFeatureUi();
		// Données venues d'un autre appareil : on réaffiche même si l'empreinte semble identique
		// (l'historique peut avoir changé sans que le solde bouge).
		this.notifyGamificationChanged(true);
		this.refreshTaskViews();
		if (this.pluginData.wallet.balance !== previousBalance) {
			console.info(`[Second Brain Manager] Données synchronisées depuis un autre appareil : solde ${previousBalance} → ${this.pluginData.wallet.balance} 🪙.`);
		}
	}

	/** Barre d'état : énergie et solde de pièces courants. */
	public updateStatusBar(): void {
		if (!this.statusBarItemEl || !this.pluginData) return;
		const energy = `Énergie: ${this.settings.energyLevel}/10`;
		this.statusBarItemEl.setText(this.isFeatureEnabled('gamification')
			? `${energy} | 🪙 ${this.pluginData.wallet.balance}`
			: energy);
	}

	public async touchActiveSession(): Promise<void> {
		if (this.pluginData) {
			this.pluginData.lastActiveSession = new Date().toISOString();
			await this.savePluginData();
		}
	}

	async saveSettings() {
		this.applyDelegationSettings();
		// Les réglages modifiés ici sont les plus récents : ce sont eux qui gagneront en cas de conflit
		// avec ceux d'un autre appareil.
		this.settingsUpdatedAt = new Date().toISOString();
		await this.savePluginData();
	}
}

export class SecondBrainSettingTab extends PluginSettingTab {
	plugin: SecondBrainPlugin;
	private settingsPageManager: SettingsPageManager | null = null;
	private lastPage: SettingsPageType = 'main-page';
	/** Page principale réutilisée d'une collecte à l'autre (elle garde son état, ex. agendas chargés) */
	private declarativeMain: MainPage | null = null;

	constructor(app: App, plugin: SecondBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.containerEl.addClass('sbm-settings-tab');
	}

	/**
	 * Obsidian ≥ 1.13 : réglages déclaratifs, indexés par la recherche des réglages.
	 * Chaque réglage garde son rendu actuel ; seuls son nom et sa description sont déclarés.
	 * En cas d'erreur, on renvoie une liste vide et Obsidian se rabat sur display().
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		try {
			if (!this.declarativeMain) {
				const main = new MainPage(createDiv(), this.plugin, 'main-page', () => this.refreshDeclarative(), () => {});
				main.declarativeRefresh = () => this.refreshDeclarative();
				this.declarativeMain = main;
			}
			const main = this.declarativeMain;
			return SettingGroup.collect(() => main.render(), (pageType, title) => this.createSubPage(pageType as SettingsPageType, title));
		} catch (e) {
			console.error('[Second Brain Manager] Réglages déclaratifs indisponibles, affichage classique utilisé :', e);
			return [];
		}
	}

	/** Reconstruit l'onglet (définitions ajoutées ou retirées) sans perdre la position de défilement. */
	private refreshDeclarative(): void {
		const scroller = this.containerEl;
		const top = scroller.scrollTop;
		(this as unknown as { update?: () => void }).update?.();
		scroller.scrollTop = top;
		window.requestAnimationFrame(() => { scroller.scrollTop = top; });
	}

	/** Sous-page native (Prompts, Récompenses) qui réutilise le rendu existant de ces pages. */
	private createSubPage(pageType: SettingsPageType, title: string): SettingPage {
		const Base = (ObsidianApi as unknown as { SettingPage?: new () => { containerEl: HTMLElement; title: string } }).SettingPage;
		if (!Base) throw new Error('SettingPage indisponible');
		const plugin = this.plugin;
		class EmbeddedSettingsPage extends Base {
			display(): void {
				this.containerEl.empty();
				this.containerEl.addClass('sbm-settings-tab');
				const PageClass = pageType === 'prompts-page' ? PromptsPage : RewardsPage;
				const page = new PageClass(this.containerEl, plugin, pageType, () => this.display(), () => {});
				page.embedded = true;
				page.render();
			}
		}
		const page = new EmbeddedSettingsPage();
		page.title = title;
		return page as unknown as SettingPage;
	}

	/** Obsidian < 1.13 : affichage classique avec navigation interne entre pages. */
	display(): void {
		this.containerEl.empty();
		this.settingsPageManager = new SettingsPageManager(
			this.containerEl,
			this.plugin,
			this.lastPage,
			() => this.display()
		);
	}

	hide(): void {
		if (this.settingsPageManager) {
			this.settingsPageManager.destroy();
			this.settingsPageManager = null;
		}
		const base = (PluginSettingTab.prototype as unknown as { hide?: () => void }).hide;
		base?.call(this);
	}
}
