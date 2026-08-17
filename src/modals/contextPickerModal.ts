import { App, FuzzySuggestModal, TFolder, MarkdownView, normalizePath } from 'obsidian';

export interface ContextItem {
	type: 'file' | 'folder' | 'active-note';
	path: string;
	title: string;
	desc: string;
}

export class ContextPickerModal extends FuzzySuggestModal<ContextItem> {
	private onChoose: (item: ContextItem) => void;

	constructor(app: App, onChoose: (item: ContextItem) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('Rechercher une note, un contact, un projet ou un dossier à joindre...');
	}

	getItems(): ContextItem[] {
		const items: ContextItem[] = [];

		// 1. Note active courante
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			items.push({
				type: 'active-note',
				path: normalizePath(activeView.file.path),
				title: `⚡ Note active : ${activeView.file.basename}`,
				desc: activeView.file.path
			});
		}

		// 2. Fichiers Markdown du coffre
		const files = this.app.vault.getMarkdownFiles();
		files.forEach(file => {
			items.push({
				type: 'file',
				path: normalizePath(file.path),
				title: file.basename,
				desc: `📄 ${file.path}`
			});
		});

		// 3. Dossiers du coffre
		const allLoaded = this.app.vault.getAllLoadedFiles();
		allLoaded.forEach(f => {
			if (f instanceof TFolder && f.path && f.path !== '/') {
				items.push({
					type: 'folder',
					path: normalizePath(f.path),
					title: `📁 Dossier : ${f.name}`,
					desc: f.path
				});
			}
		});

		return items;
	}

	getItemText(item: ContextItem): string {
		return `${item.title} ${item.path}`;
	}

	renderSuggestion(item: { item: ContextItem }, el: HTMLElement): void {
		el.createDiv({ text: item.item.title, cls: 'sbm-context-modal-title' });
		el.createDiv({ text: item.item.desc, cls: 'sbm-context-modal-desc' });
	}

	onChooseItem(item: ContextItem): void {
		this.onChoose(item);
	}
}
