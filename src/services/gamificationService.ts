import { ObsidianTask } from '../models/task';
import { 
	Wallet, 
	Reward, 
	CompletionEvent, 
	CoinRules, 
	DEFAULT_COIN_RULES, 
	StreakData, 
	BadgeDefinition, 
	UserBadge, 
	WorkflowCounts,
	BADGE_DEFINITIONS 
} from '../models/gamification';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';

export interface PluginData {
	wallet: Wallet;
	rewards: Reward[];
	completionEvents: Record<string, CompletionEvent>;
	streak: StreakData;
	badges: Record<string, UserBadge>;
	workflowCounts: WorkflowCounts;
	lastActiveSession?: string;
}

export class GamificationService {
	/**
	 * Initialise les structures de gamification pour garantir la rétrocompatibilité des données existantes.
	 */
	public static ensureDataStructures(data: PluginData): void {
		if (!data.wallet) {
			data.wallet = { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
		}
		if (!data.rewards) {
			data.rewards = [];
		}
		if (!data.completionEvents) {
			data.completionEvents = {};
		}
		if (!data.streak) {
			data.streak = { currentStreak: 0, longestStreak: 0 };
		}
		if (!data.badges) {
			data.badges = {};
		}
		if (!data.workflowCounts) {
			data.workflowCounts = {
				morningBriefings: 0,
				eveningReviews: 0,
				recoveries: 0,
				notesMovedOrCleaned: 0
			};
		}
	}

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

	/**
	 * Met à jour la série de jours consécutifs (streak) lors de l'accomplissement d'une tâche.
	 */
	public static updateStreak(streak: StreakData, targetDateStr?: string): { streakIncreased: boolean; currentStreak: number; longestStreak: number } {
		const todayStr = targetDateStr || new Date().toISOString().split('T')[0];

		if (!streak.lastCompletionDate) {
			streak.currentStreak = 1;
			streak.longestStreak = Math.max(streak.longestStreak || 0, 1);
			streak.lastCompletionDate = todayStr;
			return { streakIncreased: true, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak };
		}

		if (streak.lastCompletionDate === todayStr) {
			// Déjà complété une tâche aujourd'hui : le streak reste inchangé
			return { streakIncreased: false, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak };
		}

		const lastDate = new Date(streak.lastCompletionDate);
		const todayDate = new Date(todayStr);
		const diffTime = todayDate.getTime() - lastDate.getTime();
		const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

		if (diffDays === 1) {
			// Complété hier : le streak continue (+1)
			streak.currentStreak += 1;
			streak.longestStreak = Math.max(streak.longestStreak || 0, streak.currentStreak);
			streak.lastCompletionDate = todayStr;
			return { streakIncreased: true, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak };
		} else if (diffDays > 1) {
			// Plus d'un jour d'interruption : le streak redémarre à 1
			streak.currentStreak = 1;
			streak.longestStreak = Math.max(streak.longestStreak || 0, 1);
			streak.lastCompletionDate = todayStr;
			return { streakIncreased: false, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak };
		}

		return { streakIncreased: false, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak };
	}

	/**
	 * Évalue la progression de tous les badges et débloque ceux dont les conditions sont remplies.
	 */
	public static checkAndUnlockBadges(data: PluginData): BadgeDefinition[] {
		this.ensureDataStructures(data);

		const newlyUnlocked: BadgeDefinition[] = [];
		const events = Object.values(data.completionEvents);

		const countTasks = events.length;
		const countQ1 = events.filter(e => e.quadrant === 'q1' || (e.categoryTags && e.categoryTags.some(t => t.includes('q1')))).length;
		const countQ2 = events.filter(e => e.quadrant === 'q2' || (e.categoryTags && e.categoryTags.some(t => t.includes('q2')))).length;
		const currentStreak = data.streak.currentStreak || 0;
		const longestStreak = data.streak.longestStreak || 0;
		const maxStreak = Math.max(currentStreak, longestStreak);
		const lifetimeEarned = data.wallet.lifetimeEarned || 0;

		const progressMap: Record<string, number> = {
			first_task: countTasks,
			focus_q1: countQ1,
			vision_q2: countQ2,
			streak_3: maxStreak,
			streak_7: maxStreak,
			streak_30: maxStreak,
			coins_50: lifetimeEarned,
			coins_200: lifetimeEarned,
			inbox_cleaner: data.workflowCounts.notesMovedOrCleaned || 0,
			briefing_regular: data.workflowCounts.morningBriefings || 0,
			evening_peace: data.workflowCounts.eveningReviews || 0,
			soft_landing: data.workflowCounts.recoveries || 0
		};

		for (const def of BADGE_DEFINITIONS) {
			const currentProgress = Math.min(progressMap[def.id] || 0, def.maxProgress);
			const existingUserBadge = data.badges[def.id];

			if (!existingUserBadge) {
				data.badges[def.id] = {
					id: def.id,
					progress: currentProgress,
					unlockedAt: currentProgress >= def.maxProgress ? new Date().toISOString() : undefined
				};
				if (currentProgress >= def.maxProgress) {
					newlyUnlocked.push(def);
				}
			} else {
				existingUserBadge.progress = currentProgress;
				if (!existingUserBadge.unlockedAt && currentProgress >= def.maxProgress) {
					existingUserBadge.unlockedAt = new Date().toISOString();
					newlyUnlocked.push(def);
				}
			}
		}

		return newlyUnlocked;
	}

	/**
	 * Traite la complétion d'une tâche avec calcul de pièces, mise à jour du streak et déblocage de badges.
	 */
	public static processCompletion(
		task: ObsidianTask,
		data: PluginData,
		matrixProvider: string,
		rules: CoinRules = DEFAULT_COIN_RULES
	): { rewardGranted: boolean; coinsEarned: number; newBalance: number; newlyUnlockedBadges: BadgeDefinition[] } {
		this.ensureDataStructures(data);

		const taskId = this.getStableTaskId(task);

		if (data.completionEvents[taskId]) {
			return { rewardGranted: false, coinsEarned: 0, newBalance: data.wallet.balance, newlyUnlockedBadges: [] };
		}

		const coinsEarned = this.calculateCoins(task, matrixProvider, rules);
		data.wallet.balance += coinsEarned;
		data.wallet.lifetimeEarned += coinsEarned;

		const matrixAdapter = MatrixAdapterFactory.createAdapter(matrixProvider);
		const quadrant = matrixAdapter.getQuadrant(task);

		data.completionEvents[taskId] = {
			taskId,
			completedAt: new Date().toISOString(),
			coins: coinsEarned,
			taskText: task.cleanText,
			categoryTags: task.domainTags,
			quadrant: quadrant || undefined
		};

		// Mise à jour de la série (Streak)
		this.updateStreak(data.streak);

		// Vérification des badges débloqués
		const newlyUnlockedBadges = this.checkAndUnlockBadges(data);

		return {
			rewardGranted: true,
			coinsEarned,
			newBalance: data.wallet.balance,
			newlyUnlockedBadges
		};
	}

	/**
	 * Enregistre silencieusement une tâche complétée provenant d'une synchronisation distante (Obsidian Sync, iCloud, Git...)
	 * ou d'une modification externe hors Obsidian, SANS accorder de pièces et SANS modifier le streak.
	 */
	public static recordSyncCompletion(
		task: ObsidianTask,
		data: PluginData,
		matrixProvider: string
	): { newlyRecorded: boolean } {
		this.ensureDataStructures(data);

		const taskId = this.getStableTaskId(task);

		if (data.completionEvents[taskId]) {
			return { newlyRecorded: false };
		}

		const matrixAdapter = MatrixAdapterFactory.createAdapter(matrixProvider);
		const quadrant = matrixAdapter.getQuadrant(task);

		data.completionEvents[taskId] = {
			taskId,
			completedAt: new Date().toISOString(),
			coins: 0,
			taskText: task.cleanText,
			categoryTags: task.domainTags,
			quadrant: quadrant || undefined,
			fromSync: true
		};

		return { newlyRecorded: true };
	}

	/**
	 * Enregistre un événement de workflow (Briefing, Revue du soir, Reprise, Rangement de note)
	 * et met à jour les badges associés.
	 */
	public static recordWorkflowEvent(
		data: PluginData,
		eventType: 'morning_briefing' | 'evening_review' | 'recovery' | 'note_cleaned'
	): BadgeDefinition[] {
		this.ensureDataStructures(data);

		if (eventType === 'morning_briefing') {
			data.workflowCounts.morningBriefings = (data.workflowCounts.morningBriefings || 0) + 1;
		} else if (eventType === 'evening_review') {
			data.workflowCounts.eveningReviews = (data.workflowCounts.eveningReviews || 0) + 1;
		} else if (eventType === 'recovery') {
			data.workflowCounts.recoveries = (data.workflowCounts.recoveries || 0) + 1;
		} else if (eventType === 'note_cleaned') {
			data.workflowCounts.notesMovedOrCleaned = (data.workflowCounts.notesMovedOrCleaned || 0) + 1;
		}

		return this.checkAndUnlockBadges(data);
	}

	public static removeCompletion(
		taskId: string,
		data: PluginData
	): { success: boolean; deductedCoins: number; newBalance: number } {
		this.ensureDataStructures(data);

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
		this.ensureDataStructures(data);

		const targetDate = todayDateStr || new Date().toISOString().split('T')[0];
		let total = 0;

		Object.values(data.completionEvents).forEach(event => {
			if (event.completedAt && event.completedAt.startsWith(targetDate)) {
				total += event.coins;
			}
		});

		return total;
	}

	public static getDailyTrend(data: PluginData, days = 7): { date: string; coins: number }[] {
		this.ensureDataStructures(data);
		const result: { date: string; coins: number }[] = [];
		const now = new Date();

		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			const dateStr = d.toISOString().split('T')[0];

			const totalCoins = Object.values(data.completionEvents)
				.filter(e => e.completedAt && e.completedAt.startsWith(dateStr))
				.reduce((acc, curr) => acc + curr.coins, 0);

			result.push({ date: dateStr, coins: totalCoins });
		}
		return result;
	}

	public static getCoinsByCategory(data: PluginData): Record<string, number> {
		this.ensureDataStructures(data);
		const dist: Record<string, number> = {};
		Object.values(data.completionEvents).forEach(e => {
			if (e.categoryTags && e.categoryTags.length > 0) {
				e.categoryTags.forEach(tag => {
					dist[tag] = (dist[tag] || 0) + e.coins;
				});
			} else {
				dist['Non classé'] = (dist['Non classé'] || 0) + e.coins;
			}
		});
		return dist;
	}

	/**
	 * Archive l'état complet du score (pièces, statistiques, historique des tâches, badges)
	 * dans une note Markdown du coffre et remet toutes les statistiques de gamification à zéro.
	 */
	public static async archiveAndResetGamification(
		app: any,
		data: PluginData
	): Promise<{ success: boolean; archivePath: string; oldBalance: number; tasksCount: number }> {
		this.ensureDataStructures(data);

		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];
		const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
		const readableDateTime = now.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

		const oldBalance = data.wallet.balance || 0;
		const oldLifetime = data.wallet.lifetimeEarned || 0;
		const oldSpent = data.wallet.lifetimeSpent || 0;
		const oldStreak = data.streak.currentStreak || 0;
		const oldLongestStreak = data.streak.longestStreak || 0;

		const events = Object.values(data.completionEvents).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
		const tasksCount = events.length;

		// Badges débloqués
		const unlockedBadges = BADGE_DEFINITIONS.filter(b => data.badges[b.id]?.unlockedAt).map(b => {
			const uDate = data.badges[b.id].unlockedAt ? new Date(data.badges[b.id].unlockedAt!).toLocaleDateString('fr-FR') : '';
			return `- **${b.name}** : ${b.description} *(Débloqué le ${uDate})*`;
		});

		// Tableau des tâches complétées
		let taskTable = '| Date & Heure | Tâche | Catégories | Gain |\n| :--- | :--- | :--- | :--- |\n';
		if (events.length === 0) {
			taskTable += '| - | Aucune tâche enregistrée | - | 0 🪙 |\n';
		} else {
			events.forEach(e => {
				const d = e.completedAt ? new Date(e.completedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
				const tags = (e.categoryTags || []).join(' ') || '-';
				const cleanTitle = (e.taskText || 'Tâche').replace(/\|/g, '-');
				taskTable += `| ${d} | ${cleanTitle} | ${tags} | +${e.coins} 🪙 |\n`;
			});
		}

		const archiveContent = `---
tags:
  - second-brain/archive-score
  - gamification/bilan
date: ${dateStr}
score_archive: ${oldBalance}
streak_archive: ${oldStreak}
tasks_count: ${tasksCount}
---

# 🪙 Bilan & Archive de Score Gamification

> **Bilan généré le ${readableDateTime}**  
> Cette note conserve l'historique complet de votre progression avant remise à zéro du compteur de pièces.

## 📊 Statistiques du Portefeuille
- **Solde final archivé** : **${oldBalance} 🪙**
- **Total de pièces gagnées à vie** : **${oldLifetime} 🪙**
- **Total dépensé / utilisé** : **${oldSpent} 🪙**
- **Série active au moment du reset** : **${oldStreak} jour${oldStreak > 1 ? 's' : ''}** (Record personnel : **${oldLongestStreak} jour${oldLongestStreak > 1 ? 's' : ''}**)
- **Nombre total de tâches validées** : **${tasksCount}**

## 🏆 Trophées Débloqués (${unlockedBadges.length})
${unlockedBadges.length > 0 ? unlockedBadges.join('\n') : '*Aucun trophée débloqué lors de cette session.*'}

## 📜 Historique des Tâches Récompensées
${taskTable}

---
*Généré automatiquement par le plugin Second Brain Manager.*
`;

		const folderName = '00 - Archives';
		const fileName = `Bilan Score & Pièces - ${dateStr} (${timeStr}).md`;
		const archivePath = `${folderName}/${fileName}`;

		try {
			if (app && app.vault) {
				const folderExists = app.vault.getAbstractFileByPath(folderName);
				if (!folderExists) {
					try {
						await app.vault.createFolder(folderName);
					} catch {
						// Ignorer si existe déjà
					}
				}
				await app.vault.create(archivePath, archiveContent);
			}
		} catch (vaultErr) {
			console.warn('[Second Brain Manager] Erreur écriture note archive, tentative à la racine:', vaultErr);
			try {
				if (app && app.vault) {
					await app.vault.create(fileName, archiveContent);
				}
			} catch (e2) {
				console.error('[Second Brain Manager] Impossible de créer la note archive:', e2);
			}
		}

		// Remise à zéro des statistiques
		data.wallet = { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
		data.streak = { currentStreak: 0, longestStreak: 0 };
		data.completionEvents = {};
		data.badges = {};
		data.workflowCounts = {
			morningBriefings: 0,
			eveningReviews: 0,
			recoveries: 0,
			notesMovedOrCleaned: 0
		};

		return {
			success: true,
			archivePath,
			oldBalance,
			tasksCount
		};
	}
}
