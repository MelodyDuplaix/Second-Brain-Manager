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

export interface BadgeDefinition {
	id: string;
	name: string;
	description: string;
	icon: string;
	category: 'streak' | 'tasks' | 'matrix' | 'inbox' | 'workflow' | 'coins';
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

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
	{
		id: 'first_task',
		name: 'Premier Pas',
		description: 'Compléter votre première tâche dans votre Second Cerveau',
		icon: 'check-circle-2',
		category: 'tasks',
		maxProgress: 1
	},
	{
		id: 'focus_q1',
		name: 'Maître du Focus (Q1)',
		description: 'Compléter 10 tâches urgentes et importantes du Quadrant 1',
		icon: 'flame',
		category: 'matrix',
		maxProgress: 10
	},
	{
		id: 'vision_q2',
		name: 'Vision Stratégique (Q2)',
		description: 'Compléter 10 tâches de fond et de planification du Quadrant 2',
		icon: 'compass',
		category: 'matrix',
		maxProgress: 10
	},
	{
		id: 'streak_3',
		name: 'Étincelle de Régularité',
		description: 'Maintenir une série active de 3 jours consécutifs',
		icon: 'zap',
		category: 'streak',
		maxProgress: 3
	},
	{
		id: 'streak_7',
		name: 'Habitude Solide',
		description: 'Maintenir une série active de 7 jours consécutifs',
		icon: 'calendar-check',
		category: 'streak',
		maxProgress: 7
	},
	{
		id: 'streak_30',
		name: 'Légende du Second Cerveau',
		description: 'Maintenir une série active de 30 jours consécutifs',
		icon: 'award',
		category: 'streak',
		maxProgress: 30
	},
	{
		id: 'coins_50',
		name: 'Tirelire Bien Remplie',
		description: 'Gagner un total cumulé de 50 pièces',
		icon: 'coins',
		category: 'coins',
		maxProgress: 50
	},
	{
		id: 'coins_200',
		name: 'Trésorier du Coffre',
		description: 'Gagner un total cumulé de 200 pièces',
		icon: 'gem',
		category: 'coins',
		maxProgress: 200
	},
	{
		id: 'inbox_cleaner',
		name: 'Grand Nettoyeur',
		description: 'Ranger ou déplacer 5 notes vers leurs dossiers respectifs',
		icon: 'folder-archive',
		category: 'inbox',
		maxProgress: 5
	},
	{
		id: 'briefing_regular',
		name: 'Éveil Stratégique',
		description: 'Enregistrer 5 briefings du matin dans votre Daily Note',
		icon: 'sun',
		category: 'workflow',
		maxProgress: 5
	},
	{
		id: 'evening_peace',
		name: 'Sérénité du Soir',
		description: 'Enregistrer 5 revues du soir pour libérer votre charge mentale',
		icon: 'moon',
		category: 'workflow',
		maxProgress: 5
	},
	{
		id: 'soft_landing',
		name: 'Soft Landing',
		description: 'Réaliser avec succès une reprise sereine après une pause',
		icon: 'coffee',
		category: 'workflow',
		maxProgress: 1
	}
];
