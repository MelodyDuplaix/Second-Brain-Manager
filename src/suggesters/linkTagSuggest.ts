import { AbstractInputSuggest, App, TFile, parseFrontMatterAliases, prepareFuzzySearch, renderResults, SearchResult } from 'obsidian';

/* ==========================================================================
   Autocomplétion des liens [[…]] et des #tags dans un champ texte
   (comme le popup de capture de QuickAdd) : la suggestion dépend du texte
   juste avant le curseur, le reste du champ n'est pas touché.
   ========================================================================== */

type Suggestion =
	| { kind: 'file'; file: TFile; alias?: string; match: SearchResult | null; matchOn: string }
	| { kind: 'tag'; tag: string; count: number; match: SearchResult | null };

interface TriggerContext {
	kind: 'link' | 'tag';
	/** Début du déclencheur dans le champ (« [[ » ou « # ») */
	start: number;
	query: string;
	caret: number;
}

const LINK_TRIGGER = /\[\[([^[\]|#^]*)$/;
const TAG_TRIGGER = /(^|[\s(,;])#([\p{L}\p{N}_/-]*)$/u;
const MAX_RESULTS = 30;

/** Déclencheur actif juste avant le curseur (lien en cours ou tag en cours), ou null. */
export function findTrigger(value: string, caret: number): TriggerContext | null {
	const before = value.slice(0, caret);
	const link = LINK_TRIGGER.exec(before);
	if (link) return { kind: 'link', start: link.index, query: link[1], caret };
	const tag = TAG_TRIGGER.exec(before);
	if (tag) return { kind: 'tag', start: tag.index + tag[1].length, query: tag[2], caret };
	return null;
}

/** Remplace le déclencheur par la complétion et renvoie le nouveau texte et la position du curseur. */
export function applyCompletion(value: string, ctx: TriggerContext, insertion: string): { value: string; caret: number } {
	let after = value.slice(ctx.caret);
	if (ctx.kind === 'link') {
		// Fin de lien déjà présente (ex. « [[Pro]] » corrigé au milieu) : on ne la double pas
		after = after.replace(/^[^[\]]*\]\]/, '');
	} else {
		// Reste du tag tapé après le curseur remplacé, un seul espace après le tag
		after = after.replace(/^[\p{L}\p{N}_/-]*/u, '');
		if (/^\s/.test(after)) insertion = insertion.trimEnd();
	}
	const head = value.slice(0, ctx.start) + insertion;
	return { value: head + after, caret: head.length };
}

export class LinkTagSuggest extends AbstractInputSuggest<Suggestion> {
	private ctx: TriggerContext | null = null;
	private opened = false;
	private lastSelectAt = 0;

	constructor(app: App, private inputEl: HTMLInputElement, private sourcePath = '') {
		super(app, inputEl);
		this.limit = MAX_RESULTS;
	}

	/** Vrai quand la touche Entrée appartient à la liste de suggestions (ne pas valider le formulaire). */
	isBusy(): boolean {
		return this.opened || Date.now() - this.lastSelectAt < 300;
	}

	open(): void {
		super.open();
		this.opened = true;
	}

	close(): void {
		super.close();
		this.opened = false;
	}

	protected getSuggestions(value: string): Suggestion[] {
		const caret = this.inputEl.selectionStart ?? value.length;
		this.ctx = findTrigger(value, caret);
		if (!this.ctx) return [];
		return this.ctx.kind === 'link' ? this.fileSuggestions(this.ctx.query) : this.tagSuggestions(this.ctx.query);
	}

	private fileSuggestions(query: string): Suggestion[] {
		const files = this.app.vault.getFiles().filter(f => f.extension === 'md' || f.extension === 'canvas');
		const q = query.trim();
		if (!q) {
			// Sans saisie : notes ouvertes récemment, puis les plus récemment modifiées
			const recent = this.app.workspace.getLastOpenFiles()
				.map(p => this.app.vault.getAbstractFileByPath(p))
				.filter((f): f is TFile => f instanceof TFile);
			const seen = new Set(recent.map(f => f.path));
			const rest = files.filter(f => !seen.has(f.path)).sort((a, b) => b.stat.mtime - a.stat.mtime);
			return [...recent, ...rest].slice(0, MAX_RESULTS).map(file => ({ kind: 'file' as const, file, match: null, matchOn: file.basename }));
		}
		const fuzzy = prepareFuzzySearch(q);
		const scored: Array<{ s: Suggestion; score: number }> = [];
		for (const file of files) {
			const byName = fuzzy(file.basename);
			const byPath = byName ? null : fuzzy(file.path);
			if (byName || byPath) {
				const match = byName || byPath;
				// Nom plutôt que chemin, et léger bonus pour les notes Markdown
				const score = (match as SearchResult).score + (byName ? 0 : -1) + (file.extension === 'md' ? 0.1 : 0);
				scored.push({ s: { kind: 'file', file, match: byName, matchOn: file.basename }, score });
			}
			const aliases = parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) || [];
			for (const alias of aliases) {
				const m = fuzzy(alias);
				if (m) scored.push({ s: { kind: 'file', file, alias, match: m, matchOn: alias }, score: m.score - 0.05 });
			}
		}
		return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS).map(x => x.s);
	}

	private tagSuggestions(query: string): Suggestion[] {
		const counts = (this.app.metadataCache as unknown as { getTags?: () => Record<string, number> }).getTags?.() || {};
		const tags = Object.entries(counts).map(([tag, count]) => ({ tag: tag.replace(/^#/, ''), count }));
		const q = query.trim();
		if (!q) {
			return tags.sort((a, b) => b.count - a.count).slice(0, MAX_RESULTS)
				.map(t => ({ kind: 'tag' as const, tag: t.tag, count: t.count, match: null }));
		}
		const fuzzy = prepareFuzzySearch(q);
		return tags
			.map(t => ({ t, m: fuzzy(t.tag) }))
			.filter((x): x is { t: { tag: string; count: number }; m: SearchResult } => x.m !== null)
			// Pertinence d'abord, puis tags les plus utilisés
			.sort((a, b) => b.m.score - a.m.score || b.t.count - a.t.count)
			.slice(0, MAX_RESULTS)
			.map(x => ({ kind: 'tag' as const, tag: x.t.tag, count: x.t.count, match: x.m }));
	}

	renderSuggestion(item: Suggestion, el: HTMLElement): void {
		el.addClass('sbm-linktag-suggestion');
		const main = el.createDiv({ cls: 'sbm-linktag-main' });
		if (item.kind === 'tag') {
			const title = main.createDiv({ cls: 'sbm-linktag-title' });
			title.createSpan({ text: '#' });
			const name = title.createSpan();
			if (item.match) renderResults(name, item.tag, item.match);
			else name.setText(item.tag);
			el.createSpan({ cls: 'sbm-linktag-count', text: String(item.count) });
			return;
		}
		const title = main.createDiv({ cls: 'sbm-linktag-title' });
		if (item.match) renderResults(title, item.matchOn, item.match);
		else title.setText(item.matchOn);
		if (item.alias) main.createDiv({ cls: 'sbm-linktag-path', text: `↳ ${item.file.basename}` });
		const folder = item.file.parent && item.file.parent.path !== '/' ? item.file.parent.path : '';
		if (folder || item.file.extension !== 'md') {
			main.createDiv({ cls: 'sbm-linktag-path', text: [folder, item.file.extension !== 'md' ? item.file.extension : ''].filter(Boolean).join(' · ') });
		}
	}

	selectSuggestion(item: Suggestion): void {
		const ctx = this.ctx;
		if (!ctx) return;
		let insertion: string;
		if (item.kind === 'tag') {
			insertion = `#${item.tag} `;
		} else {
			const linktext = this.app.metadataCache.fileToLinktext(item.file, this.sourcePath, true);
			insertion = item.alias ? `[[${linktext}|${item.alias}]]` : `[[${linktext}]]`;
		}
		const next = applyCompletion(this.inputEl.value, ctx, insertion);
		this.lastSelectAt = Date.now();
		this.setValue(next.value);
		this.inputEl.setSelectionRange(next.caret, next.caret);
		this.inputEl.focus();
		this.close();
	}
}
