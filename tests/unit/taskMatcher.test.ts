import { describe, it, expect } from 'vitest';

export function matchTaskTitle(text: string, vaultTitle: string): boolean {
	const stopWords = new Set([
		'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'a', 'à', 'pour', 'dans', 'en', 'par',
		'sur', 'et', 'ou', 'ce', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son',
		'sa', 'ses', 'the', 'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by', 'about'
	]);

	const clean = (str: string) =>
		str
			.toLowerCase()
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			.replace(/#[\w/_-]+/g, '')
			.replace(/📅[^\s]+|⚡[^\s]+|\(énergie\s*:[^)]+\)/gi, '')
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();

	const cleanText = clean(text);
	const cleanVault = clean(vaultTitle);

	if (!cleanText || !cleanVault) return false;
	if (cleanText.includes(cleanVault) || cleanVault.includes(cleanText)) return true;

	const getWords = (s: string) =>
		s
			.split(/\s+/)
			.filter(w => w.length >= 2 && !stopWords.has(w));

	const wordsA = getWords(cleanText);
	const wordsB = getWords(cleanVault);

	if (wordsA.length === 0 || wordsB.length === 0) return false;

	const common = wordsA.filter(w => wordsB.includes(w));
	const score = common.length / Math.min(wordsA.length, wordsB.length);

	return score >= 0.5 || common.length >= 2;
}

describe('Task Fuzzy Matcher', () => {
	it('should match slightly rephrased task titles', () => {
		const text = 'Envoyer le catalogue à Claire #reseau 📅 2026-08-07 Claire (Énergie : 2/10)';
		const vaultTitle = 'Envoyer le catalogue de tarifs à Claire';

		expect(matchTaskTitle(text, vaultTitle)).toBe(true);
	});

	it('should match exact titles with formatting', () => {
		const text = '[[Projet Jeu Vidéo]] - Réparer le bug de collision du joueur (Énergie : 8/10)';
		const vaultTitle = 'Réparer le bug de collision du joueur';

		expect(matchTaskTitle(text, vaultTitle)).toBe(true);
	});

	it('should not match unrelated tasks', () => {
		const text = 'Sortir les poubelles';
		const vaultTitle = 'Envoyer le catalogue de tarifs à Claire';

		expect(matchTaskTitle(text, vaultTitle)).toBe(false);
	});
});
