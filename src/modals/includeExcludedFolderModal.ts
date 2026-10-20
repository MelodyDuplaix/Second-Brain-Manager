import { App, FuzzySuggestModal, normalizePath, TFolder } from 'obsidian';
import { SecondBrainSettings } from '../main';
import { VaultFilterService } from '../services/vaultFilterService';

export class IncludeExcludedFolderModal extends FuzzySuggestModal<string> {
	private settings: SecondBrainSettings;
	private currentlyIncludedSet: Set<string>;
	private currentlyIncludedList: string[];
	private onChooseFolder: (folder: string) => void;

	constructor(
		app: App,
		settings: SecondBrainSettings,
		currentlyIncluded: string[],
		onChoose: (folder: string) => void
	) {
		super(app);
		this.settings = settings;
		this.currentlyIncludedList = currentlyIncluded || [];
		this.currentlyIncludedSet = new Set((currentlyIncluded || []).map(f => normalizePath(f).toLowerCase()));
		this.onChooseFolder = onChoose;
		this.setPlaceholder('Sélectionner un dossier exclu à inclure temporairement...');
	}

	getItems(): string[] {
		const folders = new Set<string>();

		// 1. Uniquement les dossiers explicitement déclarés dans les paramètres d'exclusion
		const configured = VaultFilterService.parseList(this.settings.excludedFolders);
		let allLoadedFolders: TFolder[] | null = null;

		for (const raw of configured) {
			const norm = normalizePath(raw);
			if (!norm) continue;

			// Résoudre la casse exacte si le dossier existe dans le coffre
			const vaultFile = this.app.vault.getAbstractFileByPath(norm);
			if (vaultFile instanceof TFolder) {
				folders.add(vaultFile.path);
			} else {
				if (!allLoadedFolders) {
					try {
						allLoadedFolders = this.app.vault.getAllLoadedFiles().filter(
							(file): file is TFolder => file instanceof TFolder && file.path !== '/'
						);
					} catch {
						allLoadedFolders = [];
					}
				}
				const match = allLoadedFolders.find(
					f => f.path.toLowerCase() === norm.toLowerCase()
				);
				if (match) {
					folders.add(match.path);
				} else {
					folders.add(norm);
				}
			}
		}

		// 2. Maintenir également les dossiers déjà inclus temporairement dans la liste
		for (const inc of this.currentlyIncludedList) {
			if (inc) {
				folders.add(normalizePath(inc));
			}
		}

		return Array.from(folders).sort((a, b) => a.localeCompare(b));
	}

	getItemText(item: string): string {
		return item;
	}

	renderSuggestion(item: { item: string }, el: HTMLElement): void {
		const norm = normalizePath(item.item).toLowerCase();
		const isIncluded = this.currentlyIncludedSet.has(norm);
		const folderName = item.item.split('/').pop() || item.item;

		const titleRow = el.createDiv({ cls: 'sbm-include-modal-title-row' });
		titleRow.createSpan({
			text: `📁 ${folderName}`,
			cls: 'sbm-include-modal-folder-name'
		});

		if (isIncluded) {
			titleRow.createSpan({
				text: '✅ Inclus temporairement',
				cls: 'sbm-badge-included-status'
			});
		} else {
			titleRow.createSpan({
				text: '⚠️ Exclu',
				cls: 'sbm-badge-excluded-status'
			});
		}

		el.createDiv({
			text: `${item.item} • ${isIncluded ? 'Cliquer pour retirer du chat' : 'Cliquer pour autoriser la recherche dans ce chat'}`,
			cls: 'sbm-include-modal-desc'
		});
	}

	onChooseItem(item: string): void {
		this.onChooseFolder(item);
	}
}
