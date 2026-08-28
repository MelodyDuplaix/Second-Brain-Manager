import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleCalendarService } from '../../src/services/googleCalendarService';
import { GoogleCalendarSettings, DEFAULT_GOOGLE_CALENDAR_SETTINGS } from '../../src/models/googleCalendar';

describe('GoogleCalendarService', () => {
	const mockSettings: GoogleCalendarSettings = {
		...DEFAULT_GOOGLE_CALENDAR_SETTINGS,
		googleCalendarEnabled: true,
		googleClientId: 'test-client-id',
		googleClientSecret: 'test-client-secret',
		googleRefreshToken: 'test-refresh-token'
	};

	beforeEach(() => {
		vi.restoreAllMocks();
		(GoogleCalendarService as any).cachedAccessToken = null;
		(GoogleCalendarService as any).tokenExpiresAt = 0;
	});

	it('should format events for LLM prompts with time, title, and location', () => {
		const events = [
			{
				id: 'ev1',
				summary: 'Réunion d\'équipe',
				location: 'Salle 3 / Meet',
				start: { dateTime: '2026-08-27T09:00:00.000Z' },
				end: { dateTime: '2026-08-27T10:00:00.000Z' },
				allDay: false,
				calendarId: 'primary'
			},
			{
				id: 'ev2',
				summary: 'Anniversaire Marc',
				start: { date: '2026-08-27' },
				end: { date: '2026-08-27' },
				allDay: true,
				calendarId: 'primary'
			}
		];

		const formatted = GoogleCalendarService.formatEventsForPrompt(events, '2026-08-27');
		expect(formatted).toContain('Réunion d\'équipe');
		expect(formatted).toContain('RDV PRINCIPAL');
		expect(formatted).toContain('Lieu : Salle 3 / Meet');
		expect(formatted).toContain('Anniversaire Marc');
		expect(formatted).toContain('Toute la journée');
		expect(formatted).toContain('1. Mon Agenda Principal');
	});

	it('should clearly separate primary, secondary, and other person calendars with custom names', () => {
		const events = [
			{
				id: 'ev1',
				summary: 'Rendez-vous Client',
				start: { dateTime: '2026-08-28T10:00:00.000Z' },
				end: { dateTime: '2026-08-28T11:00:00.000Z' },
				calendarId: 'primary',
				calendarName: 'Mon Agenda Pro'
			},
			{
				id: 'ev2',
				summary: 'Entraînement Tennis',
				start: { dateTime: '2026-08-28T18:00:00.000Z' },
				end: { dateTime: '2026-08-28T19:30:00.000Z' },
				calendarId: 'perso-sports@group.calendar.google.com',
				calendarName: 'Sports & Loisirs'
			},
			{
				id: 'ev3',
				summary: 'Dentiste de Sophie',
				start: { dateTime: '2026-08-28T10:00:00.000Z' },
				end: { dateTime: '2026-08-28T11:00:00.000Z' },
				calendarId: 'sophie@gmail.com',
				calendarName: 'Agenda Sophie'
			},
			{
				id: 'ev4',
				summary: 'Anniversaire masqué',
				start: { dateTime: '2026-08-28T00:00:00.000Z' },
				calendarId: 'ignore-cal@group.calendar.google.com',
				calendarName: 'Fêtes diverses'
			}
		];

		const settings = {
			defaultCalendarId: 'primary',
			calendarsConfig: {
				'primary': { id: 'primary', role: 'primary' as const },
				'perso-sports@group.calendar.google.com': { id: 'perso-sports@group.calendar.google.com', role: 'secondary' as const },
				'sophie@gmail.com': { id: 'sophie@gmail.com', role: 'other_person' as const, ownerName: 'Sophie (conjointe)' },
				'ignore-cal@group.calendar.google.com': { id: 'ignore-cal@group.calendar.google.com', role: 'ignore' as const }
			}
		} as any;

		const formatted = GoogleCalendarService.formatEventsForPrompt(events, '2026-08-28', settings);
		expect(formatted).toContain('1. Mon Agenda Principal');
		expect(formatted).toContain('Rendez-vous Client');
		expect(formatted).toContain('2. Mes Agendas Secondaires');
		expect(formatted).toContain('Entraînement Tennis');
		expect(formatted).toContain('3. Agendas Partagés / Proches');
		expect(formatted).toContain('Sophie (conjointe)');
		expect(formatted).toContain('Dentiste de Sophie');
		expect(formatted).not.toContain('Anniversaire masqué');
	});

	it('should correctly include multi-day events that span the target date', () => {
		const multiDayEvent = {
			id: 'ev-multiday',
			summary: 'Séminaire Formation IA',
			start: { date: '2026-08-24' },
			end: { date: '2026-08-28' },
			allDay: true,
			calendarId: 'primary',
			calendarName: 'Principal'
		};

		expect(GoogleCalendarService.isEventOnDate(multiDayEvent, '2026-08-24')).toBe(true);
		expect(GoogleCalendarService.isEventOnDate(multiDayEvent, '2026-08-28')).toBe(true);
		expect(GoogleCalendarService.isEventOnDate(multiDayEvent, '2026-08-29')).toBe(false);
		expect(GoogleCalendarService.isEventOnDate(multiDayEvent, '2026-08-30')).toBe(false);

		const formatted = GoogleCalendarService.formatEventsForPrompt([multiDayEvent], '2026-08-28');
		expect(formatted).toContain('Séminaire Formation IA');
		expect(formatted).toContain('Multi-jours');
	});

	it('should list calendars using Google Calendar API', async () => {
		const mockFetch = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: 'mock-token', expires_in: 3600 })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{ id: 'primary', summary: 'Mon Agenda', primary: true },
						{ id: 'cal2@group.calendar.google.com', summary: 'Équipe Projet', primary: false }
					]
				})
			});
		vi.stubGlobal('fetch', mockFetch);

		const cals = await GoogleCalendarService.listCalendars(mockSettings);
		expect(cals.length).toBe(2);
		expect(cals[0].id).toBe('primary');
		expect(cals[0].primary).toBe(true);
		expect(cals[1].summary).toBe('Équipe Projet');
	});

	it('should use defaultCalendarId when creating events if no specific calendar is specified', async () => {
		const customSettings: GoogleCalendarSettings = {
			...mockSettings,
			defaultCalendarId: 'work-calendar-id'
		};

		const mockFetch = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: 'mock-token', expires_in: 3600 })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					id: 'created-ev-1',
					summary: 'Entretien Pro',
					start: { dateTime: '2026-08-28T14:00:00Z' },
					end: { dateTime: '2026-08-28T15:00:00Z' }
				})
			});
		vi.stubGlobal('fetch', mockFetch);

		const created = await GoogleCalendarService.createEvent(customSettings, {
			summary: 'Entretien Pro',
			startDate: '2026-08-28',
			startTime: '14:00',
			endTime: '15:00'
		});

		expect(created.id).toBe('created-ev-1');
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('calendars/work-calendar-id/events'),
			expect.any(Object)
		);
	});

	it('should skip calendars configured with role ignore when fetching events', async () => {
		const customSettings: GoogleCalendarSettings = {
			...mockSettings,
			selectedCalendarIds: ['cal-active', 'cal-ignored'],
			calendarsConfig: {
				'cal-active': { id: 'cal-active', role: 'primary' },
				'cal-ignored': { id: 'cal-ignored', role: 'ignore' }
			}
		};

		const mockFetch = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: 'mock-token', expires_in: 3600 })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					summary: 'Cal Active',
					items: [{ id: 'ev-active', summary: 'Active Event', start: { dateTime: '2026-08-28T10:00:00Z' }, end: { dateTime: '2026-08-28T11:00:00Z' } }]
				})
			});
		vi.stubGlobal('fetch', mockFetch);

		const events = await GoogleCalendarService.getEvents(customSettings);
		expect(events.length).toBe(1);
		expect(events[0].id).toBe('ev-active');
		expect(mockFetch).not.toHaveBeenCalledWith(
			expect.stringContaining('cal-ignored'),
			expect.any(Object)
		);
	});

	it('should return fallback message if no events found', () => {
		const formatted = GoogleCalendarService.formatEventsForPrompt([], '2026-08-27');
		expect(formatted).toBe('Aucun événement prévu à l\'agenda.');
	});

	it('should refresh access token using direct OAuth endpoint when clientId/secret provided', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ access_token: 'mock-access-token', expires_in: 3600 })
		});
		vi.stubGlobal('fetch', mockFetch);

		const token = await GoogleCalendarService.getValidAccessToken(mockSettings);
		expect(token).toBe('mock-access-token');
		expect(mockFetch).toHaveBeenCalledWith(
			'https://oauth2.googleapis.com/token',
			expect.objectContaining({
				method: 'POST'
			})
		);
	});

	it('should fetch events and parse Google Calendar v3 response', async () => {
		const mockFetch = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: 'mock-token', expires_in: 3600 })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					summary: 'Personnel',
					items: [
						{
							id: '123',
							summary: 'RDV Médical',
							start: { dateTime: '2026-08-27T14:30:00+02:00' },
							end: { dateTime: '2026-08-27T15:30:00+02:00' },
							location: 'Cabinet Médical'
						}
					]
				})
			});
		vi.stubGlobal('fetch', mockFetch);

		const events = await GoogleCalendarService.getEvents(mockSettings, {
			timeMin: '2026-08-27T00:00:00.000Z',
			timeMax: '2026-08-27T23:59:59.999Z'
		});

		expect(events.length).toBe(1);
		expect(events[0].summary).toBe('RDV Médical');
		expect(events[0].location).toBe('Cabinet Médical');
		expect(events[0].allDay).toBe(false);
	});

	it('should clear token on logoutGoogle', async () => {
		const mockPlugin: any = {
			settings: {
				googleRefreshToken: 'token-to-clear',
				googleCalendarEnabled: true
			},
			saveSettings: vi.fn().mockResolvedValue(undefined)
		};

		(GoogleCalendarService as any).cachedAccessToken = 'cached-token';
		await GoogleCalendarService.logoutGoogle(mockPlugin);

		expect(mockPlugin.settings.googleRefreshToken).toBe('');
		expect(mockPlugin.settings.googleCalendarEnabled).toBe(false);
		expect((GoogleCalendarService as any).cachedAccessToken).toBeNull();
		expect(mockPlugin.saveSettings).toHaveBeenCalled();
	});

	it('should filter events by location and attendee', async () => {
		const mockFetch = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: 'mock-token', expires_in: 3600 })
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					summary: 'Personnel',
					items: [
						{
							id: '1',
							summary: 'Session Coaching',
							location: 'Paris Bureau',
							start: { dateTime: '2026-08-28T10:00:00Z' },
							end: { dateTime: '2026-08-28T11:00:00Z' },
							attendees: [{ email: 'coach@example.com', displayName: 'Coach Pro' }]
						},
						{
							id: '2',
							summary: 'Webinaire',
							location: 'Zoom',
							start: { dateTime: '2026-08-28T14:00:00Z' },
							end: { dateTime: '2026-08-28T15:00:00Z' },
							attendees: [{ email: 'other@example.com' }]
						}
					]
				})
			});
		vi.stubGlobal('fetch', mockFetch);

		const locResults = await GoogleCalendarService.getEvents(mockSettings, { location: 'paris' });
		expect(locResults.length).toBe(1);
		expect(locResults[0].summary).toBe('Session Coaching');
	});
});
