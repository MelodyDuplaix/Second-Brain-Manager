import { describe, it, expect } from 'vitest';
import { ModelDiscoveryService, FALLBACK_MODELS } from '../../src/services/modelDiscoveryService';

describe('ModelDiscoveryService', () => {
	it('should provide comprehensive fallback catalog including latest Gemini 3.5 and 2.5 models', () => {
		expect(FALLBACK_MODELS.length).toBeGreaterThanOrEqual(10);

		const geminiModels = ModelDiscoveryService.getFallbackForProvider('gemini');
		expect(geminiModels.some(m => m.name === 'gemini-3.5-flash')).toBe(true);
		expect(geminiModels.some(m => m.name === 'gemini-3.5-pro')).toBe(true);
		expect(geminiModels.some(m => m.name === 'gemini-2.5-flash')).toBe(true);
		expect(geminiModels.some(m => m.name === 'gemini-2.5-pro')).toBe(true);
	});

	it('should provide OpenAI and Ollama fallback models', () => {
		const openAiModels = ModelDiscoveryService.getFallbackForProvider('openai');
		expect(openAiModels.some(m => m.name === 'gpt-4o')).toBe(true);
		expect(openAiModels.some(m => m.name === 'o3-mini')).toBe(true);

		const ollamaModels = ModelDiscoveryService.getFallbackForProvider('ollama');
		expect(ollamaModels.some(m => m.name === 'llama3.2')).toBe(true);
	});

	it('should provide Infomaniak AI Services fallback models', () => {
		const infomaniakModels = ModelDiscoveryService.getFallbackForProvider('infomaniak');
		expect(infomaniakModels.length).toBeGreaterThanOrEqual(4);
		expect(infomaniakModels.some(m => m.name === 'qwen3')).toBe(true);
		expect(infomaniakModels.some(m => m.name === 'swiss-ai/Apertus-70B-Instruct-2509')).toBe(true);
		expect(infomaniakModels.some(m => m.name === 'mistral3')).toBe(true);
		expect(infomaniakModels.some(m => m.name === 'bge_multilingual_gemma2')).toBe(true);
	});

	it('should fetch live models for Infomaniak when API key and product ID are supplied', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
				expect(String(url)).toBe('https://api.infomaniak.com/2/ai/20886/openai/v1/models');
				expect(init?.headers).toEqual({ Authorization: 'Bearer test-token' });
				return {
					ok: true,
					json: async () => ({
						object: 'list',
						data: [
							{ id: 'qwen3', object: 'model', owned_by: 'system' },
							{ id: 'mistral3', object: 'model', owned_by: 'system' }
						]
					})
				} as Response;
			};

			const liveModels = await ModelDiscoveryService.fetchLiveModels('infomaniak', 'test-token', 'https://api.infomaniak.com', '20886');
			expect(liveModels.length).toBe(2);
			expect(liveModels[0].name).toBe('mistral3');
			expect(liveModels[1].name).toBe('qwen3');
			expect(liveModels[0].isLive).toBe(true);
		} finally {
			window.fetch = originalFetch;
		}
	});

	it('should provide OpenRouter fallback models', () => {
		const openRouterModels = ModelDiscoveryService.getFallbackForProvider('openrouter');
		expect(openRouterModels.length).toBeGreaterThanOrEqual(4);
		expect(openRouterModels.some(m => m.name === 'anthropic/claude-3.5-sonnet')).toBe(true);
		expect(openRouterModels.some(m => m.name === 'deepseek/deepseek-r1')).toBe(true);
		expect(openRouterModels.some(m => m.name === 'meta-llama/llama-3.3-70b-instruct')).toBe(true);
	});

	it('should fetch live models for OpenRouter when API key is supplied', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
				expect(String(url)).toBe('https://openrouter.ai/api/v1/models');
				expect(init?.headers).toEqual({ Authorization: 'Bearer test-or-token' });
				return {
					ok: true,
					json: async () => ({
						data: [
							{ id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
							{ id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' }
						]
					})
				} as Response;
			};

			const liveModels = await ModelDiscoveryService.fetchLiveModels('openrouter', 'test-or-token', 'https://openrouter.ai/api/v1');
			expect(liveModels.length).toBe(2);
			expect(liveModels[0].name).toBe('anthropic/claude-3.5-sonnet');
			expect(liveModels[1].name).toBe('deepseek/deepseek-r1');
		} finally {
			window.fetch = originalFetch;
		}
	});
});

