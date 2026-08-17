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
});
