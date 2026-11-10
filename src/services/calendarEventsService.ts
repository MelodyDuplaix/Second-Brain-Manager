import { GoogleCalendarEvent, GoogleCalendarSettings, CalendarRole } from '../models/googleCalendar';
import { CalendarDate } from './taskCalendarService';

/* ==========================================================================
   Événements Google dans le calendrier unifié : dates, regroupement, couleurs
   ========================================================================== */

/** Palette des agendas secondaires : couleurs nettement distinctes de l'accent (agenda principal). */
export const SECONDARY_PALETTE = ['#0ea5a4', '#f97316', '#ec4899', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#ef4444'];
/** Couleur des agendas d'autres personnes (consultatifs). */
export const OTHER_PERSON_COLOR = '#94a3b8';

export interface CalendarLegendEntry {
	id: string;
	name: string;
	role: CalendarRole;
	color: string;
	ownerName?: string;
}

/** Date locale (YYYY-MM-DD) et heure (HH:MM) d'un horodatage ISO. */
export function localParts(dateTime: string): { date: string; time: string } {
	const d = new Date(dateTime);
	return {
		date: CalendarDate.toISO(d),
		time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
	};
}

/** ISO local avec décalage horaire (ex. 2026-11-08T14:30:00+01:00). */
export function toLocalIsoWithOffset(d: Date): string {
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? '+' : '-';
	const abs = Math.abs(off);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
	return `${CalendarDate.toISO(d)}T${time}${sign}${hh}:${mm}`;
}

/**
 * Fin d'un événement à partir des heures saisies. Une fin antérieure ou égale au début passe au
 * lendemain (ex. 23:00 → 00:30), ce qui évite une plage négative refusée par Google.
 */
export function resolveEventEnd(
	startDate: string,
	startTime: string,
	endTime: string
): { endDate: string; endTime: string } | null {
	const toMinutes = (value: string): number | null => {
		const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
		if (!m) return null;
		const h = Number(m[1]);
		const min = Number(m[2]);
		if (h > 23 || min > 59) return null;
		return h * 60 + min;
	};
	if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
	const start = toMinutes(startTime);
	const end = toMinutes(endTime);
	if (start === null || end === null) return null;
	const nextDay = end <= start;
	return {
		endDate: nextDay ? CalendarDate.addDays(startDate, 1) : startDate,
		endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
	};
}

/** Heure (HH:MM) obtenue en ajoutant des minutes à une heure, en restant dans la journée. */
export function addMinutesToClock(time: string, minutes: number): string {
	const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	if (!m) return time;
	const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + minutes);
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Premier et dernier jour (inclus) couverts par l'événement, en dates locales. */
export function eventDaySpan(ev: GoogleCalendarEvent): { first: string; last: string } | null {
	if (ev.start?.date && !ev.start.dateTime) {
		const first = ev.start.date;
		// Fin exclusive pour les événements « toute la journée »
		const endExclusive = ev.end?.date || CalendarDate.addDays(first, 1);
		const last = CalendarDate.addDays(endExclusive, -1);
		return { first, last: last < first ? first : last };
	}
	if (!ev.start?.dateTime) return null;
	const start = localParts(ev.start.dateTime);
	if (!ev.end?.dateTime) return { first: start.date, last: start.date };
	const end = localParts(ev.end.dateTime);
	// Un événement qui finit pile à minuit n'occupe pas le jour suivant
	const last = end.time === '00:00' && end.date > start.date ? CalendarDate.addDays(end.date, -1) : end.date;
	return { first: start.date, last: last < start.date ? start.date : last };
}

export function compareEvents(a: GoogleCalendarEvent, b: GoogleCalendarEvent): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	const ta = a.start.dateTime ? new Date(a.start.dateTime).getTime() : 0;
	const tb = b.start.dateTime ? new Date(b.start.dateTime).getTime() : 0;
	if (ta !== tb) return ta - tb;
	return (a.summary || '').localeCompare(b.summary || '', 'fr');
}

/** Regroupe les événements par jour local ; un événement sur plusieurs jours apparaît chaque jour. */
export function bucketEventsByDate(events: GoogleCalendarEvent[], maxSpanDays = 62): Map<string, GoogleCalendarEvent[]> {
	const map = new Map<string, GoogleCalendarEvent[]>();
	for (const ev of events) {
		if (ev.status === 'cancelled') continue;
		const span = eventDaySpan(ev);
		if (!span) continue;
		const days = Math.min(CalendarDate.diffDays(span.first, span.last), maxSpanDays);
		for (let i = 0; i <= days; i++) {
			const day = CalendarDate.addDays(span.first, i);
			const list = map.get(day);
			if (list) list.push(ev);
			else map.set(day, [ev]);
		}
	}
	map.forEach(list => list.sort(compareEvents));
	return map;
}

/** Clé stable d'un événement (une occurrence récurrente a son propre identifiant). */
export function eventKey(ev: Pick<GoogleCalendarEvent, 'calendarId' | 'id'>): string {
	return `ev::${ev.calendarId}::${ev.id}`;
}

export interface EventShift {
	/** Paramètres pour GoogleCalendarService.updateEvent */
	update: { calendarId: string; startDate: string; startTime?: string; endDate: string; endTime?: string };
	/** Nouvelles bornes, à appliquer localement pour un affichage immédiat */
	start: GoogleCalendarEvent['start'];
	end: GoogleCalendarEvent['end'];
}

/** Calcule le déplacement d'un événement de `deltaDays` jours en conservant heures et durée. */
export function shiftEvent(ev: GoogleCalendarEvent, deltaDays: number): EventShift | null {
	if (ev.start?.date && !ev.start.dateTime) {
		const startDate = CalendarDate.addDays(ev.start.date, deltaDays);
		const endDate = CalendarDate.addDays(ev.end?.date || CalendarDate.addDays(ev.start.date, 1), deltaDays);
		return {
			update: { calendarId: ev.calendarId, startDate, endDate },
			start: { ...ev.start, date: startDate },
			end: { ...ev.end, date: endDate }
		};
	}
	if (!ev.start?.dateTime) return null;
	const start = new Date(ev.start.dateTime);
	const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : new Date(start.getTime() + 3600_000);
	start.setDate(start.getDate() + deltaDays);
	end.setDate(end.getDate() + deltaDays);
	const s = localParts(toLocalIsoWithOffset(start));
	const e = localParts(toLocalIsoWithOffset(end));
	return {
		update: { calendarId: ev.calendarId, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time },
		start: { ...ev.start, dateTime: toLocalIsoWithOffset(start) },
		end: { ...ev.end, dateTime: toLocalIsoWithOffset(end) }
	};
}

/**
 * « primary » est un alias Google de l'agenda principal du compte (ex. moi@gmail.com).
 * On le remplace par son vrai identifiant pour ne pas afficher ni interroger deux fois le même agenda.
 */
export function resolveCalendarId(calendarId: string, primaryId?: string): string {
	return calendarId === 'primary' && primaryId ? primaryId : calendarId;
}

/** Rôle d'un agenda selon les réglages (principal par défaut pour l'agenda par défaut). */
export function calendarRole(settings: GoogleCalendarSettings, calendarId: string, primaryId?: string): CalendarRole {
	const conf = settings.calendarsConfig?.[calendarId];
	if (conf?.role) return conf.role;
	const def = resolveCalendarId(settings.defaultCalendarId || 'primary', primaryId);
	return calendarId === def || calendarId === 'primary' || (primaryId !== undefined && calendarId === primaryId && def === primaryId)
		? 'primary'
		: 'secondary';
}

/**
 * Supprime les doublons d'événements (même événement présent dans plusieurs agendas, ou agenda
 * interrogé deux fois). L'exemplaire de l'agenda le mieux classé (`rankOf` le plus petit) est gardé.
 */
export function dedupeEvents(events: GoogleCalendarEvent[], rankOf: (calendarId: string) => number): GoogleCalendarEvent[] {
	const best = new Map<string, GoogleCalendarEvent>();
	for (const ev of events) {
		const key = `${ev.id}|${ev.start?.dateTime || ev.start?.date || ''}`;
		const current = best.get(key);
		if (!current || rankOf(ev.calendarId) < rankOf(current.calendarId)) best.set(key, ev);
	}
	return events.filter(ev => best.get(`${ev.id}|${ev.start?.dateTime || ev.start?.date || ''}`) === ev);
}

/**
 * Attribue une couleur par agenda selon son rôle :
 * principal → couleur d'accent, secondaires → palette distincte (ordre stable),
 * autres personnes → gris-bleu discret.
 */
export function buildCalendarColors(
	settings: GoogleCalendarSettings,
	calendars: Array<{ id: string; name: string; color?: string }>,
	accent = 'var(--interactive-accent)',
	primaryId?: string
): CalendarLegendEntry[] {
	// Un même agenda ne figure qu'une fois (alias « primary » résolu)
	const unique = new Map<string, { id: string; name: string; color?: string }>();
	for (const cal of calendars) {
		const id = resolveCalendarId(cal.id, primaryId);
		if (unique.has(id)) continue;
		const original = cal.id === id ? cal : (calendars.find(c => c.id === id) || cal);
		unique.set(id, { id, name: original.name, color: original.color || cal.color });
	}
	calendars = [...unique.values()];
	const sorted = [...calendars].sort((a, b) => a.id.localeCompare(b.id));
	let secondaryIndex = 0;
	const byId = new Map<string, CalendarLegendEntry>();
	for (const cal of sorted) {
		const role = calendarRole(settings, cal.id, primaryId);
		if (role === 'ignore') continue;
		const conf = settings.calendarsConfig?.[cal.id];
		// Priorité : couleur choisie pour l'agenda > couleur Google (si activée) > couleur du rôle
		let color = (conf?.color || '').trim() || (settings.useGoogleCalendarColors ? (cal.color || '').trim() : '');
		if (role === 'secondary') {
			const auto = SECONDARY_PALETTE[secondaryIndex++ % SECONDARY_PALETTE.length];
			if (!color) color = auto;
		} else if (!color) {
			color = role === 'other_person'
				? (settings.otherPersonCalendarColor || '').trim() || OTHER_PERSON_COLOR
				: (settings.primaryCalendarColor || '').trim() || accent;
		}
		byId.set(cal.id, {
			id: cal.id,
			name: conf?.summary || cal.name,
			role,
			color,
			ownerName: conf?.ownerName
		});
	}
	const order: Record<string, number> = { primary: 0, secondary: 1, other_person: 2, ignore: 3 };
	return calendars
		.map(c => byId.get(c.id))
		.filter((e): e is CalendarLegendEntry => Boolean(e))
		.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, 'fr'));
}

export function formatEventTime(ev: GoogleCalendarEvent, day: string): { label: string; continues: boolean } {
	if (ev.allDay || !ev.start?.dateTime) return { label: 'Journée', continues: false };
	const start = localParts(ev.start.dateTime);
	if (start.date < day) return { label: '↳', continues: true };
	return { label: start.time, continues: false };
}

export function formatEventRange(ev: GoogleCalendarEvent): string {
	if (ev.allDay || !ev.start?.dateTime) {
		const span = eventDaySpan(ev);
		if (!span || span.first === span.last) return 'Toute la journée';
		return `Du ${CalendarDate.format(span.first, { day: 'numeric', month: 'short' })} au ${CalendarDate.format(span.last, { day: 'numeric', month: 'short' })}`;
	}
	const s = localParts(ev.start.dateTime);
	if (!ev.end?.dateTime) return s.time;
	const e = localParts(ev.end.dateTime);
	return e.date === s.date ? `${s.time} – ${e.time}` : `${s.time} → ${CalendarDate.format(e.date, { day: 'numeric', month: 'short' })} ${e.time}`;
}
