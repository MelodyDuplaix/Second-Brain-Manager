export function normalizePath(path: string): string {
	if (!path) return '';
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class TAbstractFile {
	path = '';
	name = '';
}

export class TFile extends TAbstractFile {
	basename = '';
	extension = 'md';
	parent: TFolder | null = null;
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Notice {
	constructor(public message: string) {}
}

export class Modal {
	contentEl = { empty: () => {}, createEl: () => ({}) };
	open() {}
	close() {}
}

export class FuzzySuggestModal<T = unknown> extends Modal {
	_type?: T;
	constructor(public app: unknown) {
		super();
	}
	setPlaceholder(_p: string) {}
	getItems(): T[] { return []; }
	getItemText(_item: T): string { return ''; }
	onChooseItem(_item: T, _evt: MouseEvent | KeyboardEvent) {}
}

export class Setting {
	constructor(public containerEl?: HTMLElement) {}
	setName() { return this; }
	setDesc() { return this; }
	setHeading() { return this; }
	addText() { return this; }
	addButton() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
	addSlider() { return this; }
}

export class Plugin {
	app = {};
	registerView() {}
	registerEvent() {}
	addRibbonIcon() {}
	addStatusBarItem() { return { setText: () => {} }; }
	addCommand() {}
	addSettingTab() {}
	loadData() { return Promise.resolve({}); }
	saveData() { return Promise.resolve(); }
}

export class PluginSettingTab {
	containerEl = { empty: () => {}, addClass: () => {} };
	constructor(public app: unknown, public plugin: unknown) {}
}

export class ItemView {
	containerEl = { children: [{}, { empty: () => {}, addClass: () => {} }] };
	constructor(public leaf: unknown) {}
}

export class MarkdownView {
	file?: TFile;
}

export class AbstractInputSuggest<T = unknown> {
	_type?: T;
	constructor(public app: unknown, public inputEl: unknown) {}
	setValue(_val: string) {}
	close() {}
}

export class MarkdownRenderer {
	static render() { return Promise.resolve(); }
}

export function setIcon() {}
