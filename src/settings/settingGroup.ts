import { Setting, setIcon } from 'obsidian';
import type { SettingDefinitionItem, SettingGroupItem, SettingPage } from 'obsidian';

/** Fabrique d'une sous-page native (Obsidian ≥ 1.13), fournie par l'onglet de réglages. */
export type SubPageFactory = (pageType: string, title: string) => SettingPage;

export interface PageLinkOptions {
	pageType: string;
	name: string;
	desc: string;
	icon: string;
	/** Navigation interne utilisée par l'affichage classique (Obsidian < 1.13) */
	open: () => void;
}

interface CollectedGroup {
	heading: string;
	items: SettingGroupItem[];
	afterRender: Array<() => void>;
	afterRenderDone: boolean;
}

/** Section de réglages : sous-page native (Obsidian ≥ 1.13) ou bloc repliable (affichage classique). */
export interface SectionOptions {
	id: string;
	name: string;
	desc: string;
	icon: string;
	/** Valeur courante affichée sur l'entrée de la sous-page (Obsidian ≥ 1.13.1) */
	displayValue?: () => string;
	status?: () => 'warning' | null;
}

type CollectedEntry =
	| { kind: 'group'; group: CollectedGroup }
	| { kind: 'page'; opts: SectionOptions; entries: CollectedEntry[] };

/**
 * Groupe de réglages à double mode :
 * - affichage classique : dessine directement les réglages dans le conteneur ;
 * - collecte (Obsidian ≥ 1.13) : enregistre chaque réglage comme définition déclarative
 *   (nom et description indexés par la recherche des réglages d'Obsidian), son rendu restant
 *   le même code impératif, exécuté par Obsidian au moment de l'affichage.
 */
export class SettingGroup {
	/** Pile des sections en cours de collecte (la dernière reçoit les nouveaux groupes) */
	private static collector: CollectedEntry[][] | null = null;
	/** Sections ouvertes dans l'affichage classique (gardées d'un rendu à l'autre) */
	private static openSections = new Set<string>();
	private static probing = false;
	private static pageFactory: SubPageFactory | null = null;

	private containerEl: HTMLElement;
	private groupEl: HTMLElement;
	private collected: CollectedGroup | null = null;

	/**
	 * Exécute `build` en mode collecte et renvoie les définitions déclaratives produites.
	 * Utilisé par `getSettingDefinitions()` de l'onglet de réglages.
	 */
	public static collect(build: () => void, pageFactory: SubPageFactory): SettingDefinitionItem[] {
		const root: CollectedEntry[] = [];
		SettingGroup.collector = [root];
		SettingGroup.pageFactory = pageFactory;
		try {
			build();
		} finally {
			SettingGroup.collector = null;
			SettingGroup.pageFactory = null;
		}
		return SettingGroup.toDefinitions(root);
	}

	/**
	 * Regroupe des groupes de réglages dans une section. En collecte, la section devient une
	 * sous-page native (navigation, retour, recherche) ; sinon, un bloc repliable.
	 * `build` reçoit le conteneur dans lequel créer les groupes de la section.
	 */
	public static section(containerEl: HTMLElement, opts: SectionOptions, build: (contentEl: HTMLElement) => void): void {
		const stack = SettingGroup.collector;
		if (stack) {
			const entries: CollectedEntry[] = [];
			stack[stack.length - 1].push({ kind: 'page', opts, entries });
			stack.push(entries);
			try {
				build(containerEl);
			} finally {
				stack.pop();
			}
			return;
		}

		const sectionEl = containerEl.createDiv({ cls: 'sbm-settings-section' });
		const headerEl = sectionEl.createDiv({ cls: 'sbm-settings-section-header' });
		headerEl.setAttribute('role', 'button');
		headerEl.setAttribute('tabindex', '0');
		const iconEl = headerEl.createDiv({ cls: 'sbm-settings-section-icon' });
		setIcon(iconEl, opts.icon);
		const textEl = headerEl.createDiv({ cls: 'sbm-settings-section-text' });
		textEl.createDiv({ cls: 'sbm-settings-section-name', text: opts.name });
		textEl.createDiv({ cls: 'sbm-settings-section-desc', text: opts.desc });
		const value = opts.displayValue?.();
		if (value) headerEl.createDiv({ cls: 'sbm-settings-section-value', text: value });
		const chevronEl = headerEl.createDiv({ cls: 'sbm-settings-section-chevron' });
		setIcon(chevronEl, 'chevron-right');
		const contentEl = sectionEl.createDiv({ cls: 'sbm-settings-section-content' });

		let built = false;
		const apply = (open: boolean) => {
			sectionEl.toggleClass('is-open', open);
			headerEl.setAttribute('aria-expanded', String(open));
			if (open && !built) {
				built = true;
				build(contentEl);
			}
		};
		const toggle = () => {
			const open = !sectionEl.hasClass('is-open');
			if (open) SettingGroup.openSections.add(opts.id);
			else SettingGroup.openSections.delete(opts.id);
			apply(open);
		};
		headerEl.addEventListener('click', toggle);
		headerEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggle();
			}
		});
		apply(SettingGroup.openSections.has(opts.id));
	}

	/** Convertit les entrées collectées en définitions déclaratives (pages imbriquées comprises). */
	private static toDefinitions(entries: CollectedEntry[]): SettingDefinitionItem[] {
		const out: SettingDefinitionItem[] = [];
		let pageRun: SettingGroupItem[] | null = null;
		for (const entry of entries) {
			if (entry.kind === 'page') {
				const { opts } = entry;
				const page = {
					type: 'page' as const,
					id: opts.id,
					name: opts.name,
					desc: opts.desc,
					displayValue: opts.displayValue,
					status: opts.status,
					items: SettingGroup.toDefinitions(entry.entries)
				};
				// Les entrées de sous-pages consécutives forment un même bloc
				if (!pageRun) {
					pageRun = [];
					out.push({ type: 'group', cls: 'sbm-native-group sbm-native-sections', items: pageRun });
				}
				pageRun.push(page as SettingGroupItem);
				continue;
			}
			pageRun = null;
			const g = entry.group;
			if (g.items.length === 0) continue;
			out.push({ type: 'group', heading: g.heading || undefined, cls: 'sbm-native-group', items: g.items });
		}
		return out;
	}

	/** Vrai pendant l'extraction du nom et de la description d'un réglage (rendu factice). */
	public static isProbing(): boolean {
		return SettingGroup.probing;
	}

	constructor(containerEl: HTMLElement, customClass?: string) {
		this.containerEl = containerEl;
		if (SettingGroup.collector) {
			this.collected = { heading: '', items: [], afterRender: [], afterRenderDone: false };
			const stack = SettingGroup.collector;
			stack[stack.length - 1].push({ kind: 'group', group: this.collected });
			this.groupEl = createDiv();
		} else {
			this.groupEl = this.containerEl.createDiv({ cls: `sbm-setting-group ${customClass || ''}`.trim() });
		}
	}

	setHeading(headingText: string, iconName?: string, description?: string): this {
		if (this.collected) {
			this.collected.heading = headingText;
			if (description) {
				// Description du groupe : ligne d'information, exclue de la recherche
				this.collected.items.push({
					name: '',
					desc: description,
					searchable: false,
					render: (setting: Setting) => {
						setting.settingEl.addClass('sbm-group-intro');
						setting.setDesc(description);
						if (iconName) {
							const iconEl = activeDocument.createElement('span');
							iconEl.addClass('sbm-group-intro-icon');
							setIcon(iconEl, iconName);
							setting.descEl.prepend(iconEl);
						}
						this.runAfterRender();
					}
				});
			}
			return this;
		}

		const setting = new Setting(this.groupEl).setName(headingText).setHeading();
		if (description) {
			setting.setDesc(description);
		}
		if (iconName) {
			const iconEl = activeDocument.createElement('span');
			iconEl.addClass('sbm-group-heading-icon');
			setIcon(iconEl, iconName);
			setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
		}
		return this;
	}

	addSetting(cb: (setting: Setting) => void): this {
		if (this.collected) {
			const { name, desc, aliases } = SettingGroup.probe(cb);
			this.collected.items.push({
				name,
				desc,
				aliases,
				render: (setting: Setting) => {
					try {
						cb(setting);
					} catch (e) {
						console.error('[Second Brain Manager] Erreur d’affichage du réglage', name, e);
					}
					this.runAfterRender();
				}
			});
			return this;
		}

		const setting = new Setting(this.groupEl);
		cb(setting);
		return this;
	}

	/**
	 * Lien vers une sous-page : page native d'Obsidian (navigation, retour, recherche du nom),
	 * ou ligne cliquable dans l'affichage classique.
	 */
	addPageLink(opts: PageLinkOptions): this {
		if (this.collected) {
			const factory = SettingGroup.pageFactory;
			if (factory) {
				this.collected.items.push({
					type: 'page',
					name: opts.name,
					desc: opts.desc,
					page: () => factory(opts.pageType, opts.name)
				});
			}
			return this;
		}

		const setting = new Setting(this.groupEl)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addButton((button) => {
				button.setIcon('chevron-right').onClick(opts.open);
				button.buttonEl.addClass('clickable-icon');
			});
		const iconEl = activeDocument.createElement('div');
		iconEl.addClass('sbm-settings-page-title-icon');
		setIcon(iconEl, opts.icon);
		setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
		setting.nameEl.addClass('sbm-settings-page-title');
		setting.settingEl.addClass('sbm-settings-page-title-setting');
		setting.settingEl.setAttribute('tabindex', '0');
		setting.settingEl.setAttribute('role', 'button');
		setting.settingEl.addEventListener('click', opts.open);
		setting.settingEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				opts.open();
			}
		});
		return this;
	}

	/**
	 * Action à lancer une fois le groupe réellement affiché (jamais pendant l'indexation de la
	 * recherche) : chargements réseau, lectures… En affichage classique, elle s'exécute aussitôt.
	 */
	afterRender(fn: () => void): this {
		if (this.collected) {
			this.collected.afterRender.push(fn);
		} else {
			fn();
		}
		return this;
	}

	getGroupEl(): HTMLElement {
		return this.groupEl;
	}

	private runAfterRender(): void {
		const group = this.collected;
		if (!group || group.afterRenderDone || group.afterRender.length === 0) return;
		group.afterRenderDone = true;
		window.setTimeout(() => group.afterRender.forEach(fn => fn()), 0);
	}

	/** Exécute le rendu sur un réglage détaché pour en lire le nom et la description. */
	private static probe(cb: (setting: Setting) => void): { name: string; desc: string; aliases?: string[] } {
		const setting = new Setting(createDiv());
		SettingGroup.probing = true;
		try {
			cb(setting);
		} catch {
			// Un rendu qui échoue hors contexte n'empêche pas l'indexation
		} finally {
			SettingGroup.probing = false;
		}
		const name = (setting.nameEl.textContent || '').replace(/\s+/g, ' ').trim();
		const desc = (setting.descEl.textContent || '').replace(/\s+/g, ' ').trim();
		const placeholders = Array.from(setting.controlEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]'))
			.map(el => el.placeholder)
			.filter(Boolean);
		return { name, desc, aliases: placeholders.length ? placeholders : undefined };
	}
}
