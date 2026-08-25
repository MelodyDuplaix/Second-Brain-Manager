export class DailyNoteFormatter {
	/**
	 * Formate un texte Markdown (Briefing, Revue du soir, Reprise) pour enregistrement dans la Daily Note
	 * en évitant de créer des tâches Markdown doublons (- [ ] ...) dans le coffre, tout en préservant
	 * les liens et les embeds de blocs.
	 */
	public static formatForDailyNote(markdownText: string): string {
		const cleanWikilinks = markdownText.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
		const lines = cleanWikilinks.split('\n');

		const formattedLines = lines.map(line => {
			// Détection des lignes de tâches Obsidian Tasks
			const taskMatch = line.match(/^(\s*)[-*+]\s+\[([- xX/><~])\]\s*(.*)$/);
			if (!taskMatch) {
				return line;
			}

			const indent = taskMatch[1];
			const statusChar = taskMatch[2];
			const body = taskMatch[3].trim();

			// Si la ligne contient un block ID et un lien de note pour embed : ![[Note#^blockId]]
			const blockIdMatch = body.match(/\s+(\^[a-zA-Z0-9_-]+)$/);
			const wikiMatch = body.match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/);

			if (blockIdMatch && wikiMatch) {
				const noteName = wikiMatch[1];
				const blockId = blockIdMatch[1];
				return `${indent}![[${noteName}#${blockId}]]`;
			}

			// Sinon, transformation en puce de référence (sans syntaxe checkbox) pour empêcher les doublons Tasks
			let statusPrefix = '📌';
			if (statusChar === 'x' || statusChar === 'X') {
				statusPrefix = '✅';
			} else if (statusChar === '-' || statusChar === 'c') {
				statusPrefix = '🚫';
			} else if (statusChar === '/') {
				statusPrefix = '⏳';
			}

			return `${indent}* ${statusPrefix} ${body}`;
		});

		return formattedLines.join('\n').trim();
	}
}
