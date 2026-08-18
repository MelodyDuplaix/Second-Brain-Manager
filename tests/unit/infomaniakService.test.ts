import { describe, it, expect, vi } from 'vitest';
import { InfomaniakService } from '../../src/services/infomaniakService';

describe('InfomaniakService', () => {
	it('should automatically fetch product_id from GET /1/ai with array response', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					result: 'success',
					data: [
						{ id: 90065, status: 'active', name: 'My AI Tool' }
					]
				})
			} as unknown as Response);

			const productId = await InfomaniakService.fetchProductId('test-api-token');
			expect(productId).toBe('90065');
			expect(window.fetch).toHaveBeenCalledWith(
				'https://api.infomaniak.com/1/ai',
				expect.objectContaining({
					method: 'GET',
					headers: {
						'Authorization': 'Bearer test-api-token',
						'Content-Type': 'application/json'
					}
				})
			);
		} finally {
			window.fetch = originalFetch;
		}
	});

	it('should handle single object response in data field', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					result: 'success',
					data: { id: 57476, status: 'active' }
				})
			} as unknown as Response);

			const productId = await InfomaniakService.fetchProductId('test-api-token');
			expect(productId).toBe('57476');
		} finally {
			window.fetch = originalFetch;
		}
	});

	it('should support product_id field in Infomaniak API response format', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					result: 'success',
					data: [
						{
							product_name: 'Ai-Tools',
							product_id: 90065,
							account_name: 'My Org',
							status: 'ok'
						}
					]
				})
			} as unknown as Response);

			const result = await InfomaniakService.testConnection('test-api-token');
			expect(result.success).toBe(true);
			expect(result.productId).toBe('90065');
		} finally {
			window.fetch = originalFetch;
		}
	});

	it('should return error description when API fails or returns error', async () => {
		const originalFetch = window.fetch;
		try {
			window.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				text: async () => JSON.stringify({ error: { description: 'Invalid token or scope' } })
			} as unknown as Response);

			const result = await InfomaniakService.testConnection('invalid-token');
			expect(result.success).toBe(false);
			expect(result.error).toContain('Erreur Infomaniak HTTP 401');
		} finally {
			window.fetch = originalFetch;
		}
	});
});
