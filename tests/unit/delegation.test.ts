import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DelegationFeature } from '../../src/models/delegation';
import { TaskParser } from '../../src/parsers/taskParser';
import {
	DEFAULT_CALENDAR_FILTER,
	DELEGATION_OTHERS,
	DELEGATION_SELF,
	clearFilterChip,
	delegationPersonKey,
	describeFilter,
	matchesDelegationFilter,
	normalizeFilter,
	sameFilter
} from '../../src/services/calendarFilters';
import { isLongPressWithoutMove } from '../../src/views/taskCalendarView';

describe('Personnes dans les tâches (DelegationFeature)', () => {
	beforeEach(() => DelegationFeature.configure(true, '@'));
	afterEach(() => DelegationFeature.configure(false, '@'));

	it('lit un nom simple, un lien et un nom entre guillemets', () => {
		expect(DelegationFeature.extract('Relire le devis @Antoine')).toBe('Antoine');
		expect(DelegationFeature.extract('Appeler la banque @[[Claire Dupont]]')).toBe('Claire Dupont');
		expect(DelegationFeature.extract('Appeler la banque @[[Claire Dupont|Claire]]')).toBe('Claire Dupont');
		expect(DelegationFeature.extract('Préparer la salle @"Jean Dupont" 📅 2026-11-12')).toBe('Jean Dupont');
		expect(DelegationFeature.extract('Dossier @Jean_Pierre à finir')).toBe('Jean Pierre');
		expect(DelegationFeature.extract('Nom accentué @Léa')).toBe('Léa');
	});

	it('ignore les adresses e-mail et les tâches sans jeton', () => {
		expect(DelegationFeature.extract('Écrire à melo@site.fr')).toBeUndefined();
		expect(DelegationFeature.extract('Rien à signaler')).toBeUndefined();
		expect(DelegationFeature.extract('Un @ seul')).toBeUndefined();
	});

	it('ne lit rien quand la fonctionnalité est coupée', () => {
		DelegationFeature.configure(false, '@');
		expect(DelegationFeature.extract('Relire le devis @Antoine')).toBeUndefined();
		expect(DelegationFeature.strip('Relire le devis @Antoine')).toBe('Relire le devis @Antoine');
	});

	it('accepte un jeton personnalisé, avec ou sans espace après un deux-points', () => {
		expect(DelegationFeature.extract('Relire le devis de:Antoine', 'de:')).toBe('Antoine');
		expect(DelegationFeature.extract('Relire le devis de: Antoine', 'de:')).toBe('Antoine');
		expect(DelegationFeature.extract('Relire le devis 👤Antoine', '👤')).toBe('Antoine');
		expect(DelegationFeature.extract('Relire le devis #de/Antoine', '#de/')).toBe('Antoine');
		DelegationFeature.configure(true, 'de:');
		expect(DelegationFeature.extract('Relire le devis @Antoine')).toBeUndefined();
		expect(DelegationFeature.extract('Relire le devis de:Antoine')).toBe('Antoine');
	});

	it('retire la mention pour l’affichage sans abîmer le reste', () => {
		expect(DelegationFeature.strip('Relire le devis @Antoine 📅 2026-11-12')).toBe('Relire le devis 📅 2026-11-12');
		expect(DelegationFeature.strip('@[[Claire Dupont]] Appeler la banque')).toBe('Appeler la banque');
	});

	it('remplace ou retire la personne sur une ligne, avant l’identifiant de bloc', () => {
		expect(DelegationFeature.setDelegator('- [ ] Relire le devis @Antoine ^abc', 'Claire Dupont'))
			.toBe('- [ ] Relire le devis @"Claire Dupont" ^abc');
		expect(DelegationFeature.setDelegator('- [ ] Relire le devis @Antoine', null)).toBe('- [ ] Relire le devis');
		expect(DelegationFeature.setDelegator('\t- [ ] Sous-tâche', 'Léa')).toBe('\t- [ ] Sous-tâche @Léa');
		expect(DelegationFeature.setDelegator('- [ ] Relire le devis', 'Antoine', 'de:')).toBe('- [ ] Relire le devis de:Antoine');
	});

	it('relie un prénom à la note de contact quand elle est unique', () => {
		const contacts = ['Antoine Dupont', 'Claire Martin', 'Claire Durand'];
		expect(DelegationFeature.resolvePerson('Antoine', contacts)).toBe('Antoine Dupont');
		expect(DelegationFeature.resolvePerson('antoine dupont', contacts)).toBe('Antoine Dupont');
		expect(DelegationFeature.resolvePerson('Claire', contacts)).toBe('Claire');
		expect(DelegationFeature.resolvePerson('Inconnu', contacts)).toBe('Inconnu');
	});

	it('regroupe par personne sans tenir compte de la casse ni des accents, orthographe la plus fréquente en tête', () => {
		const groups = DelegationFeature.groupByPerson(
			[{ by: 'Léa' }, { by: 'lea' }, { by: 'Léa' }, { by: 'Antoine' }],
			i => i.by
		);
		expect(groups.map(g => [g.name, g.items.length])).toEqual([['Léa', 3], ['Antoine', 1]]);
	});

	it('attribue la tâche à la personne mentionnée par défaut', () => {
		const line = '- [ ] Relire le devis @Antoine 📅 2026-11-12 #projet';
		const on = TaskParser.parseLine(line, 'Projets/Acme.md', 1);
		expect(on?.person).toBe('Antoine');
		expect(on?.forOthers).toBe(true);
		expect(on?.domainTags).toEqual(['#projet']);
		expect(on?.dueDate).toBe('2026-11-12');

		DelegationFeature.configure(false, '@');
		const off = TaskParser.parseLine(line, 'Projets/Acme.md', 1);
		expect(off?.person).toBeUndefined();
	});

	it('garde les tâches dans mes tâches lorsque la mention indique un donneur ou un contexte', () => {
		const line = '- [ ] Appeler la banque @Antoine';
		DelegationFeature.configure(true, '@', 'from');
		const fromTask = TaskParser.parseLine(line, 'Projets/Acme.md', 1);
		expect(fromTask?.person).toBe('Antoine');
		expect(fromTask?.forOthers).toBeUndefined();
		expect(DelegationFeature.hidesOthers()).toBe(false);
		expect(matchesDelegationFilter(
			{ ...DEFAULT_CALENDAR_FILTER, delegation: [DELEGATION_SELF] },
			fromTask!,
			DelegationFeature.hidesOthers()
		)).toBe(true);

		DelegationFeature.configure(true, '@', 'context');
		const contextTask = TaskParser.parseLine(line, 'Projets/Acme.md', 1);
		expect(contextTask?.person).toBe('Antoine');
		expect(contextTask?.forOthers).toBeUndefined();
		expect(DelegationFeature.hidesOthers()).toBe(false);
		expect(matchesDelegationFilter(
			{ ...DEFAULT_CALENDAR_FILTER, delegation: [DELEGATION_SELF] },
			contextTask!,
			DelegationFeature.hidesOthers()
		)).toBe(true);
	});
});

describe('Filtre « donnée par » du calendrier', () => {
	const f = (delegation: string[]) => ({ ...DEFAULT_CALENDAR_FILTER, delegation });

	it('laisse tout passer sans sélection', () => {
		expect(matchesDelegationFilter(f([]), undefined)).toBe(true);
		expect(matchesDelegationFilter(f([]), 'Antoine')).toBe(true);
	});

	it('sépare mes tâches de celles attribuées à d’autres ou liées à une personne précise', () => {
		const mine = { person: 'Antoine', forOthers: false };
		const others = { person: 'Antoine', forOthers: true };
		expect(matchesDelegationFilter(f([DELEGATION_SELF]), {})).toBe(true);
		expect(matchesDelegationFilter(f([DELEGATION_SELF]), others, true)).toBe(false);
		expect(matchesDelegationFilter(f([DELEGATION_SELF]), mine, true)).toBe(true);
		expect(matchesDelegationFilter(f([DELEGATION_SELF]), mine)).toBe(true);
		expect(matchesDelegationFilter(f([DELEGATION_OTHERS]), mine)).toBe(true);
		expect(matchesDelegationFilter(f([DELEGATION_OTHERS]), {})).toBe(false);
		expect(matchesDelegationFilter(f([delegationPersonKey('Léa')]), { person: 'léa' })).toBe(true);
		expect(matchesDelegationFilter(f([delegationPersonKey('Léa')]), { person: 'Antoine' })).toBe(false);
		expect(matchesDelegationFilter(f([DELEGATION_SELF, delegationPersonKey('Léa')]), {})).toBe(true);
	});

	it('survit à l’enregistrement : clés inconnues écartées, anciens filtres sans le champ acceptés', () => {
		expect(normalizeFilter({ showTasks: true }).delegation).toEqual([]);
		expect(normalizeFilter({ delegation: ['self', 'person:lea', 'bidule', 'person:'] }).delegation).toEqual(['self', 'person:lea']);
		expect(sameFilter(f(['self']), f(['self']))).toBe(true);
		expect(sameFilter(f(['self']), f([]))).toBe(false);
	});

	it('se résume en pastille et se retire d’un clic, seulement quand la fonctionnalité est active', () => {
		const ctx = { matrixEnabled: true, googleReady: false, entriesAvailable: false, legend: [] as Array<{ id: string; name: string; role: 'primary' }> };
		const filter = f([delegationPersonKey('Léa'), DELEGATION_SELF]);
		expect(describeFilter(filter, ctx).find(c => c.id === 'delegation')).toBeUndefined();
		const chip = describeFilter(filter, { ...ctx, delegationEnabled: true, people: [{ key: delegationPersonKey('Léa'), name: 'Léa' }] }).find(c => c.id === 'delegation');
		expect(chip?.label).toBe('Léa, Les miennes');
		expect(clearFilterChip(filter, 'delegation', []).delegation).toEqual([]);
	});
});

describe('Appui long sur mobile', () => {
	it('un appui long relâché sans bouger ouvre la modification, pas un glisser ni un clic souris', () => {
		expect(isLongPressWithoutMove('touch', 100, 100, 104, 103)).toBe(true);
		expect(isLongPressWithoutMove('pen', 100, 100, 100, 100)).toBe(true);
		expect(isLongPressWithoutMove('touch', 100, 100, 130, 100)).toBe(false);
		expect(isLongPressWithoutMove('mouse', 100, 100, 100, 100)).toBe(false);
	});
});
