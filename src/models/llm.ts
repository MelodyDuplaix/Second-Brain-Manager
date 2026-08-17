import { ObsidianTask } from './task';
import { ActionProposal } from './actions';

export type LLMProvider = 'gemini' | 'openai' | 'ollama' | 'lmstudio' | 'lm-studio';

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp?: string;
	tasks?: ObsidianTask[];
	proposals?: ActionProposal[];
}

export interface LLMConfig {
	provider: LLMProvider;
	endpoint: string;
	model: string;
	apiKey?: string;
	temperature?: number;
	signal?: AbortSignal;
}
