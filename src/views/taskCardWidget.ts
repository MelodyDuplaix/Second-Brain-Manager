import { App, TFile, Notice, normalizePath, setIcon } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import SecondBrainPlugin from '../main';

export class TaskCardWidget {
	public static render(
		containerEl: HTMLElement,
		task: ObsidianTask,
		plugin: SecondBrainPlugin,
		onTaskUpdated?: () => void
	): HTMLElement {
		const cardEl = containerEl.createDiv({ cls: 'sbm-chat-task-card' });

		// 1. En-tête : Checkbox + Titre + Lien fichier
		const topRow = cardEl.createDiv({ cls: 'sbm-chat-task-top' });

		const checkbox = topRow.createEl('input', { type: 'checkbox', cls: 'sbm-chat-task-checkbox' });
		checkbox.checked = task.completed || task.status === 'done';

		const titleContainer = topRow.createDiv({ cls: 'sbm-chat-task-title-wrap' });
		const titleEl = titleContainer.createEl('span', { cls: 'sbm-chat-task-title', text: task.title });

		// Clic sur le titre pour ouvrir la note à la ligne exacte
		titleEl.title = `Ouvrir ${task.filePath} à la ligne ${task.lineNumber}`;
		titleEl.addEventListener('click', async () => {
			await TaskCardWidget.openTaskLocation(plugin.app, task);
		});

		const filePill = topRow.createEl('span', {
			cls: 'sbm-chat-task-file-pill',
			text: `📄 ${task.filePath.split('/').pop()}:${task.lineNumber}`
		});
		filePill.title = `Ouvrir ${task.filePath}`;
		filePill.addEventListener('click', async () => {
			await TaskCardWidget.openTaskLocation(plugin.app, task);
		});

		// 2. Ligne des badges (Échéance, Énergie, Matrice, Pièces)
		const badgesRow = cardEl.createDiv({ cls: 'sbm-chat-task-badges' });

		// Échéance
		const today = new Date().toISOString().split('T')[0];
		const isOverdue = task.dueDate && task.dueDate < today && !task.completed;
		const dueText = task.dueDate ? `📅 ${task.dueDate}${isOverdue ? ' (En retard)' : ''}` : '📅 Aucune date';
		const dueBadge = badgesRow.createSpan({
			cls: `sbm-meta-tag due ${isOverdue ? 'is-overdue' : ''}`,
			text: dueText
		});

		// Énergie
		if (task.energy) {
			badgesRow.createSpan({
				cls: 'sbm-meta-tag energy',
				text: `⚡ ${task.energy}/10`
			});
		}

		// Quadrant Matrice
		const matrixAdapter = MatrixAdapterFactory.createAdapter(plugin.settings.matrixProvider, plugin.settings.customMatrixMapping);
		const currentQuad = matrixAdapter.getQuadrant(task);
		if (currentQuad) {
			badgesRow.createSpan({
				cls: 'sbm-meta-tag matrix',
				text: `#${currentQuad.toUpperCase()}`
			});
		}

		// Pièces
		if (task.pieces) {
			badgesRow.createSpan({
				cls: 'sbm-meta-tag pieces',
				text: `🪙 ${task.pieces}`
			});
		}

		// 3. Barre d'actions rapides
		const actionsRow = cardEl.createDiv({ cls: 'sbm-chat-task-actions' });

		// Bouton Ouvrir
		const openBtn = actionsRow.createEl('button', { cls: 'sbm-chat-task-btn open' });
		setIcon(openBtn, 'external-link');
		openBtn.title = 'Aller à la tâche dans la note';
		openBtn.addEventListener('click', async () => {
			await TaskCardWidget.openTaskLocation(plugin.app, task);
		});

		// Bouton Reporter à demain (+1 jour)
		const deferBtn = actionsRow.createEl('button', { cls: 'sbm-chat-task-btn defer', text: '⏩ Reporter à demain' });
		deferBtn.title = 'Reporter l\'échéance à demain';
		deferBtn.addEventListener('click', async () => {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = tomorrow.toISOString().split('T')[0];

			await TaskCardWidget.updateTaskDate(plugin, task, tomorrowStr);
			dueBadge.setText(`📅 ${tomorrowStr}`);
			dueBadge.removeClass('is-overdue');
			new Notice(`Tâche reportée au ${tomorrowStr} : ${task.title}`);
			if (onTaskUpdated) onTaskUpdated();
		});

		// Interaction avec la checkbox pour terminer la tâche
		checkbox.addEventListener('change', async () => {
			const isDone = checkbox.checked;
			await TaskCardWidget.setTaskCompleted(plugin, task, isDone);
			cardEl.toggleClass('is-completed', isDone);
			if (isDone) {
				new Notice(`Tâche accomplie : ${task.title}`);
			}
			if (onTaskUpdated) onTaskUpdated();
		});

		if (task.completed || task.status === 'done') {
			cardEl.addClass('is-completed');
		}

		return cardEl;
	}

	public static async openTaskLocation(app: App, task: ObsidianTask): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = app.vault.getFileByPath(normalized) || app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			const leaf = app.workspace.getUnpinnedLeaf();
			await leaf.openFile(file, { eState: { line: task.lineNumber - 1 } });
		}
	}

	public static async updateTaskDate(plugin: SecondBrainPlugin, task: ObsidianTask, newDate: string): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = plugin.app.vault.getFileByPath(normalized) || plugin.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			await plugin.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const idx = task.lineNumber - 1;
				if (lines[idx] !== undefined) {
					lines[idx] = TaskMutator.setDueDate(lines[idx], newDate, plugin.settings);
				}
				return lines.join('\n');
			});
			task.dueDate = newDate;
		}
	}

	public static async setTaskCompleted(plugin: SecondBrainPlugin, task: ObsidianTask, completed: boolean): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = plugin.app.vault.getFileByPath(normalized) || plugin.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			await plugin.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const idx = task.lineNumber - 1;
				if (lines[idx] !== undefined) {
					lines[idx] = TaskMutator.setCompleted(lines[idx], completed, undefined, plugin.settings);
				}
				return lines.join('\n');
			});
			task.completed = completed;
			task.status = completed ? 'done' : 'todo';

			if (completed) {
				await plugin.gamificationService.claimTaskReward(task);
			}
		}
	}
}
