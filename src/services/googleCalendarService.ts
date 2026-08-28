import { Notice, Platform } from 'obsidian';
import { GoogleCalendarEvent, GoogleCalendarListEntry, GoogleCalendarSettings, CalendarRole, CalendarConfig } from '../models/googleCalendar';
import SecondBrainPlugin from '../main';

const PORT = 42813;
const REDIRECT_URL = `http://127.0.0.1:${PORT}/callback`;

interface AuthSession {
	server: any;
	verifier: string | null;
	challenge: string | null;
	state: string | null;
}

export class GoogleCalendarService {
	private static cachedAccessToken: string | null = null;
	private static tokenExpiresAt = 0;
	private static authSession: AuthSession = {
		server: null,
		verifier: null,
		challenge: null,
		state: null
	};

	private static generateState(): string {
		return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
	}

	private static async generateVerifier(): Promise<string> {
		const array = new Uint32Array(56);
		await window.crypto.getRandomValues(array);
		return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
	}

	private static async generateChallenge(verifier: string): Promise<string> {
		const data = new TextEncoder().encode(verifier);
		const hash = await window.crypto.subtle.digest('SHA-256', data);
		return btoa(String.fromCharCode(...new Uint8Array(hash)))
			.replace(/=/g, '')
			.replace(/\+/g, '-')
			.replace(/\//g, '_');
	}

	/**
	 * Lance le processus d'authentification OAuth2 Google en démarrant un serveur local éphémère (port 42813)
	 * et en ouvrant la page d'approbation et consentement Google dans le navigateur.
	 */
	public static async startGoogleLogin(
		plugin: SecondBrainPlugin,
		onComplete?: (success: boolean) => void
	): Promise<void> {
		const clientId = plugin.settings.googleClientId?.trim();
		const clientSecret = plugin.settings.googleClientSecret?.trim();

		if (!clientId || !clientSecret) {
			new Notice('Veuillez renseigner votre Client ID et Client Secret Google avant de lancer l\'approbation.');
			if (onComplete) onComplete(false);
			return;
		}

		if (!Platform.isDesktop) {
			new Notice('L\'approbation OAuth2 via serveur local n\'est disponible que sur ordinateur (Desktop).');
			if (onComplete) onComplete(false);
			return;
		}

		this.authSession.state = this.generateState();
		this.authSession.verifier = await this.generateVerifier();
		this.authSession.challenge = await this.generateChallenge(this.authSession.verifier);

		const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
			+ `?client_id=${encodeURIComponent(clientId)}`
			+ `&response_type=code`
			+ `&redirect_uri=${encodeURIComponent(REDIRECT_URL)}`
			+ `&prompt=consent`
			+ `&access_type=offline`
			+ `&state=${this.authSession.state}`
			+ `&code_challenge=${this.authSession.challenge}`
			+ `&code_challenge_method=S256`
			+ `&scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events')}`;

		// Si un serveur précédent tourne encore, on le ferme d'abord
		if (this.authSession.server) {
			try {
				this.authSession.server.close();
			} catch {
				// ignore
			}
			this.authSession.server = null;
		}

		let http: any;
		let url: any;
		try {
			http = require('http');
			url = require('url');
		} catch {
			new Notice('Impossible d\'initialiser le module HTTP Node.js requis pour l\'authentification locale.');
			if (onComplete) onComplete(false);
			return;
		}

		this.authSession.server = http.createServer(async (req: any, res: any) => {
			try {
				if (!req.url || req.url.indexOf('/callback') < 0) return;

				const qs = new url.URL(req.url, `http://127.0.0.1:${PORT}`).searchParams;
				const code = qs.get('code');
				const receivedState = qs.get('state');

				if (receivedState !== this.authSession.state || !code) {
					res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end('<h1>Erreur d\'authentification</h1><p>État de sécurité invalide ou code manquant.</p>');
					if (onComplete) onComplete(false);
					return;
				}

				// Échange du code contre les jetons auprès de Google
				const tokenResponse = await window.fetch('https://oauth2.googleapis.com/token', {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						client_id: clientId,
						client_secret: clientSecret,
						code_verifier: this.authSession.verifier || '',
						code: code,
						redirect_uri: REDIRECT_URL
					})
				});

				const tokenData = await tokenResponse.json();

				if (tokenData && (tokenData.refresh_token || tokenData.access_token)) {
					if (tokenData.refresh_token) {
						plugin.settings.googleRefreshToken = tokenData.refresh_token;
					}
					plugin.settings.googleCalendarEnabled = true;
					this.cachedAccessToken = tokenData.access_token;
					this.tokenExpiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
					await plugin.saveSettings();

					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end(`
						<!DOCTYPE html>
						<html>
						<head>
							<meta charset="utf-8">
							<title>Second Brain Manager - Connexion Google Réussie</title>
							<style>
								body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 50px 20px; background: #0f172a; color: #f8fafc; }
								.box { max-width: 500px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
								h1 { color: #22c55e; margin-bottom: 12px; }
								p { color: #94a3b8; font-size: 1.05em; line-height: 1.5; }
							</style>
						</head>
						<body>
							<div class="box">
								<h1>🎉 Connexion Réussie !</h1>
								<p>Votre compte Google Calendar est maintenant connecté à <strong>Second Brain Manager</strong>.</p>
								<p>Vous pouvez fermer cet onglet et retourner dans Obsidian.</p>
							</div>
						</body>
						</html>
					`);

					new Notice('✅ Connexion à Google Calendar réussie !');
					if (onComplete) onComplete(true);
				} else {
					const errMsg = tokenData.error_description || tokenData.error || 'Aucun jeton reçu de Google';
					res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
					res.end(`<h1>Échec de connexion</h1><p>${errMsg}</p>`);
					new Notice(`❌ Échec de la connexion Google : ${errMsg}`);
					if (onComplete) onComplete(false);
				}
			} catch (err: unknown) {
				const errMsg = err instanceof Error ? err.message : String(err);
				new Notice(`Erreur lors de l'authentification : ${errMsg}`);
				if (onComplete) onComplete(false);
			} finally {
				if (this.authSession.server) {
					try {
						this.authSession.server.close();
					} catch {
						// ignore
					}
					this.authSession.server = null;
				}
				this.authSession.verifier = null;
				this.authSession.challenge = null;
				this.authSession.state = null;
			}
		});

		this.authSession.server.listen(PORT, '127.0.0.1', () => {
			window.open(authUrl);
		});

		this.authSession.server.on('error', (err: any) => {
			new Notice(`Impossible d'ouvrir le port local ${PORT} pour la connexion (${err.message || err}).`);
			if (onComplete) onComplete(false);
		});
	}

	/**
	 * Déconnecte le compte Google Calendar.
	 */
	public static async logoutGoogle(plugin: SecondBrainPlugin): Promise<void> {
		plugin.settings.googleRefreshToken = '';
		plugin.settings.googleCalendarEnabled = false;
		this.cachedAccessToken = null;
		this.tokenExpiresAt = 0;
		await plugin.saveSettings();
		new Notice('Compte Google Calendar déconnecté.');
	}

	/**
	 * Obtient un jeton d'accès (Access Token) valide en utilisant le Refresh Token configuré.
	 */
	public static async getValidAccessToken(settings: GoogleCalendarSettings): Promise<string> {
		const now = Date.now();
		if (this.cachedAccessToken && this.tokenExpiresAt > now + 60000) {
			return this.cachedAccessToken;
		}

		if (!settings.googleRefreshToken) {
			throw new Error('Aucun Refresh Token Google Calendar. Veuillez vous connecter dans les paramètres du plugin.');
		}

		if (!settings.googleClientId || !settings.googleClientSecret) {
			throw new Error('Client ID et Client Secret manquants dans les paramètres.');
		}

		const res = await window.fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: settings.googleClientId.trim(),
				client_secret: settings.googleClientSecret.trim(),
				refresh_token: settings.googleRefreshToken.trim(),
				grant_type: 'refresh_token'
			})
		});

		if (!res.ok) {
			const errBody = await res.text();
			throw new Error(`Échec du rafraîchissement du jeton Google (${res.status}): ${errBody}`);
		}

		const json = await res.json();
		this.cachedAccessToken = json.access_token;
		this.tokenExpiresAt = now + (json.expires_in || 3600) * 1000;
		return this.cachedAccessToken!;
	}

	/**
	 * Récupère la liste de tous les calendriers accessibles par l'utilisateur.
	 */
	public static async listCalendars(settings: GoogleCalendarSettings): Promise<GoogleCalendarListEntry[]> {
		const token = await this.getValidAccessToken(settings);
		const res = await window.fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
			headers: { Authorization: `Bearer ${token}` }
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`Erreur récupération calendriers (${res.status}): ${err}`);
		}

		const json = await res.json();
		const items: any[] = json.items || [];
		return items.map((item) => ({
			id: item.id,
			summary: item.summary,
			description: item.description,
			primary: !!item.primary,
			backgroundColor: item.backgroundColor,
			foregroundColor: item.foregroundColor,
			selected: !!item.selected,
			timeZone: item.timeZone
		}));
	}

	/**
	 * Récupère ou recherche les événements de l'agenda Google selon de multiples critères.
	 */
	public static async getEvents(
		settings: GoogleCalendarSettings,
		options: {
			timeMin?: string; // ISO string
			timeMax?: string; // ISO string
			calendarIds?: string[];
			query?: string;
			location?: string;
			attendee?: string;
			includePast?: boolean;
			maxResults?: number;
		} = {}
	): Promise<GoogleCalendarEvent[]> {
		const token = await this.getValidAccessToken(settings);

		// Période par défaut : du début de la journée actuelle à +7 jours si non spécifiée
		let timeMin = options.timeMin;
		if (!timeMin) {
			if (options.includePast) {
				const past = new Date();
				past.setDate(past.getDate() - 30);
				past.setHours(0, 0, 0, 0);
				timeMin = past.toISOString();
			} else {
				const startOfDay = new Date();
				startOfDay.setHours(0, 0, 0, 0);
				timeMin = startOfDay.toISOString();
			}
		}

		let timeMax = options.timeMax;
		if (!timeMax && !options.query) {
			const endOfPeriod = new Date();
			endOfPeriod.setDate(endOfPeriod.getDate() + 30);
			endOfPeriod.setHours(23, 59, 59, 999);
			timeMax = endOfPeriod.toISOString();
		}

		let targetCalendars = options.calendarIds || [];
		if (targetCalendars.includes('all')) {
			try {
				const allCals = await this.listCalendars(settings);
				targetCalendars = allCals.map(c => c.id);
			} catch {
				targetCalendars = ['primary'];
			}
		} else if (targetCalendars.length === 0) {
			const configuredCalIds = Object.keys(settings.calendarsConfig || {});
			if (configuredCalIds.length > 0) {
				targetCalendars = configuredCalIds;
			} else if (settings.selectedCalendarIds && settings.selectedCalendarIds.length > 0) {
				if (settings.selectedCalendarIds.includes('all')) {
					try {
						const allCals = await this.listCalendars(settings);
						targetCalendars = allCals.map(c => c.id);
					} catch {
						targetCalendars = [settings.defaultCalendarId || 'primary'];
					}
				} else {
					targetCalendars = settings.selectedCalendarIds;
				}
			} else {
				targetCalendars = [settings.defaultCalendarId || 'primary'];
			}
		}

		// Filtrer les calendriers configurés comme 'ignore' (ne pas requêter)
		if (settings.calendarsConfig) {
			targetCalendars = targetCalendars.filter(calId => {
				const conf = settings.calendarsConfig?.[calId];
				return conf ? conf.role !== 'ignore' : true;
			});
		}
		if (targetCalendars.length === 0) {
			targetCalendars = [settings.defaultCalendarId || 'primary'];
		}

		const allEvents: GoogleCalendarEvent[] = [];

		await Promise.all(
			targetCalendars.map(async (calId) => {
				try {
					const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`);
					if (timeMin) url.searchParams.set('timeMin', timeMin);
					if (timeMax) url.searchParams.set('timeMax', timeMax);
					url.searchParams.set('singleEvents', 'true');
					url.searchParams.set('orderBy', 'startTime');
					if (options.query) url.searchParams.set('q', options.query);
					if (options.maxResults) url.searchParams.set('maxResults', options.maxResults.toString());

					const res = await window.fetch(url.toString(), {
						headers: { Authorization: `Bearer ${token}` }
					});

					if (!res.ok) return;

					const json = await res.json();
					const calName = json.summary || calId;
					const items: any[] = json.items || [];

					for (const item of items) {
						const isAllDay = !!(item.start?.date && !item.start?.dateTime);
						const ev: GoogleCalendarEvent = {
							id: item.id,
							summary: item.summary || '(Sans titre)',
							description: item.description,
							location: item.location,
							start: {
								dateTime: item.start?.dateTime,
								date: item.start?.date,
								timeZone: item.start?.timeZone
							},
							end: {
								dateTime: item.end?.dateTime,
								date: item.end?.date,
								timeZone: item.end?.timeZone
							},
							allDay: isAllDay,
							status: item.status,
							htmlLink: item.htmlLink,
							calendarId: calId,
							calendarName: calName,
							colorId: item.colorId,
							attendees: item.attendees?.map((a: any) => ({
								email: a.email,
								displayName: a.displayName,
								responseStatus: a.responseStatus,
								self: !!a.self
							})),
							recurrence: item.recurrence
						};

						// Filtres locaux complémentaires (Lieu, Participant, etc.)
						if (options.location && options.location.trim()) {
							const locQuery = options.location.trim().toLowerCase();
							if (!ev.location || !ev.location.toLowerCase().includes(locQuery)) {
								continue;
							}
						}

						if (options.attendee && options.attendee.trim()) {
							const attQuery = options.attendee.trim().toLowerCase();
							const hasMatch = ev.attendees?.some(a =>
								(a.email && a.email.toLowerCase().includes(attQuery)) ||
								(a.displayName && a.displayName.toLowerCase().includes(attQuery))
							);
							if (!hasMatch) continue;
						}

						allEvents.push(ev);
					}
				} catch (calErr) {
					console.warn(`[Second Brain Manager] Erreur lecture calendrier ${calId}:`, calErr);
				}
			})
		);

		// Tri chronologique global
		return allEvents.sort((a, b) => {
			const timeA = a.start.dateTime || a.start.date || '';
			const timeB = b.start.dateTime || b.start.date || '';
			return timeA.localeCompare(timeB);
		});
	}

	/**
	 * Crée un nouvel événement dans un calendrier Google.
	 */
	public static async createEvent(
		settings: GoogleCalendarSettings,
		event: {
			summary: string;
			description?: string;
			location?: string;
			startDate: string; // YYYY-MM-DD
			startTime?: string; // HH:mm
			endDate?: string; // YYYY-MM-DD
			endTime?: string; // HH:mm
			calendarId?: string;
		}
	): Promise<GoogleCalendarEvent> {
		const token = await this.getValidAccessToken(settings);
		const targetCalId = event.calendarId || settings.defaultCalendarId || 'primary';

		const isAllDay = !event.startTime;
		let startBody: any;
		let endBody: any;

		if (isAllDay) {
			startBody = { date: event.startDate };
			endBody = { date: event.endDate || event.startDate };
		} else {
			const startIso = new Date(`${event.startDate}T${event.startTime}:00`).toISOString();
			const endDateStr = event.endDate || event.startDate;
			const endTimeStr = event.endTime || this.addOneHour(event.startTime!);
			const endIso = new Date(`${endDateStr}T${endTimeStr}:00`).toISOString();
			startBody = { dateTime: startIso };
			endBody = { dateTime: endIso };
		}

		const requestBody: any = {
			summary: event.summary,
			start: startBody,
			end: endBody
		};
		if (event.description) requestBody.description = event.description;
		if (event.location) requestBody.location = event.location;

		const res = await window.fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestBody)
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`Erreur création événement (${res.status}): ${err}`);
		}

		const json = await res.json();
		return {
			id: json.id,
			summary: json.summary,
			description: json.description,
			location: json.location,
			start: json.start,
			end: json.end,
			allDay: isAllDay,
			calendarId: targetCalId,
			htmlLink: json.htmlLink
		};
	}

	/**
	 * Met à jour un événement existant dans Google Calendar.
	 */
	public static async updateEvent(
		settings: GoogleCalendarSettings,
		eventId: string,
		updates: {
			summary?: string;
			description?: string;
			location?: string;
			startDate?: string;
			startTime?: string;
			endDate?: string;
			endTime?: string;
			calendarId?: string;
		}
	): Promise<GoogleCalendarEvent> {
		const token = await this.getValidAccessToken(settings);
		const targetCalId = updates.calendarId || settings.defaultCalendarId || 'primary';

		const requestBody: any = {};
		if (updates.summary !== undefined) requestBody.summary = updates.summary;
		if (updates.description !== undefined) requestBody.description = updates.description;
		if (updates.location !== undefined) requestBody.location = updates.location;

		if (updates.startDate) {
			if (updates.startTime) {
				const startIso = new Date(`${updates.startDate}T${updates.startTime}:00`).toISOString();
				const endDateStr = updates.endDate || updates.startDate;
				const endTimeStr = updates.endTime || this.addOneHour(updates.startTime);
				const endIso = new Date(`${endDateStr}T${endTimeStr}:00`).toISOString();
				requestBody.start = { dateTime: startIso };
				requestBody.end = { dateTime: endIso };
			} else {
				requestBody.start = { date: updates.startDate };
				requestBody.end = { date: updates.endDate || updates.startDate };
			}
		}

		const res = await window.fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events/${encodeURIComponent(eventId)}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(requestBody)
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`Erreur modification événement (${res.status}): ${err}`);
		}

		const json = await res.json();
		return {
			id: json.id,
			summary: json.summary,
			description: json.description,
			location: json.location,
			start: json.start,
			end: json.end,
			allDay: !!(json.start?.date && !json.start?.dateTime),
			calendarId: targetCalId,
			htmlLink: json.htmlLink
		};
	}

	/**
	 * Supprime un événement de Google Calendar.
	 */
	public static async deleteEvent(
		settings: GoogleCalendarSettings,
		eventId: string,
		calendarId?: string
	): Promise<boolean> {
		const token = await this.getValidAccessToken(settings);
		const targetCalId = calendarId || settings.defaultCalendarId || 'primary';

		const res = await window.fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events/${encodeURIComponent(eventId)}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});

		return res.ok || res.status === 404;
	}

	/**
	 * Formate la liste des événements pour les injecter dans les prompts du LLM (Briefing, Chat, etc.)
	 * en séparant DISTINCTEMENT selon les rôles définis pour chaque calendrier :
	 * - 1. Calendrier Principal (Mon agenda de référence - Contraintes directes)
	 * - 2. Calendriers Secondaires (Mes événements personnels flexibles)
	 * - 3. Calendriers d'autres personnes (Consultatifs avec nom de la personne)
	 */
	public static formatEventsForPrompt(
		events: GoogleCalendarEvent[],
		targetDateStr?: string,
		settings?: GoogleCalendarSettings | string
	): string {
		if (!events || events.length === 0) {
			return 'Aucun événement prévu à l\'agenda.';
		}

		let defaultCalId = 'primary';
		let calendarsConfig: Record<string, CalendarConfig> = {};
		if (typeof settings === 'string') {
			defaultCalId = settings;
		} else if (settings) {
			defaultCalId = settings.defaultCalendarId || 'primary';
			calendarsConfig = settings.calendarsConfig || {};
		}

		// Filtre sur la date cible (gère les événements simples, multi-jours et toute la journée)
		const relevantEvents = events.filter(ev => {
			if (!targetDateStr) return true;
			return GoogleCalendarService.isEventOnDate(ev, targetDateStr);
		});

		if (relevantEvents.length === 0) {
			return 'Aucun événement prévu pour cette date.';
		}

		const getEventRole = (ev: GoogleCalendarEvent): { role: CalendarRole; ownerName?: string } => {
			const calId = ev.calendarId;
			if (calId && calendarsConfig[calId]) {
				const conf = calendarsConfig[calId];
				return { role: conf.role, ownerName: conf.ownerName };
			}
			// Fallback automatique
			if (calId === defaultCalId || (!calId && defaultCalId === 'primary') || (defaultCalId === 'primary' && ev.calendarName?.toLowerCase().includes('principal'))) {
				return { role: 'primary' };
			}
			return { role: 'other_person' };
		};

		const primaryEvents: GoogleCalendarEvent[] = [];
		const secondaryEvents: GoogleCalendarEvent[] = [];
		const otherPersonEvents: Array<{ event: GoogleCalendarEvent; ownerName?: string }> = [];

		for (const ev of relevantEvents) {
			const { role, ownerName } = getEventRole(ev);
			if (role === 'ignore') {
				continue;
			} else if (role === 'primary') {
				primaryEvents.push(ev);
			} else if (role === 'secondary') {
				secondaryEvents.push(ev);
			} else {
				otherPersonEvents.push({ event: ev, ownerName });
			}
		}

		const formatEventLine = (ev: GoogleCalendarEvent, prefix: string): string => {
			const startDateTime = ev.start?.dateTime;
			const endDateTime = ev.end?.dateTime;
			const startDate = ev.start?.date || (startDateTime ? startDateTime.split('T')[0] : '');
			const endDate = ev.end?.date || (endDateTime ? endDateTime.split('T')[0] : '');

			let timeStr = 'Toute la journée';
			const isMultiDay = (startDate && endDate && startDate !== endDate && (!ev.start?.date || !ev.end?.date || ev.end.date > ev.start.date));

			if (startDateTime && endDateTime) {
				const startTime = new Date(startDateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
				const endTime = new Date(endDateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
				if (startDate === endDate) {
					timeStr = `${startTime} - ${endTime}`;
				} else {
					timeStr = `${startDate} ${startTime} au ${endDate} ${endTime}`;
				}
			} else if (isMultiDay && startDate && endDate) {
				timeStr = `Multi-jours (du ${startDate} au ${endDate})`;
			}

			let entry = `- ${prefix} ${timeStr} : **${ev.summary}**`;
			if (ev.location) entry += ` (Lieu : ${ev.location})`;
			if (ev.description) {
				const shortDesc = ev.description.replace(/\n+/g, ' ').slice(0, 120);
				entry += ` [Détails : "${shortDesc}"]`;
			}
			if (ev.attendees && ev.attendees.length > 0) {
				const attNames = ev.attendees.map(a => a.displayName || a.email).join(', ');
				entry += ` [Participants : ${attNames}]`;
			}
			return entry;
		};

		const sections: string[] = [];

		// Section 1: Mon Agenda Principal de Référence
		const primaryRefName = primaryEvents[0]?.calendarName || 'Mon Agenda Principal';
		if (primaryEvents.length > 0) {
			sections.push(
				`### 👤 1. Mon Agenda Principal (${primaryRefName}) :\n` +
				`*(Rendez-vous personnels prioritaires & contraintes de temps fermes)*\n` +
				primaryEvents.map(ev => formatEventLine(ev, '⭐ [RDV PRINCIPAL]')).join('\n')
			);
		} else {
			sections.push(
				`### 👤 1. Mon Agenda Principal (${primaryRefName}) :\n` +
				`Aucun événement prévu pour cette date.`
			);
		}

		// Section 2: Mes Agendas Secondaires (si présents)
		if (secondaryEvents.length > 0) {
			const byCal = new Map<string, GoogleCalendarEvent[]>();
			secondaryEvents.forEach(ev => {
				const name = ev.calendarName || ev.calendarId || 'Agenda secondaire';
				if (!byCal.has(name)) byCal.set(name, []);
				byCal.get(name)!.push(ev);
			});

			const calBlocks: string[] = [];
			byCal.forEach((evList, calName) => {
				calBlocks.push(`👉 **Agenda : "${calName}"**\n` + evList.map(ev => formatEventLine(ev, '🎯 [ÉVÉNEMENT SECONDAIRE]')).join('\n'));
			});

			sections.push(
				`### 🎯 2. Mes Agendas Secondaires :\n` +
				calBlocks.join('\n\n')
			);
		}

		// Section 3: Agendas d'Autres Personnes (si présents)
		if (otherPersonEvents.length > 0) {
			const byPerson = new Map<string, GoogleCalendarEvent[]>();
			otherPersonEvents.forEach(({ event, ownerName }) => {
				const calName = event.calendarName || event.calendarId || 'Autre agenda';
				const key = ownerName ? `${ownerName} (Agenda: "${calName}")` : `"${calName}"`;
				if (!byPerson.has(key)) byPerson.set(key, []);
				byPerson.get(key)!.push(event);
			});

			const personBlocks: string[] = [];
			byPerson.forEach((evList, personKey) => {
				personBlocks.push(`👉 **Agenda de ${personKey}** :\n` + evList.map(ev => formatEventLine(ev, `👥 [AGENDA TIERS : ${ev.calendarName || 'Autre'}]`)).join('\n'));
			});

			sections.push(
				`### 👥 3. Agendas Partagés / Proches :\n` +
				`*(Ces événements appartiennent à des proches ou collègues. Mentionne-les sobrement à titre informatif sans lourdeur, et ne les compte pas dans le temps de travail de l'utilisateur)*\n` +
				personBlocks.join('\n\n')
			);
		}

		return sections.join('\n\n');
	}

	/**
	 * Vérifie si un événement Google Calendar est actif / a lieu sur une date cible (YYYY-MM-DD),
	 * gérant les événements sur un seul jour, multi-jours (date ou dateTime) et toute la journée.
	 */
	public static isEventOnDate(ev: GoogleCalendarEvent, targetDateStr: string): boolean {
		const startDateTime = ev.start?.dateTime;
		const startDate = ev.start?.date || (startDateTime ? startDateTime.split('T')[0] : '');
		const endDateTime = ev.end?.dateTime;
		let endDate = ev.end?.date || (endDateTime ? endDateTime.split('T')[0] : '');

		if (!startDate) return false;
		if (!endDate) endDate = startDate;

		// Si l'événement démarre après la date cible, il n'est pas encore actif
		if (startDate > targetDateStr) return false;

		// Pour les événements avec heures précises (dateTime) :
		if (endDateTime) {
			const endD = endDateTime.split('T')[0];
			const endT = endDateTime.split('T')[1]?.slice(0, 5) || '23:59';
			if (endD === targetDateStr && (endT === '00:00' || endT === '00:00:00')) {
				return startDate === targetDateStr;
			}
			return targetDateStr <= endD;
		}

		// Pour les événements toute la journée / multi-jours
		return targetDateStr <= endDate;
	}

	private static addOneHour(timeStr: string): string {
		const [h, m] = timeStr.split(':').map(Number);
		const newH = (h + 1) % 24;
		return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}
}
