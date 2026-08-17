import { App, FuzzySuggestModal, Notice } from 'obsidian';
import { LLMProvider } from '../models/llm';
import SecondBrainPlugin from '../main';

export interface ModelOption {
	id: string;
	name: string;
	provider: LLMProvider;
	desc: string;
	providerName: string;
}

export const PRESET_MODELS: ModelOption[] = [
	// Google Gemini
	{
		id: 'gemini-2.5-flash',
		name: 'gemini-2.5-flash',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Recommandé : Ultra-rapide, multimodal et hautement intelligent'
	},
	{
		id: 'gemini-2.5-pro',
		name: 'gemini-2.5-pro',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Raisonnement complexe et analyse approfondie'
	},
	{
		id: 'gemini-1.5-flash',
		name: 'gemini-1.5-flash',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Modèle léger et très réactif'
	},
	// OpenAI
	{
		id: 'gpt-4o',
		name: 'gpt-4o',
		provider: 'openai',
		providerName: 'OpenAI',
		desc: 'Modèle phare multimodal d\'OpenAI'
	},
	{
		id: 'gpt-4o-mini',
		name: 'gpt-4o-mini',
		provider: 'openai',
		providerName: 'OpenAI',
		desc: 'Rapide, économique et performant'
	},
	{
		id: 'o3-mini',
		name: 'o3-mini',
		provider: 'openai',
		providerName: 'OpenAI',
		desc: 'Raisonnement logique et décomposition'
	},
	// Ollama (Local)
	{
		id: 'llama3.2',
		name: 'llama3.2',
		provider: 'ollama',
		providerName: 'Ollama (Local)',
		desc: 'Modèle local Meta optimisé et rapide'
	},
	{
		id: 'qwen2.5',
		name: 'qwen2.5',
		provider: 'ollama',
		providerName: 'Ollama (Local)',
		desc: 'Modèle multilingue et précis en code/markdown'
	},
	{
		id: 'mistral',
		name: 'mistral',
		provider: 'ollama',
		providerName: 'Ollama (Local)',
		desc: 'Modèle 7B français/anglais équilibré'
	},
	{
		id: 'deepseek-r1:8b',
		name: 'deepseek-r1:8b',
		provider: 'ollama',
		providerName: 'Ollama (Local)',
		desc: 'Raisonnement pas-à-pas local'
	},
	// LM Studio (Local)
	{
		id: 'local-model',
		name: 'local-model',
		provider: 'lmstudio',
		providerName: 'LM Studio (Local)',
		desc: 'Modèle actuellement chargé dans LM Studio'
	}
];

export class ModelPickerModal extends FuzzySuggestModal<ModelOption> {
	private plugin: SecondBrainPlugin;
	private onModelSelected: (model: ModelOption) => void;

	constructor(app: App, plugin: SecondBrainPlugin, onModelSelected: (model: ModelOption) => void) {
		super(app);
		this.plugin = plugin;
		this.onModelSelected = onModelSelected;
		this.setPlaceholder('Choisir un modèle IA (Gemini, OpenAI, Ollama, LM Studio)...');
	}

	getItems(): ModelOption[] {
		return PRESET_MODELS;
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

		if (isCurrent) {
			titleRow.createSpan({ text: '✓ Actif', cls: 'sbm-model-active-badge' });
		}

		row.createDiv({ text: item.item.desc, cls: 'sbm-model-desc' });
	}

	async onChooseItem(item: ModelOption): Promise<void> {
		this.plugin.settings.llmProvider = item.provider;
		this.plugin.settings.llmModel = item.name;

		// Si c'est Ollama ou LM Studio et que l'endpoint n'est pas configuré, définir le port par défaut
		if (item.provider === 'ollama' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'http://localhost:11434';
		} else if (item.provider === 'lmstudio' && !this.plugin.settings.llmEndpoint) {
			this.plugin.settings.llmEndpoint = 'http://localhost:1234';
		}

		await this.plugin.saveSettings();
		new Notice(`Modèle actif : ${item.name} (${item.providerName})`);
		this.onModelSelected(item);
	}
}
