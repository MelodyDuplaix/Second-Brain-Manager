/* ==========================================================================
   Personnes dans les tâches (fonctionnalité optionnelle)
   Une tâche porte un jeton suivi d'un nom : « Relire le devis @Antoine ».
   Le jeton est réglable (@, de:, 👤, #de/…) et son sens aussi :
   - assignee : la tâche est POUR cette personne (elle sort de mes tâches, sauf si elle me mentionne) ;
   - from     : la tâche m'a été DONNÉE par cette personne ;
   - context  : la personne est simplement LIÉE à la tâche.
   ========================================================================== */

export type DelegationMode = 'assignee' | 'from' | 'context';

export interface DelegationSettings {
	/** Jeton placé devant le nom de la personne */
	delegatedTaskToken: string;
	/** Sens de la mention */
	delegationMode: DelegationMode;
	/** Mes noms (séparés par des virgules) : une tâche qui me mentionne reste à moi */
	delegationMyNames: string;
}

export const DEFAULT_DELEGATION_TOKEN = '@';

export const DEFAULT_DELEGATION_SETTINGS: DelegationSettings = {
	delegatedTaskToken: DEFAULT_DELEGATION_TOKEN,
	delegationMode: 'assignee',
	delegationMyNames: ''
};

export const DELEGATION_MODES: DelegationMode[] = ['assignee', 'from', 'context'];

/** Libellés de l'interface selon le sens de la mention. */
export interface DelegationLabels {
	/** Titre de la section de filtre */
	section: string;
	/** Puce « tâches mentionnant quelqu'un » */
	othersChip: string;
	/** Préfixe du badge sur une tâche */
	badge: string;
	/** Phrase d'aperçu : « Pour Antoine » */
	describe: (name: string) => string;
	/** Entrée de menu */
	menu: string;
	/** Nom du mode dans les réglages */
	modeName: string;
	modeDesc: string;
}

export const DELEGATION_LABELS: Record<DelegationMode, DelegationLabels> = {
	assignee: {
		section: 'Attribuées',
		othersChip: 'Pour les autres',
		badge: '→ ',
		describe: (n) => `Pour ${n}`,
		menu: 'Attribuer à…',
		modeName: 'Tâche attribuée à la personne',
		modeDesc: '« @Antoine » : la tâche est pour Antoine et sort de vos tâches (briefings, tableau de bord, pièces). Une tâche qui vous mentionne reste la vôtre.'
	},
	from: {
		section: 'Données par',
		othersChip: 'Données par d’autres',
		badge: '👤 ',
		describe: (n) => `Donnée par ${n}`,
		menu: 'Donnée par…',
		modeName: 'Tâche donnée par la personne',
		modeDesc: '« @Antoine » : Antoine vous a confié cette tâche. Elle reste dans vos tâches et les briefings la traitent comme un engagement envers lui.'
	},
	context: {
		section: 'Personnes',
		othersChip: 'Avec une personne',
		badge: '👤 ',
		describe: (n) => `Liée à ${n}`,
		menu: 'Personnes liées…',
		modeName: 'Personne liée (contexte)',
		modeDesc: '« @Antoine » : Antoine est concerné par la tâche (à appeler, à prévenir…). Simple contexte : la tâche reste la vôtre.'
	}
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Caractères d'un nom simple : lettres (accents compris), chiffres, tiret, point, apostrophe, souligné. */
const NAME_CHARS = "[\\p{L}\\p{N}_'’.-]";

/**
 * Lecture et écriture du jeton « donnée par ». Configuré une fois par le plugin,
 * comme les quadrants : le parseur n'a pas accès aux réglages complets.
 */
export class DelegationFeature {
	private static enabled = false;
	private static token = DEFAULT_DELEGATION_TOKEN;
	private static mode: DelegationMode = 'assignee';
	private static myKeys: string[] = [];
	private static cachedRegex: RegExp | null = null;

	public static configure(enabled: boolean, token?: string, mode: DelegationMode = 'assignee', myNames = ''): void {
		const clean = DelegationFeature.normalizeToken(token);
		if (enabled !== this.enabled || clean !== this.token) this.cachedRegex = null;
		this.enabled = enabled;
		this.token = clean;
		this.mode = DELEGATION_MODES.includes(mode) ? mode : 'assignee';
		this.myKeys = this.parseNames(myNames).map(n => this.personKey(n));
	}

	/** Empreinte de la configuration (les tâches sont relues quand elle change). */
	public static signature(): string {
		return [this.enabled, this.token, this.mode, this.myKeys.join(',')].join('|');
	}

	public static isEnabled(): boolean {
		return this.enabled;
	}

	public static getMode(): DelegationMode {
		return this.mode;
	}

	public static labels(): DelegationLabels {
		return DELEGATION_LABELS[this.mode];
	}

	/** Les tâches attribuées à d'autres sortent-elles de mes tâches ? */
	public static hidesOthers(): boolean {
		return this.enabled && this.mode === 'assignee';
	}

	/** Liste de noms saisie à la main (virgules, points-virgules ou retours à la ligne ; @ initial ignoré). */
	public static parseNames(raw: string): string[] {
		return (raw || '').split(/[,;\n]+/).map(n => this.cleanName(n.replace(/^[@\s]+/, ''))).filter(Boolean);
	}

	/** Ce nom me désigne-t-il ? (un de mes noms, ou son prénom) */
	public static isMe(name: string): boolean {
		const key = this.personKey(name);
		if (!key) return false;
		return this.myKeys.some(k => k === key || k.split(' ')[0] === key);
	}

	/**
	 * Lecture d'une tâche selon le sens de la mention :
	 * `people` = toutes les personnes citées, `person` = celle à afficher,
	 * `forOthers` = la tâche n'est pas à moi (mode « attribuée » seulement).
	 */
	public static analyze(text: string): { people: string[]; person?: string; forOthers: boolean } {
		const people = this.extractAll(text);
		if (!people.length) return { people, forOthers: false };
		if (this.mode === 'assignee') {
			const others = people.filter(p => !this.isMe(p));
			const mentionsMe = others.length < people.length;
			return { people, person: others[0], forOthers: others.length > 0 && !mentionsMe };
		}
		return { people, person: people[0], forOthers: false };
	}

	public static getToken(): string {
		return this.token;
	}

	/** Jeton nettoyé ; vide ou composé seulement d'espaces : « @ ». */
	public static normalizeToken(token?: string): string {
		const t = (token ?? '').trim();
		return t || DEFAULT_DELEGATION_TOKEN;
	}

	/**
	 * Expression qui trouve le jeton suivi d'un nom :
	 * `@Antoine`, `@[[Antoine Dupont]]`, `@"Antoine Dupont"`, `@Jean_Pierre` (souligné = espace).
	 * Le jeton doit commencer un mot : une adresse e-mail (`moi@site.fr`) n'est pas un nom.
	 * Groupes : 1 = caractère qui précède (conservé), 2 = lien [[…]], 3 = nom entre guillemets, 4 = nom simple.
	 * (Pas de lookbehind : non pris en charge par les anciennes versions d'iOS.)
	 */
	public static buildRegex(token: string = this.token): RegExp {
		const t = escapeRegex(DelegationFeature.normalizeToken(token));
		// Un jeton qui finit par « : » (ex. « de: ») accepte une espace avant le nom
		const gap = /[:：]$/.test(token.trim()) ? '\\s?' : '';
		return new RegExp(
			`(^|[^\\p{L}\\p{N}_])${t}${gap}(?:\\[\\[([^\\]|#]+)(?:[|#][^\\]]*)?\\]\\]|"([^"\\n]+)"|(${NAME_CHARS}*[\\p{L}\\p{N}]))`,
			'gu'
		);
	}

	private static regex(): RegExp {
		if (!this.cachedRegex) this.cachedRegex = this.buildRegex();
		this.cachedRegex.lastIndex = 0;
		return this.cachedRegex;
	}

	/** Nom lisible : soulignés en espaces, espaces superflues retirées. */
	public static cleanName(raw: string): string {
		return raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
	}

	/** Première personne citée, ou undefined. Rien quand la fonctionnalité est coupée. */
	public static extract(text: string, token?: string): string | undefined {
		return this.extractAll(text, token)[0];
	}

	/** Toutes les personnes citées, sans doublon, dans l'ordre. Rien quand la fonctionnalité est coupée. */
	public static extractAll(text: string, token?: string): string[] {
		if (!this.enabled && token === undefined) return [];
		const re = token === undefined ? this.regex() : this.buildRegex(token);
		re.lastIndex = 0;
		const out: string[] = [];
		const keys = new Set<string>();
		for (const m of text.matchAll(re)) {
			const name = this.cleanName(m[2] || m[3] || m[4] || '');
			const key = this.personKey(name);
			if (name && !keys.has(key)) {
				keys.add(key);
				out.push(name);
			}
		}
		return out;
	}

	/** Texte sans le jeton ni le nom (affichage). */
	public static strip(text: string, token?: string): string {
		if (!this.enabled && token === undefined) return text;
		const re = token === undefined ? this.buildRegex() : this.buildRegex(token);
		return text.replace(re, '$1').replace(/\s{2,}/g, ' ').trim();
	}

	/** Écriture du nom tel qu'il sera lu : lien si demandé, guillemets si le nom contient une espace. */
	public static formatMention(name: string, token: string = this.token, asLink = false): string {
		const clean = this.cleanName(name);
		if (asLink) return `${token}[[${clean}]]`;
		return /\s/.test(clean) ? `${token}"${clean}"` : `${token}${clean}`;
	}

	/**
	 * Remplace (ou retire, avec null) la personne d'une ligne de tâche.
	 * La mention est placée à la fin du texte, avant un éventuel identifiant de bloc `^id`.
	 */
	public static setDelegator(line: string, name: string | null, token: string = this.token): string {
		return this.setPeople(line, name ? [name] : [], token);
	}

	/** Remplace toutes les personnes d'une ligne de tâche (liste vide : toutes retirées). */
	public static setPeople(line: string, names: string[], token: string = this.token): string {
		const re = this.buildRegex(token);
		// L'indentation (sous-tâches) est conservée telle quelle
		const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
		let next = indent + line.slice(indent.length).replace(re, '$1').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '');
		const clean = names.map(n => this.cleanName(n)).filter(Boolean);
		if (!clean.length) return next;
		const mention = clean.map(n => this.formatMention(n, token)).join(' ');
		const blockId = /\s(\^[A-Za-z0-9_-]+)$/.exec(next);
		if (blockId) {
			next = `${next.slice(0, blockId.index)} ${mention} ${blockId[1]}`;
		} else {
			next = `${next} ${mention}`;
		}
		return next;
	}

	/** Clé de regroupement d'une personne (insensible à la casse et aux accents). */
	public static personKey(name: string): string {
		return this.cleanName(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	}

	/**
	 * Fait correspondre un nom écrit à une note de contact du coffre :
	 * nom identique d'abord, sinon prénom unique (« Antoine » → « Antoine Dupont »).
	 */
	public static resolvePerson(name: string, contacts: string[]): string {
		const key = this.personKey(name);
		if (!key) return name;
		const exact = contacts.find(c => this.personKey(c) === key);
		if (exact) return exact;
		const byFirst = contacts.filter(c => this.personKey(c).split(' ')[0] === key);
		if (byFirst.length === 1) return byFirst[0];
		return this.cleanName(name);
	}

	/**
	 * Regroupe des éléments par personne. L'orthographe retenue est la plus fréquente
	 * (« antoine » et « Antoine » sont la même personne).
	 */
	public static groupByPerson<T>(items: T[], nameOf: (item: T) => string | undefined): Array<{ name: string; items: T[] }> {
		const groups = new Map<string, { spellings: Map<string, number>; items: T[] }>();
		for (const item of items) {
			const raw = nameOf(item);
			if (!raw) continue;
			const key = this.personKey(raw);
			let g = groups.get(key);
			if (!g) {
				g = { spellings: new Map(), items: [] };
				groups.set(key, g);
			}
			g.items.push(item);
			g.spellings.set(raw, (g.spellings.get(raw) || 0) + 1);
		}
		return [...groups.values()]
			.map(g => ({
				name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
				items: g.items
			}))
			.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
	}
}
