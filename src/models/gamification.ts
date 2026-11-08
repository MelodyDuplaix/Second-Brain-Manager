import { MatrixFeature } from '../adapters/matrixAdapter';

export interface Wallet {
	balance: number;
	lifetimeEarned: number;
	lifetimeSpent: number;
}

export interface Reward {
	id: string;
	name: string;
	description: string;
	cost: number;
	enabled: boolean;
}

export interface RewardPurchase {
	id: string;
	rewardId: string;
	rewardName: string;
	cost: number;
	purchasedAt: string;
}

export interface CompletionEvent {
	taskId: string;
	completedAt: string;
	coins: number;
	taskText: string;
	categoryTags?: string[];
	quadrant?: string;
	fromSync?: boolean;
	/** Date de complétion inscrite dans la tâche (✅ AAAA-MM-JJ), si présente */
	doneDate?: string;
	/** Énergie, difficulté et priorité de la tâche au moment où elle a été cochée */
	energy?: number;
	difficulty?: string;
	priority?: string;
}

export interface CoinRules {
	defaultCoins: number;
	quadrantBonus: {
		q1: number;
		q2: number;
		q3: number;
		q4: number;
	};
	difficultyBonus: {
		facile: number;
		moyenne: number;
		difficile: number;
	};
}

export const DEFAULT_COIN_RULES: CoinRules = {
	defaultCoins: 1,
	quadrantBonus: {
		q1: 4,
		q2: 2,
		q3: 1,
		q4: 0,
	},
	difficultyBonus: {
		facile: 0,
		moyenne: 1,
		difficile: 3,
	},
};

export interface StreakData {
	currentStreak: number;
	longestStreak: number;
	lastCompletionDate?: string; // YYYY-MM-DD
}

export type BadgeCategory = 'tasks' | 'streak' | 'habits' | 'variety' | 'effort' | 'matrix' | 'coins' | 'shop' | 'inbox' | 'workflow';

export interface BadgeDefinition {
	id: string;
	name: string;
	description: string;
	icon: string;
	category: BadgeCategory;
	maxProgress: number;
}

export interface UserBadge {
	id: string;
	unlockedAt?: string; // Date ISO de déblocage
	progress: number;
}

export interface WorkflowCounts {
	morningBriefings: number;
	eveningReviews: number;
	recoveries: number;
	notesMovedOrCleaned: number;
}

/** Libellés et ordre d'affichage des familles de trophées. */
export const BADGE_CATEGORY_LABELS: Array<{ id: BadgeCategory; label: string }> = [
	{ id: 'tasks', label: 'Accomplissement' },
	{ id: 'streak', label: 'Régularité' },
	{ id: 'habits', label: 'Habitudes' },
	{ id: 'effort', label: 'Effort & priorités' },
	{ id: 'variety', label: 'Diversité' },
	{ id: 'matrix', label: 'Matrice d’Eisenhower' },
	{ id: 'coins', label: 'Pièces' },
	{ id: 'shop', label: 'Récompenses' },
	{ id: 'inbox', label: 'Rangement' },
	{ id: 'workflow', label: 'Rituels' }
];

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
	// --- Accomplissement
	{ id: 'first_task', name: 'Premier Pas', description: 'Compléter votre première tâche dans votre Second Cerveau', icon: 'check-circle-2', category: 'tasks', maxProgress: 1 },
	{ id: 'tasks_10', name: 'Lancée', description: 'Compléter 10 tâches', icon: 'list-checks', category: 'tasks', maxProgress: 10 },
	{ id: 'tasks_50', name: 'Machine à cocher', description: 'Compléter 50 tâches', icon: 'check-check', category: 'tasks', maxProgress: 50 },
	{ id: 'tasks_100', name: 'Centurion', description: 'Compléter 100 tâches', icon: 'shield-check', category: 'tasks', maxProgress: 100 },
	{ id: 'tasks_250', name: 'Inarrêtable', description: 'Compléter 250 tâches', icon: 'rocket', category: 'tasks', maxProgress: 250 },
	{ id: 'tasks_500', name: 'Légende vivante', description: 'Compléter 500 tâches', icon: 'crown', category: 'tasks', maxProgress: 500 },
	{ id: 'productive_day', name: 'Journée productive', description: 'Compléter 5 tâches dans la même journée', icon: 'sparkles', category: 'tasks', maxProgress: 5 },
	{ id: 'marathon_day', name: 'Marathon', description: 'Compléter 10 tâches dans la même journée', icon: 'trophy', category: 'tasks', maxProgress: 10 },

	// --- Régularité
	{ id: 'streak_3', name: 'Étincelle de Régularité', description: 'Maintenir une série active de 3 jours consécutifs', icon: 'zap', category: 'streak', maxProgress: 3 },
	{ id: 'streak_7', name: 'Habitude Solide', description: 'Maintenir une série active de 7 jours consécutifs', icon: 'calendar-check', category: 'streak', maxProgress: 7 },
	{ id: 'streak_14', name: 'Deux semaines de feu', description: 'Maintenir une série active de 14 jours consécutifs', icon: 'flame', category: 'streak', maxProgress: 14 },
	{ id: 'streak_30', name: 'Légende du Second Cerveau', description: 'Maintenir une série active de 30 jours consécutifs', icon: 'award', category: 'streak', maxProgress: 30 },
	{ id: 'streak_60', name: 'Discipline de fer', description: 'Maintenir une série active de 60 jours consécutifs', icon: 'medal', category: 'streak', maxProgress: 60 },
	{ id: 'streak_100', name: 'Centenaire', description: 'Maintenir une série active de 100 jours consécutifs', icon: 'star', category: 'streak', maxProgress: 100 },
	{ id: 'active_days_30', name: 'Assiduité', description: 'Compléter au moins une tâche sur 30 journées différentes', icon: 'calendar-days', category: 'streak', maxProgress: 30 },

	// --- Habitudes
	{ id: 'early_bird', name: 'Lève-tôt', description: 'Compléter 10 tâches avant 9 h', icon: 'sunrise', category: 'habits', maxProgress: 10 },
	{ id: 'night_owl', name: 'Oiseau de nuit', description: 'Compléter 10 tâches après 22 h', icon: 'moon-star', category: 'habits', maxProgress: 10 },
	{ id: 'weekend_warrior', name: 'Guerrier du week-end', description: 'Compléter 15 tâches un samedi ou un dimanche', icon: 'swords', category: 'habits', maxProgress: 15 },

	// --- Effort & priorités
	{ id: 'hard_worker', name: 'Montagne gravie', description: 'Compléter 10 tâches de difficulté « difficile »', icon: 'mountain', category: 'effort', maxProgress: 10 },
	{ id: 'big_effort', name: 'Grand effort', description: 'Compléter 5 tâches demandant une énergie de 8 ou plus', icon: 'dumbbell', category: 'effort', maxProgress: 5 },
	{ id: 'low_energy_hero', name: 'Petits pas', description: 'Compléter 10 tâches légères (énergie 3 ou moins), même les jours sans élan', icon: 'feather', category: 'effort', maxProgress: 10 },
	{ id: 'top_priority', name: 'Priorité absolue', description: 'Compléter 10 tâches de priorité haute ou maximale', icon: 'flag', category: 'effort', maxProgress: 10 },
	{ id: 'big_bounty', name: 'Gros lot', description: 'Compléter une tâche qui rapporte au moins 10 pièces', icon: 'gem', category: 'effort', maxProgress: 1 },

	// --- Diversité
	{ id: 'explorer', name: 'Explorateur', description: 'Compléter des tâches dans 5 catégories (tags) différentes', icon: 'map', category: 'variety', maxProgress: 5 },
	{ id: 'polymath', name: 'Touche-à-tout', description: 'Compléter des tâches dans 15 catégories (tags) différentes', icon: 'library', category: 'variety', maxProgress: 15 },

	// --- Matrice d'Eisenhower (affichés seulement si les quadrants sont activés)
	{ id: 'focus_q1', name: 'Maître du Focus (Q1)', description: 'Compléter 10 tâches urgentes et importantes du Quadrant 1', icon: 'flame', category: 'matrix', maxProgress: 10 },
	{ id: 'vision_q2', name: 'Vision Stratégique (Q2)', description: 'Compléter 10 tâches de fond et de planification du Quadrant 2', icon: 'compass', category: 'matrix', maxProgress: 10 },
	{ id: 'q1_master', name: 'Pompier d’élite', description: 'Compléter 50 tâches du Quadrant 1', icon: 'siren', category: 'matrix', maxProgress: 50 },
	{ id: 'q2_master', name: 'Architecte du long terme', description: 'Compléter 50 tâches du Quadrant 2', icon: 'drafting-compass', category: 'matrix', maxProgress: 50 },
	{ id: 'all_quadrants', name: 'Équilibre', description: 'Compléter au moins une tâche dans chacun des 4 quadrants', icon: 'grid-2x2', category: 'matrix', maxProgress: 4 },

	// --- Pièces
	{ id: 'coins_50', name: 'Tirelire Bien Remplie', description: 'Gagner un total cumulé de 50 pièces', icon: 'coins', category: 'coins', maxProgress: 50 },
	{ id: 'coins_200', name: 'Trésorier du Coffre', description: 'Gagner un total cumulé de 200 pièces', icon: 'gem', category: 'coins', maxProgress: 200 },
	{ id: 'coins_500', name: 'Fortune', description: 'Gagner un total cumulé de 500 pièces', icon: 'landmark', category: 'coins', maxProgress: 500 },
	{ id: 'coins_1000', name: 'Mécène', description: 'Gagner un total cumulé de 1 000 pièces', icon: 'piggy-bank', category: 'coins', maxProgress: 1000 },

	// --- Récompenses
	{ id: 'first_reward', name: 'Bien mérité', description: 'Échanger vos pièces contre une première récompense', icon: 'gift', category: 'shop', maxProgress: 1 },
	{ id: 'rewards_10', name: 'Bon vivant', description: 'Échanger 10 récompenses', icon: 'party-popper', category: 'shop', maxProgress: 10 },
	{ id: 'spender_200', name: 'Croqueur de pièces', description: 'Dépenser un total de 200 pièces en récompenses', icon: 'shopping-bag', category: 'shop', maxProgress: 200 },

	// --- Rangement
	{ id: 'inbox_cleaner', name: 'Grand Nettoyeur', description: 'Ranger ou déplacer 5 notes vers leurs dossiers respectifs', icon: 'folder-archive', category: 'inbox', maxProgress: 5 },
	{ id: 'inbox_master', name: 'Maître du rangement', description: 'Ranger ou déplacer 25 notes vers leurs dossiers respectifs', icon: 'archive', category: 'inbox', maxProgress: 25 },

	// --- Rituels
	{ id: 'briefing_regular', name: 'Éveil Stratégique', description: 'Enregistrer 5 briefings du matin dans votre Daily Note', icon: 'sun', category: 'workflow', maxProgress: 5 },
	{ id: 'briefing_30', name: 'Stratège du matin', description: 'Enregistrer 30 briefings du matin', icon: 'sun-medium', category: 'workflow', maxProgress: 30 },
	{ id: 'evening_peace', name: 'Sérénité du Soir', description: 'Enregistrer 5 revues du soir pour libérer votre charge mentale', icon: 'moon', category: 'workflow', maxProgress: 5 },
	{ id: 'evening_30', name: 'Maître du soir', description: 'Enregistrer 30 revues du soir', icon: 'sunset', category: 'workflow', maxProgress: 30 },
	{ id: 'soft_landing', name: 'Soft Landing', description: 'Réaliser avec succès une reprise sereine après une pause', icon: 'coffee', category: 'workflow', maxProgress: 1 },
	{ id: 'phoenix', name: 'Phénix', description: 'Reprendre 5 fois après une pause', icon: 'bird', category: 'workflow', maxProgress: 5 }
];

/** Trophées actifs : ceux de la matrice sont masqués quand les quadrants sont désactivés. */
export function getActiveBadgeDefinitions(): BadgeDefinition[] {
	return MatrixFeature.isEnabled() ? BADGE_DEFINITIONS : BADGE_DEFINITIONS.filter(b => b.category !== 'matrix');
}
