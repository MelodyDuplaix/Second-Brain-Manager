import { describe, it, expect } from 'vitest';
import {
	bucketEventsByDate,
	buildCalendarColors,
	calendarRole,
	dedupeEvents,
	resolveCalendarId,
	eventDaySpan,
	formatEventTime,
	localParts,
	shiftEvent,
	toLocalIsoWithOffset,
	OTHER_PERSON_COLOR,
	SECONDARY_PALETTE
} from '../../src/services/calendarEventsService';
import { GoogleCalendarEvent, DEFAULT_GOOGLE_CALENDAR_SETTINGS } from '../../src/models/googleCalendar';

function timed(id: string, start: Date, end: Date, calendarId = 'primary'): GoogleCalendarEvent {
	return {
		id, summary: id, calendarId, allDay: false,
		start: { dateTime: toLocalIsoWithOffset(start) },
		end: { dateTime: toLocalIsoWithOffset(end) }
	};
}

function allDay(id: string, start: string, endExclusive: string, calendarId = 'primary'): GoogleCalendarEvent {
	return { id, summary: id, calendarId, allDay: true, start: { date: start }, end: { date: endExclusive } };
}

describe('eventDaySpan', () => {
	it('treats the all-day end date as exclusive', () => {
		expect(eventDaySpan(allDay('a', '2026-11-10', '2026-11-11'))).toEqual({ first: '2026-11-10', last: '2026-11-10' });
		expect(eventDaySpan(allDay('b', '2026-11-10', '2026-11-13'))).toEqual({ first: '2026-11-10', last: '2026-11-12' });
	});

	it('uses local dates for timed events and ignores a midnight end', () => {
		const ev = timed('t', new Date(2026, 10, 10, 22, 0), new Date(2026, 10, 11, 0, 0));
		expect(eventDaySpan(ev)).toEqual({ first: '2026-11-10', last: '2026-11-10' });
		const overnight = timed('o', new Date(2026, 10, 10, 22, 0), new Date(2026, 10, 11, 2, 0));
		expect(eventDaySpan(overnight)).toEqual({ first: '2026-11-10', last: '2026-11-11' });
	});
});

describe('bucketEventsByDate', () => {
	it('repeats multi-day events and sorts all-day first, then by time', () => {
		const events = [
			timed('late', new Date(2026, 10, 10, 15, 0), new Date(2026, 10, 10, 16, 0)),
			timed('early', new Date(2026, 10, 10, 9, 0), new Date(2026, 10, 10, 10, 0)),
			allDay('trip', '2026-11-10', '2026-11-12'),
			{ ...allDay('gone', '2026-11-10', '2026-11-11'), status: 'cancelled' }
		];
		const buckets = bucketEventsByDate(events);
		expect(buckets.get('2026-11-10')!.map(e => e.id)).toEqual(['trip', 'early', 'late']);
		expect(buckets.get('2026-11-11')!.map(e => e.id)).toEqual(['trip']);
		expect(buckets.has('2026-11-12')).toBe(false);
	});
});

describe('shiftEvent', () => {
	it('moves a timed event and keeps its hours and duration', () => {
		const ev = timed('r', new Date(2026, 10, 10, 14, 30), new Date(2026, 10, 10, 15, 45));
		const shift = shiftEvent(ev, 2)!;
		expect(shift.update).toEqual({ calendarId: 'primary', startDate: '2026-11-12', startTime: '14:30', endDate: '2026-11-12', endTime: '15:45' });
		expect(localParts(shift.start.dateTime as string)).toEqual({ date: '2026-11-12', time: '14:30' });
	});

	it('moves an all-day event with its exclusive end', () => {
		const shift = shiftEvent(allDay('v', '2026-11-10', '2026-11-13'), -3)!;
		expect(shift.update).toEqual({ calendarId: 'primary', startDate: '2026-11-07', endDate: '2026-11-10' });
	});
});

describe('formatEventTime', () => {
	it('shows the start time, a continuation mark, or a full-day label', () => {
		const ev = timed('m', new Date(2026, 10, 10, 22, 0), new Date(2026, 10, 11, 2, 0));
		expect(formatEventTime(ev, '2026-11-10').label).toBe('22:00');
		expect(formatEventTime(ev, '2026-11-11')).toEqual({ label: '↳', continues: true });
		expect(formatEventTime(allDay('d', '2026-11-10', '2026-11-11'), '2026-11-10').label).toBe('Journée');
	});
});

describe('calendar colors by role', () => {
	const settings = {
		...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
		defaultCalendarId: 'me@x',
		calendarsConfig: {
			'me@x': { id: 'me@x', role: 'primary' as const },
			'sport@x': { id: 'sport@x', role: 'secondary' as const },
			'work@x': { id: 'work@x', role: 'secondary' as const },
			'claire@x': { id: 'claire@x', role: 'other_person' as const, ownerName: 'Claire' },
			'spam@x': { id: 'spam@x', role: 'ignore' as const }
		}
	};
	const calendars = ['work@x', 'claire@x', 'me@x', 'spam@x', 'sport@x'].map(id => ({ id, name: id }));

	it('resolves roles, defaulting unknown calendars to secondary', () => {
		expect(calendarRole(settings, 'me@x')).toBe('primary');
		expect(calendarRole(settings, 'unknown@x')).toBe('secondary');
		expect(calendarRole({ ...DEFAULT_GOOGLE_CALENDAR_SETTINGS }, 'primary')).toBe('primary');
	});

	it('gives the primary the accent, each secondary a distinct color, and hides ignored calendars', () => {
		const legend = buildCalendarColors(settings, calendars, 'ACCENT');
		expect(legend.map(l => l.id)).toEqual(['me@x', 'sport@x', 'work@x', 'claire@x']);
		const color = (id: string) => legend.find(l => l.id === id)!.color;
		expect(color('me@x')).toBe('ACCENT');
		expect(SECONDARY_PALETTE).toContain(color('sport@x'));
		expect(SECONDARY_PALETTE).toContain(color('work@x'));
		expect(color('sport@x')).not.toBe(color('work@x'));
		expect(color('claire@x')).toBe(OTHER_PERSON_COLOR);
		expect(legend.find(l => l.id === 'claire@x')!.ownerName).toBe('Claire');
	});
});

describe('agenda principal et doublons', () => {
	// Configuration réelle : agenda par défaut « primary » (alias), agenda principal configuré par son adresse
	const settings = {
		...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
		defaultCalendarId: 'primary',
		selectedCalendarIds: ['primary'],
		calendarsConfig: {
			'melo@x': { id: 'melo@x', role: 'primary' as const },
			'antoine@x': { id: 'antoine@x', role: 'other_person' as const, ownerName: 'Antoine' },
			'feries@x': { id: 'feries@x', role: 'secondary' as const }
		}
	};

	it('resolves the "primary" alias to the real primary calendar', () => {
		expect(resolveCalendarId('primary', 'melo@x')).toBe('melo@x');
		expect(resolveCalendarId('primary')).toBe('primary');
		const calendars = [
			{ id: 'melo@x', name: 'melo@x' },
			{ id: 'antoine@x', name: 'antoine@x' },
			{ id: 'feries@x', name: 'Jours fériés' },
			{ id: 'primary', name: 'Agenda principal' }
		];
		const legend = buildCalendarColors(settings, calendars, 'ACCENT', 'melo@x');
		expect(legend.map(l => l.id)).toEqual(['melo@x', 'feries@x', 'antoine@x']);
		expect(legend.filter(l => l.role === 'primary')).toHaveLength(1);
	});

	it('keeps one copy of an event found in several calendars, from the best ranked one', () => {
		const ev = (calendarId: string) => ({ ...allDay('spectacle', '2026-10-31', '2026-11-01', calendarId) });
		const events = [ev('antoine@x'), ev('melo@x'), ev('melo@x'), allDay('autre', '2026-10-31', '2026-11-01', 'melo@x')];
		const rank: Record<string, number> = { 'melo@x': 0, 'antoine@x': 2 };
		const unique = dedupeEvents(events, id => rank[id] ?? 99);
		expect(unique.map(e => `${e.id}@${e.calendarId}`)).toEqual(['spectacle@melo@x', 'autre@melo@x']);
	});
});

describe('couleurs choisies dans les réglages', () => {
	const calendars = [
		{ id: 'me@x', name: 'Moi', color: '#111111' },
		{ id: 'sport@x', name: 'Sport', color: '#222222' },
		{ id: 'claire@x', name: 'Claire', color: '#333333' }
	];
	const base = {
		...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
		defaultCalendarId: 'me@x',
		calendarsConfig: {
			'me@x': { id: 'me@x', role: 'primary' as const },
			'sport@x': { id: 'sport@x', role: 'secondary' as const },
			'claire@x': { id: 'claire@x', role: 'other_person' as const }
		}
	};
	const colorOf = (legend: ReturnType<typeof buildCalendarColors>, id: string) => legend.find(l => l.id === id)!.color;

	it('uses the role colors chosen in the settings', () => {
		const legend = buildCalendarColors({ ...base, primaryCalendarColor: '#aa0000', otherPersonCalendarColor: '#00aa00' }, calendars, 'ACCENT');
		expect(colorOf(legend, 'me@x')).toBe('#aa0000');
		expect(colorOf(legend, 'claire@x')).toBe('#00aa00');
		expect(SECONDARY_PALETTE).toContain(colorOf(legend, 'sport@x'));
	});

	it('takes the Google colors only when enabled', () => {
		const legend = buildCalendarColors({ ...base, useGoogleCalendarColors: true }, calendars, 'ACCENT');
		expect(legend.map(l => l.color)).toEqual(['#111111', '#222222', '#333333']);
	});

	it('prefers the color chosen for one calendar over every other', () => {
		const settings = {
			...base,
			useGoogleCalendarColors: true,
			primaryCalendarColor: '#aa0000',
			calendarsConfig: { ...base.calendarsConfig, 'me@x': { id: 'me@x', role: 'primary' as const, color: '#abcdef' }, 'sport@x': { id: 'sport@x', role: 'secondary' as const, color: '#fedcba' } }
		};
		const legend = buildCalendarColors(settings, calendars, 'ACCENT');
		expect(colorOf(legend, 'me@x')).toBe('#abcdef');
		expect(colorOf(legend, 'sport@x')).toBe('#fedcba');
	});
});
