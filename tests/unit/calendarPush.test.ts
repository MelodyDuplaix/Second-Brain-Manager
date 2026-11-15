import { describe, it, expect } from 'vitest';
import { resolveEdgePush, resolveMovePush, PushBlock, PULL_LINK_MAX_GAP } from '../../src/services/calendarPush';
import { pushDirectionOf, movesStartEdge, isMoveMode, gridItemGrips, gridTimeLabel } from '../../src/views/taskCalendarView';

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const block = (key: string, start: number, end: number, movable = true): PushBlock => ({ key, start, end, movable });

describe('Blocs collés : le bouton du haut tire le voisin du dessus', () => {
	// Écart de 3 min : sous le seuil, les blocs sont collés
	const deux = [block('premier', h(10), h(11)), block('second', h(11, 3), h(12, 3))];

	it('deux blocs sont collés sous 5 minutes d’écart', () => {
		expect(PULL_LINK_MAX_GAP).toBe(5);
	});

	it('à 5 minutes d’écart exactement, ils ne sont plus collés : rien n’est tiré', () => {
		const ecart5 = [block('premier', h(10), h(11)), block('second', h(11, 5), h(12, 5))];
		expect(resolveEdgePush(ecart5, 'second', h(11, 35), 'up')).toEqual([]);
		expect(resolveEdgePush(ecart5, 'premier', h(10, 30), 'down')).toEqual([]);
	});

	it('tiré vers le bas, allonge le bloc du dessus d’autant', () => {
		expect(resolveEdgePush(deux, 'second', h(11, 33), 'up')).toEqual([
			{ key: 'premier', start: h(10), end: h(11, 30) }
		]);
	});

	it('tiré vers le haut, ne pousse qu’au contact : l’écart se referme d’abord', () => {
		// Le bord remonte de 11 h 03 à 11 h 01 : l'écart se réduit, rien ne bouge
		expect(resolveEdgePush(deux, 'second', h(11, 1), 'up')).toEqual([]);
		// Au-delà du contact, le premier est poussé : sa fin rejoint le bord tiré
		expect(resolveEdgePush(deux, 'second', h(10, 35), 'up')).toEqual([
			{ key: 'premier', start: h(10), end: h(10, 35) }
		]);
	});

	it('conserve l’écart entre les deux blocs', () => {
		const [shift] = resolveEdgePush(deux, 'second', h(14), 'up');
		expect(h(14) - shift.end).toBe(3);
	});

	it('ne touche à rien quand le bord revient à sa place', () => {
		expect(resolveEdgePush(deux, 'second', h(11, 3), 'up')).toEqual([]);
	});

	it('décale le voisin quand il ne peut plus se raccourcir, puis passe au suivant', () => {
		const pile = [
			block('haut', h(8), h(9)),
			block('milieu', h(9), h(10)),
			block('tiré', h(10), h(11))
		];
		// Le bord passe à 9 h 10 : « milieu » tomberait à 10 min, sous le minimum de 15 min,
		// donc il est ramené à 15 min et son début recule de 5 min. « haut » encaisse ces 5 min
		// en se raccourcissant d'autant, sans bouger son début : la chaîne s'arrête là.
		expect(resolveEdgePush(pile, 'tiré', h(9, 10), 'up')).toEqual([
			{ key: 'milieu', start: h(8, 55), end: h(9, 10) },
			{ key: 'haut', start: h(8), end: h(8, 55) }
		]);
	});

	it('s’arrête dès qu’un bloc ne change que de durée', () => {
		const pile = [
			block('loin', h(6), h(7)),
			block('voisin', h(9), h(10)),
			block('tiré', h(10), h(11))
		];
		expect(resolveEdgePush(pile, 'tiré', h(10, 30), 'up')).toEqual([
			{ key: 'voisin', start: h(9), end: h(10, 30) }
		]);
	});

	it('fait mur sur un bloc non déplaçable', () => {
		const mur = [block('ancré', h(9), h(10), false), block('tiré', h(10), h(11))];
		expect(resolveEdgePush(mur, 'tiré', h(10, 30), 'up')).toEqual([]);
	});

	it('ne touche pas un bloc qui chevauchait déjà le bloc tiré', () => {
		const cote = [block('parallèle', h(9, 30), h(10, 30)), block('tiré', h(10), h(11))];
		expect(resolveEdgePush(cote, 'tiré', h(9), 'up')).toEqual([]);
	});

	it('s’arrête au bord haut de la journée', () => {
		const matin = [block('aube', h(0), h(1)), block('tiré', h(1), h(2))];
		expect(resolveEdgePush(matin, 'tiré', h(0, 10), 'up')).toEqual([]);
	});
});

describe('Blocs collés : le bouton du bas entraîne le voisin du dessous', () => {
	const deux = [block('premier', h(10), h(11)), block('second', h(11, 3), h(12, 3))];

	it('tiré vers le bas, ne pousse qu’au contact puis raccourcit le bloc du dessous', () => {
		expect(resolveEdgePush(deux, 'premier', h(11, 2), 'down')).toEqual([]);
		expect(resolveEdgePush(deux, 'premier', h(11, 30), 'down')).toEqual([
			{ key: 'second', start: h(11, 30), end: h(12, 3) }
		]);
	});

	it('tiré vers le haut, avance le bloc du dessous et l’allonge', () => {
		expect(resolveEdgePush(deux, 'premier', h(10, 30), 'down')).toEqual([
			{ key: 'second', start: h(10, 33), end: h(12, 3) }
		]);
	});

	it('décale le voisin quand il ne peut plus se raccourcir, puis passe au suivant', () => {
		const pile = [
			block('tiré', h(10), h(11)),
			block('milieu', h(11), h(12)),
			block('bas', h(12), h(13))
		];
		// « milieu » est ramené à 15 min et sa fin dépasse de 5 min ; « bas » absorbe ces 5 min
		// en commençant plus tard, sans changer sa fin : la chaîne s'arrête là.
		expect(resolveEdgePush(pile, 'tiré', h(11, 50), 'down')).toEqual([
			{ key: 'milieu', start: h(11, 50), end: h(12, 5) },
			{ key: 'bas', start: h(12, 5), end: h(13) }
		]);
	});

	it('repart des positions d’origine : revenir en arrière remet le voisin en place', () => {
		expect(resolveEdgePush(deux, 'premier', h(11, 30), 'down')).not.toEqual([]);
		expect(resolveEdgePush(deux, 'premier', h(11), 'down')).toEqual([]);
	});

	it('raccourcit le dernier bloc de la journée tant qu’il tient', () => {
		const soir = [block('tiré', h(22), h(23)), block('nuit', h(23), h(24))];
		expect(resolveEdgePush(soir, 'tiré', h(23, 30), 'down')).toEqual([
			{ key: 'nuit', start: h(23, 30), end: h(24) }
		]);
	});

	it('s’arrête quand le voisin ne tiendrait plus avant minuit', () => {
		const soir = [block('tiré', h(22), h(23)), block('nuit', h(23), h(24))];
		expect(resolveEdgePush(soir, 'tiré', h(23, 50), 'down')).toEqual([]);
	});
});

describe('Blocs éloignés : le voisin ne bouge qu’au contact', () => {
	// Écart d'une heure, donc bien au-delà du seuil d'accrochage
	const loin = [block('premier', h(10), h(11)), block('second', h(12), h(13))];

	it('un bord qui s’éloigne ne tire pas le voisin', () => {
		// Le bouton du haut du second descend : le premier garde sa durée
		expect(resolveEdgePush(loin, 'second', h(12, 30), 'up')).toEqual([]);
		// Et le bouton du bas du premier remonte : le second ne remonte pas avec lui
		expect(resolveEdgePush(loin, 'premier', h(10, 30), 'down')).toEqual([]);
	});

	it('tant que le bord n’atteint pas le voisin, rien ne bouge', () => {
		expect(resolveEdgePush(loin, 'second', h(11, 30), 'up')).toEqual([]);
		expect(resolveEdgePush(loin, 'premier', h(11, 45), 'down')).toEqual([]);
	});

	it('au contact, le voisin est poussé et se raccourcit', () => {
		// Le bord haut du second passe sous la fin du premier : contact, puis poussée
		expect(resolveEdgePush(loin, 'second', h(10, 30), 'up')).toEqual([
			{ key: 'premier', start: h(10), end: h(10, 30) }
		]);
		// Le bord bas du premier dépasse le début du second
		expect(resolveEdgePush(loin, 'premier', h(12, 30), 'down')).toEqual([
			{ key: 'second', start: h(12, 30), end: h(13) }
		]);
	});

	it('au contact puis au-delà de la durée minimale, le voisin est décalé', () => {
		expect(resolveEdgePush(loin, 'second', h(10, 10), 'up')).toEqual([
			{ key: 'premier', start: h(9, 55), end: h(10, 10) }
		]);
	});
});

describe('Mini-bouton du milieu : déplacer en poussant, à durée constante', () => {
	const pile = [
		block('tiré', h(10), h(11)),
		block('suivant', h(11), h(12)),
		block('encore', h(12), h(12, 30))
	];

	it('ne pousse rien quand le bloc ne bouge pas', () => {
		expect(resolveMovePush(pile, 'tiré', h(10), h(11))).toEqual([]);
	});

	it('vers le bas, pousse la pile à durée constante', () => {
		expect(resolveMovePush(pile, 'tiré', h(11), h(12))).toEqual([
			{ key: 'suivant', start: h(12), end: h(13) },
			{ key: 'encore', start: h(13), end: h(13, 30) }
		]);
	});

	it('ne rappelle pas les blocs qu’il quitte derrière lui', () => {
		const avecHaut = [block('au-dessus', h(9), h(10)), ...pile];
		const shifts = resolveMovePush(avecHaut, 'tiré', h(11), h(12));
		expect(shifts.map(s => s.key)).not.toContain('au-dessus');
	});

	it('vers le haut, pousse la pile du dessus à durée constante', () => {
		const avecHaut = [
			block('loin-haut', h(8), h(9)),
			block('au-dessus', h(9), h(10)),
			block('tiré', h(10), h(11))
		];
		expect(resolveMovePush(avecHaut, 'tiré', h(9), h(10))).toEqual([
			{ key: 'au-dessus', start: h(8), end: h(9) },
			{ key: 'loin-haut', start: h(7), end: h(8) }
		]);
	});

	it('s’arrête dès qu’un bloc a la place', () => {
		const espace = [block('tiré', h(10), h(11)), block('loin', h(15), h(16))];
		expect(resolveMovePush(espace, 'tiré', h(11), h(12))).toEqual([]);
	});

	it('fait mur sur un bloc non déplaçable', () => {
		const mur = [block('tiré', h(10), h(11)), block('ancré', h(11), h(12), false)];
		expect(resolveMovePush(mur, 'tiré', h(11), h(12))).toEqual([]);
	});

	it('s’arrête au bord de la journée', () => {
		const soir = [block('tiré', h(22), h(23)), block('nuit', h(23), h(24))];
		expect(resolveMovePush(soir, 'tiré', h(23), h(24))).toEqual([]);
	});
});

describe('Cas limites', () => {
	it('ne renvoie rien si le bloc tiré est inconnu', () => {
		expect(resolveEdgePush([block('a', h(9), h(10))], 'absent', h(11), 'down')).toEqual([]);
		expect(resolveMovePush([block('a', h(9), h(10))], 'absent', h(11), h(12))).toEqual([]);
	});

	it('respecte des bornes de journée personnalisées', () => {
		const matin = [block('tôt', h(6), h(7)), block('tiré', h(7), h(8))];
		expect(resolveEdgePush(matin, 'tiré', h(6, 10), 'up', { min: h(6), max: h(22) })).toEqual([]);
		expect(resolveEdgePush(matin, 'tiré', h(6, 10), 'up', { min: h(5), max: h(22) })).toEqual([
			{ key: 'tôt', start: h(5, 55), end: h(6, 10) }
		]);
	});
});

describe('Correspondance entre la poignée saisie et le geste', () => {
	it('seuls les mini-boutons des bords entraînent le voisin qui fait face', () => {
		expect(pushDirectionOf('push-start')).toBe('up');
		expect(pushDirectionOf('push-end')).toBe('down');
		expect(pushDirectionOf('resize-start')).toBeNull();
		expect(pushDirectionOf('resize-end')).toBeNull();
		expect(pushDirectionOf('move')).toBeNull();
		expect(pushDirectionOf('push-move')).toBeNull();
	});

	it('les deux poignées du haut agissent sur l’heure de début', () => {
		expect(movesStartEdge('resize-start')).toBe(true);
		expect(movesStartEdge('push-start')).toBe(true);
		expect(movesStartEdge('resize-end')).toBe(false);
		expect(movesStartEdge('push-end')).toBe(false);
		expect(movesStartEdge('move')).toBe(false);
	});

	it('deux modes déplacent le bloc entier', () => {
		expect(isMoveMode('move')).toBe(true);
		expect(isMoveMode('push-move')).toBe(true);
		expect(isMoveMode('resize-start')).toBe(false);
		expect(isMoveMode('push-end')).toBe(false);
	});
});

describe('Poignées posées sur un bloc', () => {
	it('un bloc confortable les a toutes, empilées', () => {
		expect(gridItemGrips(60, 80, false)).toEqual({ topBand: true, topPush: true, middlePush: true, inlineGrips: false });
	});

	it('les mini-boutons dépendent de la durée, pas de la hauteur à l’écran', () => {
		// 5 min très aplati par le zoom : les boutons restent, mais passent en rangée
		expect(gridItemGrips(5, 4, false)).toEqual({ topBand: false, topPush: true, middlePush: true, inlineGrips: true });
	});

	it('en dessous de 5 min, le haut et le milieu disparaissent', () => {
		expect(gridItemGrips(4, 40, false)).toEqual({ topBand: true, topPush: false, middlePush: false, inlineGrips: true });
	});

	it('la bande du bord haut reste conditionnée à la hauteur, pas à la durée', () => {
		// Bloc d'une heure mais écrasé par le zoom : pas de bande en haut, la zone cliquable primerait
		expect(gridItemGrips(60, 20, false).topBand).toBe(false);
		expect(gridItemGrips(60, 40, false).topBand).toBe(true);
	});

	it('au doigt, il faut plus de hauteur pour empiler les boutons et poser la bande', () => {
		expect(gridItemGrips(60, 40, true)).toEqual({ topBand: false, topPush: true, middlePush: true, inlineGrips: true });
		expect(gridItemGrips(60, 50, true)).toEqual({ topBand: true, topPush: true, middlePush: true, inlineGrips: true });
		expect(gridItemGrips(60, 96, true)).toEqual({ topBand: true, topPush: true, middlePush: true, inlineGrips: false });
	});
});

describe('Libellé horaire des blocs', () => {
	it('affiche le début et la fin', () => {
		expect(gridTimeLabel(h(10), h(11, 30))).toBe('10:00 – 11:30');
	});

	it('sans heure de fin, n’affiche que le début', () => {
		expect(gridTimeLabel(h(9, 5), null)).toBe('09:05');
	});

	it('signale un bloc commencé la veille ou fini le lendemain', () => {
		expect(gridTimeLabel(0, h(9), true, false)).toBe('↳ – 09:00');
		expect(gridTimeLabel(h(23), h(24), false, true)).toBe('23:00 – →');
	});

	it('affiche minuit en fin de journée comme 24:00', () => {
		expect(gridTimeLabel(h(23), h(24))).toBe('23:00 – 24:00');
	});
});
