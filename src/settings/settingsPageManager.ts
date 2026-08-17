import SecondBrainPlugin from '../main';
import { BaseSettingsPage } from './baseSettingsPage';
import { MainPage } from './pages/mainPage';
import { RewardsPage } from './pages/rewardsPage';

export type SettingsPageType = 'main-page' | 'rewards-page';

export const SettingsPageTypesArray: ReadonlyArray<SettingsPageType> = [
	'main-page',
	'rewards-page'
];

export function getPageName(pageType: SettingsPageType): string {
	switch (pageType) {
		case 'main-page':
			return 'Paramètres généraux';
		case 'rewards-page':
			return 'Récompenses de boutique';
	}
}

export function getPageIcon(pageType: SettingsPageType): string {
	switch (pageType) {
		case 'main-page':
			return 'settings';
		case 'rewards-page':
			return 'gift';
	}
}

export class SettingsPageManager {
	private containerEl: HTMLElement;
	private plugin: SecondBrainPlugin;
	private pages: BaseSettingsPage[] = [];
	private currentPage: SettingsPageType = 'main-page';
	private display: () => void;

	constructor(
		containerEl: HTMLElement,
		plugin: SecondBrainPlugin,
		lastPage: SettingsPageType,
		display: () => void
	) {
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.display = display;
		this.currentPage = lastPage;

		this.createPages();
		this.showPage(this.currentPage);
	}

	destroy(): void {
		this.pages.forEach((page) => page.destroy && page.destroy());
		this.containerEl.empty();
	}

	render(): void {
		this.pages.forEach((page) => page.render());
	}

	private createPages(): void {
		this.containerEl.empty();

		for (const pageType of SettingsPageTypesArray) {
			const pageContainerEl = this.containerEl.createDiv({ cls: 'sbm-page-container' });
			let page: BaseSettingsPage;

			switch (pageType) {
				case 'main-page':
					page = new MainPage(
						pageContainerEl,
						this.plugin,
						pageType,
						this.display,
						this.openPage.bind(this)
					);
					break;
				case 'rewards-page':
					page = new RewardsPage(
						pageContainerEl,
						this.plugin,
						pageType,
						this.display,
						this.openPage.bind(this)
					);
					break;
			}

			page.render();
			page.hide();
			this.pages.push(page);
		}
	}

	public openPage(pageType: SettingsPageType): void {
		const currentIdx = this.pages.findIndex((p) => p.getPageType() === this.currentPage);
		if (currentIdx !== -1) {
			this.pages[currentIdx].hide();
		}

		this.currentPage = pageType;
		const nextIdx = this.pages.findIndex((p) => p.getPageType() === this.currentPage);
		if (nextIdx !== -1) {
			this.pages[nextIdx].show();
			this.pages[nextIdx].scrollTo(0);
		}
	}

	private showPage(pageType: SettingsPageType): void {
		this.pages.forEach((p) => {
			if (p.getPageType() === pageType) {
				p.show();
			} else {
				p.hide();
			}
		});
	}
}
