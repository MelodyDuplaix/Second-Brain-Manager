import { describe, it, expect } from 'vitest';
import {
	FLING_WINDOW_MS,
	PointerSample,
	isFlingRelease,
	pushSample,
	releaseSpeedX,
	selectionRange,
	viewShifted
} from '../../src/services/touchGesture';
import { asTaskLine } from '../../src/services/dailyEntriesService';

describe('releaseSpeedX', () => {
	it('mesure la vitesse horizontale sur la fin du geste', () => {
		const trail: PointerSample[] = [
			{ x: 100, y: 50, t: 1000 },
			{ x: 140, y: 52, t: 1040 },
			{ x: 200, y: 55, t: 1080 }
		];
		expect(releaseSpeedX(trail, 1090)).toBeCloseTo(100 / 80);
		expect(isFlingRelease(trail, 1090)).toBe(true);
	});

	it('vaut zéro quand le doigt s’est arrêté avant le relâcher', () => {
		const trail: PointerSample[] = [
			{ x: 100, y: 50, t: 1000 },
			{ x: 300, y: 50, t: 1040 }
		];
		expect(releaseSpeedX(trail, 1040 + FLING_WINDOW_MS + 50)).toBe(0);
		expect(isFlingRelease(trail, 1200)).toBe(false);
	});

	it('ignore un glisser vertical, même rapide', () => {
		const trail: PointerSample[] = [
			{ x: 100, y: 0, t: 1000 },
			{ x: 104, y: 200, t: 1050 }
		];
		expect(isFlingRelease(trail, 1055)).toBe(false);
	});

	it('un dépôt lent n’est pas un balayage', () => {
		const trail: PointerSample[] = [
			{ x: 100, y: 0, t: 1000 },
			{ x: 110, y: 0, t: 1050 },
			{ x: 115, y: 0, t: 1090 }
		];
		expect(isFlingRelease(trail, 1095)).toBe(false);
	});
});

describe('pushSample', () => {
	it('oublie les points trop anciens mais en garde au moins deux', () => {
		const trail: PointerSample[] = [];
		pushSample(trail, { x: 0, y: 0, t: 0 });
		pushSample(trail, { x: 1, y: 0, t: 10 });
		pushSample(trail, { x: 2, y: 0, t: 1000 });
		expect(trail.map(s => s.t)).toEqual([10, 1000]);
	});
});

describe('viewShifted', () => {
	it('tolère un léger tremblement', () => {
		expect(viewShifted(400, 405)).toBe(false);
	});
	it('repère la barre latérale qui se referme', () => {
		expect(viewShifted(400, 440)).toBe(true);
		expect(viewShifted(400, 360)).toBe(true);
	});
});

describe('selectionRange', () => {
	it('en descendant, va de l’ancre au point courant', () => {
		expect(selectionRange(600, 690, 15)).toEqual({ start: 600, end: 690 });
	});
	it('garde au moins un créneau', () => {
		expect(selectionRange(600, 600, 15)).toEqual({ start: 600, end: 615 });
	});
	it('en remontant, inclut le créneau touché', () => {
		expect(selectionRange(600, 540, 15)).toEqual({ start: 540, end: 615 });
	});
});

describe('asTaskLine', () => {
	it('ajoute la case après la puce', () => {
		expect(asTaskLine('- 10:00 - 11:00 Dentiste')).toBe('- [ ] 10:00 - 11:00 Dentiste');
		expect(asTaskLine('  * 10:00 Appel')).toBe('  * [ ] 10:00 Appel');
		expect(asTaskLine('1. 10:00 Appel')).toBe('1. [ ] 10:00 Appel');
	});
	it('ajoute puce et case quand le modèle n’en a pas', () => {
		expect(asTaskLine('10:00 Appel')).toBe('- [ ] 10:00 Appel');
	});
	it('laisse une ligne déjà cochable intacte', () => {
		expect(asTaskLine('- [x] 10:00 Appel')).toBe('- [x] 10:00 Appel');
	});
});
