import { ChatMessage, LLMConfig } from '../models/llm';

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
			case 'ollama':
				return this.streamOllama(messages, config, onChunk);
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
}
