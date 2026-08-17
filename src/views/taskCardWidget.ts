import { App, TFile, Notice, normalizePath, setIcon } from 'obsidian';
import { ObsidianTask, TaskPriority } from '../models/task';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory, MatrixQuadrant } from '../adapters/matrixAdapter';
import { InlineMetaPopover } from './inlineMetaPopover';
import SecondBrainPlugin from '../main';

export class TaskCardWidget {
	private static popover = new InlineMetaPopover();

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

		// 2. Ligne des badges modifiables (Échéance, Énergie, Priorité, Matrice, Pièces)
		const badgesRow = cardEl.createDiv({ cls: 'sbm-chat-task-badges' });

		// Échéance modifiable
		const today = new Date().toISOString().split('T')[0];
		const isOverdue = task.dueDate && task.dueDate < today && !task.completed;
		const dueText = task.dueDate ? `📅 ${task.dueDate}${isOverdue ? ' (En retard)' : ''}` : '+ 📅 Date';
		const dueBadge = badgesRow.createSpan({
			cls: `sbm-meta-tag due sbm-editable-tag ${isOverdue ? 'is-overdue' : ''}`,
			text: dueText
		});
		dueBadge.title = 'Cliquer pour modifier la date d\'échéance';
		dueBadge.addEventListener('click', (e) => {
			const current = task.dueDate || today;
			TaskCardWidget.popover.open(e.currentTarget as HTMLElement, {
				title: 'Échéance',
				type: 'date',
				initialValue: current,
				onSubmit: async (val) => {
					const newDate = val.trim() || null;
					await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
						TaskMutator.setDueDate(line, newDate, plugin.settings)
					);
					task.dueDate = newDate || undefined;
					dueBadge.setText(newDate ? `📅 ${newDate}` : '+ 📅 Date');
					dueBadge.toggleClass('is-overdue', Boolean(newDate && newDate < today && !task.completed));
					newNotice(`Échéance mise à jour : ${task.title}`);
					if (onTaskUpdated) onTaskUpdated();
				}
			});
		});

		// Énergie modifiable
		const energyText = task.energy ? `⚡ ${task.energy}/10` : '+ ⚡ Énergie';
		const energyBadge = badgesRow.createSpan({
			cls: 'sbm-meta-tag energy sbm-editable-tag',
			text: energyText
		});
		energyBadge.title = 'Cliquer pour modifier le niveau d\'énergie requis (1-10)';
		energyBadge.addEventListener('click', (e) => {
			const current = (task.energy || 5).toString();
			TaskCardWidget.popover.open(e.currentTarget as HTMLElement, {
				title: 'Niveau d\'énergie (1-10)',
				type: 'number',
				initialValue: current,
				min: 1,
				max: 10,
				onSubmit: async (val) => {
					const parsed = parseInt(val, 10);
					if (isNaN(parsed)) return;
					await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
						TaskMutator.setControlledTag(line, 'energie', parsed, plugin.settings)
					);
					task.energy = parsed;
					energyBadge.setText(`⚡ ${parsed}/10`);
					newNotice(`Énergie mise à jour : ${parsed}/10`);
					if (onTaskUpdated) onTaskUpdated();
				}
			});
		});

		// Quadrant Matrice modifiable
		const matrixAdapter = MatrixAdapterFactory.createAdapter(plugin.settings.matrixProvider, plugin.settings.customMatrixMapping);
		const currentQuad = matrixAdapter.getQuadrant(task);
		const matrixLabel = currentQuad ? `#${currentQuad.toUpperCase()}` : '+ Quadrant';
		const matrixBadge = badgesRow.createSpan({
			cls: 'sbm-meta-tag matrix sbm-editable-tag',
			text: task.matrixTag || matrixLabel
		});
		matrixBadge.title = 'Cliquer pour changer le quadrant de matrice Eisenhower';
		matrixBadge.addEventListener('click', async () => {
			const order: MatrixQuadrant[] = ['q1', 'q2', 'q3', 'q4'];
			const nextQuad = order[(order.indexOf(currentQuad || 'q4') + 1) % order.length];
			const nextTag = matrixAdapter.formatTag(nextQuad);

			await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
				matrixAdapter.setQuadrant(line, nextQuad)
			);
			task.matrixTag = nextTag;
			matrixBadge.setText(nextTag);
			newNotice(`Quadrant mis à jour : ${nextTag}`);
			if (onTaskUpdated) onTaskUpdated();
		});

		// Pièces modifiables
		const piecesText = task.pieces ? `🪙 ${task.pieces}` : '+ 🪙 Pièces';
		const piecesBadge = badgesRow.createSpan({
			cls: 'sbm-meta-tag pieces sbm-editable-tag',
			text: piecesText
		});
		piecesBadge.title = 'Cliquer pour modifier la récompense en pièces';
		piecesBadge.addEventListener('click', (e) => {
			const current = (task.pieces || 1).toString();
			TaskCardWidget.popover.open(e.currentTarget as HTMLElement, {
				title: 'Montant en pièces',
				type: 'number',
				initialValue: current,
				min: 1,
				max: 100,
				onSubmit: async (val) => {
					const parsed = parseInt(val, 10);
					if (isNaN(parsed)) return;
					await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
						TaskMutator.setControlledTag(line, 'pieces', parsed, plugin.settings)
					);
					task.pieces = parsed;
					piecesBadge.setText(`🪙 ${parsed}`);
					newNotice(`Récompense mise à jour : 🪙 ${parsed}`);
					if (onTaskUpdated) onTaskUpdated();
				}
			});
		});

		// Priorité modifiable
		const priorityLabelMap: Record<string, string> = {
			highest: '🔺 Highest',
			high: '⏫ High',
			medium: '🔼 Medium',
			normal: '⚪ Normal',
			low: '🔽 Low',
			lowest: '⏬ Lowest',
		};
		const priorityText = task.prioritySignifier || task.priorityTag || (task.priority ? priorityLabelMap[task.priority] : '+ Priorité');
		const priorityBadge = badgesRow.createSpan({
			cls: 'sbm-meta-tag priority sbm-editable-tag',
			text: priorityText
		});
		priorityBadge.title = 'Cliquer pour modifier la priorité';
		priorityBadge.addEventListener('click', (e) => {
			TaskCardWidget.popover.open(e.currentTarget as HTMLElement, {
				title: 'Priorité',
				type: 'priority-select',
				initialValue: task.priority || 'normal',
				onSubmit: async (val) => {
					await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
						TaskMutator.setPrioritySignifier(line, val as TaskPriority)
					);
					task.priority = val as TaskPriority;
					priorityBadge.setText(priorityLabelMap[val] || val);
					newNotice(`Priorité mise à jour : ${val}`);
					if (onTaskUpdated) onTaskUpdated();
				}
			});
		});

		// 3. Barre d'actions rapides
		const actionsRow = cardEl.createDiv({ cls: 'sbm-chat-task-actions' });

		// Bouton Commencer [/]
		const startBtn = actionsRow.createEl('button', { cls: 'sbm-chat-task-btn start', text: '🚀 Commencer' });
		startBtn.title = 'Passer la tâche en cours [/]';
		startBtn.addEventListener('click', async () => {
			await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
				TaskMutator.setStatus(line, 'in_progress', plugin.settings)
			);
			task.status = 'in_progress';
			newNotice(`Tâche démarrée : ${task.title}`);
			if (onTaskUpdated) onTaskUpdated();
		});

		// Bouton Terminer & Réclamer
		const completeBtn = actionsRow.createEl('button', { cls: 'sbm-chat-task-btn complete', text: '✅ Terminer' });
		completeBtn.title = 'Terminer la tâche et réclamer les pièces';
		completeBtn.addEventListener('click', async () => {
			await TaskCardWidget.setTaskCompleted(plugin, task, true);
			checkbox.checked = true;
			cardEl.addClass('is-completed');
			if (onTaskUpdated) onTaskUpdated();
		});

		// Bouton Reporter à demain (+1 jour)
		const deferBtn = actionsRow.createEl('button', { cls: 'sbm-chat-task-btn defer', text: '⏩ Reporter' });
		deferBtn.title = 'Reporter l\'échéance à demain';
		deferBtn.addEventListener('click', async () => {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = tomorrow.toISOString().split('T')[0];

			await TaskCardWidget.mutateTaskLine(plugin, task, (line) =>
				TaskMutator.setDueDate(line, tomorrowStr, plugin.settings)
			);
			task.dueDate = tomorrowStr;
			dueBadge.setText(`📅 ${tomorrowStr}`);
			dueBadge.removeClass('is-overdue');
			newNotice(`Tâche reportée au ${tomorrowStr} : ${task.title}`);
			if (onTaskUpdated) onTaskUpdated();
		});

		// Bouton Ouvrir
		const openBtn = actionsRow.createEl('button', { cls: 'sbm-chat-task-btn open' });
		setIcon(openBtn, 'external-link');
		openBtn.title = 'Aller à la tâche dans la note';
		openBtn.addEventListener('click', async () => {
			await TaskCardWidget.openTaskLocation(plugin.app, task);
		});

		// Interaction avec la checkbox pour terminer la tâche
		checkbox.addEventListener('change', async () => {
			const isDone = checkbox.checked;
			await TaskCardWidget.setTaskCompleted(plugin, task, isDone);
			cardEl.toggleClass('is-completed', isDone);
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

	public static async mutateTaskLine(
		plugin: SecondBrainPlugin,
		task: ObsidianTask,
		mutator: (line: string) => string
	): Promise<void> {
		const normalized = normalizePath(task.filePath);
		const file = plugin.app.vault.getFileByPath(normalized) || plugin.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			await plugin.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const idx = task.lineNumber - 1;
				if (lines[idx] !== undefined) {
					lines[idx] = mutator(lines[idx]);
				}
				return lines.join('\n');
			});
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
				const earned = await plugin.gamificationService.claimTaskReward(task);
				new Notice(`🎉 Tâche terminée ! +${earned} pièces gagnées (Total: ${plugin.gamificationService.getProfile().coins} 🪙)`);
			} else {
				new Notice(`Tâche réouverte : ${task.title}`);
			}
		}
	}
}

function newNotice(msg: string): void {
	new Notice(msg);
}
