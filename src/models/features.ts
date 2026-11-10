/* ==========================================================================
   Grandes fonctionnalités activables : calendrier, IA, briefings, gamification
   ========================================================================== */

export type FeatureKey = 'calendar' | 'ai' | 'briefings' | 'gamification';

/** Réglages d'activation. Absent ou `true` : la fonctionnalité est active (comportement d'origine). */
export interface FeatureSettings {
	featureCalendarEnabled: boolean;
	featureAiEnabled: boolean;
	featureBriefingsEnabled: boolean;
	featureGamificationEnabled: boolean;
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
	featureCalendarEnabled: true,
	featureAiEnabled: true,
	featureBriefingsEnabled: true,
	featureGamificationEnabled: true
};

export interface FeatureDefinition {
	key: FeatureKey;
	/** Clé du réglage correspondant */
	setting: keyof FeatureSettings;
	name: string;
	icon: string;
	desc: string;
	/** Ce qui disparaît quand la fonctionnalité est désactivée (affiché dans les réglages) */
	includes: string;
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
	{
		key: 'calendar',
		setting: 'featureCalendarEnabled',
		name: 'Calendrier',
		icon: 'calendar-days',
		desc: 'Calendrier unifié (tâches, entrées des notes quotidiennes, Google Agenda) et import des rendez-vous.',
		includes: 'Vues Calendrier et Agenda Google, entrées horodatées, filtres et préréglages, import des RDV.'
	},
	{
		key: 'ai',
		setting: 'featureAiEnabled',
		name: 'Intelligence artificielle',
		icon: 'bot',
		desc: 'Assistant, prompts de l’éditeur et actions IA sur les notes.',
		includes: 'Vue Assistant IA, commandes d’édition IA, menu contextuel des prompts, propositions de rangement.'
	},
	{
		key: 'briefings',
		setting: 'featureBriefingsEnabled',
		name: 'Briefings & revues',
		icon: 'sun',
		desc: 'Briefing du matin, revue du soir et reprise après une pause.',
		includes: 'Vues Briefing du matin, Revue du soir et Reprise.'
	},
	{
		key: 'gamification',
		setting: 'featureGamificationEnabled',
		name: 'Gamification',
		icon: 'coins',
		desc: 'Pièces gagnées en terminant des tâches, séries, trophées et boutique de récompenses.',
		includes: 'Vue Gamification & trophées, pièces dans la barre d’état, séries, trophées et boutique.'
	}
];

export function isFeatureEnabled(settings: Partial<FeatureSettings> | undefined, key: FeatureKey): boolean {
	const def = FEATURE_DEFINITIONS.find(f => f.key === key);
	if (!def) return true;
	// Seul un `false` explicite désactive : les coffres existants gardent tout.
	return settings?.[def.setting] !== false;
}

export function featureDefinition(key: FeatureKey): FeatureDefinition {
	const def = FEATURE_DEFINITIONS.find(f => f.key === key);
	if (!def) throw new Error(`Fonctionnalité inconnue : ${key}`);
	return def;
}
