export type LLMProvider = 'gemini' | 'openai' | 'ollama' | 'lm-studio';

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp?: string;
}

export interface LLMConfig {
	provider: LLMProvider;
	endpoint: string;
	model: string;
	apiKey?: string;
	temperature?: number;
	signal?: AbortSignal;
}
