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
