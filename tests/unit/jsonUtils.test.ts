import { describe, it, expect } from 'vitest';
import { JsonUtils } from '../../src/utils/jsonUtils';

describe('JsonUtils', () => {
	it('should parse standard JSON safely', () => {
		const json = '{"tool": "read_note", "arguments": {"filePath": "01 - Projets/Jeu.md"}}';
		const parsed = JsonUtils.safeParseJson(json);
		expect(parsed).toEqual({
			tool: 'read_note',
			arguments: { filePath: '01 - Projets/Jeu.md' }
		});
	});

	it('should sanitize and parse JSON with trailing commas and comments', () => {
		const json = `
		// Commentaire d'outil
		{
			"tool": "propose_create_task",
			"arguments": {
				"taskTitle": "Faire les courses",
				"priority": "high",
			},
		}
		`;
		const parsed = JsonUtils.safeParseJson(json);
		expect(parsed).toEqual({
			tool: 'propose_create_task',
			arguments: {
				taskTitle: 'Faire les courses',
				priority: 'high'
			}
		});
	});

	it('should extract tool call with nested markdown codeblocks (```col-md, ````col)', () => {
		const text = `
J'ai récupéré le contenu de la note "Sans titre 173".
Je vais créer la fiche **François Gafier** dans le dossier \`Personnes\`.

Voici la proposition de création de la note :

\`\`\`json
[
  {
    "tool": "propose_create_note",
    "arguments": {
      "folder": "Personnes",
      "fileName": "François Gafier",
      "tags": [
        "#personne"
      ],
      "content": "<% await tp.file.move(\\"/Personnes/\\" + tp.file.title) %>\\n\\n## Information générale\\n\\n>[!col]\\n>\\n\\n\`\`\`\`col\\n===\\n\`\`\`col-md\\nPrénom / Nom : François Gafier\\n<br><br>Téléphone : \\nAutre contact :\\n\`\`\`\\n\\n\`\`\`col-md\\nAdresse :  \\n<br>Mail : \\n<br><br>Date aniversaire : \\n\`\`\`\\n\`\`\`\`\\n\\nTag \\n\\n## Contexte\\n\\nC14 : 2017\\nD10 :\\n\\nM08 : 1789\\n\\n12 :\\n\\n\\n12 : \\n\\nQuoi : Vérité \\n\\nQui : voyage / Star / \\n\\n## Journal   \\n\\n\\n"
    }
  }
]
\`\`\`
		`;

		const { toolCalls, cleanText } = JsonUtils.extractToolCallsFromText(text);

		expect(toolCalls.length).toBe(1);
		expect(toolCalls[0].name).toBe('propose_create_note');
		expect(toolCalls[0].arguments.folder).toBe('Personnes');
		expect(toolCalls[0].arguments.fileName).toBe('François Gafier');
		expect(toolCalls[0].arguments.tags).toEqual(['#personne']);
		expect(toolCalls[0].arguments.content).toContain('```col-md');

		expect(cleanText).not.toContain('```json');
		expect(cleanText).not.toContain('propose_create_note');
		expect(cleanText).toContain('J\'ai récupéré le contenu de la note "Sans titre 173".');
	});

	it('should extract bare JSON array without markdown code blocks (Qwen style)', () => {
		const text = `
[
  {
    "tool": "propose_create_note",
    "arguments": {
      "folder": "personne",
      "fileName": "François Gueyffier.md",
      "tags": ["#contact", "#personne"]
    }
  }
]
		`;

		const { toolCalls, cleanText } = JsonUtils.extractToolCallsFromText(text);

		expect(toolCalls.length).toBe(1);
		expect(toolCalls[0].name).toBe('propose_create_note');
		expect(toolCalls[0].arguments.fileName).toBe('François Gueyffier.md');
		expect(cleanText).toBe('');
	});

	it('should extract bare JSON object without markdown code blocks', () => {
		const text = `
Je consulte votre note tout de suite.
{
  "tool": "read_note",
  "arguments": {
    "filePath": "Notes en vrac/Sans titre 175.md"
  }
}
		`;

		const { toolCalls, cleanText } = JsonUtils.extractToolCallsFromText(text);

		expect(toolCalls.length).toBe(1);
		expect(toolCalls[0].name).toBe('read_note');
		expect(toolCalls[0].arguments.filePath).toBe('Notes en vrac/Sans titre 175.md');
		expect(cleanText).toBe('Je consulte votre note tout de suite.');
	});

	it('should repair JSON with unescaped literal newlines in content string', () => {
		const malformed = `
		{
			"tool": "propose_create_note",
			"arguments": {
				"folder": "01 - Projets",
				"fileName": "Test.md",
				"content": "Ligne 1
Ligne 2
Ligne 3"
			}
		}
		`;

		const parsed = JsonUtils.safeParseJson(malformed);
		expect(parsed).not.toBeNull();
		expect(parsed.arguments.fileName).toBe('Test.md');
		expect(parsed.arguments.content).toBe('Ligne 1\nLigne 2\nLigne 3');
	});

	it('should clean streaming text dynamically', () => {
		const streaming1 = 'Je vais analyser la note.\n```json\n[\n  {"tool": "read_note"';
		expect(JsonUtils.cleanStreamingText(streaming1)).toBe('Je vais analyser la note.');

		const streaming2 = 'Recherche en cours...\n[{"tool": "search_vault"';
		expect(JsonUtils.cleanStreamingText(streaming2)).toBe('Recherche en cours...');
	});
});
