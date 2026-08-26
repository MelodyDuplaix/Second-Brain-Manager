import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath } from 'obsidian';
import { ObsidianTask, TaskPriority } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory, MatrixQuadrant } from '../adapters/matrixAdapter';
import { InlineMetaPopover } from './inlineMetaPopover';
import { GamificationService } from '../services/gamificationService';
import { DomUtils } from '../utils/domUtils';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_DASHBOARD = 'sbm-dashboard-view';

export class DashboardView extends ItemView {
	private plugin: SecondBrainPlugin;
	private popover: InlineMetaPopover;
	private taskSearchQuery = '';
	private showAllTodoTasks = false;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.popover = new InlineMetaPopover();
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return 'Tableau de bord';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	onClose(): Promise<void> {
		this.popover.close();
		return super.onClose();
	}

	async render(): Promise<void> {
		const container = (this as any).contentEl || this.containerEl.children[1] || this.containerEl;
		container.empty();
		container.addClass('sbm-dashboard-container');

		const currentEnergy = this.plugin.settings.energyLevel;
		const isEconomyMode = currentEnergy <= 3;

		// Header principal
		const headerEl = container.createEl('div', { cls: 'sbm-dashboard-header' });
		headerEl.createEl('h2', { text: '📊 Tableau de bord' });

		// Barre d'énergie
		const energyContainer = headerEl.createEl('div', { cls: 'sbm-energy-bar' });
		energyContainer.createEl('span', { text: `Énergie : ` });

		const energySelect = energyContainer.createEl('select');
		for (let i = 1; i <= 10; i++) {
			const option = energySelect.createEl('option', { value: i.toString(), text: `${i} / 10` });
			if (i === currentEnergy) option.selected = true;
		}

		energySelect.addEventListener('change', async () => {
			const val = parseInt(energySelect.value, 10);
			this.plugin.settings.energyLevel = val;
			await this.plugin.saveSettings();
			await this.render();
		});

		energyContainer.createEl('span', {
			cls: `sbm-mode-badge ${isEconomyMode ? 'economy' : 'full'}`,
			text: isEconomyMode ? '⚡ Mode économie' : '🔥 Mode plein potentiel'
		});

		// Carte de Gamification & Statistiques de pièces
		this.renderGamificationStatsCard(container);

		// Chargement de toutes les tâches
		const allTasks = await this.loadAllVaultTasks();
		const todoTasks = allTasks.filter(t => !t.completed && t.status !== 'cancelled');

		// Badge récapitulatif global des tâches détectées (aide au debug)
		const summaryCard = container.createEl('div', { cls: 'sbm-tasks-summary-card' });
		summaryCard.createEl('span', {
			cls: 'sbm-summary-badge total',
			text: `📋 ${todoTasks.length} tâche${todoTasks.length > 1 ? 's' : ''} à faire détectée${todoTasks.length > 1 ? 's' : ''}`
		});
		const dueCount = todoTasks.filter(t => !!t.dueDate || !!t.scheduledDate).length;
		if (dueCount > 0) {
			summaryCard.createEl('span', { cls: 'sbm-summary-badge due', text: `📅 ${dueCount} avec échéance` });
		}
		const energyCount = todoTasks.filter(t => t.energy !== undefined).length;
		if (energyCount > 0) {
			summaryCard.createEl('span', { cls: 'sbm-summary-badge energy', text: `⚡ ${energyCount} avec énergie` });
		}

		// Barre de recherche de tâches
		const searchContainer = container.createEl('div', { cls: 'sbm-task-search-container' });
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: '🔍 Rechercher une tâche (titre, tag, note)...'
		});
		searchInput.value = this.taskSearchQuery;
		searchInput.addEventListener('input', () => {
			this.taskSearchQuery = searchInput.value.toLowerCase().trim();
			this.renderSections(sectionsContainer, allTasks, isEconomyMode);
		});

		const sectionsContainer = container.createEl('div', { cls: 'sbm-sections-wrapper' });
		this.renderSections(sectionsContainer, allTasks, isEconomyMode);
	}

	private renderSections(container: Element, allTasks: ObsidianTask[], isEconomyMode: boolean): void {
		container.empty();

		const filteredTasks = allTasks.filter(t => {
			if (t.completed || t.status === 'cancelled') return false;
			if (!this.taskSearchQuery) return true;

			const matchTitle = t.title.toLowerCase().includes(this.taskSearchQuery);
			const matchPath = t.filePath.toLowerCase().includes(this.taskSearchQuery);
			const matchRaw = t.rawText.toLowerCase().includes(this.taskSearchQuery);
			const matchTags = t.domainTags && t.domainTags.some(tag => tag.toLowerCase().includes(this.taskSearchQuery));

			return matchTitle || matchPath || matchRaw || matchTags;
		});

		const matrixAdapter = MatrixAdapterFactory.createAdapter(
			this.plugin.settings.matrixProvider,
			this.plugin.settings.customMatrixMapping
		);

		const mainTask = filteredTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || (t.energy && t.energy >= 6));
		const secondaryTasks = filteredTasks.filter(t => t !== mainTask && (matrixAdapter.getQuadrant(t) === 'q2' || (t.energy && t.energy <= 5)));
		const deadlines = filteredTasks.filter(t => t !== mainTask && !secondaryTasks.includes(t) && (t.dueDate || t.scheduledDate));
		const unclassified = filteredTasks.filter(t => t !== mainTask && !secondaryTasks.includes(t) && !deadlines.includes(t));

		this.renderSection(container, '🎯 Tâche principale', mainTask ? [mainTask] : [], 'main');
		this.renderSection(container, '📋 Tâches secondaires', isEconomyMode ? secondaryTasks.slice(0, 1) : secondaryTasks, 'secondary');
		this.renderSection(container, '⏰ Échéances et urgences', deadlines, 'deadlines');
		this.renderSection(container, '❓ Tâches à qualifier (sans tag ni échéance)', unclassified, 'unclassified', true);
		this.renderSection(container, `📑 Toutes les tâches à faire détectées (${filteredTasks.length})`, filteredTasks, 'all-todo', true);
	}

	private renderGamificationStatsCard(container: Element): void {
		try {
			const statsCard = container.createEl('div', { cls: 'sbm-gamification-card' });

			const topRow = statsCard.createEl('div', { cls: 'sbm-gamification-top-row' });

			const walletBox = topRow.createEl('div', { cls: 'sbm-gamification-stat' });
			walletBox.createEl('div', { cls: 'sbm-stat-label', text: 'Solde portefeuille' });
			walletBox.createEl('div', { cls: 'sbm-stat-value gold', text: `🪙 ${this.plugin.pluginData.wallet.balance} pièces` });

			const todayCoins = GamificationService.getTodayCoins(this.plugin.pluginData);
			const todayBox = topRow.createEl('div', { cls: 'sbm-gamification-stat' });
			todayBox.createEl('div', { cls: 'sbm-stat-label', text: 'Gagnées aujourd\'hui' });
			todayBox.createEl('div', { cls: 'sbm-stat-value green', text: `+${todayCoins} 🪙` });

			// Résumé et lien historique
			const historyLink = statsCard.createEl('div', { cls: 'sbm-history-link-row' });
			const linkBtn = historyLink.createEl('button', { cls: 'sbm-history-btn', text: '📜 Consulter l\'historique des pièces (annuler un missclick)' });
			linkBtn.addEventListener('click', () => {
				this.plugin.activateHistoryView();
			});

			// Répartition par catégorie
			const categoryCoins = GamificationService.getCoinsByCategory(this.plugin.pluginData);
			const categoryEntries = Object.entries(categoryCoins);

			if (categoryEntries.length > 0) {
				const catSection = statsCard.createEl('div', { cls: 'sbm-category-breakdown' });
				catSection.createEl('div', { cls: 'sbm-cat-title', text: 'Répartition par catégorie :' });
				const catPills = catSection.createEl('div', { cls: 'sbm-cat-pills' });

				categoryEntries.forEach(([cat, amount]) => {
					const pill = catPills.createEl('span', { cls: 'sbm-cat-pill' });
					pill.setText(`${cat} : ${amount} 🪙`);
				});
			}

			// Graphique d'activité sur 7 jours (Sparkline SVG sécurisé sans innerHTML)
			const trend = GamificationService.getDailyTrend(this.plugin.pluginData, 7);
			this.renderTrendChart(statsCard, trend);
		} catch (err) {
			console.warn('[Second Brain Manager] Erreur affichage carte gamification:', err);
		}
	}

	private renderTrendChart(container: Element, trend: { date: string; coins: number }[]): void {
		const chartContainer = container.createEl('div', { cls: 'sbm-trend-container' });
		chartContainer.createEl('div', { cls: 'sbm-trend-title', text: '📈 Activité des 7 derniers jours' });

		const svgContainer = chartContainer.createEl('div', { cls: 'sbm-sparkline-wrapper' });
		svgContainer.empty();

		const maxCoins = Math.max(1, ...trend.map(t => t.coins));
		const width = 280;
		const height = 48;
		const barWidth = 28;
		const gap = (width - barWidth * trend.length) / (trend.length + 1);

		const svgEl = DomUtils.appendSvgChild(svgContainer, 'svg', {
			viewBox: `0 0 ${width} ${height}`,
			class: 'sbm-sparkline-svg'
		});

		trend.forEach((item, index) => {
			const x = gap + index * (barWidth + gap);
			const barHeight = Math.max(4, (item.coins / maxCoins) * (height - 16));
			const y = height - barHeight - 12;
			const dayLabel = item.date.slice(8);

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
				y: height - 2,
				class: 'sbm-bar-label',
				'text-anchor': 'middle'
			}, dayLabel);

			if (item.coins > 0) {
				DomUtils.appendSvgChild(svgEl, 'text', {
					x: x + barWidth / 2,
					y: y - 3,
					class: 'sbm-bar-val',
					'text-anchor': 'middle'
				}, String(item.coins));
			}
		});
	}

	private renderSection(container: Element, title: string, tasks: ObsidianTask[], sectionType: string, allowExpand = false): void {
		const sectionEl = container.createEl('div', { cls: `sbm-section sbm-section-${sectionType}` });
		sectionEl.createEl('h3', { text: title });

		if (tasks.length === 0) {
			sectionEl.createEl('p', { cls: 'sbm-empty-text', text: 'Aucune tâche dans cette catégorie.' });
			return;
		}

		const listEl = sectionEl.createEl('div', { cls: 'sbm-task-list' });

		const limit = (allowExpand && !this.showAllTodoTasks) ? 30 : tasks.length;
		const displayedTasks = tasks.slice(0, limit);

		displayedTasks.forEach(task => {
			const cardEl = listEl.createEl('div', { cls: 'sbm-task-card' });

			const infoEl = cardEl.createEl('div', { cls: 'sbm-task-info' });

			const titleEl = infoEl.createEl('span', { cls: 'sbm-task-title sbm-clickable-link', text: task.title });
			titleEl.title = `Cliquer pour ouvrir ${task.filePath} L:${task.lineNumber}`;
			titleEl.addEventListener('click', async () => {
				await this.openTaskLocation(task);
			});

			const fileEl = infoEl.createEl('span', { cls: 'sbm-task-file sbm-clickable-link', text: `📄 ${task.filePath.split('/').pop()}:${task.lineNumber}` });
			fileEl.addEventListener('click', async () => {
				await this.openTaskLocation(task);
			});

			const metaEl = infoEl.createEl('div', { cls: 'sbm-task-meta' });

			const dueTag = metaEl.createEl('span', { cls: 'sbm-meta-tag due sbm-editable-tag', text: task.dueDate ? `📅 ${task.dueDate}` : '+ 📅 Date' });
			dueTag.addEventListener('click', (e) => this.editDateInline(e.currentTarget as HTMLElement, task));

			const energyTag = metaEl.createEl('span', { cls: 'sbm-meta-tag energy sbm-editable-tag', text: task.energy ? `⚡ ${task.energy}/10` : '+ ⚡ Énergie' });
			energyTag.addEventListener('click', (e) => this.editEnergyInline(e.currentTarget as HTMLElement, task));

			const piecesTag = metaEl.createEl('span', { cls: 'sbm-meta-tag pieces sbm-editable-tag', text: task.pieces ? `🪙 ${task.pieces}` : '+ 🪙 Pièces' });
			piecesTag.addEventListener('click', (e) => this.editPiecesInline(e.currentTarget as HTMLElement, task));

			const priorityLabelMap: Record<string, string> = {
				highest: '🔺 Highest',
				high: '⏫ High',
				medium: '🔼 Medium',
				normal: '⚪ Normal',
				low: '🔽 Low',
				lowest: '⏬ Lowest',
			};

			const priorityText = task.prioritySignifier || task.priorityTag || (task.priority ? priorityLabelMap[task.priority] : '+ Priorité');
			const priorityTag = metaEl.createEl('span', { cls: 'sbm-meta-tag priority sbm-editable-tag', text: priorityText });
			priorityTag.addEventListener('click', (e) => this.editPriorityInline(e.currentTarget as HTMLElement, task));

			const matrixAdapter = MatrixAdapterFactory.createAdapter(this.plugin.settings.matrixProvider, this.plugin.settings.customMatrixMapping);
			const currentQuad = matrixAdapter.getQuadrant(task);
			const matrixLabel = currentQuad ? `#${currentQuad.toUpperCase()}` : '+ Quadrant';
			const matrixTag = metaEl.createEl('span', { cls: 'sbm-meta-tag matrix sbm-editable-tag', text: task.matrixTag || matrixLabel });
			matrixTag.addEventListener('click', () => this.editMatrixInline(task));

			const actionGroup = cardEl.createEl('div', { cls: 'sbm-action-group' });

			const startBtn = actionGroup.createEl('button', { cls: 'sbm-action-btn start', text: '🚀 Commencer' });
			startBtn.title = 'Passer la tâche en cours [/]';
			startBtn.addEventListener('click', async () => {
				await this.updateTaskStatus(task, true);
				new Notice(`Tâche démarrée : ${task.title}`);
				await this.render();
			});

			const completeBtn = actionGroup.createEl('button', { cls: 'sbm-action-btn complete', text: '✅ Terminer' });
			completeBtn.title = 'Terminer la tâche et réclamer les pièces';
			completeBtn.addEventListener('click', async () => {
				await this.completeTask(task);
				await this.render();
			});

			const deferBtn = actionGroup.createEl('button', { cls: 'sbm-action-btn defer', text: '⏩ Reporter' });
			deferBtn.title = 'Reporter l\'échéance à demain';
			deferBtn.addEventListener('click', async () => {
				await this.deferTaskDate(task);
				new Notice(`Tâche reportée au lendemain : ${task.title}`);
				await this.render();
			});

			const decomposeBtn = actionGroup.createEl('button', { cls: 'sbm-action-btn decompose', text: '🧩 Décomposer' });
			decomposeBtn.title = 'Insérer une nouvelle sous-tâche';
			decomposeBtn.addEventListener('click', async () => {
				await this.decomposeTask(task);
				new Notice(`Sous-tâche ajoutée à : ${task.title}`);
				await this.render();
			});
		});

		if (allowExpand && tasks.length > 30) {
			const expandContainer = sectionEl.createEl('div', { cls: 'sbm-expand-container' });
			const toggleBtn = expandContainer.createEl('button', {
				cls: 'sbm-expand-btn',
				text: this.showAllTodoTasks ? `🔼 Réduire l'affichage (30/${tasks.length})` : `🔽 Afficher toutes les tâches (${tasks.length})`
			});
			toggleBtn.addEventListener('click', async () => {
				this.showAllTodoTasks = !this.showAllTodoTasks;
				await this.render();
			});
		}
	}

	private async openTaskLocation(task: ObsidianTask): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getUnpinnedLeaf();
			await leaf.openFile(file, { eState: { line: task.lineNumber - 1 } });
		}
	}

	private editDateInline(targetEl: HTMLElement, task: ObsidianTask): void {
		const current = task.dueDate || new Date().toISOString().split('T')[0];
		this.popover.open(targetEl, {
			title: 'Échéance',
			type: 'date',
			initialValue: current,
			onSubmit: async (val) => {
				await this.mutateTaskLine(task, (line) => TaskMutator.setDueDate(line, val.trim() || null, this.plugin.settings));
				await this.render();
			}
		});
	}

	private editEnergyInline(targetEl: HTMLElement, task: ObsidianTask): void {
		const current = (task.energy || 5).toString();
		this.popover.open(targetEl, {
			title: 'Niveau d\'énergie (1-10)',
			type: 'number',
			initialValue: current,
			min: 1,
			max: 10,
			onSubmit: async (val) => {
				const parsed = parseInt(val, 10);
				if (isNaN(parsed)) return;
				await this.mutateTaskLine(task, (line) => TaskMutator.setControlledTag(line, 'energie', parsed, this.plugin.settings));
				await this.render();
			}
		});
	}

	private editPiecesInline(targetEl: HTMLElement, task: ObsidianTask): void {
		const current = (task.pieces || 1).toString();
		this.popover.open(targetEl, {
			title: 'Montant en pièces',
			type: 'number',
			initialValue: current,
			min: 1,
			max: 100,
			onSubmit: async (val) => {
				const parsed = parseInt(val, 10);
				if (isNaN(parsed)) return;
				await this.mutateTaskLine(task, (line) => TaskMutator.setControlledTag(line, 'pieces', parsed, this.plugin.settings));
				await this.render();
			}
		});
	}

	private editPriorityInline(targetEl: HTMLElement, task: ObsidianTask): void {
		this.popover.open(targetEl, {
			title: 'Priorité',
			type: 'priority-select',
			initialValue: task.priority || 'normal',
			onSubmit: async (val) => {
				await this.mutateTaskLine(task, (line) => TaskMutator.setPriority(line, val as TaskPriority, this.plugin.settings));
				await this.render();
			}
		});
	}

	private async editMatrixInline(task: ObsidianTask): Promise<void> {
		const matrixAdapter = MatrixAdapterFactory.createAdapter(this.plugin.settings.matrixProvider, this.plugin.settings.customMatrixMapping);
		const currentQuad = matrixAdapter.getQuadrant(task);

		const cycle: Record<string, MatrixQuadrant> = {
			q1: 'q2',
			q2: 'q3',
			q3: 'q4',
			q4: null,
			null: 'q1'
		};

		const nextQuad = cycle[currentQuad || 'null'];
		await this.mutateTaskLine(task, (line) => matrixAdapter.setQuadrant(line, nextQuad));
		await this.render();
	}

	private async mutateTaskLine(task: ObsidianTask, mutatorFn: (line: string) => string): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const lineIdx = task.lineNumber - 1;

			if (lines[lineIdx] !== undefined) {
				lines[lineIdx] = mutatorFn(lines[lineIdx]);
			}
			return lines.join('\n');
		});
	}

	private async loadAllVaultTasks(): Promise<ObsidianTask[]> {
		const files = (typeof this.app.vault.getMarkdownFiles === 'function') ? this.app.vault.getMarkdownFiles() : [];
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					const content = (typeof (this.app.vault as any).cachedRead === 'function')
						? await (this.app.vault as any).cachedRead(file)
						: await this.app.vault.read(file);
					return TaskParser.parseAllTasks(content, file.path, this.plugin.settings);
				} catch {
					return [];
				}
			})
		);

		return results.flat();
	}

	private async updateTaskStatus(task: ObsidianTask, inProgress: boolean): Promise<void> {
		await this.mutateTaskLine(task, (line) => TaskMutator.setCompleted(line, inProgress, undefined, this.plugin.settings));
	}

	private async completeTask(task: ObsidianTask): Promise<void> {
		const todayStr = new Date().toISOString().split('T')[0];
		await this.mutateTaskLine(task, (line) => TaskMutator.setCompleted(line, true, todayStr, this.plugin.settings));

		const res = GamificationService.processCompletion(task, this.plugin.pluginData, this.plugin.settings.matrixProvider);
		if (res.rewardGranted) {
			await this.plugin.savePluginData();
			new Notice(`🎉 Tâche terminée ! +${res.coinsEarned} 🪙 (Solde : ${res.newBalance} 🪙)`);
		}
	}

	private async deferTaskDate(task: ObsidianTask): Promise<void> {
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		await this.mutateTaskLine(task, (line) => TaskMutator.setDueDate(line, tomorrowStr, this.plugin.settings));
	}

	private async decomposeTask(task: ObsidianTask): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const lineIdx = task.lineNumber - 1;

			if (lines[lineIdx] !== undefined) {
				const subtaskLine = TaskMutator.createSubtaskLine(task.indentLevel, 'Nouvelle sous-tâche décomposée');
				lines.splice(lineIdx + 1, 0, subtaskLine);
			}
			return lines.join('\n');
		});
	}
}
