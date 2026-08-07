import { AbstractInputSuggest, App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, textInputEl: HTMLInputElement) {
		super(app, textInputEl);
	}

	getSuggestions(inputStr: string): TFolder[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const folders: TFolder[] = [];
		const lowerInput = inputStr.toLowerCase().trim();

		for (const file of abstractFiles) {
			if (file instanceof TFolder) {
				if (!lowerInput || file.path.toLowerCase().includes(lowerInput)) {
					folders.push(file);
				}
			}
		}

		return folders.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || '/ (Racine du coffre)');
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.textInputEl.dispatchEvent(new Event('input'));
		this.textInputEl.dispatchEvent(new Event('change'));
		this.close();
	}
}
