import { requestUrl } from 'obsidian';
import { ChatMessage, LLMConfig } from '../models/llm';
import { InfomaniakService } from './infomaniakService';
import { HttpStreamService } from './httpStreamService';

export class LLMService {
	public static async generateStreamingResponse(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		switch (config.provider) {
			case 'gemini':
				return this.streamGemini(messages, config, onChunk);
			case 'openai':
				return this.streamOpenAI(messages, config, onChunk);
			case 'openrouter':
				return this.streamOpenRouter(messages, config, onChunk);
			case 'infomaniak':
				return this.streamInfomaniak(messages, config, onChunk);
			case 'ollama':
				return this.streamOllama(messages, config, onChunk);
			case 'lmstudio':
			case 'lm-studio':
				return this.streamLMStudio(messages, config, onChunk);
			default:
				throw new Error(`Fournisseur LLM non supporté : ${config.provider}`);
		}
	}

	private static async streamGemini(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		if (!config.apiKey) {
			throw new Error('Clé API Gemini manquante. Liez un secret dans les réglages du plugin.');
		}

		const model = config.model || 'gemini-1.5-flash';
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${config.apiKey}&alt=sse`;

		const contents = messages.map(m => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: m.content }]
		}));

		const response = await window.fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contents }),
			signal: config.signal
		});

		if (!response.ok || !response.body) {
			const errText = await response.text();
			throw new Error(`Erreur Gemini (${response.status}) : ${errText}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullText = '';
		let buffer = '';
		let isDone = false;

		while (!isDone) {
			const { done, value } = await reader.read();
			if (done) {
				isDone = true;
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data: ')) {
					const jsonStr = trimmed.slice(6).trim();
					if (jsonStr) {
						try {
							const parsed = JSON.parse(jsonStr);
							const textPart = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
							if (textPart) {
								fullText += textPart;
								onChunk(textPart, fullText);
							}
						} catch {
							// Ignorer les fragments partiels
						}
					}
				}
			}
		}

		return fullText;
	}

	private static async streamOpenAI(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		if (!config.apiKey) {
			throw new Error('Clé API OpenAI manquante. Liez un secret dans les réglages du plugin.');
		}

		const endpoint = config.endpoint || 'https://api.openai.com/v1';
		const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

		const response = await window.fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.apiKey}`
			},
			body: JSON.stringify({
				model: config.model || 'gpt-4o-mini',
				messages: messages.map(m => ({ role: m.role, content: m.content })),
				temperature: config.temperature ?? 0.7,
				stream: true
			}),
			signal: config.signal
		});

		if (!response.ok || !response.body) {
			const errText = await response.text();
			throw new Error(`Erreur OpenAI (${response.status}) : ${errText}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullText = '';
		let buffer = '';
		let isDone = false;

		while (!isDone) {
			const { done, value } = await reader.read();
			if (done) {
				isDone = true;
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data: ')) {
					const payload = trimmed.slice(6).trim();
					if (payload === '[DONE]') {
						isDone = true;
						break;
					}
					if (payload) {
						try {
							const parsed = JSON.parse(payload);
							const delta = parsed.choices?.[0]?.delta?.content;
							if (delta) {
								fullText += delta;
								onChunk(delta, fullText);
							}
						} catch {
							// Ignorer les fragments partiels
						}
					}
				}
			}
		}

		return fullText;
	}

	private static async streamOllama(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		const endpoint = config.endpoint || 'http://localhost:11434';
		const url = `${endpoint.replace(/\/+$/, '')}/api/chat`;

		const response = await window.fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.model || 'llama3:latest',
				messages: messages.map(m => ({ role: m.role, content: m.content })),
				stream: true
			}),
			signal: config.signal
		});

		if (!response.ok || !response.body) {
			throw new Error(`Erreur Ollama (${response.status}) : Vérifiez que Ollama est bien démarré.`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullText = '';
		let buffer = '';
		let isDone = false;

		while (!isDone) {
			const { done, value } = await reader.read();
			if (done) {
				isDone = true;
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) {
					try {
						const parsed = JSON.parse(trimmed);
						const delta = parsed.message?.content;
						if (delta) {
							fullText += delta;
							onChunk(delta, fullText);
						}
					} catch {
						// Ignorer les fragments partiels
					}
				}
			}
		}

		return fullText;
	}

	private static async streamLMStudio(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		const endpoint = config.endpoint || 'http://localhost:1234';
		const url = `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;

		const response = await window.fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.model || 'local-model',
				messages: messages.map(m => ({ role: m.role, content: m.content })),
				temperature: config.temperature ?? 0.7,
				stream: true
			}),
			signal: config.signal
		});

		if (!response.ok || !response.body) {
			throw new Error(`Erreur LM Studio (${response.status}) : Vérifiez que le serveur local LM Studio est actif.`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullText = '';
		let buffer = '';
		let isDone = false;

		while (!isDone) {
			const { done, value } = await reader.read();
			if (done) {
				isDone = true;
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data: ')) {
					const payload = trimmed.slice(6).trim();
					if (payload === '[DONE]') {
						isDone = true;
						break;
					}
					if (payload) {
						try {
							const parsed = JSON.parse(payload);
							const delta = parsed.choices?.[0]?.delta?.content;
							if (delta) {
								fullText += delta;
								onChunk(delta, fullText);
							}
						} catch {
							// Ignorer les fragments partiels
						}
					}
				}
			}
		}

		return fullText;
	}

	private static async streamInfomaniak(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		if (!config.apiKey) {
			throw new Error('Clé API / Token Infomaniak manquant. Liez un secret dans les réglages du plugin.');
		}

		let productId = config.productId;
		if (!productId) {
			const check = await InfomaniakService.testConnection(config.apiKey, config.endpoint);
			if (check.productId) {
				productId = check.productId;
			} else {
				throw new Error(
					`Impossible de récupérer automatiquement l'identifiant produit Infomaniak (GET /1/ai).\n${check.error || 'Vérifiez la validité de votre token API et ses permissions AI Tools.'}`
				);
			}
		}

		const validInfomaniakModels = [
			'qwen3',
			'mistral3',
			'mistral24b',
			'swiss-ai/Apertus-70B-Instruct-2509',
			'swiss-ai/Apertus-v1.5-70B',
			'mistralai/Ministral-3-14B-Instruct-2512',
			'mistralai/Mistral-Small-4-119B-2603',
			'Qwen/Qwen3.5-122B-A10B-FP8',
			'Qwen/Qwen3.5-397B-A17B-FP8',
			'google/gemma-4-31B-it',
			'moonshotai/Kimi-K2.6',
			'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8'
		];

		let modelToUse = (config.model || '').trim();
		if (!validInfomaniakModels.includes(modelToUse)) {
			const matchCaseInsensitive = validInfomaniakModels.find(m => m.toLowerCase() === modelToUse.toLowerCase());
			if (matchCaseInsensitive) {
				modelToUse = matchCaseInsensitive;
			} else {
				modelToUse = 'qwen3';
			}
		}

		const endpoint = config.endpoint || 'https://api.infomaniak.com';
		const url = `${endpoint.replace(/\/+$/, '')}/2/ai/${productId}/openai/v1/chat/completions`;

		return await HttpStreamService.streamSSE({
			url,
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.apiKey}`
			},
			body: JSON.stringify({
				model: modelToUse,
				messages: messages.map(m => ({ role: m.role, content: m.content })),
				temperature: config.temperature ?? 0.7,
				stream: true
			}),
			signal: config.signal,
			onChunk
		});
	}

	/**
	 * Génère un vecteur d'embeddings pour du texte (compatible Infomaniak et OpenAI pour système RAG).
	 */
	public static async createEmbedding(
		input: string | string[],
		config: LLMConfig
	): Promise<number[][]> {
		if (config.provider === 'infomaniak') {
			if (!config.apiKey) {
				throw new Error('Clé API / Token Infomaniak manquant.');
			}

			let productId = config.productId;
			if (!productId) {
				productId = await InfomaniakService.fetchProductId(config.apiKey, config.endpoint);
			}

			if (!productId) {
				throw new Error('Impossible de récupérer l\'identifiant produit Infomaniak (GET /1/ai).');
			}

			const endpoint = config.endpoint || 'https://api.infomaniak.com';
			const url = `${endpoint.replace(/\/+$/, '')}/2/ai/${productId}/openai/v1/embeddings`;

			let status = 0;
			let data: unknown = null;
			let rawText = '';

			if (typeof requestUrl === 'function') {
				const response = await requestUrl({
					url,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${config.apiKey}`
					},
					body: JSON.stringify({
						input,
						model: config.model || 'bge_multilingual_gemma2'
					}),
					throw: false
				});
				status = response.status;
				data = response.json;
				rawText = response.text;
			} else {
				const response = await window.fetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${config.apiKey}`
					},
					body: JSON.stringify({
						input,
						model: config.model || 'bge_multilingual_gemma2'
					}),
					signal: config.signal
				});
				status = response.status;
				rawText = await response.text();
				try {
					data = JSON.parse(rawText);
				} catch {
					data = null;
				}
			}

			if (status < 200 || status >= 300 || !data) {
				throw new Error(`Erreur Infomaniak Embeddings (${status}) : ${rawText}`);
			}

			const json = data as { data?: Array<{ embedding: number[] }> | { embedding: number[] } };
			if (Array.isArray(json.data)) {
				return json.data.map(item => item.embedding);
			} else if (json.data && 'embedding' in json.data) {
				return [(json.data as { embedding: number[] }).embedding];
			}
			throw new Error('Format de réponse d\'embeddings inattendu');
		} else if (config.provider === 'openai') {
			if (!config.apiKey) throw new Error('Clé API OpenAI manquante.');
			const endpoint = config.endpoint || 'https://api.openai.com/v1';
			const url = `${endpoint.replace(/\/+$/, '')}/embeddings`;

			const response = await window.fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${config.apiKey}`
				},
				body: JSON.stringify({
					input,
					model: config.model || 'text-embedding-3-small'
				}),
				signal: config.signal
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Erreur OpenAI Embeddings (${response.status}) : ${errText}`);
			}

			const json = await response.json() as { data: Array<{ embedding: number[] }> };
			return json.data.map(item => item.embedding);
		}

		throw new Error(`Génération d'embeddings non supportée pour le fournisseur : ${config.provider}`);
	}

	private static async streamOpenRouter(
		messages: ChatMessage[],
		config: LLMConfig,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<string> {
		if (!config.apiKey) {
			throw new Error('Clé API OpenRouter manquante. Liez un secret dans les réglages du plugin.');
		}

		const endpoint = config.endpoint || 'https://openrouter.ai/api/v1';
		const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

		const response = await window.fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.apiKey}`,
				'HTTP-Referer': 'https://obsidian.md',
				'X-Title': 'Second Brain Manager'
			},
			body: JSON.stringify({
				model: config.model || 'anthropic/claude-3.5-sonnet',
				messages: messages.map(m => ({ role: m.role, content: m.content })),
				temperature: config.temperature ?? 0.7,
				stream: true
			}),
			signal: config.signal
		});

		if (!response.ok || !response.body) {
			const errText = await response.text();
			throw new Error(`Erreur OpenRouter (${response.status}) : ${errText}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullText = '';
		let buffer = '';
		let isDone = false;

		while (!isDone) {
			const { done, value } = await reader.read();
			if (done) {
				isDone = true;
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data: ')) {
					const payload = trimmed.slice(6).trim();
					if (payload === '[DONE]') {
						isDone = true;
						break;
					}
					if (payload) {
						try {
							const parsed = JSON.parse(payload);
							const delta = parsed.choices?.[0]?.delta?.content;
							if (delta) {
								fullText += delta;
								onChunk(delta, fullText);
							}
						} catch {
							// Ignorer les fragments partiels
						}
					}
				}
			}
		}

		return fullText;
	}

	/**
	 * Génère une réponse complète en agrégeant le flux streaming.
	 */
	public static async generateResponse(
		messages: ChatMessage[],
		config: LLMConfig
	): Promise<{ content: string }> {
		const fullText = await this.generateStreamingResponse(messages, config, () => {});
		return { content: fullText };
	}
}


