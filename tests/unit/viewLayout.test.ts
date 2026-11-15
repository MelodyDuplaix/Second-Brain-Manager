import { describe, it, expect } from 'vitest';
import { findDuplicateLeaves, LeafPlacement } from '../../src/services/viewLayout';

interface FakeLeaf {
	id: string;
	type?: string;
	placement: LeafPlacement;
}

const PLUGIN_VIEWS = new Set([
	'sbm-dashboard-view',
	'sbm-task-calendar-view',
	'sbm-briefing-view'
]);

const find = (leaves: FakeLeaf[]) => findDuplicateLeaves<FakeLeaf>(
	leaves,
	l => l.type,
	l => l.placement,
	t => PLUGIN_VIEWS.has(t)
).map(l => l.id);

const leaf = (id: string, type: string | undefined, placement: LeafPlacement = 'right'): FakeLeaf => ({ id, type, placement });

describe('Dédoublonnage des onglets du plugin', () => {
	it('ne ferme rien quand chaque vue est unique', () => {
		expect(find([
			leaf('a', 'sbm-task-calendar-view'),
			leaf('b', 'sbm-dashboard-view'),
			leaf('c', 'sbm-briefing-view')
		])).toEqual([]);
	});

	it('ferme le second onglet et conserve le premier (celui restauré par Obsidian)', () => {
		expect(find([
			leaf('restauré', 'sbm-task-calendar-view'),
			leaf('ouvert-au-démarrage', 'sbm-task-calendar-view')
		])).toEqual(['ouvert-au-démarrage']);
	});

	it('ferme tous les exemplaires surnuméraires, pas seulement le deuxième', () => {
		expect(find([
			leaf('1', 'sbm-briefing-view'),
			leaf('2', 'sbm-briefing-view'),
			leaf('3', 'sbm-briefing-view')
		])).toEqual(['2', '3']);
	});

	it('laisse le calendrier ouvert à la fois en barre latérale et en vue principale', () => {
		expect(find([
			leaf('barre', 'sbm-task-calendar-view', 'right'),
			leaf('grand', 'sbm-task-calendar-view', 'main')
		])).toEqual([]);
	});

	it('juge les doublons par emplacement', () => {
		expect(find([
			leaf('barre', 'sbm-task-calendar-view', 'right'),
			leaf('grand-1', 'sbm-task-calendar-view', 'main'),
			leaf('grand-2', 'sbm-task-calendar-view', 'main'),
			leaf('gauche', 'sbm-task-calendar-view', 'left')
		])).toEqual(['grand-2']);
	});

	it('ne touche jamais aux onglets d’Obsidian ou d’autres plugins, même en double', () => {
		expect(find([
			leaf('md1', 'markdown', 'main'),
			leaf('md2', 'markdown', 'main'),
			leaf('tag1', 'tag'),
			leaf('tag2', 'tag'),
			leaf('sans-type', undefined)
		])).toEqual([]);
	});

	it('ne confond pas deux vues différentes du plugin au même endroit', () => {
		expect(find([
			leaf('cal', 'sbm-task-calendar-view'),
			leaf('dash', 'sbm-dashboard-view'),
			leaf('cal-bis', 'sbm-task-calendar-view')
		])).toEqual(['cal-bis']);
	});
});
