import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App } from 'obsidian';
import { GamificationService } from '../services/gamificationService';
import { DomUtils } from '../utils/domUtils';
import { BADGE_CATEGORY_LABELS, BadgeDefinition, RewardPurchase, getActiveBadgeDefinitions } from '../models/gamification';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_GAMIFICATION_HISTORY = 'sbm-gamification-history-view';

export class GamificationHistoryView extends ItemView {
	private plugin: SecondBrainPlugin;
	private currentTab: 'history' | 'badges' | 'shop' | 'stats' = 'history';
	/** Récompense en attente de confirmation d'achat (second clic) */
	private pendingPurchaseId: string | null = null;
	private pendingPurchaseTimer: number | undefined;
	private searchQuery = '';

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_GAMIFICATION_HISTORY;
	}

	getDisplayText(): string {
		return 'Gamification, séries et trophées';
	}

	getIcon(): string {
		return 'coins';
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		GamificationService.ensureDataStructures(this.plugin.pluginData);
		// Trophées débloqués rétroactivement (nouvelles règles) : enregistrés sans notification en rafale
		if (GamificationService.checkAndUnlockBadges(this.plugin.pluginData).length > 0) {
			void this.plugin.savePluginData();
		}

		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('sbm-history-container');

		const headerEl = container.createEl('div', { cls: 'sbm-history-header' });
		const titleWrap = headerEl.createDiv({ cls: 'sbm-history-title-wrap' });
		titleWrap.createEl('h2', { text: '🪙 Gamification & Trophées' });

		const resetBtn = headerEl.createEl('button', {
			cls: 'sbm-history-reset-btn',
			text: '🔄 Réinitialiser'
		});
		resetBtn.title = 'Archiver le score actuel dans une note et remettre les compteurs à 0';
		resetBtn.addEventListener('click', () => {
			this.openResetConfirmationModal();
		});

		// Navigation par Onglets
		const tabNav = container.createEl('div', { cls: 'sbm-tab-nav' });

		const historyTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'history' ? 'active' : ''}`,
			text: '📜 Historique'
		});
		historyTabBtn.addEventListener('click', () => {
			this.currentTab = 'history';
			this.render();
		});

		const badgesTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'badges' ? 'active' : ''}`,
			text: '🏆 Trophées'
		});
		badgesTabBtn.addEventListener('click', () => {
			this.currentTab = 'badges';
			this.render();
		});

		const shopTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'shop' ? 'active' : ''}`,
			text: '🛍️ Boutique'
		});
		shopTabBtn.addEventListener('click', () => {
			this.currentTab = 'shop';
			this.render();
		});

		const statsTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'stats' ? 'active' : ''}`,
			text: '📊 Statistiques'
		});
		statsTabBtn.addEventListener('click', () => {
			this.currentTab = 'stats';
			this.render();
		});

		// Résumé du portefeuille & Série
		const summaryRow = container.createEl('div', { cls: 'sbm-history-summary' });

		const balanceStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		balanceStat.createEl('div', { cls: 'sbm-summary-label', text: 'Solde actuel' });
		balanceStat.createEl('div', { cls: 'sbm-summary-val gold', text: `${this.plugin.pluginData.wallet.balance} 🪙` });

		const streakStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		streakStat.createEl('div', { cls: 'sbm-summary-label', text: 'Série (Streak)' });
		streakStat.createEl('div', { cls: 'sbm-summary-val streak-val', text: `🔥 ${this.plugin.pluginData.streak.currentStreak} j` });

		const lifetimeStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		lifetimeStat.createEl('div', { cls: 'sbm-summary-label', text: 'Total à vie' });
		lifetimeStat.createEl('div', { cls: 'sbm-summary-val green', text: `${this.plugin.pluginData.wallet.lifetimeEarned} 🪙` });

		const events = Object.values(this.plugin.pluginData.completionEvents)
			.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

		const countStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		countStat.createEl('div', { cls: 'sbm-summary-label', text: 'Tâches faites' });
		countStat.createEl('div', { cls: 'sbm-summary-val', text: `${events.length}` });

		const mainContent = container.createEl('div', { cls: 'sbm-tab-content' });

		if (this.currentTab === 'history') {
			this.renderHistoryTab(mainContent, events);
		} else if (this.currentTab === 'badges') {
			this.renderBadgesTab(mainContent);
		} else if (this.currentTab === 'shop') {
			this.renderShopTab(mainContent);
		} else {
			this.renderAdvancedStatsTab(mainContent, events);
		}
	}

	private renderBadgesTab(container: Element): void {
		const streakHero = container.createEl('div', { cls: 'sbm-streak-hero-card' });
		const currentStreak = this.plugin.pluginData.streak.currentStreak || 0;
		const longestStreak = this.plugin.pluginData.streak.longestStreak || 0;

		const streakIconWrap = streakHero.createDiv({ cls: 'sbm-streak-hero-icon' });
		setIcon(streakIconWrap, 'flame');

		const streakInfo = streakHero.createDiv({ cls: 'sbm-streak-hero-info' });
		streakInfo.createEl('h3', { text: `🔥 Série : ${currentStreak} jour${currentStreak > 1 ? 's' : ''}` });
		streakInfo.createEl('p', {
			text: `Record : ${longestStreak} j — Complétez 1 tâche par jour pour maintenir votre flamme.`,
			cls: 'sbm-streak-hero-desc'
		});

		// Galerie des trophées, regroupés par famille
		const defs = getActiveBadgeDefinitions();
		const badges = this.plugin.pluginData.badges;
		const unlockedCount = defs.filter(d => badges[d.id]?.unlockedAt).length;
		const titleRow = container.createDiv({ cls: 'sbm-badges-title-row' });
		titleRow.createEl('h3', { text: '🏆 Galerie des Trophées', cls: 'sbm-badges-section-title' });
		titleRow.createSpan({ cls: 'sbm-badges-counter', text: `${unlockedCount} / ${defs.length}` });

		BADGE_CATEGORY_LABELS.forEach(({ id, label }) => {
			const inCategory = defs.filter(d => d.category === id);
			if (inCategory.length === 0) return;
			const done = inCategory.filter(d => badges[d.id]?.unlockedAt).length;
			const section = container.createDiv({ cls: 'sbm-badges-category' });
			const head = section.createDiv({ cls: 'sbm-badges-category-head' });
			head.createSpan({ cls: 'sbm-badges-category-title', text: label });
			head.createSpan({ cls: 'sbm-badges-category-count', text: `${done} / ${inCategory.length}` });
			const gridEl = section.createDiv({ cls: 'sbm-badges-grid' });
			// Débloqués d'abord, puis les plus proches du but
			const ratio = (d: BadgeDefinition) => (badges[d.id]?.progress || 0) / d.maxProgress;
			[...inCategory]
				.sort((a, b) => Number(Boolean(badges[b.id]?.unlockedAt)) - Number(Boolean(badges[a.id]?.unlockedAt)) || ratio(b) - ratio(a))
				.forEach(badgeDef => this.renderBadgeCard(gridEl, badgeDef));
		});
	}

	private renderBadgeCard(gridEl: HTMLElement, badgeDef: BadgeDefinition): void {
		const userBadge = this.plugin.pluginData.badges[badgeDef.id];
		const isUnlocked = Boolean(userBadge && userBadge.unlockedAt);
		const progress = userBadge ? Math.min(userBadge.progress, badgeDef.maxProgress) : 0;

		const card = gridEl.createEl('div', {
			cls: `sbm-badge-card ${isUnlocked ? 'is-unlocked' : 'is-locked'}`
		});

		const badgeHeader = card.createDiv({ cls: 'sbm-badge-card-header' });
		const iconEl = badgeHeader.createDiv({ cls: 'sbm-badge-icon' });
		setIcon(iconEl, badgeDef.icon || 'award');

		const badgeMeta = badgeHeader.createDiv({ cls: 'sbm-badge-meta' });
		badgeMeta.createEl('h4', { text: badgeDef.name, cls: 'sbm-badge-name' });

		card.createEl('p', { text: badgeDef.description, cls: 'sbm-badge-desc' });

		const footerEl = card.createDiv({ cls: 'sbm-badge-footer' });
		if (isUnlocked) {
			const dateStr = userBadge.unlockedAt ? new Date(userBadge.unlockedAt).toLocaleDateString('fr-FR') : 'Obtenu';
			footerEl.createSpan({ text: `✨ Débloqué le ${dateStr}`, cls: 'sbm-badge-unlocked-tag' });
		} else {
			const progressWrap = footerEl.createDiv({ cls: 'sbm-badge-progress-wrap' });
			progressWrap.createDiv({ cls: 'sbm-badge-progress-text', text: `Progression : ${progress} / ${badgeDef.maxProgress}` });
			const progressBar = progressWrap.createDiv({ cls: 'sbm-badge-progress-bar' });
			const percent = Math.min(100, Math.round((progress / badgeDef.maxProgress) * 100));
			progressBar.createDiv({ cls: 'sbm-badge-progress-fill' }).style.width = `${percent}%`;
		}
	}

	/* ======================================================================
	   Boutique : échanger ses pièces contre des récompenses
	   ====================================================================== */

	private renderShopTab(container: Element): void {
		const data = this.plugin.pluginData;
		const balance = data.wallet.balance;
		const rewards = (data.rewards || []).filter(r => r.enabled).sort((a, b) => a.cost - b.cost);

		const hero = container.createDiv({ cls: 'sbm-shop-hero' });
		const heroIcon = hero.createDiv({ cls: 'sbm-shop-hero-icon' });
		setIcon(heroIcon, 'shopping-bag');
		const heroInfo = hero.createDiv({ cls: 'sbm-shop-hero-info' });
		heroInfo.createEl('h3', { text: `${balance} 🪙 à dépenser` });
		const affordable = rewards.filter(r => r.cost <= balance).length;
		heroInfo.createEl('p', {
			cls: 'sbm-shop-hero-desc',
			text: rewards.length === 0
				? 'Aucune récompense dans la boutique pour le moment.'
				: affordable > 0
					? `${affordable} récompense${affordable > 1 ? 's' : ''} à votre portée. Faites-vous plaisir, c'est mérité.`
					: 'Encore un peu d’efforts : chaque tâche vous rapproche de votre prochaine récompense.'
		});
		const manageBtn = hero.createEl('button', { cls: 'sbm-shop-manage-btn', text: 'Gérer le catalogue' });
		manageBtn.title = 'Ajouter ou modifier des récompenses dans les réglages';
		manageBtn.addEventListener('click', () => this.openRewardSettings());

		if (rewards.length === 0) {
			container.createDiv({ cls: 'sbm-shop-empty', text: 'Ajoutez vos premières récompenses (une pause jeu, un bon repas, un film…) dans les réglages du plugin.' });
		} else {
			const grid = container.createDiv({ cls: 'sbm-shop-grid' });
			rewards.forEach(reward => {
				const canBuy = reward.cost <= balance;
				const card = grid.createDiv({ cls: `sbm-shop-card ${canBuy ? 'is-affordable' : 'is-locked'}` });
				const top = card.createDiv({ cls: 'sbm-shop-card-top' });
				top.createDiv({ cls: 'sbm-shop-card-name', text: reward.name });
				top.createDiv({ cls: 'sbm-shop-card-cost', text: `${reward.cost} 🪙` });
				if (reward.description) card.createDiv({ cls: 'sbm-shop-card-desc', text: reward.description });

				if (!canBuy) {
					const missing = reward.cost - balance;
					const wrap = card.createDiv({ cls: 'sbm-shop-card-progress' });
					const bar = wrap.createDiv({ cls: 'sbm-badge-progress-bar' });
					bar.createDiv({ cls: 'sbm-badge-progress-fill' }).style.width = `${Math.max(0, Math.min(100, Math.round((balance / reward.cost) * 100)))}%`;
					wrap.createDiv({ cls: 'sbm-shop-card-missing', text: `Encore ${missing} pièce${missing > 1 ? 's' : ''}` });
				}

				const pending = this.pendingPurchaseId === reward.id;
				const buyBtn = card.createEl('button', {
					cls: `sbm-shop-buy-btn ${pending ? 'is-armed' : ''} ${canBuy ? 'mod-cta' : ''}`,
					text: pending ? `Confirmer (−${reward.cost} 🪙)` : canBuy ? 'Échanger' : 'Pas encore'
				});
				buyBtn.disabled = !canBuy;
				buyBtn.addEventListener('click', () => this.onBuyClick(reward.id));
			});
		}

		// Historique des échanges
		const purchases = [...((data.rewardPurchases || []) as RewardPurchase[])].reverse();
		const historyHead = container.createDiv({ cls: 'sbm-shop-history-head' });
		historyHead.createEl('h3', { text: '🧾 Mes récompenses' });
		historyHead.createSpan({ cls: 'sbm-shop-history-total', text: `${data.wallet.lifetimeSpent || 0} 🪙 dépensées au total` });
		if (purchases.length === 0) {
			container.createDiv({ cls: 'sbm-shop-empty', text: 'Aucune récompense échangée pour l’instant.' });
			return;
		}
		const list = container.createDiv({ cls: 'sbm-shop-history' });
		purchases.slice(0, 30).forEach(p => {
			const row = list.createDiv({ cls: 'sbm-shop-history-row' });
			row.createSpan({ cls: 'sbm-shop-history-name', text: `🎁 ${p.rewardName}` });
			row.createSpan({
				cls: 'sbm-shop-history-date',
				text: new Date(p.purchasedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
			});
			row.createSpan({ cls: 'sbm-shop-history-cost', text: `−${p.cost} 🪙` });
			const undo = row.createEl('button', { cls: 'sbm-shop-undo-btn clickable-icon' });
			setIcon(undo, 'undo-2');
			undo.title = 'Annuler cet échange (les pièces sont rendues)';
			undo.addEventListener('click', async () => {
				if (GamificationService.refundPurchase(this.plugin.pluginData, p.id)) {
					await this.plugin.savePluginData();
					new Notice(`↩️ Échange annulé : +${p.cost} 🪙 rendues`);
					await this.render();
				}
			});
		});
	}

	/** Achat en deux clics : le premier arme le bouton, le second confirme (4 s). */
	private async onBuyClick(rewardId: string): Promise<void> {
		if (this.pendingPurchaseId !== rewardId) {
			this.pendingPurchaseId = rewardId;
			if (this.pendingPurchaseTimer) window.clearTimeout(this.pendingPurchaseTimer);
			this.pendingPurchaseTimer = window.setTimeout(() => {
				this.pendingPurchaseId = null;
				if (this.currentTab === 'shop') void this.render();
			}, 4000);
			await this.render();
			return;
		}
		this.pendingPurchaseId = null;
		if (this.pendingPurchaseTimer) window.clearTimeout(this.pendingPurchaseTimer);
		const res = GamificationService.purchaseReward(this.plugin.pluginData, rewardId);
		new Notice(res.message, res.ok ? 5000 : 4000);
		if (res.ok) {
			res.newlyUnlockedBadges.forEach(b => new Notice(`🏆 NOUVEAU TROPHÉE : ${b.name} !\n${b.description}`, 7000));
			await this.plugin.savePluginData();
		}
		await this.render();
	}

	private openRewardSettings(): void {
		const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.plugin.manifest.id);
	}

	private renderHistoryTab(container: Element, events: Array<{ taskId: string; completedAt: string; coins: number; taskText: string; categoryTags?: string[] }>): void {
		const searchContainer = container.createEl('div', { cls: 'sbm-history-search' });
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: '🔍 Rechercher une tâche ou une récompense (titre, tag)...'
		});
		searchInput.value = this.searchQuery;
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value.toLowerCase().trim();
			this.renderList(listContainer, events);
		});

		const listContainer = container.createEl('div', { cls: 'sbm-history-list' });
		this.renderList(listContainer, events);
	}

	private renderList(container: Element, events: Array<{ taskId: string; completedAt: string; coins: number; taskText: string; categoryTags?: string[] }>): void {
		container.empty();

		const q = this.searchQuery;
		const filtered = events.filter(e => {
			if (!q) return true;
			const matchText = (e.taskText || '').toLowerCase().includes(q);
			const matchTags = (e.categoryTags || []).some(t => t.toLowerCase().includes(q));
			return matchText || matchTags;
		});

		// Échanges de la boutique, mêlés aux tâches dans l'ordre chronologique
		const purchases = ((this.plugin.pluginData.rewardPurchases || []) as RewardPurchase[])
			.filter(p => !q || (p.rewardName || '').toLowerCase().includes(q) || 'récompense'.includes(q));

		type Entry = { kind: 'task'; at: string; item: typeof events[number] } | { kind: 'purchase'; at: string; purchase: RewardPurchase };
		const entries: Entry[] = [
			...filtered.map(item => ({ kind: 'task' as const, at: item.completedAt || '', item })),
			...purchases.map(purchase => ({ kind: 'purchase' as const, at: purchase.purchasedAt || '', purchase }))
		].sort((a, b) => b.at.localeCompare(a.at));

		if (entries.length === 0) {
			const emptyState = container.createEl('div', { cls: 'sbm-empty-history' });
			emptyState.setText(q ? 'Aucune entrée ne correspond à votre recherche.' : 'Aucune tâche récompensée pour le moment.');
			return;
		}

		entries.forEach(entry => {
			if (entry.kind === 'purchase') {
				this.renderPurchaseRow(container, entry.purchase);
				return;
			}
			const item = entry.item;
			const row = container.createEl('div', { cls: 'sbm-history-card' });

			const mainInfo = row.createEl('div', { cls: 'sbm-history-left' });
			mainInfo.createEl('div', { cls: 'sbm-history-task-text', text: item.taskText });

			const metaInfo = mainInfo.createEl('div', { cls: 'sbm-history-meta' });
			const dateFormatted = new Date(item.completedAt).toLocaleString('fr-FR', {
				dateStyle: 'short',
				timeStyle: 'short'
			});
			metaInfo.createEl('span', { cls: 'sbm-history-date', text: dateFormatted });

			if (item.categoryTags && item.categoryTags.length > 0) {
				const tagsWrap = metaInfo.createEl('span', { cls: 'sbm-history-tags' });
				item.categoryTags.forEach(t => {
					tagsWrap.createEl('span', { cls: 'sbm-tag-pill', text: t });
				});
			}

			const rightWrap = row.createEl('div', { cls: 'sbm-history-right' });
			rightWrap.createEl('span', { cls: 'sbm-history-coins', text: `+${item.coins} 🪙` });

			const refundBtn = rightWrap.createEl('button', {
				cls: 'sbm-revoke-btn',
				text: 'Annuler'
			});
			refundBtn.title = 'Annuler cette complétion et rembourser les pièces';
			refundBtn.addEventListener('click', async () => {
				const res = GamificationService.removeCompletion(item.taskId, this.plugin.pluginData);
				if (res.success) {
					await this.plugin.savePluginData();
					new Notice(`Complétion annulée. Solde mis à jour : ${res.newBalance} 🪙`);
					await this.render();
				}
			});
		});
	}

	/** Ligne d'historique pour un échange de pièces contre une récompense. */
	private renderPurchaseRow(container: Element, p: RewardPurchase): void {
		const row = container.createEl('div', { cls: 'sbm-history-card is-purchase' });

		const mainInfo = row.createEl('div', { cls: 'sbm-history-left' });
		mainInfo.createEl('div', { cls: 'sbm-history-task-text', text: `🎁 ${p.rewardName}` });
		const metaInfo = mainInfo.createEl('div', { cls: 'sbm-history-meta' });
		metaInfo.createEl('span', {
			cls: 'sbm-history-date',
			text: new Date(p.purchasedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
		});
		metaInfo.createEl('span', { cls: 'sbm-tag-pill sbm-history-purchase-pill', text: 'Récompense' });

		const rightWrap = row.createEl('div', { cls: 'sbm-history-right' });
		rightWrap.createEl('span', { cls: 'sbm-history-coins is-spent', text: `−${p.cost} 🪙` });
		const undoBtn = rightWrap.createEl('button', { cls: 'sbm-revoke-btn', text: 'Annuler' });
		undoBtn.title = 'Annuler cet échange et récupérer les pièces';
		undoBtn.addEventListener('click', async () => {
			if (GamificationService.refundPurchase(this.plugin.pluginData, p.id)) {
				await this.plugin.savePluginData();
				new Notice(`↩️ Échange annulé : +${p.cost} 🪙 rendues`);
				await this.render();
			}
		});
	}

	private renderAdvancedStatsTab(container: Element, events: Array<{ taskId: string; completedAt: string; coins: number; taskText: string; categoryTags?: string[] }>): void {
		const grid = container.createEl('div', { cls: 'sbm-stats-grid' });

		// 1. Courbe d'évolution sur 14 jours
		const sparkCard = grid.createEl('div', { cls: 'sbm-stat-card full-width' });
		sparkCard.createEl('h3', { text: '📈 Gains (14 derniers jours)' });
		const trendData = this.calculate14DayTrend(events);
		this.renderSparkline(sparkCard, trendData);

		// 2. Répartition par catégorie / Tag (Camembert SVG)
		const catCard = grid.createEl('div', { cls: 'sbm-stat-card' });
		catCard.createEl('h3', { text: '🍩 Répartition catégories' });
		const catData = this.calculateCategoryDistribution(events);
		this.renderCategoryDonut(catCard, catData);

		// 3. Tâches validées par jour (Barres SVG)
		const barCard = grid.createEl('div', { cls: 'sbm-stat-card' });
		barCard.createEl('h3', { text: '📊 Activité récente (7 jours)' });
		this.renderDailyBarChart(barCard, trendData.slice(-7));
	}

	private calculate14DayTrend(events: Array<{ completedAt: string; coins: number }>): { date: string; coins: number }[] {
		const result: { date: string; coins: number }[] = [];
		const now = new Date();

		for (let i = 13; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			const dateStr = d.toISOString().split('T')[0];

			const totalCoins = events
				.filter(e => e.completedAt && e.completedAt.startsWith(dateStr))
				.reduce((acc, curr) => acc + curr.coins, 0);

			result.push({ date: dateStr, coins: totalCoins });
		}
		return result;
	}

	private calculateCategoryDistribution(events: Array<{ categoryTags?: string[]; coins: number }>): Record<string, number> {
		const dist: Record<string, number> = {};
		events.forEach(e => {
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

	private renderSparkline(container: Element, trend: { date: string; coins: number }[]): void {
		const chartWrap = container.createEl('div', { cls: 'sbm-chart-wrapper' });
		chartWrap.empty();

		const width = 600;
		const height = 180;
		const padding = 30;

		const maxCoins = Math.max(1, ...trend.map(t => t.coins));
		const stepX = (width - padding * 2) / (trend.length - 1);

		const points = trend.map((t, idx) => {
			const x = padding + idx * stepX;
			const y = height - padding - (t.coins / maxCoins) * (height - padding * 2);
			return `${x},${y}`;
		});

		const svgEl = DomUtils.appendSvgChild(chartWrap, 'svg', {
			viewBox: `0 0 ${width} ${height}`,
			class: 'sbm-sparkline-svg'
		});

		// Zone de remplissage sous la courbe
		const areaPoints = `${padding},${height - padding} ${points.join(' ')} ${width - padding},${height - padding}`;
		DomUtils.appendSvgChild(svgEl, 'polygon', {
			points: areaPoints,
			class: 'sbm-sparkline-area'
		});

		// Ligne de courbe
		DomUtils.appendSvgChild(svgEl, 'polyline', {
			points: points.join(' '),
			class: 'sbm-sparkline-line'
		});

		// Points et infobulles
		trend.forEach((t, idx) => {
			const [x, y] = points[idx].split(',').map(Number);
			DomUtils.appendSvgChild(svgEl, 'circle', {
				cx: x,
				cy: y,
				r: t.coins > 0 ? 5 : 3,
				class: `sbm-sparkline-dot ${t.coins > 0 ? 'active' : ''}`
			});

			// Label de date sous l'axe
			if (idx % 2 === 0 || idx === trend.length - 1) {
				const dayLabel = t.date.slice(5);
				DomUtils.appendSvgChild(svgEl, 'text', {
					x,
					y: height - 10,
					class: 'sbm-axis-label',
					'text-anchor': 'middle'
				}, dayLabel);
			}
		});
	}

	private renderCategoryDonut(container: Element, dist: Record<string, number>): void {
		const chartWrap = container.createEl('div', { cls: 'sbm-chart-wrapper donut' });
		chartWrap.empty();

		const total = Object.values(dist).reduce((a, b) => a + b, 0);
		if (total === 0) {
			chartWrap.createEl('p', { text: 'Aucune donnée de catégorie disponible.', cls: 'sbm-empty-text' });
			return;
		}

		const width = 200;
		const height = 200;
		const cx = 100;
		const cy = 100;
		const radius = 70;
		const innerRadius = 45;

		const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#6366f1'];
		const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 6);

		let currentAngle = 0;
		const svgEl = DomUtils.appendSvgChild(chartWrap, 'svg', {
			viewBox: `0 0 ${width} ${height}`,
			class: 'sbm-donut-svg'
		});

		entries.forEach(([_cat, val], idx) => {
			const sliceAngle = (val / total) * 2 * Math.PI;
			const startAngle = currentAngle;
			const endAngle = currentAngle + sliceAngle;
			currentAngle = endAngle;

			const x1 = cx + radius * Math.cos(startAngle);
			const y1 = cy + radius * Math.sin(startAngle);
			const x2 = cx + radius * Math.cos(endAngle);
			const y2 = cy + radius * Math.sin(endAngle);

			const ix1 = cx + innerRadius * Math.cos(endAngle);
			const iy1 = cy + innerRadius * Math.sin(endAngle);
			const ix2 = cx + innerRadius * Math.cos(startAngle);
			const iy2 = cy + innerRadius * Math.sin(startAngle);

			const largeArc = sliceAngle > Math.PI ? 1 : 0;
			const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;

			DomUtils.appendSvgChild(svgEl, 'path', {
				d: pathData,
				fill: colors[idx % colors.length],
				class: 'sbm-donut-slice'
			});
		});

		// Texte central
		DomUtils.appendSvgChild(svgEl, 'text', {
			x: cx,
			y: cy + 5,
			'text-anchor': 'middle',
			class: 'sbm-donut-center-text'
		}, `${total}🪙`);

		// Légende
		const legend = container.createEl('div', { cls: 'sbm-donut-legend' });
		entries.forEach(([cat, val], idx) => {
			const row = legend.createEl('div', { cls: 'sbm-legend-row' });
			const colorBox = row.createEl('span', { cls: 'sbm-legend-color' });
			colorBox.style.backgroundColor = colors[idx % colors.length];
			const percentage = Math.round((val / total) * 100);
			row.createEl('span', { cls: 'sbm-legend-text', text: `${cat} : ${val} 🪙 (${percentage}%)` });
		});
	}

	private renderDailyBarChart(container: Element, trend: { date: string; coins: number }[]): void {
		const chartWrap = container.createEl('div', { cls: 'sbm-chart-wrapper' });
		chartWrap.empty();

		const width = 280;
		const height = 160;
		const maxCoins = Math.max(1, ...trend.map(t => t.coins));
		const barWidth = 26;
		const gap = (width - barWidth * trend.length) / (trend.length + 1);

		const svgEl = DomUtils.appendSvgChild(chartWrap, 'svg', {
			viewBox: `0 0 ${width} ${height}`,
			class: 'sbm-sparkline-svg'
		});

		trend.forEach((item, index) => {
			const x = gap + index * (barWidth + gap);
			const barHeight = Math.max(4, (item.coins / maxCoins) * (height - 40));
			const y = height - barHeight - 22;
			const dayLabel = item.date.slice(5);

			DomUtils.appendSvgChild(svgEl, 'rect', {
				x,
				y,
				width: barWidth,
				height: barHeight,
				rx: 4,
				class: `sbm-bar ${item.coins > 0 ? 'active' : 'empty'}`
			});

			DomUtils.appendSvgChild(svgEl, 'text', {
				x: x + barWidth / 2,
				y: height - 6,
				class: 'sbm-bar-label',
				'text-anchor': 'middle'
			}, dayLabel);

			if (item.coins > 0) {
				DomUtils.appendSvgChild(svgEl, 'text', {
					x: x + barWidth / 2,
					y: y - 4,
					class: 'sbm-bar-val',
					'text-anchor': 'middle'
				}, String(item.coins));
			}
		});
	}

	private openResetConfirmationModal(): void {
		new ResetGamificationModal(this.app, this.plugin, async () => {
			const res = await GamificationService.archiveAndResetGamification(this.app, this.plugin.pluginData);
			if (res.success) {
				await this.plugin.savePluginData();
				new Notice(`Score archivé dans "${res.archivePath}". Les compteurs sont remis à 0 !`, 6000);
				try {
					await this.app.workspace.openLinkText(res.archivePath, '', false);
				} catch {
					// fallback
				}
				await this.render();
			}
		}).open();
	}
}

export class ResetGamificationModal extends Modal {
	private plugin: SecondBrainPlugin;
	private onConfirmed: () => Promise<void>;

	constructor(app: App, plugin: SecondBrainPlugin, onConfirmed: () => Promise<void>) {
		super(app);
		this.plugin = plugin;
		this.onConfirmed = onConfirmed;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sbm-reset-score-modal');

		contentEl.createEl('h2', { text: '🪙 Repartir à zéro & Archiver le score' });

		const currentBalance = this.plugin.pluginData?.wallet?.balance || 0;
		const currentStreak = this.plugin.pluginData?.streak?.currentStreak || 0;
		const eventsCount = Object.keys(this.plugin.pluginData?.completionEvents || {}).length;

		const desc = contentEl.createEl('p', {
			text: `Voulez-vous archiver votre progression actuelle (${currentBalance} 🪙, série de ${currentStreak} j, ${eventsCount} tâches validées) et repartir sur de nouvelles bases ?`
		});
		desc.style.lineHeight = '1.45';

		const noteInfo = contentEl.createEl('div', { cls: 'sbm-reset-info-box' });
		noteInfo.createEl('p', {
			text: '📁 Une note d\'archive détaillée ("00 - Archives/Bilan Score & Pièces...") contenant l\'ensemble de vos gains, trophées et historique de tâches sera automatiquement créée dans votre coffre.'
		});

		const actions = contentEl.createDiv({ cls: 'sbm-modal-actions-row' });
		const cancelBtn = actions.createEl('button', { text: 'Annuler' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = actions.createEl('button', {
			cls: 'mod-warning',
			text: '💾 Confirmer l\'archivage et repartir à 0'
		});
		confirmBtn.addEventListener('click', async () => {
			confirmBtn.disabled = true;
			confirmBtn.setText('Archivage en cours...');
			this.close();
			await this.onConfirmed();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
