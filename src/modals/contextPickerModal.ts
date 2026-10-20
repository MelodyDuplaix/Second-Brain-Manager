import { App, FuzzySuggestModal, TFolder, MarkdownView, normalizePath } from 'obsidian';
import { SecondBrainSettings } from '../main';
import { VaultFilterService } from '../services/vaultFilterService';

export interface ContextItem {
	type: 'file' | 'folder' | 'active-note' | 'tag';
	path: string;
	title: string;
	desc: string;
}

export class ContextPickerModal extends FuzzySuggestModal<ContextItem> {
	private onChoose: (item: ContextItem) => void;
	private filterService?: VaultFilterService;
	private settings?: SecondBrainSettings;

	constructor(app: App, onChoose: (item: ContextItem) => void, settings?: SecondBrainSettings) {
		super(app);
		this.onChoose = onChoose;
		this.settings = settings;
		if (settings) {
			this.filterService = new VaultFilterService(app, settings);
		}
		this.setPlaceholder('Rechercher une note, un dossier ou un tag (#)...');
	}

	getItems(): ContextItem[] {
		const items: ContextItem[] = [];

		// 1. Note active courante
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			if (!this.filterService || !this.filterService.isFileExcluded(activeView.file)) {
				items.push({
					type: 'active-note',
					path: normalizePath(activeView.file.path),
					title: `⚡ Note active : ${activeView.file.basename}`,
					desc: activeView.file.path
				});
			}
		}

		// 2. Fichiers Markdown du coffre
		const files = this.app.vault.getMarkdownFiles();
		files.forEach(file => {
			if (this.filterService && this.filterService.isFileExcluded(file)) {
				return;
			}
			items.push({
				type: 'file',
				path: normalizePath(file.path),
				title: file.basename,
				desc: `📄 ${file.path}`
			});
		});

		// 3. Dossiers du coffre (dossiers normaux et dossiers exclus pour inclusion temporaire)
		const configuredExcluded = new Set(
			VaultFilterService.parseList(this.settings?.excludedFolders).map(f => normalizePath(f).toLowerCase())
		);
		const seenFolders = new Set<string>();
		const allLoaded = this.app.vault.getAllLoadedFiles();
		allLoaded.forEach(f => {
			if (f instanceof TFolder && f.path && f.path !== '/') {
				const normFolder = normalizePath(f.path);
				const normFolderLower = normFolder.toLowerCase();
				if (seenFolders.has(normFolderLower)) return;
				seenFolders.add(normFolderLower);

				const isExplicitlyExcluded = configuredExcluded.has(normFolderLower) || configuredExcluded.has(f.name.toLowerCase());
				if (isExplicitlyExcluded) {
					items.push({
						type: 'folder',
						path: normFolder,
						title: `📂 [Exclu] Dossier : ${f.name}`,
						desc: `⚠️ ${f.path} • Actuellement exclu — cliquer pour l'inclure temporairement dans ce chat`
					});
				} else if (this.filterService && this.filterService.isFolderExcluded(normFolder)) {
					// Le dossier est un sous-dossier d'un dossier exclu : on ne le propose pas séparément
					return;
				} else {
					items.push({
						type: 'folder',
						path: normFolder,
						title: `📁 Dossier : ${f.name}`,
						desc: f.path
					});
				}
			}
		});

		// 3b. S'assurer que les dossiers déclarés dans les paramètres d'exclusion sont présents dans les options même s'ils n'ont pas été chargés via getAllLoadedFiles
		if (this.settings?.excludedFolders) {
			const excludedFromSettings = VaultFilterService.parseList(this.settings.excludedFolders);
			excludedFromSettings.forEach(folderPath => {
				const norm = normalizePath(folderPath);
				const normLower = norm.toLowerCase();
				if (!seenFolders.has(normLower)) {
					seenFolders.add(normLower);
					const folderName = norm.split('/').pop() || norm;
					items.push({
						type: 'folder',
						path: norm,
						title: `📂 [Exclu] Dossier : ${folderName}`,
						desc: `⚠️ ${norm} • Configuré comme exclu — cliquer pour l'inclure temporairement dans ce chat`
					});
				}
			});
		}

		// 4. Tags du coffre
		try {
			const tagCounts = (this.app.metadataCache as any)?.getTags?.() || {};
			Object.entries(tagCounts).forEach(([rawTag, count]) => {
				const cleanTag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
				items.push({
					type: 'tag',
					path: cleanTag.replace(/^#/, ''),
					title: `🏷️ Tag : ${cleanTag}`,
					desc: `${count} occurrence(s) dans le coffre`
				});
			});
		} catch {
			// Ignore si getTags n'est pas disponible
		}

		return items;
	}

	getItemText(item: ContextItem): string {
		return `${item.title} ${item.path}`;
	}

	renderSuggestion(item: { item: ContextItem }, el: HTMLElement): void {
		const isExcluded = item.item.title.includes('[Exclu]');
		el.createDiv({
			text: item.item.title,
			cls: isExcluded ? 'sbm-context-modal-title sbm-context-modal-excluded-title' : 'sbm-context-modal-title'
		});
		el.createDiv({
			text: item.item.desc,
			cls: isExcluded ? 'sbm-context-modal-desc sbm-context-modal-excluded-desc' : 'sbm-context-modal-desc'
		});
	}

	onChooseItem(item: ContextItem): void {
		this.onChoose(item);
	}
}
