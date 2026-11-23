import { describe, it, expect } from 'vitest';
import { gridClock, gridTimeLabel, splitGridRange } from '../../src/views/taskCalendarView';

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe('journée prolongée après minuit', () => {
	it('affiche les minutes du lendemain comme des heures normales', () => {
		expect(gridClock(h(23, 30))).toBe('23:30');
		expect(gridClock(h(24))).toBe('24:00');
		expect(gridClock(h(25, 30))).toBe('01:30');
		expect(gridTimeLabel(h(23), h(25))).toBe('23:00 – 01:00');
	});

	it('laisse inchangée une plage de la journée', () => {
		expect(splitGridRange('2026-11-23', h(10), h(11))).toEqual({ day: '2026-11-23', start: h(10), end: h(11) });
		expect(splitGridRange('2026-11-23', h(23), h(24))).toEqual({ day: '2026-11-23', start: h(23), end: h(24) });
		expect(splitGridRange('2026-11-23', h(9), null)).toEqual({ day: '2026-11-23', start: h(9), end: null });
	});

	it('passe au lendemain une plage qui commence après minuit', () => {
		expect(splitGridRange('2026-11-23', h(24, 30), h(26))).toEqual({ day: '2026-11-24', start: h(0, 30), end: h(2) });
		expect(splitGridRange('2026-11-30', h(25), null)).toEqual({ day: '2026-12-01', start: h(1), end: null });
	});

	it('fait finir après minuit une plage à cheval (fin plus petite que le début)', () => {
		expect(splitGridRange('2026-11-23', h(23), h(25, 30))).toEqual({ day: '2026-11-23', start: h(23), end: h(1, 30) });
	});
});
