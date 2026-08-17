import { Plugin, Notice, PluginSettingTab, App, TFile, normalizePath } from 'obsidian';
import { TaskParser } from './parsers/taskParser';
import { CustomMatrixTagMapping } from './adapters/matrixAdapter';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from './models/syntaxConfig';
import { DashboardView, VIEW_TYPE_DASHBOARD } from './views/dashboardView';
import { GamificationHistoryView, VIEW_TYPE_GAMIFICATION_HISTORY } from './views/gamificationHistoryView';
import { ChatView, VIEW_TYPE_CHAT } from './views/chatView';
import { BriefingView, VIEW_TYPE_BRIEFING } from './views/briefingView';
import { Wallet, Reward, CompletionEvent } from './models/gamification';
import { GamificationService, PluginData } from './services/gamificationService';
import { SettingsPageManager, SettingsPageType } from './settings/settingsPageManager';

export interface SecondBrainSettings extends TaskSyntaxConfig {
	energyLevel: number;
	defaultCoinsPerTask: number;
	matrixProvider: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom';
	customMatrixMapping: CustomMatrixTagMapping;
	inboxFolder: string;
	dailyNotesFolder: string;

	llmProvider: 'gemini' | 'openai' | 'ollama' | 'lm-studio';
	llmEndpoint: string;
	llmModel: string;

	geminiSecretId?: string;
	openaiSecretId?: string;
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
	...DEFAULT_SYNTAX_CONFIG,
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
	dailyNotesFolder: '04 - Journal',

	llmProvider: 'gemini',
	llmEndpoint: 'https://generativelanguage.googleapis.com',
	llmModel: 'gemini-1.5-flash',

	geminiSecretId: undefined,
	openaiSecretId: undefined,
};

interface StoredData {
	settings: SecondBrainSettings;
	wallet: Wallet;
	rewards: Reward[];
	completionEvents: Record<string, CompletionEvent>;
}

const DEFAULT_STORED_DATA: StoredData = {
	settings: DEFAULT_SETTINGS,
	wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
	rewards: [
		{ id: 'pause-jeu', name: '30 minutes de jeu', description: 'Une pause choisie sans culpabilité', cost: 20, enabled: true },
		{ id: 'pause-cafe', name: 'Pause Café Gourmet', description: 'Prendre le temps d\'une vraie pause', cost: 10, enabled: true }
	],
	completionEvents: {}
};

export default class SecondBrainPlugin extends Plugin {
	settings: SecondBrainSettings;
	pluginData: PluginData;

	async onload() {
		await this.loadPluginData();

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

		// Icônes dans le ruban latéral
		this.addRibbonIcon('layout-dashboard', 'Tableau de bord', () => {
			this.activateDashboardView();
		});

		this.addRibbonIcon('sun', 'Briefing du matin', () => {
			this.activateBriefingView();
		});

		this.addRibbonIcon('coins', 'Historique des pièces et statistiques', () => {
			this.activateHistoryView();
		});

		this.addRibbonIcon('bot', 'Assistant IA', () => {
			this.activateChatView();
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(`Énergie: ${this.settings.energyLevel}/10 | 🪙 ${this.pluginData.wallet.balance}`);

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
			id: 'ouvrir-briefing',
			name: 'Ouvrir le briefing du matin',
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
			id: 'analyser-taches',
			name: 'Analyser les tâches du coffre',
			callback: async () => {
				const files = this.app.vault.getMarkdownFiles();
				let count = 0;
				for (const file of files) {
					const content = await this.app.vault.read(file);
					const tasks = TaskParser.parseFile(content, file.path, this.settings);
					count += tasks.length;
				}
				new Notice(`Analyse terminée : ${count} tâches principales trouvées dans le coffre.`);
			}
		});

		this.addSettingTab(new SecondBrainSettingTab(this.app, this));
	}

	onunload() {
		// Nettoyage automatique assuré par Obsidian pour les vues et événements enregistrés
	}

	public async checkFileForCompletedTasks(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const tasks = TaskParser.parseFile(content, file.path, this.settings);

		for (const task of tasks) {
			if (task.completed || task.status === 'done') {
				const res = GamificationService.processCompletion(task, this.pluginData, this.settings.matrixProvider);
				if (res.rewardGranted) {
					await this.savePluginData();
					new Notice(`Tâche terminée ! +${res.coinsEarned} 🪙 (Solde : ${res.newBalance} 🪙)`);
				}
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
		}
	}

	async activateBriefingView() {
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
		}
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
	 * Récupération sécurisée des clés d'API via le Secret Storage d'Obsidian (docs.obsidian.md/plugins/guides/secret-storage)
	 */
	async getSecretApiKey(provider: string): Promise<string | undefined> {
		const secretId = provider === 'gemini' ? this.settings.geminiSecretId : provider === 'openai' ? this.settings.openaiSecretId : undefined;

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
		this.settings = raw.settings;

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
		};
	}

	async savePluginData() {
		const dataToStore: StoredData = {
			settings: this.settings,
			wallet: this.pluginData.wallet,
			rewards: this.pluginData.rewards,
			completionEvents: this.pluginData.completionEvents
		};
		await this.saveData(dataToStore);
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
