/* ==========================================================================
   Grandes fonctionnalités activables : calendrier, IA, briefings, gamification, tâches données
   ========================================================================== */

export type FeatureKey = 'calendar' | 'ai' | 'briefings' | 'gamification' | 'delegated';

/**
 * Réglages d'activation. Absent : valeur par défaut de la fonctionnalité
 * (active pour les fonctionnalités d'origine, inactive pour les options comme les tâches données).
 */
export interface FeatureSettings {
	featureCalendarEnabled: boolean;
	featureAiEnabled: boolean;
	featureBriefingsEnabled: boolean;
	featureGamificationEnabled: boolean;
	featureDelegatedTasksEnabled: boolean;
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
	featureCalendarEnabled: true,
	featureAiEnabled: true,
	featureBriefingsEnabled: true,
	featureGamificationEnabled: true,
	featureDelegatedTasksEnabled: false
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
	/** Activée tant que l'utilisateur ne l'a pas réglée (défaut : oui) */
	defaultEnabled?: boolean;
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
	},
	{
		key: 'delegated',
		setting: 'featureDelegatedTasksEnabled',
		name: 'Personnes dans les tâches (@nom)',
		icon: 'user-check',
		desc: 'Mentionnez une personne dans une tâche : « Relire le devis @Antoine ». Au choix (réglage dans Tâches) : tâche attribuée à cette personne et retirée de vos tâches, tâche qu’elle vous a donnée, ou simple contexte. Le jeton (@ par défaut) est personnalisable.',
		includes: 'Badge de la personne dans le calendrier, filtre par personne, menu d’attribution, prise en compte dans les briefings, le tableau de bord et les pièces.',
		defaultEnabled: false
	}
];

export function isFeatureEnabled(settings: Partial<FeatureSettings> | undefined, key: FeatureKey): boolean {
	const def = FEATURE_DEFINITIONS.find(f => f.key === key);
	if (!def) return true;
	// Un réglage explicite l'emporte ; sinon la valeur par défaut de la fonctionnalité
	// (les coffres existants gardent tout ce qu'ils avaient, les options restent coupées).
	const value = settings?.[def.setting];
	if (typeof value === 'boolean') return value;
	return def.defaultEnabled !== false;
}

export function featureDefinition(key: FeatureKey): FeatureDefinition {
	const def = FEATURE_DEFINITIONS.find(f => f.key === key);
	if (!def) throw new Error(`Fonctionnalité inconnue : ${key}`);
	return def;
}
