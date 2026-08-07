import { ObsidianTask } from '../models/task';
import { Wallet, Reward, CompletionEvent, CoinRules, DEFAULT_COIN_RULES } from '../models/gamification';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';

export interface PluginData {
	wallet: Wallet;
	rewards: Reward[];
	completionEvents: Record<string, CompletionEvent>;
}

export class GamificationService {
	public static calculateCoins(task: ObsidianTask, matrixProvider: string, rules: CoinRules = DEFAULT_COIN_RULES): number {
		if (task.pieces !== undefined) {
			return task.pieces;
		}

		let coins = rules.defaultCoins;

		const matrixAdapter = MatrixAdapterFactory.createAdapter(matrixProvider);
		const quadrant = matrixAdapter.getQuadrant(task);
		if (quadrant && rules.quadrantBonus[quadrant]) {
			coins += rules.quadrantBonus[quadrant];
		}

		if (task.difficulty) {
			const diff = task.difficulty.toLowerCase();
			if (diff === 'facile') coins += rules.difficultyBonus.facile;
			else if (diff === 'moyenne') coins += rules.difficultyBonus.moyenne;
			else if (diff === 'difficile') coins += rules.difficultyBonus.difficile;
		}

		return coins;
	}

	public static getStableTaskId(task: ObsidianTask): string {
		if (task.blockId) {
			return `${task.filePath}::^${task.blockId}`;
		}
		return `${task.filePath}::L${task.lineNumber}::${task.title}`;
	}

	public static processCompletion(
		task: ObsidianTask,
		data: PluginData,
		matrixProvider: string,
		rules: CoinRules = DEFAULT_COIN_RULES
	): { rewardGranted: boolean; coinsEarned: number; newBalance: number } {
		const taskId = this.getStableTaskId(task);

		if (data.completionEvents[taskId]) {
			return { rewardGranted: false, coinsEarned: 0, newBalance: data.wallet.balance };
		}

		const coinsEarned = this.calculateCoins(task, matrixProvider, rules);
		data.wallet.balance += coinsEarned;
		data.wallet.lifetimeEarned += coinsEarned;

		data.completionEvents[taskId] = {
			taskId,
			completedAt: new Date().toISOString(),
			coins: coinsEarned,
			taskText: task.cleanText,
			categoryTags: task.domainTags
		};

		return {
			rewardGranted: true,
			coinsEarned,
			newBalance: data.wallet.balance
		};
	}

	public static removeCompletion(
		taskId: string,
		data: PluginData
	): { success: boolean; deductedCoins: number; newBalance: number } {
		const event = data.completionEvents[taskId];
		if (!event) {
			return { success: false, deductedCoins: 0, newBalance: data.wallet.balance };
		}

		const deductedCoins = event.coins;
		data.wallet.balance = Math.max(0, data.wallet.balance - deductedCoins);
		data.wallet.lifetimeEarned = Math.max(0, data.wallet.lifetimeEarned - deductedCoins);
		delete data.completionEvents[taskId];

		return {
			success: true,
			deductedCoins,
			newBalance: data.wallet.balance
		};
	}

	public static getTodayCoins(data: PluginData, todayDateStr?: string): number {
		const targetDate = todayDateStr || new Date().toISOString().split('T')[0];
		let total = 0;

		Object.values(data.completionEvents).forEach(event => {
			if (event.completedAt && event.completedAt.startsWith(targetDate)) {
				total += event.coins;
			}
		});

		return total;
	}

	public static getCoinsByCategory(data: PluginData, todayOnly = false): Record<string, number> {
		const categories: Record<string, number> = {};
		const todayDateStr = new Date().toISOString().split('T')[0];

		Object.values(data.completionEvents).forEach(event => {
			if (todayOnly && (!event.completedAt || !event.completedAt.startsWith(todayDateStr))) {
				return;
			}

			const tags = event.categoryTags && event.categoryTags.length > 0 ? event.categoryTags : ['#général'];
			tags.forEach(tag => {
				categories[tag] = (categories[tag] || 0) + event.coins;
			});
		});

		return categories;
	}

	public static getDailyTrend(data: PluginData, days = 7): { date: string; coins: number }[] {
		const trend: { date: string; coins: number }[] = [];
		const now = new Date();

		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			const dateStr = d.toISOString().split('T')[0];

			let coinsForDay = 0;
			Object.values(data.completionEvents).forEach(event => {
				if (event.completedAt && event.completedAt.startsWith(dateStr)) {
					coinsForDay += event.coins;
				}
			});

			trend.push({ date: dateStr, coins: coinsForDay });
		}

		return trend;
	}
}
