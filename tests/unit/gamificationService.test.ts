import { describe, it, expect } from 'vitest';
import { GamificationService, PluginData } from '../../src/services/gamificationService';
import { ObsidianTask } from '../../src/models/task';

describe('GamificationService', () => {
	const baseTask: ObsidianTask = {
		rawText: '- [x] Dev test #pieces/5 #dev',
		cleanText: 'Dev test #pieces/5 #dev',
		title: 'Dev test',
		completed: true,
		statusChar: 'x',
		status: 'done',
		filePath: '01 - Projets/Test.md',
		lineNumber: 5,
		indentLevel: 0,
		pieces: 5,
		domainTags: ['#dev'],
		blockId: 'task-test',
		subtasks: []
	};

	it('should priority explicit #pieces/N tag over auto rules', () => {
		const coins = GamificationService.calculateCoins(baseTask, 'task-matrix');
		expect(coins).toBe(5);
	});

	it('should process completion idempotently without double counting', () => {
		const data: PluginData = {
			wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
			rewards: [],
			completionEvents: {}
		};

		const res1 = GamificationService.processCompletion(baseTask, data, 'task-matrix');
		expect(res1.rewardGranted).toBe(true);
		expect(res1.coinsEarned).toBe(5);
		expect(res1.newBalance).toBe(5);

		// Re-processing same task should be ignored
		const res2 = GamificationService.processCompletion(baseTask, data, 'task-matrix');
		expect(res2.rewardGranted).toBe(false);
		expect(res2.coinsEarned).toBe(0);
		expect(res2.newBalance).toBe(5);
	});

	it('should revoke completion and refund coins on missclick cancellation', () => {
		const data: PluginData = {
			wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
			rewards: [],
			completionEvents: {}
		};

		GamificationService.processCompletion(baseTask, data, 'task-matrix');
		expect(data.wallet.balance).toBe(5);

		const taskId = GamificationService.getStableTaskId(baseTask);
		const revokeRes = GamificationService.removeCompletion(taskId, data);

		expect(revokeRes.success).toBe(true);
		expect(revokeRes.deductedCoins).toBe(5);
		expect(revokeRes.newBalance).toBe(0);
		expect(data.wallet.balance).toBe(0);
		expect(data.completionEvents[taskId]).toBeUndefined();
	});

	it('should aggregate today coins and category breakdown', () => {
		const data: PluginData = {
			wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
			rewards: [],
			completionEvents: {}
		};

		GamificationService.processCompletion(baseTask, data, 'task-matrix');

		const todayCoins = GamificationService.getTodayCoins(data);
		expect(todayCoins).toBe(5);

		const categories = GamificationService.getCoinsByCategory(data);
		expect(categories['#dev']).toBe(5);
	});
});
