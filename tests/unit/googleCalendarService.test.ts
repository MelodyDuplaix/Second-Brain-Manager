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
		expect(formatted).toContain('Lieu : Salle 3 / Meet');
		expect(formatted).toContain('Anniversaire Marc');
		expect(formatted).toContain('Toute la journée');
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
