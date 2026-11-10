import {
	Wallet,
	Reward,
	CompletionEvent,
	StreakData,
	UserBadge,
	WorkflowCounts,
	RewardPurchase
} from '../models/gamification';

/**
 * Part du portefeuille qui ne provient pas de l'historique courant (données héritées des versions
 * antérieures, où le solde était un simple compteur). Le solde est toujours recalculé comme
 * `base + somme des pièces gagnées - somme des pièces dépensées`, ce qui rend la fusion entre deux
 * appareils déterministe.
 */
export interface WalletBaseline {
	earned: number;
	spent: number;
}

/** Données du plugin telles qu'elles sont écrites dans `data.json` (vue nécessaire à la fusion). */
export interface SyncableData<S = unknown> {
	settings: S;
	/** Horodatage du dernier enregistrement des réglages : arbitre les réglages entre deux appareils. */
	settingsUpdatedAt?: string;
	wallet: Wallet;
	rewards: Reward[];
	completionEvents: Record<string, CompletionEvent>;
	streak?: StreakData;
	badges?: Record<string, UserBadge>;
	workflowCounts?: WorkflowCounts;
	lastActiveSession?: string;
	rewardPurchases?: RewardPurchase[];
	/** Complétions supprimées volontairement (taskId → horodatage), pour qu'elles ne « ressuscitent » pas. */
	deletedCompletions?: Record<string, string>;
	/** Échanges annulés (id → horodatage). */
	deletedPurchases?: Record<string, string>;
	/** Date de la dernière remise à zéro : tout ce qui est antérieur est ignoré lors d'une fusion. */
	gamificationResetAt?: string;
	walletBaseline?: WalletBaseline;
}

/** Durée de conservation des marqueurs de suppression (au-delà, la suppression est considérée propagée). */
const TOMBSTONE_RETENTION_DAYS = 120;

const str = (v?: string): string => v || '';
const maxStr = (a?: string, b?: string): string => (str(a) >= str(b) ? str(a) : str(b));

export class PluginDataSyncService {
	/**
	 * Fusionne deux états du plugin : celui en mémoire sur cet appareil et celui trouvé sur le disque,
	 * écrit par un autre appareil via la synchronisation des fichiers. La fusion est déterministe et
	 * idempotente : les deux appareils aboutissent au même résultat, quel que soit l'ordre des
	 * synchronisations.
	 */
	public static merge<S>(local: SyncableData<S>, remote: SyncableData<S>, now: Date = new Date()): SyncableData<S> {
		const resetAt = maxStr(local.gamificationResetAt, remote.gamificationResetAt);
		const sameReset = str(local.gamificationResetAt) === str(remote.gamificationResetAt);
		// Remises à zéro différentes : les compteurs non reconstituables (série, trophées, workflows)
		// proviennent de l'appareil qui a fait la remise à zéro la plus récente.
		const counterSource: SyncableData<S> | null = sameReset
			? null
			: (str(local.gamificationResetAt) === resetAt ? local : remote);

		const deletedCompletions = this.mergeTombstones(local.deletedCompletions, remote.deletedCompletions, resetAt, now);
		const deletedPurchases = this.mergeTombstones(local.deletedPurchases, remote.deletedPurchases, resetAt, now);

		const completionEvents = this.mergeCompletionEvents(local, remote, deletedCompletions, resetAt);
		const rewardPurchases = this.mergePurchases(local, remote, deletedPurchases, resetAt);

		// Réglages (et boutique de récompenses, qui s'édite avec eux) : le plus récemment enregistré gagne.
		const settingsSource = str(remote.settingsUpdatedAt) > str(local.settingsUpdatedAt) ? remote : local;

		const merged: SyncableData<S> = {
			settings: settingsSource.settings,
			settingsUpdatedAt: maxStr(local.settingsUpdatedAt, remote.settingsUpdatedAt) || undefined,
			wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
			rewards: settingsSource.rewards || local.rewards || [],
			completionEvents,
			streak: counterSource ? this.cloneStreak(counterSource.streak) : this.mergeStreak(local.streak, remote.streak),
			badges: counterSource ? { ...(counterSource.badges || {}) } : this.mergeBadges(local.badges, remote.badges),
			workflowCounts: counterSource
				? { ...this.emptyCounts(), ...(counterSource.workflowCounts || {}) }
				: this.mergeWorkflowCounts(local.workflowCounts, remote.workflowCounts),
			lastActiveSession: maxStr(local.lastActiveSession, remote.lastActiveSession) || undefined,
			rewardPurchases,
			deletedCompletions,
			deletedPurchases,
			gamificationResetAt: resetAt || undefined,
			walletBaseline: counterSource
				? (counterSource.walletBaseline || { earned: 0, spent: 0 })
				: {
					earned: Math.max(local.walletBaseline?.earned || 0, remote.walletBaseline?.earned || 0),
					spent: Math.max(local.walletBaseline?.spent || 0, remote.walletBaseline?.spent || 0)
				}
		};

		this.recomputeWallet(merged);
		return merged;
	}

	/**
	 * Recalcule le portefeuille à partir de l'historique : c'est lui qui fait foi, pour que deux
	 * appareils affichent toujours le même nombre de pièces.
	 */
	public static recomputeWallet(
		data: Pick<SyncableData, 'wallet' | 'completionEvents' | 'rewardPurchases' | 'walletBaseline'>
	): Wallet {
		const base = data.walletBaseline || { earned: 0, spent: 0 };
		const earned = (base.earned || 0) + this.sumEarned(data.completionEvents);
		const spent = (base.spent || 0) + this.sumSpent(data.rewardPurchases);
		data.wallet = {
			balance: Math.max(0, earned - spent),
			lifetimeEarned: earned,
			lifetimeSpent: spent
		};
		return data.wallet;
	}

	/**
	 * Calcule la part du solde qui ne vient pas de l'historique courant. Appelée une seule fois lors de
	 * la migration, pour qu'aucun appareil ne voie son solde baisser en passant au solde recalculé.
	 */
	public static deriveWalletBaseline(
		data: Pick<SyncableData, 'wallet' | 'completionEvents' | 'rewardPurchases'>
	): WalletBaseline {
		const earnedFromHistory = this.sumEarned(data.completionEvents);
		const spentFromHistory = this.sumSpent(data.rewardPurchases);
		return {
			earned: Math.max(0, (data.wallet?.lifetimeEarned || 0) - earnedFromHistory),
			spent: Math.max(0, (data.wallet?.lifetimeSpent || 0) - spentFromHistory)
		};
	}

	public static sumEarned(events?: Record<string, CompletionEvent>): number {
		return Object.values(events || {}).reduce((acc, e) => acc + (e?.coins || 0), 0);
	}

	public static sumSpent(purchases?: RewardPurchase[]): number {
		return (purchases || []).reduce((acc, p) => acc + (p?.cost || 0), 0);
	}

	/** Entre deux enregistrements d'une même complétion, garde celui qui a réellement rapporté des pièces. */
	private static pickEvent(a: CompletionEvent, b: CompletionEvent): CompletionEvent {
		if ((a.coins || 0) !== (b.coins || 0)) return (a.coins || 0) > (b.coins || 0) ? a : b;
		if (!!a.fromSync !== !!b.fromSync) return a.fromSync ? b : a;
		return str(a.completedAt) <= str(b.completedAt) ? a : b;
	}

	private static mergeCompletionEvents<S>(
		local: SyncableData<S>,
		remote: SyncableData<S>,
		deleted: Record<string, string>,
		resetAt: string
	): Record<string, CompletionEvent> {
		const out: Record<string, CompletionEvent> = {};
		for (const side of [local, remote]) {
			for (const [id, event] of Object.entries(side.completionEvents || {})) {
				if (!event) continue;
				if (resetAt && str(event.completedAt) < resetAt) continue;
				const deletedAt = deleted[id];
				if (deletedAt && str(event.completedAt) <= deletedAt) continue;
				out[id] = out[id] ? this.pickEvent(out[id], event) : event;
			}
		}
		return out;
	}

	private static mergePurchases<S>(
		local: SyncableData<S>,
		remote: SyncableData<S>,
		deleted: Record<string, string>,
		resetAt: string
	): RewardPurchase[] {
		const byId = new Map<string, RewardPurchase>();
		for (const side of [local, remote]) {
			for (const purchase of side.rewardPurchases || []) {
				if (!purchase || !purchase.id) continue;
				if (resetAt && str(purchase.purchasedAt) < resetAt) continue;
				const deletedAt = deleted[purchase.id];
				if (deletedAt && str(purchase.purchasedAt) <= deletedAt) continue;
				if (!byId.has(purchase.id)) byId.set(purchase.id, purchase);
			}
		}
		return [...byId.values()].sort((a, b) => str(a.purchasedAt).localeCompare(str(b.purchasedAt)));
	}

	private static mergeTombstones(
		a: Record<string, string> | undefined,
		b: Record<string, string> | undefined,
		resetAt: string,
		now: Date
	): Record<string, string> {
		const limit = new Date(now.getTime() - TOMBSTONE_RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
		const out: Record<string, string> = {};
		for (const source of [a || {}, b || {}]) {
			for (const [id, ts] of Object.entries(source)) {
				if (!ts || ts < limit) continue;
				if (resetAt && ts < resetAt) continue;
				out[id] = maxStr(out[id], ts);
			}
		}
		return out;
	}

	private static cloneStreak(streak?: StreakData): StreakData {
		return { currentStreak: 0, longestStreak: 0, ...(streak || {}) };
	}

	private static mergeStreak(a?: StreakData, b?: StreakData): StreakData {
		const left = this.cloneStreak(a);
		const right = this.cloneStreak(b);
		const lastCompletionDate = maxStr(left.lastCompletionDate, right.lastCompletionDate);
		let currentStreak: number;
		if (str(left.lastCompletionDate) === str(right.lastCompletionDate)) {
			currentStreak = Math.max(left.currentStreak || 0, right.currentStreak || 0);
		} else {
			currentStreak = (str(left.lastCompletionDate) === lastCompletionDate ? left : right).currentStreak || 0;
		}
		return {
			currentStreak,
			longestStreak: Math.max(left.longestStreak || 0, right.longestStreak || 0, currentStreak),
			lastCompletionDate: lastCompletionDate || undefined
		};
	}

	private static mergeBadges(
		a?: Record<string, UserBadge>,
		b?: Record<string, UserBadge>
	): Record<string, UserBadge> {
		const out: Record<string, UserBadge> = {};
		for (const source of [a || {}, b || {}]) {
			for (const [id, badge] of Object.entries(source)) {
				if (!badge) continue;
				const current = out[id];
				if (!current) {
					out[id] = { ...badge };
					continue;
				}
				current.progress = Math.max(current.progress || 0, badge.progress || 0);
				// Premier déblocage conservé (la date la plus ancienne des deux)
				if (badge.unlockedAt && (!current.unlockedAt || badge.unlockedAt < current.unlockedAt)) {
					current.unlockedAt = badge.unlockedAt;
				}
			}
		}
		return out;
	}

	private static emptyCounts(): WorkflowCounts {
		return { morningBriefings: 0, eveningReviews: 0, recoveries: 0, notesMovedOrCleaned: 0 };
	}

	/**
	 * Compteurs de workflow : on garde le maximum de chaque appareil. Les additionner compterait deux
	 * fois les actions déjà synchronisées.
	 */
	private static mergeWorkflowCounts(a?: WorkflowCounts, b?: WorkflowCounts): WorkflowCounts {
		const left = { ...this.emptyCounts(), ...(a || {}) };
		const right = { ...this.emptyCounts(), ...(b || {}) };
		return {
			morningBriefings: Math.max(left.morningBriefings || 0, right.morningBriefings || 0),
			eveningReviews: Math.max(left.eveningReviews || 0, right.eveningReviews || 0),
			recoveries: Math.max(left.recoveries || 0, right.recoveries || 0),
			notesMovedOrCleaned: Math.max(left.notesMovedOrCleaned || 0, right.notesMovedOrCleaned || 0)
		};
	}
}
