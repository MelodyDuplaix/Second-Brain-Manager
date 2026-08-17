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

	const getWords = (s: string) =>
		s
			.split(/\s+/)
			.filter(w => w.length >= 2 && !stopWords.has(w));

	const wordsA = getWords(cleanText);
	const wordsB = getWords(cleanVault);

	if (wordsA.length === 0 || wordsB.length === 0) return false;

	// Si le texte est un long paragraphe explicatif (> 25 mots), ce n'est pas une ligne de tâche
	if (wordsA.length > 25 && wordsA.length > wordsB.length * 3) return false;

	// 1. Inclusion directe de la chaîne
	if (cleanText.includes(cleanVault) || cleanVault.includes(cleanText)) {
		return true;
	}

	// 2. Score de mots en commun
	const common = wordsA.filter(w => wordsB.includes(w));
	const matchRatio = common.length / wordsB.length;

	return matchRatio >= 0.6 || (common.length >= 2 && wordsB.length <= 3 && matchRatio >= 0.5);
}

describe('Task Fuzzy Matcher', () => {
	it('should match task titles with appended wikilink paths and tags', () => {
		const text = 'Réserver le billet de train #perso 📅 2026-08-10 #tm/q2 00 - Inbox/Idées vrac';
		const vaultTitle = 'Réserver le billet de train #perso';

		expect(matchTaskTitle(text, vaultTitle)).toBe(true);
	});

	it('should match list items with category and location', () => {
		const text = 'Sortir les poubelles #maison 📅 2026-08-07 #tm/q3 Maison';
		const vaultTitle = 'Sortir les poubelles #maison';

		expect(matchTaskTitle(text, vaultTitle)).toBe(true);
	});

	it('should match slightly rephrased task titles in lists', () => {
		const text = 'Envoyer le catalogue à Claire #reseau 📅 2026-08-07 Claire (Énergie : 2/10)';
		const vaultTitle = 'Envoyer le catalogue de tarifs à Claire';

		expect(matchTaskTitle(text, vaultTitle)).toBe(true);
	});

	it('should match exact titles with formatting', () => {
		const text = '[[Projet Jeu Vidéo]] - Réparer le bug de collision du joueur (Énergie : 8/10)';
		const vaultTitle = 'Réparer le bug de collision du joueur';

		expect(matchTaskTitle(text, vaultTitle)).toBe(true);
	});

	it('should NEVER match conversational welcome paragraphs that just mention Second Brain', () => {
		const welcomeText = 'Bonjour ! Je suis votre assistant Second Brain. Vous pouvez me poser des questions sur votre coffre, me raconter une réunion pour créer automatiquement des fiches et des tâches, ou me demander un briefing.';
		const vaultTask = 'Définir les principes du Second Brain Manager #dev';

		expect(matchTaskTitle(welcomeText, vaultTask)).toBe(false);
	});

	it('should not match unrelated tasks', () => {
		const text = 'Sortir les poubelles';
		const vaultTitle = 'Envoyer le catalogue de tarifs à Claire';

		expect(matchTaskTitle(text, vaultTitle)).toBe(false);
	});
});
