import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App } from 'obsidian';
import { GamificationService } from '../services/gamificationService';
import { DomUtils } from '../utils/domUtils';
import { BADGE_DEFINITIONS } from '../models/gamification';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_GAMIFICATION_HISTORY = 'sbm-gamification-history-view';

export class GamificationHistoryView extends ItemView {
	private plugin: SecondBrainPlugin;
	private currentTab: 'history' | 'badges' | 'stats' = 'history';
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
		GamificationService.checkAndUnlockBadges(this.plugin.pluginData);

		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('sbm-history-container');

		const headerEl = container.createEl('div', { cls: 'sbm-history-header' });
		const titleWrap = headerEl.createDiv({ cls: 'sbm-history-title-wrap' });
		titleWrap.createEl('h2', { text: '🪙 Gamification — Portefeuille, séries et trophées' });

		const resetBtn = headerEl.createEl('button', {
			cls: 'sbm-history-reset-btn',
			text: '🔄 Repartir à zéro'
		});
		resetBtn.title = 'Archiver le score actuel dans une note et remettre les compteurs à 0';
		resetBtn.addEventListener('click', () => {
			this.openResetConfirmationModal();
		});

		// Navigation par Onglets
		const tabNav = container.createEl('div', { cls: 'sbm-tab-nav' });

		const historyTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'history' ? 'active' : ''}`,
			text: '📜 Historique des gains'
		});
		historyTabBtn.addEventListener('click', () => {
			this.currentTab = 'history';
			this.render();
		});

		const badgesTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'badges' ? 'active' : ''}`,
			text: '🏆 Trophées & Séries (Streaks)'
		});
		badgesTabBtn.addEventListener('click', () => {
			this.currentTab = 'badges';
			this.render();
		});

		const statsTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'stats' ? 'active' : ''}`,
			text: '📊 Statistiques avancées'
		});
		statsTabBtn.addEventListener('click', () => {
			this.currentTab = 'stats';
			this.render();
		});

		// Résumé du portefeuille & Série
		const summaryRow = container.createEl('div', { cls: 'sbm-history-summary' });

		const balanceStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		balanceStat.createEl('div', { cls: 'sbm-summary-label', text: 'Solde portefeuille' });
		balanceStat.createEl('div', { cls: 'sbm-summary-val gold', text: `${this.plugin.pluginData.wallet.balance} 🪙` });

		const streakStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		streakStat.createEl('div', { cls: 'sbm-summary-label', text: 'Série active (Streak)' });
		streakStat.createEl('div', { cls: 'sbm-summary-val streak-val', text: `🔥 ${this.plugin.pluginData.streak.currentStreak} j` });

		const lifetimeStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		lifetimeStat.createEl('div', { cls: 'sbm-summary-label', text: 'Total gagné à vie' });
		lifetimeStat.createEl('div', { cls: 'sbm-summary-val green', text: `${this.plugin.pluginData.wallet.lifetimeEarned} 🪙` });

		const events = Object.values(this.plugin.pluginData.completionEvents)
			.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

		const countStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		countStat.createEl('div', { cls: 'sbm-summary-label', text: 'Tâches validées' });
		countStat.createEl('div', { cls: 'sbm-summary-val', text: `${events.length}` });

		const mainContent = container.createEl('div', { cls: 'sbm-tab-content' });

		if (this.currentTab === 'history') {
			this.renderHistoryTab(mainContent, events);
		} else if (this.currentTab === 'badges') {
			this.renderBadgesTab(mainContent);
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
		streakInfo.createEl('h3', { text: `🔥 Série active : ${currentStreak} jour${currentStreak > 1 ? 's' : ''} consécutif${currentStreak > 1 ? 's' : ''}` });
		streakInfo.createEl('p', { 
			text: `Record historique : ${longestStreak} jour${longestStreak > 1 ? 's' : ''} — Complétez au moins une tâche chaque jour pour maintenir votre flamme !`,
			cls: 'sbm-streak-hero-desc'
		});

		// Galerie des Badges & Trophées
		container.createEl('h3', { text: '🏆 Galerie des Trophées & Accomplissements', cls: 'sbm-badges-section-title' });

		const gridEl = container.createEl('div', { cls: 'sbm-badges-grid' });

		BADGE_DEFINITIONS.forEach(badgeDef => {
			const userBadge = this.plugin.pluginData.badges[badgeDef.id];
			const isUnlocked = Boolean(userBadge && userBadge.unlockedAt);
			const progress = userBadge ? userBadge.progress : 0;

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
		});
	}

	private renderHistoryTab(container: Element, events: Array<{ taskId: string; completedAt: string; coins: number; taskText: string; categoryTags?: string[] }>): void {
		const searchContainer = container.createEl('div', { cls: 'sbm-history-search' });
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: '🔍 Rechercher une tâche complétée (titre, tag)...'
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

		const filtered = events.filter(e => {
			if (!this.searchQuery) return true;
			const matchText = (e.taskText || '').toLowerCase().includes(this.searchQuery);
			const matchTags = (e.categoryTags || []).some(t => t.toLowerCase().includes(this.searchQuery));
			return matchText || matchTags;
		});

		if (filtered.length === 0) {
			const emptyState = container.createEl('div', { cls: 'sbm-empty-history' });
			emptyState.setText(this.searchQuery ? 'Aucune tâche ne correspond à votre recherche.' : 'Aucune tâche récompensée pour le moment.');
			return;
		}

		filtered.forEach(item => {
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

	private renderAdvancedStatsTab(container: Element, events: Array<{ taskId: string; completedAt: string; coins: number; taskText: string; categoryTags?: string[] }>): void {
		const grid = container.createEl('div', { cls: 'sbm-stats-grid' });

		// 1. Courbe d'évolution sur 14 jours
		const sparkCard = grid.createEl('div', { cls: 'sbm-stat-card full-width' });
		sparkCard.createEl('h3', { text: '📈 Évolution des gains (14 derniers jours)' });
		const trendData = this.calculate14DayTrend(events);
		this.renderSparkline(sparkCard, trendData);

		// 2. Répartition par catégorie / Tag (Camembert SVG)
		const catCard = grid.createEl('div', { cls: 'sbm-stat-card' });
		catCard.createEl('h3', { text: '🍩 Répartition par catégorie' });
		const catData = this.calculateCategoryDistribution(events);
		this.renderCategoryDonut(catCard, catData);

		// 3. Tâches validées par jour (Barres SVG)
		const barCard = grid.createEl('div', { cls: 'sbm-stat-card' });
		barCard.createEl('h3', { text: '📊 Activité quotidienne récente' });
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
