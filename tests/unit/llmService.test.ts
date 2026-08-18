import { describe, it, expect, vi } from 'vitest';
import { LLMService } from '../../src/services/llmService';
import { ChatMessage, LLMConfig } from '../../src/models/llm';
import { HttpStreamService } from '../../src/services/httpStreamService';

describe('LLMService', () => {
	it('should stream response successfully for Infomaniak provider', async () => {
		const spyStream = vi.spyOn(HttpStreamService, 'streamSSE').mockImplementation(async (opts) => {
			opts.onChunk('Bonjour', 'Bonjour');
			opts.onChunk(' du coffre', 'Bonjour du coffre');
			return 'Bonjour du coffre';
		});

		try {
			const messages: ChatMessage[] = [
				{ role: 'user', content: 'Bonjour' }
			];

			const config: LLMConfig = {
				provider: 'infomaniak',
				endpoint: 'https://api.infomaniak.com',
				model: 'qwen3',
				productId: '20886',
				apiKey: 'infomaniak-secret-token'
			};

			const chunksReceived: string[] = [];
			const result = await LLMService.generateStreamingResponse(
				messages,
				config,
				(chunk) => chunksReceived.push(chunk)
			);

			expect(result).toBe('Bonjour du coffre');
			expect(chunksReceived).toEqual(['Bonjour', ' du coffre']);
			expect(spyStream).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://api.infomaniak.com/2/ai/20886/openai/v1/chat/completions',
					headers: expect.objectContaining({
						'Authorization': 'Bearer infomaniak-secret-token'
					})
				})
			);
		} finally {
			spyStream.mockRestore();
		}
	});

	it('should throw error when Infomaniak apiKey is missing or product id cannot be resolved', async () => {
		const messages: ChatMessage[] = [{ role: 'user', content: 'Test' }];

		const noKeyConfig: LLMConfig = {
			provider: 'infomaniak',
			endpoint: 'https://api.infomaniak.com',
			model: 'qwen3',
			productId: '20886'
		};

		await expect(
			LLMService.generateStreamingResponse(messages, noKeyConfig, () => {})
		).rejects.toThrow('Clé API / Token Infomaniak manquant');

		const originalFetch = window.fetch;
		try {
			window.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 401
			} as unknown as Response);

			const noProductConfig: LLMConfig = {
				provider: 'infomaniak',
				endpoint: 'https://api.infomaniak.com',
				model: 'qwen3',
				apiKey: 'invalid-token'
			};

			await expect(
				LLMService.generateStreamingResponse(messages, noProductConfig, () => {})
			).rejects.toThrow('Impossible de récupérer automatiquement l\'identifiant produit Infomaniak (GET /1/ai)');
		} finally {
			window.fetch = originalFetch;
		}
	});

	it('should generate embeddings with Infomaniak embedding endpoint', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					object: 'list',
					data: [
						{
							object: 'embedding',
							embedding: [0.1, 0.2, 0.3],
							index: 0
						}
					],
					model: 'bge_multilingual_gemma2'
				})
			} as unknown as Response);

			const config: LLMConfig = {
				provider: 'infomaniak',
				endpoint: 'https://api.infomaniak.com',
				model: 'bge_multilingual_gemma2',
				productId: '28964',
				apiKey: 'token-123'
			};

			const embeddings = await LLMService.createEmbedding('Test sentence', config);
			expect(embeddings).toEqual([[0.1, 0.2, 0.3]]);
			expect(window.fetch).toHaveBeenCalledWith(
				'https://api.infomaniak.com/2/ai/28964/openai/v1/embeddings',
				expect.objectContaining({
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': 'Bearer token-123'
					},
					body: JSON.stringify({
						input: 'Test sentence',
						model: 'bge_multilingual_gemma2'
					})
				})
			);
		} finally {
			window.fetch = originalFetch;
		}
	});

	it('should stream response successfully for OpenRouter provider', async () => {
		const originalFetch = window.fetch;
		try {
			const sseChunks = [
				'data: {"id":"gen-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
				'data: {"id":"gen-1","choices":[{"delta":{"content":" OpenRouter"}}]}\n\n',
				'data: [DONE]\n\n'
			];

			const encoder = new TextEncoder();
			let chunkIndex = 0;

			const mockReadableStream = new ReadableStream({
				pull(controller) {
					if (chunkIndex < sseChunks.length) {
						controller.enqueue(encoder.encode(sseChunks[chunkIndex]));
						chunkIndex++;
					} else {
						controller.close();
					}
				}
			});

			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				body: mockReadableStream
			} as unknown as Response);

			const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

			const config: LLMConfig = {
				provider: 'openrouter',
				endpoint: 'https://openrouter.ai/api/v1',
				model: 'anthropic/claude-3.5-sonnet',
				apiKey: 'sk-or-v1-token'
			};

			const chunksReceived: string[] = [];
			const result = await LLMService.generateStreamingResponse(
				messages,
				config,
				(chunk) => chunksReceived.push(chunk)
			);

			expect(result).toBe('Hello OpenRouter');
			expect(chunksReceived).toEqual(['Hello', ' OpenRouter']);
			expect(window.fetch).toHaveBeenCalledWith(
				'https://openrouter.ai/api/v1/chat/completions',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Authorization': 'Bearer sk-or-v1-token',
						'HTTP-Referer': 'https://obsidian.md'
					})
				})
			);
		} finally {
			window.fetch = originalFetch;
		}
	});
});
