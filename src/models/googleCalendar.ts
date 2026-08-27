export interface GoogleCalendarEvent {
	id: string;
	summary: string;
	description?: string;
	location?: string;
	start: {
		dateTime?: string; // ISO 8601
		date?: string; // YYYY-MM-DD for all-day events
		timeZone?: string;
	};
	end: {
		dateTime?: string;
		date?: string;
		timeZone?: string;
	};
	allDay: boolean;
	status?: 'confirmed' | 'tentative' | 'cancelled' | string;
	htmlLink?: string;
	calendarId: string;
	calendarName?: string;
	colorId?: string;
	backgroundColor?: string;
	attendees?: Array<{
		email: string;
		displayName?: string;
		responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
		self?: boolean;
	}>;
	recurrence?: string[];
}

export interface GoogleCalendarListEntry {
	id: string;
	summary: string;
	description?: string;
	primary?: boolean;
	backgroundColor?: string;
	foregroundColor?: string;
	selected?: boolean;
	timeZone?: string;
}

export interface GoogleCalendarSettings {
	googleCalendarEnabled: boolean;
	googleClientId: string;
	googleClientSecret: string;
	googleRefreshToken: string;
	selectedCalendarIds: string[];
	defaultCalendarId?: string;
	autoSyncGoogleCalendar: boolean;
	syncIntervalMinutes: number;
}

export const DEFAULT_GOOGLE_CALENDAR_SETTINGS: GoogleCalendarSettings = {
	googleCalendarEnabled: false,
	googleClientId: '',
	googleClientSecret: '',
	googleRefreshToken: '',
	selectedCalendarIds: ['primary'],
	defaultCalendarId: 'primary',
	autoSyncGoogleCalendar: true,
	syncIntervalMinutes: 15
};

export type CalendarViewType = 'day' | 'week' | 'schedule';
