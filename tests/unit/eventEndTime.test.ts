import { describe, it, expect } from 'vitest';
import { addMinutesToClock, resolveEventEnd } from '../../src/services/calendarEventsService';

describe('Heure de fin des événements', () => {
	it('calcule la fin dans la même journée', () => {
		expect(resolveEventEnd('2026-11-10', '09:00', '10:30')).toEqual({ endDate: '2026-11-10', endTime: '10:30' });
	});

	it('passe au lendemain quand la fin précède ou égale le début', () => {
		expect(resolveEventEnd('2026-11-10', '23:00', '00:30')).toEqual({ endDate: '2026-11-11', endTime: '00:30' });
		expect(resolveEventEnd('2026-11-10', '09:00', '09:00')).toEqual({ endDate: '2026-11-11', endTime: '09:00' });
	});

	it('change de mois correctement', () => {
		expect(resolveEventEnd('2026-11-30', '23:30', '01:00')).toEqual({ endDate: '2026-12-01', endTime: '01:00' });
	});

	it('refuse une heure ou une date invalide', () => {
		expect(resolveEventEnd('2026-11-10', '09:00', '')).toBeNull();
		expect(resolveEventEnd('2026-11-10', '09:00', '25:00')).toBeNull();
		expect(resolveEventEnd('2026-11-10', '09:00', '10:75')).toBeNull();
		expect(resolveEventEnd('10/11/2026', '09:00', '10:00')).toBeNull();
	});

	it('propose une heure de fin une heure après le début, sans dépasser minuit', () => {
		expect(addMinutesToClock('09:15', 60)).toBe('10:15');
		expect(addMinutesToClock('23:30', 60)).toBe('23:59');
		expect(addMinutesToClock('bof', 60)).toBe('bof');
	});
});
