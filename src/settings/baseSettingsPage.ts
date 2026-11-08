import { Setting, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';
import { SettingsPageType, getPageName, getPageIcon } from './settingsPageManager';

export abstract class BaseSettingsPage {
	protected containerEl: HTMLElement;
	protected plugin: SecondBrainPlugin;
	protected pageType: SettingsPageType;
	protected display: () => void;
	protected openPage: (pageType: SettingsPageType) => void;
	/** Page affichée comme sous-page native d'Obsidian : pas d'en-tête « retour » maison */
	public embedded = false;
	/** Affichage déclaratif (Obsidian ≥ 1.13) : rafraîchissement délégué à l'onglet */
	public declarativeRefresh: (() => void) | null = null;

	constructor(
		containerEl: HTMLElement,
		plugin: SecondBrainPlugin,
		pageType: SettingsPageType,
		display: () => void,
		openPage: (pageType: SettingsPageType) => void
	) {
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.pageType = pageType;
		this.display = display;
		this.openPage = openPage;
	}

	getPageType(): SettingsPageType {
		return this.pageType;
	}

	show(): void {
		this.containerEl.show();
	}

	hide(): void {
		this.containerEl.hide();
	}

	scrollTo(pos: number): void {
		this.containerEl.scrollTop = pos;
	}

	destroy(): void {
		this.containerEl.empty();
	}

	abstract render(): void;

	/**
	 * Reconstruit la page sans perdre la position de défilement.
	 * Le rendu vide puis recrée le contenu : sans précaution, la hauteur retombe à zéro
	 * et Obsidian remonte tout en haut des réglages.
	 */
	protected rerender(): void {
		if (this.declarativeRefresh) {
			this.declarativeRefresh();
			return;
		}
		const scroller = this.getScrollContainer();
		const top = scroller ? scroller.scrollTop : 0;
		// Verrouille la hauteur le temps du rendu pour que le navigateur ne ramène pas le défilement à 0
		this.containerEl.style.minHeight = `${this.containerEl.offsetHeight}px`;
		this.render();
		if (scroller) scroller.scrollTop = top;
		window.requestAnimationFrame(() => {
			this.containerEl.style.minHeight = '';
			if (scroller) scroller.scrollTop = top;
		});
	}

	private getScrollContainer(): HTMLElement | null {
		const tab = this.containerEl.closest<HTMLElement>('.vertical-tab-content');
		if (tab) return tab;
		let el: HTMLElement | null = this.containerEl.parentElement;
		while (el) {
			const overflow = getComputedStyle(el).overflowY;
			if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
			el = el.parentElement;
		}
		return null;
	}

	protected renderHeader(): void {
		if (this.pageType === 'main-page' || this.embedded) return;

		const backSetting = new Setting(this.containerEl)
			.setClass('sbm-settings-back-header')
			.addButton((button) => {
				button
					.setIcon('arrow-left')
					.setTooltip('Retour au menu principal')
					.onClick(() => {
						this.openPage('main-page');
					});
				button.buttonEl.addClass('clickable-icon');
			});

		const titleIcon = activeDocument.createElement('span');
		titleIcon.addClass('sbm-settings-page-title-icon');
		setIcon(titleIcon, getPageIcon(this.pageType));

		backSetting.nameEl.empty();
		backSetting.nameEl.appendChild(titleIcon);
		const titleText = activeDocument.createElement('span');
		titleText.setText(getPageName(this.pageType));
		backSetting.nameEl.appendChild(titleText);
		backSetting.nameEl.addClass('sbm-settings-page-title');

		backSetting.settingEl.setAttribute('tabindex', '0');
		backSetting.settingEl.setAttribute('role', 'button');
		backSetting.settingEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.openPage('main-page');
			}
		});

		this.containerEl.createDiv({ cls: 'sbm-subpage-divider' });
	}
}
