import { requestUrl } from 'obsidian';
import { LLMProvider } from '../models/llm';
import { InfomaniakService } from './infomaniakService';

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
	},
	// Infomaniak AI Services (Souverain Suisse)
	{
		id: 'qwen3',
		name: 'qwen3',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Recommandé : Qwen 3 polyvalent et rapide'
	},
	{
		id: 'mistral3',
		name: 'mistral3',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Mistral 3 optimisé en français'
	},
	{
		id: 'mistral24b',
		name: 'mistral24b',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Mistral NeMo 24B haute précision'
	},
	{
		id: 'swiss-ai/Apertus-70B-Instruct-2509',
		name: 'swiss-ai/Apertus-70B-Instruct-2509',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Modèle souverain suisse haute capacité (70B)'
	},
	{
		id: 'swiss-ai/Apertus-v1.5-70B',
		name: 'swiss-ai/Apertus-v1.5-70B',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Modèle souverain suisse Apertus v1.5 (70B)'
	},
	{
		id: 'mistralai/Ministral-3-14B-Instruct-2512',
		name: 'mistralai/Ministral-3-14B-Instruct-2512',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Ministral 3 14B compact et réactif'
	},
	{
		id: 'mistralai/Mistral-Small-4-119B-2603',
		name: 'mistralai/Mistral-Small-4-119B-2603',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Mistral Small 4 119B très haute performance'
	},
	{
		id: 'Qwen/Qwen3.5-122B-A10B-FP8',
		name: 'Qwen/Qwen3.5-122B-A10B-FP8',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Qwen 3.5 122B MoE haute capacité'
	},
	{
		id: 'Qwen/Qwen3.5-397B-A17B-FP8',
		name: 'Qwen/Qwen3.5-397B-A17B-FP8',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Qwen 3.5 397B MoE ultra-puissant'
	},
	{
		id: 'google/gemma-4-31B-it',
		name: 'google/gemma-4-31B-it',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Google Gemma 4 31B Instruct'
	},
	{
		id: 'moonshotai/Kimi-K2.6',
		name: 'moonshotai/Kimi-K2.6',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'Moonshot AI Kimi K2.6 longue fenêtre de contexte'
	},
	{
		id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
		name: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI',
		desc: 'NVIDIA Nemotron 3 Nano 30B'
	},
	{
		id: 'bge_multilingual_gemma2',
		name: 'bge_multilingual_gemma2',
		provider: 'infomaniak',
		providerName: 'Infomaniak AI (Embeddings)',
		desc: 'Modèle d\'embeddings vectoriels multilingue'
	},
	// OpenRouter
	{
		id: 'anthropic/claude-3.5-sonnet',
		name: 'anthropic/claude-3.5-sonnet',
		provider: 'openrouter',
		providerName: 'OpenRouter',
		desc: 'Modèle Claude 3.5 Sonnet haute précision'
	},
	{
		id: 'deepseek/deepseek-r1',
		name: 'deepseek/deepseek-r1',
		provider: 'openrouter',
		providerName: 'OpenRouter',
		desc: 'Modèle DeepSeek R1 de raisonnement approfondi'
	},
	{
		id: 'meta-llama/llama-3.3-70b-instruct',
		name: 'meta-llama/llama-3.3-70b-instruct',
		provider: 'openrouter',
		providerName: 'OpenRouter',
		desc: 'Modèle open-source Meta Llama 3.3 70B'
	},
	{
		id: 'google/gemini-2.5-flash',
		name: 'google/gemini-2.5-flash',
		provider: 'openrouter',
		providerName: 'OpenRouter',
		desc: 'Modèle rapide Google Gemini via OpenRouter'
	},
	{
		id: 'mistralai/mistral-large-2411',
		name: 'mistralai/mistral-large-2411',
		provider: 'openrouter',
		providerName: 'OpenRouter',
		desc: 'Modèle Mistral Large 2411'
	}
];

export class ModelDiscoveryService {
	/**
	 * Récupère dynamiquement en temps réel la liste des modèles disponibles auprès de l'API du fournisseur.
	 */
	public static async fetchLiveModels(
		provider: LLMProvider,
		apiKey?: string,
		endpoint?: string,
		productId?: string
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

				case 'openrouter': {
					if (!apiKey) return this.getFallbackForProvider('openrouter');
					const baseUrl = endpoint || 'https://openrouter.ai/api/v1';
					const url = `${baseUrl.replace(/\/+$/, '')}/models`;
					const res = await window.fetch(url, {
						headers: { Authorization: `Bearer ${apiKey}` }
					});
					if (!res.ok) return this.getFallbackForProvider('openrouter');
					const data = await res.json() as { data?: Array<{ id: string; name?: string; description?: string }> };
					if (!data.data || !Array.isArray(data.data)) return this.getFallbackForProvider('openrouter');

					return data.data
						.slice(0, 50)
						.map(m => ({
							id: m.id,
							name: m.id,
							provider: 'openrouter' as LLMProvider,
							providerName: 'OpenRouter',
							desc: m.description ? m.description.slice(0, 60) : (m.name || 'Modèle OpenRouter'),
							isLive: true
						}));
				}

				case 'infomaniak': {
					if (!apiKey) return this.getFallbackForProvider('infomaniak');
					const baseUrl = endpoint || 'https://api.infomaniak.com';
					let resolvedProductId = productId;
					if (!resolvedProductId) {
						resolvedProductId = await InfomaniakService.fetchProductId(apiKey, baseUrl);
					}
					if (!resolvedProductId) return this.getFallbackForProvider('infomaniak');

					const url = `${baseUrl.replace(/\/+$/, '')}/2/ai/${resolvedProductId}/openai/v1/models`;
					let data: unknown = null;

					if (typeof requestUrl === 'function') {
						const response = await requestUrl({
							url,
							method: 'GET',
							headers: { Authorization: `Bearer ${apiKey}` },
							throw: false
						});
						if (response.status === 200) {
							data = response.json;
						}
					} else {
						const res = await window.fetch(url, {
							headers: { Authorization: `Bearer ${apiKey}` }
						});
						if (res.ok) {
							data = await res.json();
						}
					}

					if (!data) return this.getFallbackForProvider('infomaniak');
					const json = data as { data?: Array<{ id: string; owned_by?: string }> | { id: string; owned_by?: string } };
					if (!json.data) return this.getFallbackForProvider('infomaniak');

					const modelsList = Array.isArray(json.data) ? json.data : [json.data];
					return modelsList.map(m => ({
						id: m.id,
						name: m.id,
						provider: 'infomaniak' as LLMProvider,
						providerName: 'Infomaniak AI',
						desc: m.owned_by ? `Modèle Infomaniak (${m.owned_by})` : 'Modèle disponible via Infomaniak AI Services',
						isLive: true
					})).sort((a, b) => a.name.localeCompare(b.name));
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

				case 'lmstudio':
				case 'lm-studio': {
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
