import { App, FuzzySuggestModal, Notice } from 'obsidian';
import { ModelDiscoveryService, ModelOption } from '../services/modelDiscoveryService';
import { SecretsManagementModal } from './secretsManagementModal';
import SecondBrainPlugin from '../main';

export class ModelPickerModal extends FuzzySuggestModal<ModelOption> {
	private plugin: SecondBrainPlugin;
	private onModelSelected: (model: ModelOption) => void;
	private loadedModels: ModelOption[] = [];

	constructor(app: App, plugin: SecondBrainPlugin, onModelSelected: (model: ModelOption) => void) {
		super(app);
		this.plugin = plugin;
		this.onModelSelected = onModelSelected;
		this.loadedModels = [];
		this.setPlaceholder('Rechercher un modèle IA parmi vos fournisseurs configurés...');
	}

	async onOpen(): Promise<void> {
		super.onOpen();

		// Chargement dynamique uniquement pour les fournisseurs possédant une clé API valide
		try {
			const models = await ModelDiscoveryService.getAvailableModelsForConfiguredProviders(
				(provider) => this.plugin.getSecretApiKey(provider),
				this.plugin.settings.llmProvider,
				this.plugin.settings.llmEndpoint,
				this.plugin.settings.infomaniakProductId
			);

			if (models.length > 0) {
				this.loadedModels = models;
			} else {
				this.loadedModels = [
					{
						id: '__configure_secrets__',
						name: '🔑 Configurer mes clés d\'API',
						provider: this.plugin.settings.llmProvider,
						providerName: 'Secrets Obsidian',
						desc: 'Aucune clé d\'API configurée. Cliquez ici pour ajouter votre clé Gemini, Infomaniak, OpenAI ou OpenRouter.'
					}
				];
			}
		} catch (err) {
			console.warn('[Second Brain Manager] Erreur lors du chargement des modèles:', err);
			this.loadedModels = [
				{
					id: '__configure_secrets__',
					name: '🔑 Configurer mes clés d\'API',
					provider: this.plugin.settings.llmProvider,
					providerName: 'Secrets Obsidian',
					desc: 'Cliquez ici pour vérifier ou ajouter vos clés d\'API dans le gestionnaire de secrets.'
				}
			];
		}

		// Déclenche le rafraîchissement immédiat de la liste de suggestions
		if (this.inputEl) {
			this.inputEl.dispatchEvent(new Event('input'));
		}
	}

	getItems(): ModelOption[] {
		const currentQuery = this.inputEl.value.trim();

		// Si l'utilisateur tape un nom personnalisé et qu'au moins un modèle est disponible
		if (currentQuery && !this.loadedModels.some(m => m.name.toLowerCase() === currentQuery.toLowerCase())) {
			const customOption: ModelOption = {
				id: currentQuery,
				name: currentQuery,
				provider: this.plugin.settings.llmProvider,
				providerName: `${this.plugin.settings.llmProvider.toUpperCase()} (Personnalisé)`,
				desc: `Utiliser "${currentQuery}" comme nom de modèle personnalisé`
			};
			return [customOption, ...this.loadedModels];
		}

		return this.loadedModels;
	}

	getItemText(item: ModelOption): string {
		return `${item.name} ${item.providerName} ${item.desc}`;
	}

	renderSuggestion(item: { item: ModelOption }, el: HTMLElement): void {
		const isCurrent = this.plugin.settings.llmModel === item.item.name && this.plugin.settings.llmProvider === item.item.provider;

		const row = el.createDiv({ cls: 'sbm-model-picker-row' });
		const titleRow = row.createDiv({ cls: 'sbm-model-picker-title-row' });
		
		titleRow.createSpan({ text: item.item.name, cls: 'sbm-model-name' });
		titleRow.createSpan({ text: item.item.providerName, cls: 'sbm-model-provider-badge' });

		if (item.item.isLive) {
			titleRow.createSpan({ text: '📡 API Live', cls: 'sbm-model-live-badge' });
		}

		if (isCurrent) {
			titleRow.createSpan({ text: '✓ Actif', cls: 'sbm-model-active-badge' });
		}

		row.createDiv({ text: item.item.desc, cls: 'sbm-model-desc' });
	}

	async onChooseItem(item: ModelOption): Promise<void> {
		if (item.id === '__configure_secrets__') {
			new SecretsManagementModal(this.app, this.plugin).open();
			return;
		}

		this.plugin.settings.llmProvider = item.provider;
		this.plugin.settings.llmModel = item.name;

		if (item.provider === 'infomaniak' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'https://api.infomaniak.com';
		} else if (item.provider === 'openrouter' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'https://openrouter.ai/api/v1';
		} else if (item.provider === 'ollama' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'http://localhost:11434';
		} else if (item.provider === 'lmstudio' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'http://localhost:1234';
		}

		await this.plugin.saveSettings();
		new Notice(`Modèle sélectionné : ${item.name} (${item.providerName})`);
		this.onModelSelected(item);
	}
}
