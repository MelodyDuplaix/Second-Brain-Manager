import { Plugin, Notice, PluginSettingTab, App, TFile, normalizePath, Editor, MarkdownView } from 'obsidian';
import { TaskParser } from './parsers/taskParser';
import { CustomMatrixTagMapping } from './adapters/matrixAdapter';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from './models/syntaxConfig';
import { DashboardView, VIEW_TYPE_DASHBOARD } from './views/dashboardView';
import { GamificationHistoryView, VIEW_TYPE_GAMIFICATION_HISTORY } from './views/gamificationHistoryView';
import { ChatView, VIEW_TYPE_CHAT } from './views/chatView';
import { BriefingView, VIEW_TYPE_BRIEFING } from './views/briefingView';
import { EveningReviewView, VIEW_TYPE_EVENING_REVIEW } from './views/eveningReviewView';
import { CalendarView, VIEW_TYPE_CALENDAR } from './views/calendarView';
import { Wallet, Reward, CompletionEvent, StreakData, UserBadge, WorkflowCounts } from './models/gamification';
import { GamificationService, PluginData } from './services/gamificationService';
import { SettingsPageManager, SettingsPageType } from './settings/settingsPageManager';
import { EnergyLevelModal } from './modals/energyLevelModal';
import { GoogleCalendarSettings, DEFAULT_GOOGLE_CALENDAR_SETTINGS } from './models/googleCalendar';
import { NoteActionsService } from './services/noteActionsService';
import { VaultContextService } from './services/vaultContextService';

export interface SecondBrainSettings extends TaskSyntaxConfig, GoogleCalendarSettings {
	energyLevel: number;
	defaultCoinsPerTask: number;
	matrixProvider: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom';
	customMatrixMapping: CustomMatrixTagMapping;
	inboxFolder: string;
	templatesFolder: string;
	dailyNotesFolder: string;
	dailyNoteTemplatePath: string;
	autoOpenDailyNoteOnBriefing: boolean;

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
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
	...DEFAULT_SYNTAX_CONFIG,
	...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
	energyLevel: 5,
	defaultCoinsPerTask: 1,
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
};

interface StoredData {
	settings: SecondBrainSettings;
	wallet: Wallet;
	rewards: Reward[];
	completionEvents: Record<string, CompletionEvent>;
	streak?: StreakData;
	badges?: Record<string, UserBadge>;
	workflowCounts?: WorkflowCounts;
	lastActiveSession?: string;
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

export default class SecondBrainPlugin extends Plugin {
	settings: SecondBrainSettings;
	pluginData: PluginData;

	private lastUserCheckboxTime = 0;
	private lastUserCheckboxFilePath: string | null = null;
	private lastUserEditorChangeTime = 0;
	private lastUserEditorFilePath: string | null = null;
	public isPluginPerformingTaskAction = false;

	async onload() {
		await this.loadPluginData();
		this.touchActiveSession();

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

		// Icônes dans le ruban latéral
		this.addRibbonIcon('layout-dashboard', 'Tableau de bord', () => {
			this.activateDashboardView();
		});

		this.addRibbonIcon('sun', 'Briefing du matin (avec tri & reprise)', () => {
			this.activateBriefingView();
		});

		this.addRibbonIcon('moon', 'Revue du soir', () => {
			this.activateEveningReviewView();
		});

		this.addRibbonIcon('calendar', 'Agenda Google Calendar', () => {
			this.activateCalendarView();
		});

		this.addRibbonIcon('coins', 'Historique des pièces et statistiques', () => {
			this.activateHistoryView();
		});

		this.addRibbonIcon('bot', 'Assistant IA', () => {
			this.activateChatView();
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(`Énergie: ${this.settings.energyLevel}/10 | 🪙 ${this.pluginData.wallet.balance}`);

		// Traçage des interactions utilisateur sur les cases à cocher dans l'interface Obsidian
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement | null;
			if (!target) return;
			if (
				target.classList.contains('task-list-item-checkbox') ||
				target.classList.contains('cm-task-checkbox') ||
				(target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox')
			) {
				this.recordUserCheckboxInteraction();
			}
		});

		this.registerDomEvent(document, 'change', (evt: Event) => {
			const target = evt.target as HTMLElement | null;
			if (!target) return;
			if (
				target.classList.contains('task-list-item-checkbox') ||
				target.classList.contains('cm-task-checkbox') ||
				(target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox')
			) {
				this.recordUserCheckboxInteraction();
			}
		});

		// Traçage des modifications actives dans l'éditeur Markdown
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				this.lastUserEditorChangeTime = Date.now();
				const activeFile = (info as any)?.file || this.app.workspace.getActiveFile();
				this.lastUserEditorFilePath = activeFile?.path || null;
			})
		);

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
			id: 'ouvrir-briefing',
			name: 'Ouvrir le briefing du matin',
			callback: () => {
				this.activateBriefingView();
			}
		});

		this.addCommand({
			id: 'ouvrir-revue-soir',
			name: 'Ouvrir la revue du soir',
			callback: () => {
				this.activateEveningReviewView();
			}
		});

		this.addCommand({
			id: 'ouvrir-reprise-pause',
			name: 'Reprendre après une pause',
			callback: () => {
				this.activateBriefingView();
			}
		});

		this.addCommand({
			id: 'ouvrir-chat-ia',
			name: 'Ouvrir le chat IA',
			callback: () => {
				this.activateChatView();
			}
		});

		this.addCommand({
			id: 'ouvrir-historique-pieces',
			name: 'Ouvrir l\'historique des pièces et statistiques',
			callback: () => {
				this.activateHistoryView();
			}
		});

		this.addCommand({
			id: 'ouvrir-agenda-google',
			name: 'Ouvrir l\'agenda Google Calendar',
			callback: () => {
				this.activateCalendarView();
			}
		});

		this.addCommand({
			id: 'analyser-taches',
			name: 'Analyser les tâches du coffre',
			callback: async () => {
				const files = this.app.vault.getMarkdownFiles();
				let count = 0;
				for (const file of files) {
					const content = await this.app.vault.read(file);
					const tasks = TaskParser.parseAllTasks(content, file.path, this.settings);
					count += tasks.length;
				}
				new Notice(`Analyse terminée : ${count} tâches trouvées dans le coffre.`);
			}
		});

		// Commandes contextuelles d'édition IA sur les notes
		this.addCommand({
			id: 'extraire-taches-note',
			name: 'Extraire les tâches de la note ou de la sélection',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				NoteActionsService.handleExtractTasksCommand(this.app, this, editor, view);
			}
		});

		this.addCommand({
			id: 'decomposer-tache-curseur',
			name: 'Décomposer la tâche sous le curseur',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				NoteActionsService.handleBreakdownTaskCommand(this.app, this, editor, view);
			}
		});

		this.addCommand({
			id: 'resumer-note-selection',
			name: 'Résumer la note ou la sélection',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				NoteActionsService.handleSummarizeCommand(this.app, this, editor, view);
			}
		});

		this.addCommand({
			id: 'reformuler-selection',
			name: 'Reformuler la sélection pour améliorer la clarté',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				NoteActionsService.handleRephraseCommand(this.app, this, editor, view);
			}
		});

		// Intégration dans le menu contextuel clic-droit de l'éditeur Markdown
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				menu.addSeparator();

				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const isTaskLine = /^[-*0-9.]*\s*\[[ xX/]\]/.test(line.trim());

				if (isTaskLine) {
					menu.addItem((item) => {
						item.setTitle('🧩 Second Brain: Décomposer cette tâche')
							.setIcon('list-tree')
							.onClick(() => {
								NoteActionsService.handleBreakdownTaskCommand(this.app, this, editor, view as MarkdownView);
							});
					});
				}

				menu.addItem((item) => {
					item.setTitle('🧠 Second Brain: Extraire les tâches')
						.setIcon('check-square')
						.onClick(() => {
							NoteActionsService.handleExtractTasksCommand(this.app, this, editor, view as MarkdownView);
						});
				});

				const selection = editor.getSelection();
				if (selection.trim()) {
					menu.addItem((item) => {
						item.setTitle('✨ Second Brain: Reformuler la sélection')
							.setIcon('sparkles')
							.onClick(() => {
								NoteActionsService.handleRephraseCommand(this.app, this, editor, view as MarkdownView);
							});
					});
				}

				menu.addItem((item) => {
					item.setTitle('📝 Second Brain: Résumer')
						.setIcon('file-text')
						.onClick(() => {
							NoteActionsService.handleSummarizeCommand(this.app, this, editor, view as MarkdownView);
						});
				});
			})
		);

		this.addSettingTab(new SecondBrainSettingTab(this.app, this));
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
		const isLocal = this.isLocalUserTaskCheck(file.path);
		const content = await this.app.vault.read(file);
		const tasks = TaskParser.parseAllTasks(content, file.path, this.settings);

		let dataModified = false;

		for (const task of tasks) {
			if (task.completed || task.status === 'done') {
				if (isLocal) {
					const res = GamificationService.processCompletion(task, this.pluginData, this.settings.matrixProvider);
					if (res.rewardGranted) {
						dataModified = true;
						new Notice(`Tâche terminée ! +${res.coinsEarned} 🪙 (Solde : ${res.newBalance} 🪙 | Série : ${this.pluginData.streak.currentStreak}j 🔥)`);
						if (res.newlyUnlockedBadges && res.newlyUnlockedBadges.length > 0) {
							for (const badge of res.newlyUnlockedBadges) {
								new Notice(`🏆 NOUVEAU BADGE DÉBLOQUÉ : ${badge.name} !\n${badge.description}`, 7000);
							}
						}
					}
				} else {
					// Tâche cochée hors Obsidian (ex: synchronisation depuis un autre appareil / sync distant)
					// On enregistre silencieusement pour éviter de distribuer des pièces ou notifications en double
					const syncRes = GamificationService.recordSyncCompletion(task, this.pluginData, this.settings.matrixProvider);
					if (syncRes.newlyRecorded) {
						dataModified = true;
					}
				}
			}
		}

		if (dataModified) {
			await this.savePluginData();
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
		// La reprise après pause et le tri large sont intégrés directement dans le Briefing du matin
		await this.activateBriefingView();
	}

	async activateHistoryView() {
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

	async activateCalendarView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
			if (leaf.view instanceof CalendarView) {
				await (leaf.view as CalendarView).refreshEvents();
			}
		}
	}

	async activateChatView() {
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
		const raw: StoredData = Object.assign({}, DEFAULT_STORED_DATA, await this.loadData());
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
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
			lastActiveSession: raw.lastActiveSession
		};

		GamificationService.ensureDataStructures(this.pluginData);
		GamificationService.checkAndUnlockBadges(this.pluginData);
	}

	async savePluginData() {
		const dataToStore: StoredData = {
			settings: this.settings,
			wallet: this.pluginData.wallet,
			rewards: this.pluginData.rewards,
			completionEvents: this.pluginData.completionEvents,
			streak: this.pluginData.streak,
			badges: this.pluginData.badges,
			workflowCounts: this.pluginData.workflowCounts,
			lastActiveSession: this.pluginData.lastActiveSession
		};
		await this.saveData(dataToStore);
	}

	public async touchActiveSession(): Promise<void> {
		if (this.pluginData) {
			this.pluginData.lastActiveSession = new Date().toISOString();
			await this.savePluginData();
		}
	}

	async saveSettings() {
		await this.savePluginData();
	}
}

export class SecondBrainSettingTab extends PluginSettingTab {
	plugin: SecondBrainPlugin;
	private settingsPageManager: SettingsPageManager | null = null;
	private lastPage: SettingsPageType = 'main-page';

	constructor(app: App, plugin: SecondBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.containerEl.addClass('sbm-settings-tab');
	}

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
		}
		this.containerEl.empty();
	}
}
