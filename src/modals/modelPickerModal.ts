import { App, FuzzySuggestModal, Notice } from 'obsidian';
import { ModelDiscoveryService, ModelOption, FALLBACK_MODELS } from '../services/modelDiscoveryService';
import SecondBrainPlugin from '../main';

export class ModelPickerModal extends FuzzySuggestModal<ModelOption> {
	private plugin: SecondBrainPlugin;
	private onModelSelected: (model: ModelOption) => void;
	private loadedModels: ModelOption[] = [];

	constructor(app: App, plugin: SecondBrainPlugin, onModelSelected: (model: ModelOption) => void) {
		super(app);
		this.plugin = plugin;
		this.onModelSelected = onModelSelected;
		this.loadedModels = FALLBACK_MODELS;
		this.setPlaceholder('Rechercher ou saisir un modèle IA (ex: gemini-3.5-flash, gpt-4o, llama3.2)...');
	}

	async onOpen(): Promise<void> {
		super.onOpen();

		// Chargement dynamique des modèles en direct depuis l'API du fournisseur actif
		try {
			const apiKey = await this.plugin.getSecretApiKey(this.plugin.settings.llmProvider);
			const liveModels = await ModelDiscoveryService.fetchLiveModels(
				this.plugin.settings.llmProvider,
				apiKey,
				this.plugin.settings.llmEndpoint,
				this.plugin.settings.infomaniakProductId
			);

			if (liveModels.length > 0) {
				// Combine les modèles du fournisseur actif avec les modèles des autres fournisseurs
				const otherProvidersModels = FALLBACK_MODELS.filter(m => m.provider !== this.plugin.settings.llmProvider);
				this.loadedModels = [...liveModels, ...otherProvidersModels];
			}
		} catch {
			this.loadedModels = FALLBACK_MODELS;
		}
	}

	getItems(): ModelOption[] {
		const currentQuery = this.inputEl.value.trim();

		// Si l'utilisateur tape un nom qui n'est pas dans la liste, on propose de l'utiliser comme modèle personnalisé
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
		this.plugin.settings.llmProvider = item.provider;
		this.plugin.settings.llmModel = item.name;

		if (item.provider === 'infomaniak' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'https://api.infomaniak.com';
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
