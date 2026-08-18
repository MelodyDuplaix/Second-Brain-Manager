import { requestUrl } from 'obsidian';

/**
 * Service d'intégration spécifique aux API Infomaniak AI Tools (https://developer.infomaniak.com)
 */
export class InfomaniakService {
	/**
	 * Interroge l'endpoint officiel GET /1/ai pour récupérer automatiquement le product_id
	 * associé au compte de l'utilisateur.
	 */
	public static async fetchProductId(apiKey: string, endpoint = 'https://api.infomaniak.com'): Promise<string | undefined> {
		const result = await this.testConnection(apiKey, endpoint);
		return result.productId;
	}

	/**
	 * Teste la validité du token API et récupère les informations détaillées du produit AI Tools.
	 */
	public static async testConnection(
		apiKey: string,
		endpoint = 'https://api.infomaniak.com'
	): Promise<{ success: boolean; productId?: string; error?: string; rawData?: unknown }> {
		if (!apiKey) {
			return { success: false, error: 'Token API manquant' };
		}

		try {
			const baseUrl = endpoint.replace(/\/+$/, '');
			const url = `${baseUrl}/1/ai`;

			let status = 0;
			let data: unknown = null;
			let rawText = '';

			if (typeof requestUrl === 'function') {
				const response = await requestUrl({
					url,
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					},
					throw: false
				});
				status = response.status;
				data = response.json;
				rawText = response.text;
			} else {
				const res = await window.fetch(url, {
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					}
				});
				status = res.status;
				rawText = await res.text();
				try {
					data = JSON.parse(rawText);
				} catch {
					data = null;
				}
			}

			if (status !== 200 || !data) {
				return {
					success: false,
					error: `Erreur Infomaniak HTTP ${status} : ${rawText.slice(0, 200)}`,
					rawData: data
				};
			}

			const json = data as {
				data?: Array<Record<string, unknown>> | Record<string, unknown> | number | string;
				result?: string;
				error?: { description?: string; code?: string };
			};

			if (json.error?.description) {
				return {
					success: false,
					error: `Erreur API Infomaniak : ${json.error.description}`,
					rawData: json
				};
			}

			if (!json.data) {
				return {
					success: false,
					error: 'Aucune donnée "data" retournée par GET /1/ai',
					rawData: json
				};
			}

			let detectedId: string | undefined;

			// Cas 1 : data est un tableau d'objets (ex: [{"product_id": 90065, "product_name": "Ai-Tools"}])
			if (Array.isArray(json.data) && json.data.length > 0) {
				for (const item of json.data) {
					if (item && typeof item === 'object') {
						const pid = item.product_id ?? item.id ?? item.productId;
						if (pid !== undefined && pid !== null && String(pid).trim() !== '') {
							detectedId = String(pid).trim();
							break;
						}
					} else if (typeof item === 'number' || typeof item === 'string') {
						detectedId = String(item).trim();
						break;
					}
				}
			}
			// Cas 2 : data est un objet unique (ex: {"product_id": 90065})
			else if (typeof json.data === 'object' && json.data !== null) {
				const single = json.data as Record<string, unknown>;
				const pid = single.product_id ?? single.id ?? single.productId;
				if (pid !== undefined && pid !== null && String(pid).trim() !== '') {
					detectedId = String(pid).trim();
				}
			}
			// Cas 3 : data est directement un identifiant numérique ou chaîne
			else if (typeof json.data === 'number' || typeof json.data === 'string') {
				detectedId = String(json.data).trim();
			}

			if (detectedId) {
				return {
					success: true,
					productId: detectedId,
					rawData: json
				};
			}

			return {
				success: false,
				error: `Structure de données inattendue dans GET /1/ai : ${JSON.stringify(json.data).slice(0, 200)}`,
				rawData: json
			};
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				error: `Exception réseau / API : ${msg}`
			};
		}
	}
}
