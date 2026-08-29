import { describe, it, expect } from 'vitest';
import { TemplateService } from '../../src/services/templateService';
import { DEFAULT_SETTINGS } from '../../src/main';
import { TFile, App } from 'obsidian';

describe('TemplateService', () => {
	const createMockTFile = (path: string): TFile => {
		const f = new TFile();
		f.path = path;
		f.basename = path.split('/').pop()?.replace('.md', '') || '';
		return f;
	};

	const filesStore: Record<string, string> = {
		'Templates/Personne.md': `---
type: contact
tags:
  - contact
---
# {{title}}

- **Société** : {{societe}}
- **Rôle** : {{role}}
- **Créé le** : {{date:YYYY-MM-DD}}
- **Date FR** : <% tp.date.now("DD/MM/YYYY") %>
- **Notes** : {{VALUE:notes}}
`,
		'Templates/Projet.md': `# Projet : <% tp.file.title %>
Dossier : <% tp.file.folder() %>
Date : {{DATE}}
Hier : {{yesterday}}
Demain : {{tomorrow}}
<% tp.file.cursor() %>
`
	};

	const mockApp = {
		vault: {
			getMarkdownFiles: () => Object.keys(filesStore).map(p => createMockTFile(p)),
			getFileByPath: (p: string) => (filesStore[p] ? createMockTFile(p) : null),
			getAbstractFileByPath: (p: string) => (filesStore[p] ? createMockTFile(p) : null),
			read: async (f: TFile) => filesStore[f.path] || '',
			cachedRead: async (f: TFile) => filesStore[f.path] || ''
		},
		metadataCache: {
			getFileCache: (f: TFile) => {
				if (f.path.includes('Personne')) {
					return { frontmatter: { type: 'contact' }, tags: [{ tag: '#contact' }] };
				}
				return null;
			}
		}
	} as unknown as App;

	it('should discover and list templates correctly', () => {
		const list = TemplateService.listTemplates(mockApp, DEFAULT_SETTINGS);
		expect(list.length).toBe(2);
		expect(list.map(t => t.name)).toContain('Personne');
		expect(list.map(t => t.name)).toContain('Projet');
	});

	it('should filter templates by query', () => {
		const list = TemplateService.listTemplates(mockApp, DEFAULT_SETTINGS, 'personne');
		expect(list.length).toBe(1);
		expect(list[0].name).toBe('Personne');
	});

	it('should read template and extract placeholders', async () => {
		const res = await TemplateService.readTemplate(mockApp, DEFAULT_SETTINGS, 'Personne');
		expect(res).not.toBeNull();
		expect(res?.name).toBe('Personne');
		expect(res?.placeholders).toContain('{{title}}');
		expect(res?.placeholders).toContain('{{societe}}');
		expect(res?.placeholders).toContain('{{role}}');
		expect(res?.placeholders).toContain('{{date:YYYY-MM-DD}}');
		expect(res?.placeholders).toContain('{{VALUE:notes}}');
		expect(res?.placeholders.some(p => p.includes('tp.date.now'))).toBe(true);
	});

	it('should render template with variables and placeholders correctly', () => {
		const rawTemplate = filesStore['Templates/Personne.md'];
		const rendered = TemplateService.renderTemplate(rawTemplate, {
			title: 'Claire Dupont',
			folder: '03 - Contacts',
			date: '2026-08-29',
			variables: {
				societe: 'Acme Corp',
				role: 'Directrice Marketing',
				notes: 'Rencontrée lors du salon Tech'
			}
		}, mockApp);

		expect(rendered).toContain('# Claire Dupont');
		expect(rendered).toContain('**Société** : Acme Corp');
		expect(rendered).toContain('**Rôle** : Directrice Marketing');
		expect(rendered).toContain('**Notes** : Rencontrée lors du salon Tech');
		expect(rendered).toContain('**Créé le** : 2026-08-29');
	});

	it('should render Templater syntax (tp.file.title, tp.file.cursor)', () => {
		const rawTemplate = filesStore['Templates/Projet.md'];
		const rendered = TemplateService.renderTemplate(rawTemplate, {
			title: 'Second Brain 2.0',
			folder: '01 - Projets',
			date: '2026-08-29'
		}, mockApp);

		expect(rendered).toContain('# Projet : Second Brain 2.0');
		expect(rendered).toContain('Dossier : 01 - Projets');
		expect(rendered).toContain('Date : 2026-08-29');
		expect(rendered).not.toContain('<% tp.file.cursor() %>');
	});
});
