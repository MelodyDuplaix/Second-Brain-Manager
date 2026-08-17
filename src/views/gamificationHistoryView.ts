import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { GamificationService } from '../services/gamificationService';
import { DomUtils } from '../utils/domUtils';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_GAMIFICATION_HISTORY = 'sbm-gamification-history-view';

export class GamificationHistoryView extends ItemView {
	private plugin: SecondBrainPlugin;
	private currentTab: 'history' | 'stats' = 'history';
	private searchQuery = '';

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_GAMIFICATION_HISTORY;
	}

	getDisplayText(): string {
		return 'Historique et statistiques des pièces';
	}

	getIcon(): string {
		return 'coins';
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('sbm-history-container');

		const headerEl = container.createEl('div', { cls: 'sbm-history-header' });
		headerEl.createEl('h2', { text: '🪙 Gamification — Historique et statistiques' });

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

		const statsTabBtn = tabNav.createEl('button', {
			cls: `sbm-tab-btn ${this.currentTab === 'stats' ? 'active' : ''}`,
			text: '📊 Statistiques avancées (courbe et camembert)'
		});
		statsTabBtn.addEventListener('click', () => {
			this.currentTab = 'stats';
			this.render();
		});

		// Résumé du portefeuille
		const summaryRow = container.createEl('div', { cls: 'sbm-history-summary' });

		const balanceStat = summaryRow.createEl('div', { cls: 'sbm-summary-card' });
		balanceStat.createEl('div', { cls: 'sbm-summary-label', text: 'Solde portefeuille' });
		balanceStat.createEl('div', { cls: 'sbm-summary-val gold', text: `${this.plugin.pluginData.wallet.balance} 🪙` });

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
		} else {
			this.renderAdvancedStatsTab(mainContent, events);
		}
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
			return e.taskText.toLowerCase().includes(this.searchQuery) ||
				(e.categoryTags && e.categoryTags.some(t => t.toLowerCase().includes(this.searchQuery)));
		});

		if (filtered.length === 0) {
			container.createEl('p', { cls: 'sbm-empty-text', text: 'Aucun événement de complétion trouvé.' });
			return;
		}

		filtered.forEach(event => {
			const itemCard = container.createEl('div', { cls: 'sbm-history-card' });

			const leftCol = itemCard.createEl('div', { cls: 'sbm-history-left' });
			leftCol.createEl('div', { cls: 'sbm-history-task-text', text: event.taskText });

			const metaRow = leftCol.createEl('div', { cls: 'sbm-history-meta' });
			const formattedDate = event.completedAt ? new Date(event.completedAt).toLocaleString() : 'Date inconnue';
			metaRow.createEl('span', { cls: 'sbm-history-date', text: `🕒 ${formattedDate}` });

			if (event.categoryTags && event.categoryTags.length > 0) {
				event.categoryTags.forEach(tag => {
					metaRow.createEl('span', { cls: 'sbm-cat-pill', text: tag });
				});
			}

			const rightCol = itemCard.createEl('div', { cls: 'sbm-history-right' });
			rightCol.createEl('div', { cls: 'sbm-history-coins', text: `+${event.coins} 🪙` });

			const revokeBtn = rightCol.createEl('button', { cls: 'sbm-revoke-btn', text: '🗑️ Annuler' });
			revokeBtn.title = 'Annuler ce gain et déduire les pièces du portefeuille';
			revokeBtn.addEventListener('click', async () => {
				const res = GamificationService.removeCompletion(event.taskId, this.plugin.pluginData);
				if (res.success) {
					await this.plugin.savePluginData();
					new Notice(`🗑️ Gain annulé : -${res.deductedCoins} 🪙 déduites (Nouveau solde : ${res.newBalance} 🪙)`);
					await this.render();
				}
			});
		});
	}

	private renderAdvancedStatsTab(container: Element, _events: Array<{ taskId: string; completedAt: string; coins: number; taskText: string; categoryTags?: string[] }>): void {
		const statsGrid = container.createEl('div', { cls: 'sbm-stats-grid' });

		// 1. Graphique en Courbe (Line Chart SVG)
		const lineCard = statsGrid.createEl('div', { cls: 'sbm-stats-chart-card full-width' });
		lineCard.createEl('h3', { text: '📈 Évolution temporelle des pièces (courbe des 14 derniers jours)' });
		const trend14 = GamificationService.getDailyTrend(this.plugin.pluginData, 14);
		this.renderLineChart(lineCard, trend14);

		// 2. Graphique en Camembert / Donut (Donut Chart SVG)
		const pieCard = statsGrid.createEl('div', { cls: 'sbm-stats-chart-card' });
		pieCard.createEl('h3', { text: '🥧 Répartition des pièces par catégorie (camembert)' });
		const catBreakdown = GamificationService.getCoinsByCategory(this.plugin.pluginData);
		this.renderDonutChart(pieCard, catBreakdown);

		// 3. Graphique en Barres Quotidiennes (Daily Bar Chart)
		const barCard = statsGrid.createEl('div', { cls: 'sbm-stats-chart-card' });
		barCard.createEl('h3', { text: '📊 Comparatif quotidien (7 derniers jours)' });
		const trend7 = GamificationService.getDailyTrend(this.plugin.pluginData, 7);
		this.renderDailyBarChart(barCard, trend7);
	}

	private renderLineChart(container: Element, trend: { date: string; coins: number }[]): void {
		const chartWrap = container.createEl('div', { cls: 'sbm-chart-wrapper' });
		chartWrap.empty();

		const width = 560;
		const height = 180;
		const padding = 35;

		const maxVal = Math.max(5, ...trend.map(t => t.coins));
		const stepX = (width - padding * 2) / (trend.length - 1);

		const points = trend.map((item, idx) => {
			const x = padding + idx * stepX;
			const y = height - padding - (item.coins / maxVal) * (height - padding * 2);
			return { x, y, coins: item.coins, date: item.date.slice(5) };
		});

		const pathD = points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '');
		const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

		const svgEl = DomUtils.appendSvgChild(chartWrap, 'svg', {
			viewBox: `0 0 ${width} ${height}`,
			class: 'sbm-advanced-svg'
		});

		// Area fill
		DomUtils.appendSvgChild(svgEl, 'path', {
			d: areaD,
			class: 'sbm-line-area'
		});

		// Line stroke
		DomUtils.appendSvgChild(svgEl, 'path', {
			d: pathD,
			class: 'sbm-line-stroke'
		});

		// Points & Labels
		points.forEach(pt => {
			DomUtils.appendSvgChild(svgEl, 'circle', {
				cx: pt.x,
				cy: pt.y,
				r: 4,
				class: 'sbm-line-dot'
			});

			DomUtils.appendSvgChild(svgEl, 'text', {
				x: pt.x,
				y: height - 12,
				class: 'sbm-chart-axis-label',
				'text-anchor': 'middle'
			}, pt.date);

			if (pt.coins > 0) {
				DomUtils.appendSvgChild(svgEl, 'text', {
					x: pt.x,
					y: pt.y - 8,
					class: 'sbm-chart-val-label',
					'text-anchor': 'middle'
				}, String(pt.coins));
			}
		});
	}

	private renderDonutChart(container: Element, catBreakdown: Record<string, number>): void {
		const chartWrap = container.createEl('div', { cls: 'sbm-donut-wrapper' });
		chartWrap.empty();

		const entries = Object.entries(catBreakdown);
		const total = entries.reduce((acc, [, val]) => acc + val, 0);

		if (total === 0) {
			chartWrap.createEl('p', { cls: 'sbm-empty-text', text: 'Aucune donnée pour le camembert.' });
			return;
		}

		const colors = ['#4caf50', '#2196f3', '#ff9800', '#e91e63', '#9c27b0', '#00bcd4', '#ffeb3b'];
		const radius = 60;
		const cx = 80;
		const cy = 80;

		let cumulativePercent = 0;
		const svgEl = DomUtils.appendSvgChild(chartWrap, 'svg', {
			viewBox: '0 0 160 160',
			class: 'sbm-donut-svg'
		});

		entries.forEach(([_cat, val], idx) => {
			const percent = val / total;

			const startAngle = cumulativePercent * 2 * Math.PI;
			const endAngle = (cumulativePercent + percent) * 2 * Math.PI;
			cumulativePercent += percent;

			const x1 = cx + radius * Math.cos(startAngle - Math.PI / 2);
			const y1 = cy + radius * Math.sin(startAngle - Math.PI / 2);
			const x2 = cx + radius * Math.cos(endAngle - Math.PI / 2);
			const y2 = cy + radius * Math.sin(endAngle - Math.PI / 2);

			const largeArc = percent > 0.5 ? 1 : 0;
			const color = colors[idx % colors.length];

			if (entries.length === 1) {
				DomUtils.appendSvgChild(svgEl, 'circle', {
					cx,
					cy,
					r: radius,
					fill: color
				});
			} else {
				const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
				DomUtils.appendSvgChild(svgEl, 'path', {
					d: pathData,
					fill: color
				});
			}
		});

		// Donut hole
		DomUtils.appendSvgChild(svgEl, 'circle', {
			cx,
			cy,
			r: 35,
			fill: 'var(--background-primary)'
		});

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
}
