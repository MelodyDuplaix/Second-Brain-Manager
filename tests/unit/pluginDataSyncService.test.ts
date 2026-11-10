import { describe, it, expect } from 'vitest';
import { PluginDataSyncService, SyncableData } from '../../src/services/pluginDataSyncService';
import { CompletionEvent, RewardPurchase } from '../../src/models/gamification';

const event = (id: string, coins: number, completedAt: string, extra: Partial<CompletionEvent> = {}): CompletionEvent => ({
	taskId: id,
	completedAt,
	coins,
	taskText: id,
	...extra
});

const purchase = (id: string, cost: number, purchasedAt: string): RewardPurchase => ({
	id,
	rewardId: 'pause-cafe',
	rewardName: 'Pause café',
	cost,
	purchasedAt
});

const device = (over: Partial<SyncableData<{ energyLevel: number }>> = {}): SyncableData<{ energyLevel: number }> => ({
	settings: { energyLevel: 5 },
	wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
	rewards: [],
	completionEvents: {},
	streak: { currentStreak: 0, longestStreak: 0 },
	badges: {},
	workflowCounts: { morningBriefings: 0, eveningReviews: 0, recoveries: 0, notesMovedOrCleaned: 0 },
	rewardPurchases: [],
	walletBaseline: { earned: 0, spent: 0 },
	...over
});

/** Solde tel qu'il serait calculé après fusion, dans les deux sens. */
const mergeBothWays = (a: SyncableData<{ energyLevel: number }>, b: SyncableData<{ energyLevel: number }>, now = new Date('2026-11-10T12:00:00.000Z')) => ({
	ab: PluginDataSyncService.merge(a, b, now),
	ba: PluginDataSyncService.merge(b, a, now)
});

describe('PluginDataSyncService.merge', () => {
	it('réunit les complétions des deux appareils et recalcule le même solde de part et d’autre', () => {
		const phone = device({
			completionEvents: { a: event('a', 5, '2026-11-10T08:00:00.000Z') },
			wallet: { balance: 5, lifetimeEarned: 5, lifetimeSpent: 0 }
		});
		const laptop = device({
			completionEvents: { b: event('b', 3, '2026-11-10T09:00:00.000Z') },
			wallet: { balance: 3, lifetimeEarned: 3, lifetimeSpent: 0 }
		});

		const { ab, ba } = mergeBothWays(phone, laptop);

		expect(Object.keys(ab.completionEvents).sort()).toEqual(['a', 'b']);
		expect(ab.wallet).toEqual({ balance: 8, lifetimeEarned: 8, lifetimeSpent: 0 });
		expect(ba.wallet).toEqual(ab.wallet);
	});

	it('garde la complétion payée face au même événement enregistré à 0 pièce par synchronisation', () => {
		const earner = device({
			completionEvents: { a: event('a', 7, '2026-11-10T08:00:00.000Z') },
			wallet: { balance: 7, lifetimeEarned: 7, lifetimeSpent: 0 }
		});
		const syncOnly = device({
			completionEvents: { a: event('a', 0, '2026-11-10T08:00:30.000Z', { fromSync: true }) }
		});

		const { ab, ba } = mergeBothWays(earner, syncOnly);

		expect(ab.completionEvents.a.coins).toBe(7);
		expect(ab.completionEvents.a.fromSync).toBeUndefined();
		expect(ab.wallet.balance).toBe(7);
		expect(ba.wallet.balance).toBe(7);
	});

	it('n’écrase plus les pièces de l’autre appareil (le dernier enregistrement ne gagne pas)', () => {
		// Avant le correctif : le dernier à écrire data.json imposait son solde.
		const phone = device({
			completionEvents: { a: event('a', 4, '2026-11-10T08:00:00.000Z'), b: event('b', 4, '2026-11-10T08:05:00.000Z') },
			wallet: { balance: 8, lifetimeEarned: 8, lifetimeSpent: 0 }
		});
		const laptop = device({
			completionEvents: {},
			wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 }
		});

		const merged = PluginDataSyncService.merge(laptop, phone);
		expect(merged.wallet.balance).toBe(8);
	});

	it('déduit les échanges de récompense des deux appareils une seule fois', () => {
		const phone = device({
			completionEvents: { a: event('a', 30, '2026-11-09T08:00:00.000Z') },
			rewardPurchases: [purchase('p1', 10, '2026-11-09T10:00:00.000Z')]
		});
		const laptop = device({
			completionEvents: { a: event('a', 30, '2026-11-09T08:00:00.000Z') },
			rewardPurchases: [purchase('p1', 10, '2026-11-09T10:00:00.000Z'), purchase('p2', 5, '2026-11-09T11:00:00.000Z')]
		});

		const { ab, ba } = mergeBothWays(phone, laptop);

		expect(ab.rewardPurchases?.map(p => p.id)).toEqual(['p1', 'p2']);
		expect(ab.wallet).toEqual({ balance: 15, lifetimeEarned: 30, lifetimeSpent: 15 });
		expect(ba.wallet).toEqual(ab.wallet);
	});

	it('ne fait pas revenir une complétion supprimée volontairement', () => {
		const cleaned = device({
			completionEvents: {},
			deletedCompletions: { a: '2026-11-10T10:00:00.000Z' }
		});
		const stale = device({
			completionEvents: { a: event('a', 6, '2026-11-10T08:00:00.000Z') },
			wallet: { balance: 6, lifetimeEarned: 6, lifetimeSpent: 0 }
		});

		const { ab, ba } = mergeBothWays(cleaned, stale);

		expect(ab.completionEvents).toEqual({});
		expect(ab.wallet.balance).toBe(0);
		expect(ba.wallet.balance).toBe(0);
	});

	it('conserve une complétion recochée après la suppression', () => {
		const cleaned = device({ completionEvents: {}, deletedCompletions: { a: '2026-11-10T10:00:00.000Z' } });
		const recreated = device({ completionEvents: { a: event('a', 6, '2026-11-10T11:00:00.000Z') } });

		const merged = PluginDataSyncService.merge(cleaned, recreated);
		expect(merged.completionEvents.a.coins).toBe(6);
		expect(merged.wallet.balance).toBe(6);
	});

	it('ne fait pas revenir un échange annulé', () => {
		const refunded = device({
			completionEvents: { a: event('a', 20, '2026-11-09T08:00:00.000Z') },
			rewardPurchases: [],
			deletedPurchases: { p1: '2026-11-09T12:00:00.000Z' }
		});
		const other = device({
			completionEvents: { a: event('a', 20, '2026-11-09T08:00:00.000Z') },
			rewardPurchases: [purchase('p1', 10, '2026-11-09T10:00:00.000Z')]
		});

		const merged = PluginDataSyncService.merge(refunded, other);
		expect(merged.rewardPurchases).toEqual([]);
		expect(merged.wallet).toEqual({ balance: 20, lifetimeEarned: 20, lifetimeSpent: 0 });
	});

	it('ne ressuscite pas l’historique archivé après une remise à zéro', () => {
		const reset = device({
			completionEvents: {},
			gamificationResetAt: '2026-11-10T09:00:00.000Z',
			streak: { currentStreak: 0, longestStreak: 0 },
			workflowCounts: { morningBriefings: 0, eveningReviews: 0, recoveries: 0, notesMovedOrCleaned: 0 }
		});
		const old = device({
			completionEvents: { a: event('a', 12, '2026-11-08T08:00:00.000Z') },
			wallet: { balance: 12, lifetimeEarned: 12, lifetimeSpent: 0 },
			streak: { currentStreak: 4, longestStreak: 9, lastCompletionDate: '2026-11-08' },
			workflowCounts: { morningBriefings: 7, eveningReviews: 3, recoveries: 1, notesMovedOrCleaned: 2 }
		});

		const { ab, ba } = mergeBothWays(reset, old);

		expect(ab.completionEvents).toEqual({});
		expect(ab.wallet.balance).toBe(0);
		expect(ab.streak).toEqual({ currentStreak: 0, longestStreak: 0, lastCompletionDate: undefined });
		expect(ab.workflowCounts?.morningBriefings).toBe(0);
		expect(ba.wallet.balance).toBe(0);
	});

	it('garde les complétions postérieures à la remise à zéro', () => {
		const reset = device({
			completionEvents: { b: event('b', 2, '2026-11-10T10:00:00.000Z') },
			gamificationResetAt: '2026-11-10T09:00:00.000Z'
		});
		const old = device({ completionEvents: { a: event('a', 12, '2026-11-08T08:00:00.000Z') } });

		const merged = PluginDataSyncService.merge(old, reset);
		expect(Object.keys(merged.completionEvents)).toEqual(['b']);
		expect(merged.wallet.balance).toBe(2);
	});

	it('retient les réglages les plus récemment enregistrés, avec la boutique qui va avec', () => {
		const older = device({
			settings: { energyLevel: 3 },
			settingsUpdatedAt: '2026-11-10T08:00:00.000Z',
			rewards: [{ id: 'r1', name: 'Ancienne', description: '', cost: 10, enabled: true }]
		});
		const newer = device({
			settings: { energyLevel: 9 },
			settingsUpdatedAt: '2026-11-10T09:00:00.000Z',
			rewards: [{ id: 'r2', name: 'Nouvelle', description: '', cost: 20, enabled: true }]
		});

		const { ab, ba } = mergeBothWays(older, newer);

		expect(ab.settings.energyLevel).toBe(9);
		expect(ab.rewards.map(r => r.id)).toEqual(['r2']);
		expect(ba.settings.energyLevel).toBe(9);
		expect(ab.settingsUpdatedAt).toBe('2026-11-10T09:00:00.000Z');
	});

	it('fusionne série, trophées et compteurs de workflow sans double comptage', () => {
		const phone = device({
			streak: { currentStreak: 2, longestStreak: 11, lastCompletionDate: '2026-11-09' },
			badges: { first_task: { id: 'first_task', progress: 1, unlockedAt: '2026-11-01T10:00:00.000Z' } },
			workflowCounts: { morningBriefings: 5, eveningReviews: 1, recoveries: 0, notesMovedOrCleaned: 4 }
		});
		const laptop = device({
			streak: { currentStreak: 3, longestStreak: 7, lastCompletionDate: '2026-11-10' },
			badges: { first_task: { id: 'first_task', progress: 1, unlockedAt: '2026-11-02T10:00:00.000Z' }, tasks_10: { id: 'tasks_10', progress: 6 } },
			workflowCounts: { morningBriefings: 4, eveningReviews: 2, recoveries: 1, notesMovedOrCleaned: 4 }
		});

		const { ab, ba } = mergeBothWays(phone, laptop);

		expect(ab.streak).toEqual({ currentStreak: 3, longestStreak: 11, lastCompletionDate: '2026-11-10' });
		expect(ab.badges?.first_task.unlockedAt).toBe('2026-11-01T10:00:00.000Z');
		expect(ab.badges?.tasks_10.progress).toBe(6);
		expect(ab.workflowCounts).toEqual({ morningBriefings: 5, eveningReviews: 2, recoveries: 1, notesMovedOrCleaned: 4 });
		expect(ba.streak).toEqual(ab.streak);
		expect(ba.workflowCounts).toEqual(ab.workflowCounts);
	});

	it('est idempotente : refusionner le résultat ne change rien', () => {
		const phone = device({
			completionEvents: { a: event('a', 5, '2026-11-10T08:00:00.000Z') },
			rewardPurchases: [purchase('p1', 2, '2026-11-10T08:30:00.000Z')],
			settingsUpdatedAt: '2026-11-10T08:00:00.000Z'
		});
		const laptop = device({
			completionEvents: { b: event('b', 1, '2026-11-10T09:00:00.000Z') },
			settingsUpdatedAt: '2026-11-10T07:00:00.000Z'
		});

		const once = PluginDataSyncService.merge(phone, laptop);
		const twice = PluginDataSyncService.merge(once, laptop);
		const thrice = PluginDataSyncService.merge(once, once);

		expect(twice).toEqual(once);
		expect(thrice).toEqual(once);
	});

	it('oublie les marqueurs de suppression trop anciens pour ne pas gonfler data.json', () => {
		const withOldTombstone = device({ deletedCompletions: { vieux: '2026-01-01T00:00:00.000Z', recent: '2026-11-01T00:00:00.000Z' } });
		const merged = PluginDataSyncService.merge(withOldTombstone, device(), new Date('2026-11-10T12:00:00.000Z'));
		expect(Object.keys(merged.deletedCompletions || {})).toEqual(['recent']);
	});

	it('conserve le solde hérité des anciennes versions via la base du portefeuille', () => {
		const legacy = device({
			completionEvents: { a: event('a', 5, '2026-11-10T08:00:00.000Z') },
			wallet: { balance: 100, lifetimeEarned: 120, lifetimeSpent: 20 },
			walletBaseline: undefined
		});
		const baseline = PluginDataSyncService.deriveWalletBaseline(legacy);
		expect(baseline).toEqual({ earned: 115, spent: 20 });

		legacy.walletBaseline = baseline;
		expect(PluginDataSyncService.recomputeWallet(legacy)).toEqual({ balance: 100, lifetimeEarned: 120, lifetimeSpent: 20 });

		// La base la plus haute est retenue : aucun appareil ne perd de pièces en migrant.
		const merged = PluginDataSyncService.merge(legacy, device({ completionEvents: { a: event('a', 5, '2026-11-10T08:00:00.000Z') } }));
		expect(merged.wallet.balance).toBe(100);
	});

	it('tolère des données partielles venant d’une version plus ancienne', () => {
		const partial = { settings: { energyLevel: 4 }, wallet: { balance: 3, lifetimeEarned: 3, lifetimeSpent: 0 }, rewards: [], completionEvents: { a: event('a', 3, '2026-11-10T08:00:00.000Z') } } as SyncableData<{ energyLevel: number }>;
		const merged = PluginDataSyncService.merge(partial, device());
		expect(merged.wallet.balance).toBe(3);
		expect(merged.streak).toEqual({ currentStreak: 0, longestStreak: 0, lastCompletionDate: undefined });
	});
});
