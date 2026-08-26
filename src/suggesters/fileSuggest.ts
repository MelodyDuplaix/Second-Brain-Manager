import { AbstractInputSuggest, App, TFile } from 'obsidian';

export class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(app: App, textInputEl: HTMLInputElement) {
		super(app, textInputEl);
	}

	getSuggestions(inputStr: string): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const lowerInput = inputStr.toLowerCase().trim();

		const matches = files.filter(f => {
			if (!lowerInput) return true;
			return f.path.toLowerCase().includes(lowerInput) || f.basename.toLowerCase().includes(lowerInput);
		});

		return matches.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createEl('div', { text: file.basename, cls: 'sbm-suggest-title' });
		el.createEl('small', { text: file.path, cls: 'sbm-suggest-path' });
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.textInputEl.dispatchEvent(new Event('input'));
		this.textInputEl.dispatchEvent(new Event('change'));
		this.close();
	}
}
