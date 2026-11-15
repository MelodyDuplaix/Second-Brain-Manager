/**
 * Règles d'affichage du calendrier, définies dans les réglages.
 *
 * Deux sortes de règles, chacune faite de conditions (texte, tag, type, date…) :
 *   - **couleur** : un bloc qui remplit les conditions prend la couleur de la règle
 *     (ex. rouge pour tout ce qui mentionne « @Melody ») ;
 *   - **priorité** : dans les listes (journée, sans date, en retard, mois, agenda), un bloc qui
 *     remplit les conditions remonte, descend ou disparaît (ex. « @Antoine » en premier,
 *     « réveil » en dernier ou masqué).
 *
 * Les règles sont lues dans l'ordre : la première règle active qui correspond l'emporte.
 * Logique isolée de l'interface pour être vérifiable par des tests.
 */

/** Sorte de bloc. */
export type RuleItemKind = 'task' | 'event' | 'entry';

/** Ce qu'une règle sait d'un bloc. */
export interface RuleSubject {
	kind: RuleItemKind;
	/** Texte cherché par les conditions « contient » (titre, ligne brute, description…) */
	text: string;
	/** Tags du bloc, avec ou sans « # » */
	tags: string[];
	/** Date du bloc (AAAA-MM-JJ), ou null sans date */
	date: string | null;
	/** Chemin de la note (tâches et entrées) */
	path?: string;
	/** Nom ou identifiant de l'agenda (événements) */
	calendar?: string;
	/** Bloc terminé ou annulé */
	done?: boolean;
}

/** Ce sur quoi porte une condition. */
export type ConditionField = 'text' | 'tag' | 'kind' | 'date' | 'path' | 'calendar' | 'status';

/** Valeurs d'une condition sur la date. */
export type DateCondition = 'none' | 'past' | 'today' | 'tomorrow' | 'next7' | 'future';

export interface RuleCondition {
	field: ConditionField;
	/**
	 * Texte, tag, chemin, agenda : valeur cherchée.
	 * Type : `task` | `event` | `entry`. Date : une `DateCondition`. Statut : `open` | `done`.
	 */
	value: string;
	/** Condition inversée : « ne contient pas », « n'est pas »… */
	negate?: boolean;
}

export interface DisplayRuleBase {
	id: string;
	name: string;
	enabled: boolean;
	/** `all` : toutes les conditions ; `any` : au moins une */
	match: 'all' | 'any';
	conditions: RuleCondition[];
}

export interface ColorRule extends DisplayRuleBase {
	/** Couleur CSS (ex. « #e11d48 ») */
	color: string;
}

/** Place d'un bloc dans une liste. */
export type PriorityLevel = 'first' | 'higher' | 'lower' | 'last' | 'hidden';

export interface PriorityRule extends DisplayRuleBase {
	priority: PriorityLevel;
}

export const PRIORITY_LEVELS: Array<{ value: PriorityLevel; label: string }> = [
	{ value: 'first', label: 'En premier' },
	{ value: 'higher', label: 'Plus haut' },
	{ value: 'lower', label: 'Plus bas' },
	{ value: 'last', label: 'En dernier' },
	{ value: 'hidden', label: 'Masquer' }
];

export const CONDITION_FIELDS: Array<{ value: ConditionField; label: string }> = [
	{ value: 'text', label: 'Texte' },
	{ value: 'tag', label: 'Tag' },
	{ value: 'kind', label: 'Type de bloc' },
	{ value: 'date', label: 'Date' },
	{ value: 'status', label: 'Statut' },
	{ value: 'path', label: 'Note / dossier' },
	{ value: 'calendar', label: 'Agenda' }
];

export const KIND_OPTIONS: Array<{ value: RuleItemKind; label: string }> = [
	{ value: 'task', label: 'Tâche' },
	{ value: 'event', label: 'Événement' },
	{ value: 'entry', label: 'Entrée de journal' }
];

export const DATE_OPTIONS: Array<{ value: DateCondition; label: string }> = [
	{ value: 'none', label: 'Sans date' },
	{ value: 'past', label: 'Passée' },
	{ value: 'today', label: 'Aujourd’hui' },
	{ value: 'tomorrow', label: 'Demain' },
	{ value: 'next7', label: 'Dans les 7 jours' },
	{ value: 'future', label: 'À venir' }
];

export const STATUS_OPTIONS: Array<{ value: 'open' | 'done'; label: string }> = [
	{ value: 'open', label: 'À faire' },
	{ value: 'done', label: 'Terminé' }
];

/** Rang d'une priorité : les blocs sont triés du plus grand au plus petit, 0 sans règle. */
const PRIORITY_WEIGHT: Record<Exclude<PriorityLevel, 'hidden'>, number> = {
	first: 2,
	higher: 1,
	lower: -1,
	last: -2
};

/** Comparaison sans casse ni accents. */
export function foldText(value: string): string {
	return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Tags « #mot » ou « #mot/sous-mot » présents dans un texte. */
export function extractTags(text: string): string[] {
	return (text.match(/(?:^|\s)#[^\s#,;:!?()[\]{}]+/g) || []).map(t => t.trim());
}

function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

function normalizeTag(tag: string): string {
	return foldText(tag.trim().replace(/^#/, ''));
}

/** Une condition seule, avant inversion. */
function testCondition(c: RuleCondition, s: RuleSubject, today: string): boolean {
	const value = (c.value || '').trim();
	switch (c.field) {
		case 'text':
			return value !== '' && foldText(s.text).includes(foldText(value));
		case 'tag': {
			const wanted = normalizeTag(value);
			if (!wanted) return false;
			// « #projet » couvre aussi « #projet/client »
			return s.tags.some(t => {
				const tag = normalizeTag(t);
				return tag === wanted || tag.startsWith(`${wanted}/`);
			});
		}
		case 'kind':
			return s.kind === value;
		case 'status':
			return value === 'done' ? Boolean(s.done) : !s.done;
		case 'path':
			return value !== '' && Boolean(s.path) && foldText(s.path as string).includes(foldText(value));
		case 'calendar':
			return value !== '' && Boolean(s.calendar) && foldText(s.calendar as string).includes(foldText(value));
		case 'date': {
			const d = s.date;
			switch (value as DateCondition) {
				case 'none': return !d;
				case 'past': return Boolean(d) && (d as string) < today;
				case 'today': return d === today;
				case 'tomorrow': return d === addDays(today, 1);
				case 'next7': return Boolean(d) && (d as string) > today && (d as string) <= addDays(today, 7);
				case 'future': return Boolean(d) && (d as string) > today;
				default: return false;
			}
		}
		default:
			return false;
	}
}

/**
 * Le bloc remplit-il les conditions de la règle ?
 * Une règle désactivée ou sans condition ne correspond jamais : elle ne doit pas
 * colorer ni déplacer tous les blocs par accident.
 */
export function matchesRule(rule: DisplayRuleBase, subject: RuleSubject, today: string): boolean {
	if (!rule.enabled || !rule.conditions.length) return false;
	const test = (c: RuleCondition) => testCondition(c, subject, today) !== Boolean(c.negate);
	return rule.match === 'any' ? rule.conditions.some(test) : rule.conditions.every(test);
}

/** Couleur de la première règle active qui correspond, ou null. */
export function ruleColor(rules: readonly ColorRule[] | undefined, subject: RuleSubject, today: string): string | null {
	const rule = (rules || []).find(r => r.color && matchesRule(r, subject, today));
	return rule ? rule.color : null;
}

/** Priorité de la première règle active qui correspond, ou null. */
export function rulePriority(rules: readonly PriorityRule[] | undefined, subject: RuleSubject, today: string): PriorityLevel | null {
	const rule = (rules || []).find(r => matchesRule(r, subject, today));
	return rule ? rule.priority : null;
}

/**
 * Réordonne une liste selon les règles de priorité, et retire les blocs masqués.
 *
 * Tri stable : à priorité égale, l'ordre d'origine (heure, échéance…) est conservé, et une
 * liste sans règle applicable ressort inchangée.
 */
export function prioritize<T>(
	items: readonly T[],
	subjectOf: (item: T) => RuleSubject,
	rules: readonly PriorityRule[] | undefined,
	today: string
): T[] {
	if (!rules || !rules.some(r => r.enabled && r.conditions.length)) return [...items];
	return items
		.map((item, index) => ({ item, index, level: rulePriority(rules, subjectOf(item), today) }))
		.filter(x => x.level !== 'hidden')
		.map(x => ({ ...x, weight: x.level ? PRIORITY_WEIGHT[x.level as Exclude<PriorityLevel, 'hidden'>] : 0 }))
		.sort((a, b) => b.weight - a.weight || a.index - b.index)
		.map(x => x.item);
}

/** Identifiant d'une nouvelle règle. */
export function newRuleId(): string {
	return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Résumé lisible des conditions d'une règle, pour la liste des réglages. */
export function describeConditions(rule: DisplayRuleBase): string {
	if (!rule.conditions.length) return 'Aucune condition : la règle ne s’applique pas';
	const label = (list: Array<{ value: string; label: string }>, v: string) => list.find(o => o.value === v)?.label || v;
	const parts = rule.conditions.map(c => {
		const not = c.negate;
		switch (c.field) {
			case 'text': return `${not ? 'ne contient pas' : 'contient'} « ${c.value} »`;
			case 'tag': return `${not ? 'sans le tag' : 'tag'} ${c.value.startsWith('#') ? c.value : `#${c.value}`}`;
			case 'kind': return `${not ? 'pas ' : ''}${label(KIND_OPTIONS, c.value).toLowerCase()}`;
			case 'date': return `date ${not ? 'autre que ' : ''}${label(DATE_OPTIONS, c.value).toLowerCase()}`;
			case 'status': return `${not ? 'pas ' : ''}${label(STATUS_OPTIONS, c.value).toLowerCase()}`;
			case 'path': return `note ${not ? 'hors de' : 'dans'} « ${c.value} »`;
			case 'calendar': return `agenda ${not ? 'autre que' : ''} « ${c.value} »`.replace('  ', ' ');
			default: return '';
		}
	}).filter(Boolean);
	return parts.join(rule.match === 'any' ? ' ou ' : ' et ');
}
