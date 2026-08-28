/**
 * Utilitaires robustes d'extraction, assainissement et parsing de JSON / Tool Calls
 * Conçu pour résister aux blocs de code imbriqués (ex: ```col-md), aux JSONs bruts sans backticks,
 * aux retours à la ligne non échappés et aux virgules traînantes.
 */

export interface ExtractedJsonBlock {
	jsonText: string;
	fullMatchText: string;
	startIndex: number;
	endIndex: number;
}

export interface GenericToolCall {
	name: string;
	arguments: Record<string, any>;
}

export class JsonUtils {
	/**
	 * Tente de parser une chaîne JSON avec réparations automatiques en cas d'échec strict.
	 */
	public static safeParseJson<T = any>(rawJson: string): T | null {
		if (!rawJson || typeof rawJson !== 'string') return null;
		const trimmed = rawJson.trim();
		if (!trimmed) return null;

		// 1. Essai direct standard
		try {
			return JSON.parse(trimmed) as T;
		} catch {
			// Continuer vers l'assainissement
		}

		// 2. Nettoyage et assainissement progressif
		try {
			const sanitized = JsonUtils.sanitizeJsonString(trimmed);
			return JSON.parse(sanitized) as T;
		} catch {
			// Continuer vers réparation plus agressive
		}

		// 3. Réparation des chaînes avec sauts de ligne réels et caractères de contrôle
		try {
			const repaired = JsonUtils.repairMalformedJson(trimmed);
			return JSON.parse(repaired) as T;
		} catch {
			return null;
		}
	}

	/**
	 * Assainit le JSON : retire les commentaires, les virgules traînantes, etc.
	 */
	public static sanitizeJsonString(json: string): string {
		let result = json.trim();

		// Supprime les commentaires JS simples // ou /* */
		result = result.replace(/\/\*[\s\S]*?\*\//g, '');
		result = result.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

		// Supprime les virgules traînantes avant } ou ]
		result = result.replace(/,\s*([}\]])/g, '$1');

		return result;
	}

	/**
	 * Répare les JSONs contenant des sauts de ligne littéraux non échappés dans les chaînes de texte.
	 */
	public static repairMalformedJson(json: string): string {
		let inString = false;
		let isEscaped = false;
		let out = '';

		for (let i = 0; i < json.length; i++) {
			const char = json[i];

			if (isEscaped) {
				isEscaped = false;
				continue;
			}

			if (char === '\\') {
				isEscaped = true;
				out += char;
				continue;
			}

			if (char === '"') {
				inString = !inString;
				out += char;
				continue;
			}

			if (inString) {
				// Remplacement des vrais retours à la ligne par \n dans les chaînes
				if (char === '\n') {
					out += '\\n';
				} else if (char === '\r') {
					// Ignorer \r
				} else if (char === '\t') {
					out += '\\t';
				} else if (char.charCodeAt(0) < 32) {
					// Caractères de contrôle ASCII < 32
					out += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
				} else {
					out += char;
				}
			} else {
				out += char;
			}
		}

		// Nettoyage final des virgules traînantes
		return JsonUtils.sanitizeJsonString(out);
	}

	/**
	 * Extrait tous les blocs JSON (avec ou sans balises markdown ```json)
	 * en utilisant un algorithme d'équilibrage des accolades/crochets insensible aux backticks internes.
	 */
	public static extractJsonBlocks(text: string): ExtractedJsonBlock[] {
		if (!text) return [];
		const blocks: ExtractedJsonBlock[] = [];
		const len = text.length;
		let i = 0;

		while (i < len) {
			// Recherche d'un début de bloc de code ``` ou d'un début direct de JSON [ ou {
			const codeBlockStart = text.indexOf('```', i);
			const bracketStart = text.indexOf('[', i);
			const braceStart = text.indexOf('{', i);

			// Déterminer la première position intéressante
			const candidates = [codeBlockStart, bracketStart, braceStart].filter(pos => pos !== -1);
			if (candidates.length === 0) break;

			const firstPos = Math.min(...candidates);

			if (firstPos === codeBlockStart) {
				// Bloc de code markdown ```
				const fenceMatch = text.slice(codeBlockStart).match(/^```(?:[a-zA-Z0-9_-]+)?\s*/);
				if (!fenceMatch) {
					i = codeBlockStart + 3;
					continue;
				}

				const jsonSearchStart = codeBlockStart + fenceMatch[0].length;
				const firstCharMatch = text.slice(jsonSearchStart).search(/[[{]/);

				if (firstCharMatch === -1) {
					// Pas de JSON dans ce bloc de code
					const nextFence = text.indexOf('```', jsonSearchStart);
					i = nextFence !== -1 ? nextFence + 3 : len;
					continue;
				}

				const actualJsonStart = jsonSearchStart + firstCharMatch;
				const balancedEnd = JsonUtils.findBalancedJsonEnd(text, actualJsonStart);

				if (balancedEnd !== -1) {
					const jsonText = text.slice(actualJsonStart, balancedEnd);
					// Recherche du ``` de fermeture après balancedEnd
					const closingFenceIdx = text.indexOf('```', balancedEnd);
					let fullEndIndex = balancedEnd;

					if (closingFenceIdx !== -1 && closingFenceIdx <= balancedEnd + 20) {
						fullEndIndex = closingFenceIdx + 3;
					}

					const fullMatchText = text.slice(codeBlockStart, fullEndIndex);

					blocks.push({
						jsonText,
						fullMatchText,
						startIndex: codeBlockStart,
						endIndex: fullEndIndex
					});

					i = fullEndIndex;
					continue;
				} else {
					i = jsonSearchStart;
					continue;
				}
			} else {
				// Début direct sans fence (bare JSON array ou object)
				const balancedEnd = JsonUtils.findBalancedJsonEnd(text, firstPos);
				if (balancedEnd !== -1) {
					const candidateJson = text.slice(firstPos, balancedEnd);
					// Vérification rapide : est-ce que ça ressemble à un tool call ou un objet structuré ?
					if (candidateJson.includes('"tool"') || candidateJson.includes('"name"') || candidateJson.includes('"type"')) {
						blocks.push({
							jsonText: candidateJson,
							fullMatchText: candidateJson,
							startIndex: firstPos,
							endIndex: balancedEnd
						});
						i = balancedEnd;
						continue;
					}
				}
				i = firstPos + 1;
			}
		}

		return blocks;
	}

	/**
	 * Trouve l'indice de fin d'un JSON équilibré en tenant compte des chaînes échappées.
	 */
	public static findBalancedJsonEnd(text: string, startIndex: number): number {
		const startChar = text[startIndex];
		if (startChar !== '{' && startChar !== '[') return -1;

		let inString = false;
		let isEscaped = false;
		let braceCount = 0;
		let bracketCount = 0;
		const len = text.length;

		for (let i = startIndex; i < len; i++) {
			const char = text[i];

			if (isEscaped) {
				isEscaped = false;
				continue;
			}

			if (char === '\\' && inString) {
				isEscaped = true;
				continue;
			}

			if (char === '"') {
				inString = !inString;
				continue;
			}

			if (!inString) {
				if (char === '{') braceCount++;
				else if (char === '}') braceCount--;
				else if (char === '[') bracketCount++;
				else if (char === ']') bracketCount--;

				if (braceCount === 0 && bracketCount === 0) {
					return i + 1;
				}

				if (braceCount < 0 || bracketCount < 0) {
					return -1;
				}
			}
		}

		return -1;
	}

	/**
	 * Extrait les appels d'outils (tool calls) d'un texte et renvoie le texte nettoyé.
	 */
	public static extractToolCallsFromText(text: string): { toolCalls: GenericToolCall[]; cleanText: string } {
		if (!text) return { toolCalls: [], cleanText: '' };

		const blocks = JsonUtils.extractJsonBlocks(text);
		const toolCalls: GenericToolCall[] = [];
		let cleanText = text;

		for (const block of blocks) {
			const parsed = JsonUtils.safeParseJson(block.jsonText);
			if (!parsed) continue;

			const items = Array.isArray(parsed) ? parsed : [parsed];
			let hasValidTool = false;

			for (const item of items) {
				if (!item || typeof item !== 'object') continue;

				const name = item.tool || item.name;
				const args = item.arguments || item.args || item.parameters || {};

				if (name && typeof name === 'string') {
					toolCalls.push({ name, arguments: args });
					hasValidTool = true;
				}
			}

			if (hasValidTool) {
				// Supprime le bloc du texte visible
				cleanText = cleanText.replace(block.fullMatchText, '');
			}
		}

		// Nettoyage des lignes vides superflues
		cleanText = cleanText
			.replace(/\n{3,}/g, '\n\n')
			.trim();

		return { toolCalls, cleanText };
	}

	/**
	 * Nettoie le texte en cours de streaming pour masquer les blocs JSON incomplets ou terminés.
	 */
	public static cleanStreamingText(fullText: string): string {
		if (!fullText) return '';

		// 1. Supprime les blocs de code markdown fermés ou en cours de streaming
		let cleaned = fullText.replace(/```(?:json[a-z:-]*)?\s*[\s\S]*?(?:```|$)/gi, '');

		// 2. Supprime les tableaux JSON bruts en cours de streaming commençant par [ { "tool" ...
		cleaned = cleaned.replace(/(?:^|\n)\s*\[\s*\{\s*"(?:tool|name)"[\s\S]*$/gi, '');

		return cleaned.trim();
	}
}
