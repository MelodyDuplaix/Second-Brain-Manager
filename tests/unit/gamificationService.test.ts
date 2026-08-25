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

	const createEmptyPluginData = (): PluginData => ({
		wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
		rewards: [],
		completionEvents: {},
		streak: { currentStreak: 0, longestStreak: 0 },
		badges: {},
		workflowCounts: {
			morningBriefings: 0,
			eveningReviews: 0,
			recoveries: 0,
			notesMovedOrCleaned: 0
		}
	});

	it('should priority explicit #pieces/N tag over auto rules', () => {
		const coins = GamificationService.calculateCoins(baseTask, 'task-matrix');
		expect(coins).toBe(5);
	});

	it('should process completion idempotently without double counting and unlock first_task badge', () => {
		const data = createEmptyPluginData();

		const res1 = GamificationService.processCompletion(baseTask, data, 'task-matrix');
		expect(res1.rewardGranted).toBe(true);
		expect(res1.coinsEarned).toBe(5);
		expect(res1.newBalance).toBe(5);
		expect(res1.newlyUnlockedBadges.map(b => b.id)).toContain('first_task');
		expect(data.badges['first_task'].unlockedAt).toBeDefined();

		// Re-processing same task should be ignored
		const res2 = GamificationService.processCompletion(baseTask, data, 'task-matrix');
		expect(res2.rewardGranted).toBe(false);
		expect(res2.coinsEarned).toBe(0);
		expect(res2.newBalance).toBe(5);
	});

	it('should revoke completion and refund coins on missclick cancellation', () => {
		const data = createEmptyPluginData();

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
		const data = createEmptyPluginData();

		GamificationService.processCompletion(baseTask, data, 'task-matrix');

		const todayCoins = GamificationService.getTodayCoins(data);
		expect(todayCoins).toBe(5);

		const categories = GamificationService.getCoinsByCategory(data);
		expect(categories['#dev']).toBe(5);
	});

	describe('Streak (Séries de jours)', () => {
		it('should start streak at 1 on first completion', () => {
			const streak = { currentStreak: 0, longestStreak: 0 };
			const res = GamificationService.updateStreak(streak, '2026-08-25');

			expect(res.streakIncreased).toBe(true);
			expect(streak.currentStreak).toBe(1);
			expect(streak.longestStreak).toBe(1);
			expect(streak.lastCompletionDate).toBe('2026-08-25');
		});

		it('should increment streak when completion happens the next day', () => {
			const streak = { currentStreak: 2, longestStreak: 2, lastCompletionDate: '2026-08-24' };
			const res = GamificationService.updateStreak(streak, '2026-08-25');

			expect(res.streakIncreased).toBe(true);
			expect(streak.currentStreak).toBe(3);
			expect(streak.longestStreak).toBe(3);
			expect(streak.lastCompletionDate).toBe('2026-08-25');
		});

		it('should not increment streak twice on the same day', () => {
			const streak = { currentStreak: 3, longestStreak: 3, lastCompletionDate: '2026-08-25' };
			const res = GamificationService.updateStreak(streak, '2026-08-25');

			expect(res.streakIncreased).toBe(false);
			expect(streak.currentStreak).toBe(3);
			expect(streak.longestStreak).toBe(3);
		});

		it('should reset streak to 1 if more than one day is missed', () => {
			const streak = { currentStreak: 5, longestStreak: 5, lastCompletionDate: '2026-08-20' };
			const res = GamificationService.updateStreak(streak, '2026-08-25');

			expect(res.streakIncreased).toBe(false);
			expect(streak.currentStreak).toBe(1);
			expect(streak.longestStreak).toBe(5); // Le record historique est préservé
			expect(streak.lastCompletionDate).toBe('2026-08-25');
		});
	});

	describe('Badges & Trophées', () => {
		it('should unlock streak_3 badge when reaching 3 days streak', () => {
			const data = createEmptyPluginData();
			data.streak.currentStreak = 3;
			data.streak.longestStreak = 3;

			const unlocked = GamificationService.checkAndUnlockBadges(data);
			expect(unlocked.map(b => b.id)).toContain('streak_3');
			expect(data.badges['streak_3'].unlockedAt).toBeDefined();
		});

		it('should unlock workflow badges on recording events', () => {
			const data = createEmptyPluginData();

			// 5 briefings
			for (let i = 0; i < 4; i++) {
				GamificationService.recordWorkflowEvent(data, 'morning_briefing');
			}
			expect(data.badges['briefing_regular']?.unlockedAt).toBeUndefined();

			const lastUnlocked = GamificationService.recordWorkflowEvent(data, 'morning_briefing');
			expect(lastUnlocked.map(b => b.id)).toContain('briefing_regular');
			expect(data.badges['briefing_regular'].unlockedAt).toBeDefined();

			// 1 recovery
			const recoveryUnlocked = GamificationService.recordWorkflowEvent(data, 'recovery');
			expect(recoveryUnlocked.map(b => b.id)).toContain('soft_landing');
			expect(data.badges['soft_landing'].unlockedAt).toBeDefined();
		});
	});
});
