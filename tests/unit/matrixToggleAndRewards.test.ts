import { describe, it, expect, afterEach } from 'vitest';
import { MatrixFeature, MatrixAdapterFactory, TaskMatrixAdapter } from '../../src/adapters/matrixAdapter';
import { TaskParser } from '../../src/parsers/taskParser';
import { TaskMutator } from '../../src/mutators/taskMutator';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';
import { GamificationService, PluginData } from '../../src/services/gamificationService';
import { getActiveBadgeDefinitions, BADGE_DEFINITIONS, CompletionEvent } from '../../src/models/gamification';
import { ToolRegistry } from '../../src/services/toolRegistry';

const parse = (line: string) => TaskParser.parseLine(line, 'a.md', 1, DEFAULT_SYNTAX_CONFIG)!;

function freshData(): PluginData {
	return {
		wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
		rewards: [
			{ id: 'jeu', name: '30 min de jeu', description: '', cost: 20, enabled: true },
			{ id: 'off', name: 'Désactivée', description: '', cost: 1, enabled: false }
		],
		completionEvents: {},
		streak: { currentStreak: 0, longestStreak: 0 },
		badges: {},
		workflowCounts: { morningBriefings: 0, eveningReviews: 0, recoveries: 0, notesMovedOrCleaned: 0 }
	};
}

afterEach(() => MatrixFeature.setEnabled(true));

describe('quadrants désactivables', () => {
	it('keeps the indentation of subtasks when changing the quadrant', () => {
		const adapter = new TaskMatrixAdapter();
		expect(adapter.setQuadrant('\t- [ ] Sous-tâche #tm/q3 ^abc', 'q1')).toBe('\t- [ ] Sous-tâche #tm/q1 ^abc');
		expect(adapter.setQuadrant('  - [ ] Sous-tâche #tm/q2', null)).toBe('  - [ ] Sous-tâche');
		expect(adapter.formatTag('q2')).toBe('#tm/q2');
	});

	it('ignores quadrants everywhere when disabled', () => {
		MatrixFeature.setEnabled(false);
		const task = parse('- [ ] Rapport #tm/q1 #difficulte/difficile');
		expect(task.matrixTag).toBeUndefined();
		const adapter = MatrixAdapterFactory.createAdapter('task-matrix');
		expect(adapter.getQuadrant(parse('- [ ] X #tm/q1'))).toBeNull();
		expect(adapter.setQuadrant('- [ ] X', 'q1')).toBe('- [ ] X');
		// Pièces : plus de bonus de quadrant (1 de base + 3 pour « difficile »)
		expect(GamificationService.calculateCoins(task, 'task-matrix')).toBe(4);
		MatrixFeature.setEnabled(true);
		expect(GamificationService.calculateCoins(parse('- [ ] Rapport #tm/q1 #difficulte/difficile'), 'task-matrix')).toBe(8);
	});

	it('removes quadrant guidance from the AI', () => {
		MatrixFeature.setEnabled(false);
		const syntax = TaskMutator.getTaskSyntaxPromptDescription(DEFAULT_SYNTAX_CONFIG);
		expect(syntax).not.toMatch(/#tm\/q1|Matrice :/);
		const props = ToolRegistry.getToolDefinitions().flatMap(t => Object.keys(t.parameters.properties || {}));
		expect(props).not.toContain('matrixQuadrant');
		expect(props).not.toContain('newMatrixQuadrant');
		expect(props).not.toContain('quadrant');
		expect(TaskMutator.formatTaskLine('Appeler', { matrixQuadrant: 'q1' }, DEFAULT_SYNTAX_CONFIG)).not.toContain('q1');
		MatrixFeature.setEnabled(true);
		expect(TaskMutator.getTaskSyntaxPromptDescription(DEFAULT_SYNTAX_CONFIG)).toMatch(/Matrice :/);
	});

	it('hides matrix trophies when disabled', () => {
		const matrixCount = BADGE_DEFINITIONS.filter(b => b.category === 'matrix').length;
		expect(matrixCount).toBeGreaterThan(0);
		MatrixFeature.setEnabled(false);
		expect(getActiveBadgeDefinitions()).toHaveLength(BADGE_DEFINITIONS.length - matrixCount);
		const data = freshData();
		GamificationService.checkAndUnlockBadges(data);
		expect(Object.keys(data.badges).some(id => id.includes('q1') || id.includes('q2'))).toBe(false);
	});
});

describe('nouveaux trophées', () => {
	it('has unique badge ids', () => {
		const ids = BADGE_DEFINITIONS.map(b => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('computes day, time, effort and variety progress', () => {
		const data = freshData();
		const at = (h: number, day = 9) => new Date(2026, 10, day, h, 0).toISOString(); // lundi 9 nov.
		const ev = (id: string, completedAt: string, extra: Partial<CompletionEvent> = {}): CompletionEvent =>
			({ taskId: id, completedAt, coins: 1, taskText: id, ...extra });
		data.completionEvents = {
			a: ev('a', at(7), { energy: 2, categoryTags: ['#maison'] }),
			b: ev('b', at(8), { energy: 9, difficulty: 'difficile', categoryTags: ['#travail', '#tm/q1'] }),
			c: ev('c', at(23), { priority: 'highest', coins: 12, categoryTags: ['#santé'] }),
			d: ev('d', at(12, 14), { categoryTags: ['#maison'] }) // samedi
		};
		const p = GamificationService.computeBadgeProgress(data);
		expect(p.productive_day).toBe(3);
		expect(p.active_days_30).toBe(2);
		expect(p.early_bird).toBe(2);
		expect(p.night_owl).toBe(1);
		expect(p.weekend_warrior).toBe(1);
		expect(p.low_energy_hero).toBe(1);
		expect(p.big_effort).toBe(1);
		expect(p.hard_worker).toBe(1);
		expect(p.top_priority).toBe(1);
		expect(p.big_bounty).toBe(1);
		expect(p.explorer).toBe(3); // le tag de quadrant n'est pas une catégorie
	});
});

describe('historique des complétions', () => {
	const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const today = ymd(new Date());

	it('ignores old completed tasks and line shifts', () => {
		const data = freshData();
		const old = { ...parse('- [x] Passer la serpillère ✅ 2026-02-09'), lineNumber: 12 };
		expect(GamificationService.recordSyncCompletion(old, data, 'task-matrix').newlyRecorded).toBe(false);
		expect(GamificationService.processCompletion(old, data, 'task-matrix').rewardGranted).toBe(false);

		const fresh = { ...parse(`- [x] Appeler Danielle ✅ ${today}`), lineNumber: 5 };
		expect(GamificationService.processCompletion(fresh, data, 'task-matrix').rewardGranted).toBe(true);
		// Une ligne insérée au-dessus (récurrence) décale la tâche : ce n'est pas une nouvelle complétion
		const shifted = { ...fresh, lineNumber: 6 };
		expect(GamificationService.recordSyncCompletion(shifted, data, 'task-matrix').newlyRecorded).toBe(false);
		expect(Object.keys(data.completionEvents)).toHaveLength(1);
	});

	it('recognises events stored with the legacy line-based id', () => {
		const data = freshData();
		const task = { ...parse(`- [x] Ranger ✅ ${today}`), lineNumber: 3 };
		data.completionEvents[`a.md::L3::${task.title}`] = { taskId: 'x', completedAt: new Date().toISOString(), coins: 2, taskText: 'Ranger' };
		expect(GamificationService.processCompletion({ ...task, lineNumber: 9 }, data, 'task-matrix').rewardGranted).toBe(false);
	});

	it('prunes old tasks mass-recorded as synced', () => {
		const data = freshData();
		data.completionEvents = {
			junk: { taskId: 'junk', completedAt: '2026-11-08T15:42:07.226Z', coins: 0, fromSync: true, taskText: 'Aspirateur ✅ 2026-03-12' },
			recentSync: { taskId: 'r', completedAt: '2026-11-08T15:42:07.226Z', coins: 0, fromSync: true, taskText: 'Courses ✅ 2026-11-08' },
			earned: { taskId: 'e', completedAt: '2026-11-08T10:00:00.000Z', coins: 3, taskText: 'Rapport ✅ 2026-03-12' }
		};
		expect(GamificationService.pruneHistoricalSyncEvents(data)).toBe(1);
		expect(Object.keys(data.completionEvents).sort()).toEqual(['earned', 'recentSync']);
	});
});

describe('boutique de récompenses', () => {
	it('buys a reward when affordable and unlocks shop trophies', () => {
		const data = freshData();
		data.wallet.balance = 25;
		const fail = GamificationService.purchaseReward(freshData(), 'jeu');
		expect(fail.ok).toBe(false);
		expect(GamificationService.purchaseReward(data, 'off').ok).toBe(false);

		const res = GamificationService.purchaseReward(data, 'jeu');
		expect(res.ok).toBe(true);
		expect(data.wallet.balance).toBe(5);
		expect(data.wallet.lifetimeSpent).toBe(20);
		expect(data.rewardPurchases).toHaveLength(1);
		expect(res.newlyUnlockedBadges.map(b => b.id)).toContain('first_reward');
	});

	it('refunds a purchase', () => {
		const data = freshData();
		data.wallet.balance = 20;
		const res = GamificationService.purchaseReward(data, 'jeu');
		expect(GamificationService.refundPurchase(data, res.purchase!.id)).toBe(true);
		expect(data.wallet.balance).toBe(20);
		expect(data.wallet.lifetimeSpent).toBe(0);
		expect(data.rewardPurchases).toHaveLength(0);
	});
});
