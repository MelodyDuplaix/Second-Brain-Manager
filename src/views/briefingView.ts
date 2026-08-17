import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_BRIEFING = 'sbm-briefing-view';

export class BriefingView extends ItemView {
	private plugin: SecondBrainPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_BRIEFING;
	}

	getDisplayText(): string {
		return 'Briefing du matin';
	}

	getIcon(): string {
		return 'sun';
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('sbm-briefing-container');

		const currentEnergy = this.plugin.settings.energyLevel;
		const isEconomyMode = currentEnergy <= 3;

		// Header & Énergie
		const headerEl = container.createEl('div', { cls: 'sbm-briefing-header' });
		headerEl.createEl('h2', { text: '🧠 Briefing du matin' });

		const energyContainer = headerEl.createEl('div', { cls: 'sbm-energy-bar' });
		energyContainer.createEl('span', { text: `Niveau d'énergie : ` });

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
			text: isEconomyMode ? '⚡ Mode économie (1 tâche prioritaire)' : '🔥 Mode plein potentiel'
		});

		// Parsing des tâches du coffre
		const allTasks = await this.loadAllVaultTasks();
		const openTasks = allTasks.filter(t => !t.completed && t.status !== 'cancelled');

		const matrixAdapter = MatrixAdapterFactory.createAdapter(
			this.plugin.settings.matrixProvider,
			this.plugin.settings.customMatrixMapping
		);

		// Classification
		const mainTask = openTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || (t.energy && t.energy >= 6));
		const secondaryTasks = openTasks.filter(t => t !== mainTask && (matrixAdapter.getQuadrant(t) === 'q2' || (t.energy && t.energy <= 5)));
		const deadlines = openTasks.filter(t => t.dueDate || t.scheduledDate);
		const unclassified = openTasks.filter(t => !matrixAdapter.getQuadrant(t) && !t.energy);

		// 1. Tâche Principale
		this.renderSection(container, '🎯 Tâche principale', mainTask ? [mainTask] : [], 'main');

		// 2. Tâches Secondaires
		this.renderSection(container, '📋 Tâches secondaires', isEconomyMode ? secondaryTasks.slice(0, 1) : secondaryTasks, 'secondary');

		// 3. Échéances
		this.renderSection(container, '⏰ Échéances et urgences', deadlines, 'deadlines');

		// 4. Tâches à Décider
		this.renderSection(container, '❓ Tâches à décider', unclassified, 'unclassified');
	}

	private renderSection(container: Element, title: string, tasks: ObsidianTask[], sectionType: string): void {
		const sectionEl = container.createEl('div', { cls: `sbm-section sbm-section-${sectionType}` });
		sectionEl.createEl('h3', { text: title });

		if (tasks.length === 0) {
			sectionEl.createEl('p', { cls: 'sbm-empty-text', text: 'Aucune tâche dans cette catégorie.' });
			return;
		}

		const listEl = sectionEl.createEl('div', { cls: 'sbm-task-list' });

		tasks.forEach(task => {
			const cardEl = listEl.createEl('div', { cls: 'sbm-task-card' });

			const infoEl = cardEl.createEl('div', { cls: 'sbm-task-info' });
			infoEl.createEl('span', { cls: 'sbm-task-title', text: task.title });

			const metaEl = infoEl.createEl('div', { cls: 'sbm-task-meta' });
			if (task.dueDate) metaEl.createEl('span', { cls: 'sbm-meta-tag due', text: `📅 ${task.dueDate}` });
			if (task.energy) metaEl.createEl('span', { cls: 'sbm-meta-tag energy', text: `⚡ ${task.energy}/10` });
			if (task.pieces) metaEl.createEl('span', { cls: 'sbm-meta-tag pieces', text: `🪙 ${task.pieces}` });
			if (task.matrixTag) metaEl.createEl('span', { cls: 'sbm-meta-tag matrix', text: task.matrixTag });

			// Boutons d'action
			const actionsEl = cardEl.createEl('div', { cls: 'sbm-task-actions' });

			const startBtn = actionsEl.createEl('button', { text: '🚀 Commencer' });
			startBtn.addEventListener('click', async () => {
				await this.updateTaskStatus(task, true);
				new Notice(`Tâche démarrée : ${task.title}`);
				await this.render();
			});

			const deferBtn = actionsEl.createEl('button', { text: '⏩ Reporter' });
			deferBtn.addEventListener('click', async () => {
				await this.deferTaskDate(task);
				new Notice(`Tâche reportée : ${task.title}`);
				await this.render();
			});

			const decomposeBtn = actionsEl.createEl('button', { text: '🧩 Décomposer' });
			decomposeBtn.addEventListener('click', async () => {
				await this.decomposeTask(task);
				new Notice(`Sous-tâche ajoutée à : ${task.title}`);
				await this.render();
			});
		});
	}

	private async loadAllVaultTasks(): Promise<ObsidianTask[]> {
		const files = this.app.vault.getMarkdownFiles();
		const allTasks: ObsidianTask[] = [];

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const tasks = TaskParser.parseFile(content, file.path, this.plugin.settings);
			allTasks.push(...tasks);
		}

		return allTasks;
	}

	private async updateTaskStatus(task: ObsidianTask, inProgress: boolean): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const lineIdx = task.lineNumber - 1;

			if (lines[lineIdx] !== undefined) {
				lines[lineIdx] = TaskMutator.setCompleted(lines[lineIdx], inProgress, undefined, this.plugin.settings);
			}
			return lines.join('\n');
		});
	}

	private async deferTaskDate(task: ObsidianTask): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = this.app.vault.getFileByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);
		if (!(file instanceof TFile)) return;

		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const lineIdx = task.lineNumber - 1;

			if (lines[lineIdx] !== undefined) {
				lines[lineIdx] = TaskMutator.setDueDate(lines[lineIdx], tomorrowStr, this.plugin.settings);
			}
			return lines.join('\n');
		});
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
