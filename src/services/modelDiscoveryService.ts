import { LLMProvider } from '../models/llm';

export interface ModelOption {
	id: string;
	name: string;
	provider: LLMProvider;
	desc: string;
	providerName: string;
	isLive?: boolean;
}

export const FALLBACK_MODELS: ModelOption[] = [
	// Google Gemini (dernières versions et futures 3.5 / 2.5 / 1.5)
	{
		id: 'gemini-3.5-flash',
		name: 'gemini-3.5-flash',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Dernière génération Gemini Flash — Vitesse extrême et capacités avancées'
	},
	{
		id: 'gemini-3.5-pro',
		name: 'gemini-3.5-pro',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Dernière génération Gemini Pro — Raisonnement complexe et contexte étendu'
	},
	{
		id: 'gemini-2.5-flash',
		name: 'gemini-2.5-flash',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Recommandé : Rapide, multimodal et intelligent'
	},
	{
		id: 'gemini-2.5-pro',
		name: 'gemini-2.5-pro',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Raisonnement approfondi et multimodalité'
	},
	{
		id: 'gemini-1.5-flash',
		name: 'gemini-1.5-flash',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Modèle léger et très réactif'
	},
	{
		id: 'gemini-1.5-pro',
		name: 'gemini-1.5-pro',
		provider: 'gemini',
		providerName: 'Google Gemini',
		desc: 'Grande fenêtre de contexte (1M tokens)'
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
		desc: 'Raisonnement logique pas-à-pas'
	},
	{
		id: 'o1',
		name: 'o1',
		provider: 'openai',
		providerName: 'OpenAI',
		desc: 'Raisonnement complexe et programmation avancée'
	},
	// Ollama (Local)
	{
		id: 'llama3.2',
		name: 'llama3.2',
		provider: 'ollama',
		providerName: 'Ollama (Local)',
		desc: 'Modèle local Meta optimisé'
	},
	{
		id: 'qwen2.5',
		name: 'qwen2.5',
		provider: 'ollama',
		providerName: 'Ollama (Local)',
		desc: 'Modèle multilingue et précis en Markdown'
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
		desc: 'Modèle de raisonnement local DeepSeek R1'
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

export class ModelDiscoveryService {
	/**
	 * Récupère dynamiquement en temps réel la liste des modèles disponibles auprès de l'API du fournisseur.
	 */
	public static async fetchLiveModels(
		provider: LLMProvider,
		apiKey?: string,
		endpoint?: string
	): Promise<ModelOption[]> {
		try {
			switch (provider) {
				case 'gemini': {
					if (!apiKey) return this.getFallbackForProvider('gemini');
					const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
					const res = await window.fetch(url);
					if (!res.ok) return this.getFallbackForProvider('gemini');
					const data = await res.json() as { models?: Array<{ name: string; displayName?: string; description?: string; supportedGenerationMethods?: string[] }> };
					if (!data.models || !Array.isArray(data.models)) return this.getFallbackForProvider('gemini');

					return data.models
						.filter(m => {
							const methods = m.supportedGenerationMethods || [];
							return methods.includes('generateContent') || m.name.includes('gemini');
						})
						.map(m => {
							const cleanName = m.name.replace(/^models\//, '');
							return {
								id: cleanName,
								name: cleanName,
								provider: 'gemini' as LLMProvider,
								providerName: 'Google Gemini',
								desc: m.description || m.displayName || 'Modèle officiel Google Gemini',
								isLive: true
							};
						});
				}

				case 'openai': {
					if (!apiKey) return this.getFallbackForProvider('openai');
					const url = 'https://api.openai.com/v1/models';
					const res = await window.fetch(url, {
						headers: { Authorization: `Bearer ${apiKey}` }
					});
					if (!res.ok) return this.getFallbackForProvider('openai');
					const data = await res.json() as { data?: Array<{ id: string }> };
					if (!data.data || !Array.isArray(data.data)) return this.getFallbackForProvider('openai');

					return data.data
						.filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.includes('chat'))
						.map(m => ({
							id: m.id,
							name: m.id,
							provider: 'openai' as LLMProvider,
							providerName: 'OpenAI',
							desc: 'Modèle officiel OpenAI',
							isLive: true
						}))
						.sort((a, b) => b.name.localeCompare(a.name));
				}

				case 'ollama': {
					const baseUrl = endpoint || 'http://localhost:11434';
					const res = await window.fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
					if (!res.ok) return this.getFallbackForProvider('ollama');
					const data = await res.json() as { models?: Array<{ name: string; details?: { parameter_size?: string; family?: string } }> };
					if (!data.models || !Array.isArray(data.models)) return this.getFallbackForProvider('ollama');

					return data.models.map(m => ({
						id: m.name,
						name: m.name,
						provider: 'ollama' as LLMProvider,
						providerName: 'Ollama (Local)',
						desc: m.details?.parameter_size ? `Modèle local (${m.details.parameter_size})` : 'Modèle local installé',
						isLive: true
					}));
				}

				case 'lmstudio': {
					const baseUrl = endpoint || 'http://localhost:1234';
					const res = await window.fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`);
					if (!res.ok) return this.getFallbackForProvider('lmstudio');
					const data = await res.json() as { data?: Array<{ id: string }> };
					if (!data.data || !Array.isArray(data.data)) return this.getFallbackForProvider('lmstudio');

					return data.data.map(m => ({
						id: m.id,
						name: m.id,
						provider: 'lmstudio' as LLMProvider,
						providerName: 'LM Studio (Local)',
						desc: 'Modèle chargé dans LM Studio',
						isLive: true
					}));
				}

				default:
					return FALLBACK_MODELS;
			}
		} catch {
			return this.getFallbackForProvider(provider);
		}
	}

	public static getFallbackForProvider(provider: LLMProvider): ModelOption[] {
		return FALLBACK_MODELS.filter(m => m.provider === provider);
	}

	public static getAllFallbackModels(): ModelOption[] {
		return FALLBACK_MODELS;
	}
}
