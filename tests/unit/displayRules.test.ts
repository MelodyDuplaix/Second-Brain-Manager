import { describe, it, expect } from 'vitest';
import {
	ColorRule,
	PriorityRule,
	RuleSubject,
	describeConditions,
	extractTags,
	matchesRule,
	prioritize,
	ruleColor,
	rulePriority
} from '../../src/services/displayRules';

const TODAY = '2026-11-16';

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
	kind: 'task',
	text: '',
	tags: [],
	date: null,
	...over
});

const color = (id: string, conditions: ColorRule['conditions'], c = '#e11d48', extra: Partial<ColorRule> = {}): ColorRule => ({
	id, name: id, enabled: true, match: 'all', conditions, color: c, ...extra
});

const prio = (id: string, conditions: PriorityRule['conditions'], priority: PriorityRule['priority'], extra: Partial<PriorityRule> = {}): PriorityRule => ({
	id, name: id, enabled: true, match: 'all', conditions, priority, ...extra
});

describe('Conditions', () => {
	it('texte : contient, sans tenir compte de la casse ni des accents', () => {
		const r = color('melody', [{ field: 'text', value: '@Melody' }]);
		expect(matchesRule(r, subject({ text: 'Appeler @melody demain' }), TODAY)).toBe(true);
		expect(matchesRule(r, subject({ text: 'Appeler Antoine' }), TODAY)).toBe(false);
		const accent = color('reveil', [{ field: 'text', value: 'reveil' }]);
		expect(matchesRule(accent, subject({ text: '07:00 Réveil' }), TODAY)).toBe(true);
	});

	it('tag : avec ou sans « # », et un tag parent couvre ses sous-tags', () => {
		const r = color('projet', [{ field: 'tag', value: 'projet' }]);
		expect(matchesRule(r, subject({ tags: ['#projet'] }), TODAY)).toBe(true);
		expect(matchesRule(r, subject({ tags: ['#projet/client'] }), TODAY)).toBe(true);
		expect(matchesRule(r, subject({ tags: ['#projets'] }), TODAY)).toBe(false);
	});

	it('type de bloc', () => {
		const r = color('entrees', [{ field: 'kind', value: 'entry' }]);
		expect(matchesRule(r, subject({ kind: 'entry' }), TODAY)).toBe(true);
		expect(matchesRule(r, subject({ kind: 'event' }), TODAY)).toBe(false);
	});

	it('date relative à aujourd’hui', () => {
		const at = (value: string, date: string | null) => matchesRule(color('d', [{ field: 'date', value }]), subject({ date }), TODAY);
		expect(at('none', null)).toBe(true);
		expect(at('none', TODAY)).toBe(false);
		expect(at('past', '2026-11-15')).toBe(true);
		expect(at('today', TODAY)).toBe(true);
		expect(at('tomorrow', '2026-11-17')).toBe(true);
		expect(at('next7', '2026-11-23')).toBe(true);
		expect(at('next7', '2026-11-24')).toBe(false);
		expect(at('next7', TODAY)).toBe(false);
		expect(at('future', '2027-01-01')).toBe(true);
	});

	it('statut, note et agenda', () => {
		expect(matchesRule(color('s', [{ field: 'status', value: 'done' }]), subject({ done: true }), TODAY)).toBe(true);
		expect(matchesRule(color('s', [{ field: 'status', value: 'open' }]), subject({ done: true }), TODAY)).toBe(false);
		expect(matchesRule(color('p', [{ field: 'path', value: 'Projets/Acme' }]), subject({ path: 'Projets/Acme/Suivi.md' }), TODAY)).toBe(true);
		expect(matchesRule(color('c', [{ field: 'calendar', value: 'travail' }]), subject({ kind: 'event', calendar: 'Agenda Travail' }), TODAY)).toBe(true);
	});

	it('condition inversée', () => {
		const r = color('pas-reveil', [{ field: 'text', value: 'réveil', negate: true }]);
		expect(matchesRule(r, subject({ text: 'Dentiste' }), TODAY)).toBe(true);
		expect(matchesRule(r, subject({ text: 'Réveil' }), TODAY)).toBe(false);
	});

	it('toutes les conditions ou au moins une', () => {
		const conds: ColorRule['conditions'] = [{ field: 'text', value: '@Melody' }, { field: 'kind', value: 'event' }];
		const s = subject({ kind: 'task', text: '@Melody' });
		expect(matchesRule(color('all', conds), s, TODAY)).toBe(false);
		expect(matchesRule(color('any', conds, '#000', { match: 'any' }), s, TODAY)).toBe(true);
	});

	it('une règle désactivée ou sans condition ne correspond jamais', () => {
		const s = subject({ text: '@Melody' });
		expect(matchesRule(color('off', [{ field: 'text', value: '@Melody' }], '#000', { enabled: false }), s, TODAY)).toBe(false);
		expect(matchesRule(color('vide', []), s, TODAY)).toBe(false);
		expect(matchesRule(color('texte-vide', [{ field: 'text', value: '' }]), s, TODAY)).toBe(false);
	});
});

describe('Couleurs', () => {
	it('la première règle qui correspond l’emporte', () => {
		const rules = [
			color('melody', [{ field: 'text', value: '@Melody' }], '#e11d48'),
			color('taches', [{ field: 'kind', value: 'task' }], '#2563eb')
		];
		expect(ruleColor(rules, subject({ text: 'Voir @Melody' }), TODAY)).toBe('#e11d48');
		expect(ruleColor(rules, subject({ text: 'Courses' }), TODAY)).toBe('#2563eb');
		expect(ruleColor(rules, subject({ kind: 'event', text: 'Réunion' }), TODAY)).toBeNull();
		expect(ruleColor(undefined, subject(), TODAY)).toBeNull();
	});
});

describe('Priorités dans les listes', () => {
	const items = ['Courses', '07:00 Réveil', 'Appeler @Antoine', 'Facture', 'Rappeler @Antoine'];
	const subjectOf = (t: string) => subject({ text: t });
	const rules = [
		prio('antoine', [{ field: 'text', value: '@Antoine' }], 'first'),
		prio('reveil', [{ field: 'text', value: 'réveil' }], 'last')
	];

	it('remonte en premier, descend en dernier, et garde l’ordre d’origine sinon', () => {
		expect(prioritize(items, subjectOf, rules, TODAY)).toEqual([
			'Appeler @Antoine', 'Rappeler @Antoine', 'Courses', 'Facture', '07:00 Réveil'
		]);
	});

	it('masque les blocs d’une règle « Masquer »', () => {
		const masque = [prio('reveil', [{ field: 'text', value: 'réveil' }], 'hidden')];
		expect(prioritize(items, subjectOf, masque, TODAY)).not.toContain('07:00 Réveil');
		expect(prioritize(items, subjectOf, masque, TODAY)).toHaveLength(4);
	});

	it('« Plus haut » passe avant les blocs sans règle mais après « En premier »', () => {
		const r = [
			prio('facture', [{ field: 'text', value: 'facture' }], 'higher'),
			...rules
		];
		expect(prioritize(items, subjectOf, r, TODAY).slice(0, 3)).toEqual(['Appeler @Antoine', 'Rappeler @Antoine', 'Facture']);
	});

	it('sans règle active, la liste ressort inchangée', () => {
		expect(prioritize(items, subjectOf, [], TODAY)).toEqual(items);
		expect(prioritize(items, subjectOf, [prio('off', [{ field: 'text', value: 'a' }], 'first', { enabled: false })], TODAY)).toEqual(items);
	});

	it('la première règle qui correspond fixe la priorité', () => {
		const r = [
			prio('reveil', [{ field: 'text', value: 'réveil' }], 'hidden'),
			prio('tout', [{ field: 'kind', value: 'task' }], 'first')
		];
		expect(rulePriority(r, subjectOf('Réveil'), TODAY)).toBe('hidden');
		expect(rulePriority(r, subjectOf('Courses'), TODAY)).toBe('first');
	});
});

describe('Outils', () => {
	it('extrait les tags d’un texte', () => {
		expect(extractTags('Point #projet/acme avec #client, fin')).toEqual(['#projet/acme', '#client']);
		expect(extractTags('Pas de tag ici, juste un C#')).toEqual([]);
	});

	it('résume les conditions d’une règle', () => {
		expect(describeConditions(color('m', [{ field: 'text', value: '@Melody' }, { field: 'kind', value: 'event' }])))
			.toBe('contient « @Melody » et événement');
		expect(describeConditions(color('v', []))).toContain('Aucune condition');
	});
});
