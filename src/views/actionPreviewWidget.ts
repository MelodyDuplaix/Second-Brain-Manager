import { App, Notice, normalizePath, TFile } from 'obsidian';
import { ActionProposal, ActionResult, UpdateTaskActionProposal } from '../models/actions';
import { ActionExecutor } from '../services/actionExecutor';

export class ActionPreviewWidget {
	public static render(
		containerEl: HTMLElement,
		proposals: ActionProposal[],
		executor: ActionExecutor,
		app?: App,
		onExecuted?: (results: ActionResult[]) => void
	): HTMLElement {
		const widgetEl = containerEl.createDiv({ cls: 'sbm-action-preview-card' });

		// En-tête de la carte d'actions
		const headerEl = widgetEl.createDiv({ cls: 'sbm-preview-header' });
		const titleRow = headerEl.createDiv({ cls: 'sbm-preview-title-row' });
		
		titleRow.createEl('h4', { 
			text: `📋 Plan d'Allègement & Tri Proposé (${proposals.length} modification${proposals.length > 1 ? 's' : ''})`,
			cls: 'sbm-preview-title'
		});

		// Boutons d'aide à la sélection rapide
		if (proposals.length > 1) {
			const selectToggles = titleRow.createDiv({ cls: 'sbm-preview-select-toggles' });
			const checkAllBtn = selectToggles.createEl('button', { cls: 'sbm-preview-toggle-btn', text: 'Tout cocher' });
			const uncheckAllBtn = selectToggles.createEl('button', { cls: 'sbm-preview-toggle-btn', text: 'Tout décocher' });

			checkAllBtn.addEventListener('click', (e) => {
				e.preventDefault();
				proposals.forEach(p => p.selected = true);
				rowMap.forEach(({ rowEl, checkbox }) => {
					checkbox.checked = true;
					rowEl.removeClass('is-deselected');
				});
			});

			uncheckAllBtn.addEventListener('click', (e) => {
				e.preventDefault();
				proposals.forEach(p => p.selected = false);
				rowMap.forEach(({ rowEl, checkbox }) => {
					checkbox.checked = false;
					rowEl.addClass('is-deselected');
				});
			});
		}

		const listEl = widgetEl.createDiv({ cls: 'sbm-preview-list' });
		const rowMap = new Map<string, { rowEl: HTMLElement; checkbox: HTMLInputElement }>();

		proposals.forEach(prop => {
			const itemRow = listEl.createDiv({ cls: 'sbm-preview-item' });

			const checkboxWrap = itemRow.createDiv({ cls: 'sbm-preview-checkbox-wrap' });
			const checkbox = checkboxWrap.createEl('input', { type: 'checkbox' });
			checkbox.checked = prop.selected;

			checkbox.addEventListener('change', () => {
				prop.selected = checkbox.checked;
				itemRow.toggleClass('is-deselected', !checkbox.checked);
			});

			const itemContent = itemRow.createDiv({ cls: 'sbm-preview-item-content' });

			// A. En-tête de l'item : Badge de type d'action + Titre de la tâche + Fichier source
			const itemHeader = itemContent.createDiv({ cls: 'sbm-preview-item-header' });
			this.createActionTypeBadge(itemHeader, prop);

			// Extraction du titre et du nom de fichier
			let taskTitle = '';
			const fileBasename = prop.targetPath.replace(/\.md$/, '').split('/').pop() || prop.targetPath;
			let lineNumber = 0;

			if (prop.type === 'update_task') {
				const upProp = prop as UpdateTaskActionProposal;
				taskTitle = upProp.taskTitle || upProp.diff?.taskTitle || prop.description;
				lineNumber = upProp.lineNumber;
			} else if (prop.type === 'create_task') {
				taskTitle = prop.taskTitle;
			} else {
				taskTitle = prop.description;
			}

			// Fonction d'ouverture de la note source à la ligne exacte
			const openTaskLocation = async () => {
				if (!app) return;
				const normalized = normalizePath(prop.targetPath);
				const file = app.vault.getFileByPath(normalized) || app.vault.getAbstractFileByPath(normalized);
				if (file instanceof TFile) {
					const leaf = app.workspace.getLeaf ? app.workspace.getLeaf(false) : app.workspace.activeLeaf;
					if (leaf) {
						await leaf.openFile(file, { eState: { line: Math.max(0, lineNumber - 1) } });
					}
				} else {
					new Notice(`Fichier introuvable : ${prop.targetPath}`);
				}
			};

			const titleSpan = itemHeader.createSpan({ cls: 'sbm-preview-task-title', text: taskTitle });
			titleSpan.title = `Ouvrir ${prop.targetPath}${lineNumber ? ` à la ligne ${lineNumber}` : ''}`;
			titleSpan.addEventListener('click', async (e) => {
				e.stopPropagation();
				await openTaskLocation();
			});

			const filePill = itemHeader.createSpan({ 
				cls: 'sbm-preview-file-pill', 
				text: `📁 [[${fileBasename}]]${lineNumber ? ` : L${lineNumber}` : ''}` 
			});
			filePill.title = `Ouvrir ${prop.targetPath}${lineNumber ? ` à la ligne ${lineNumber}` : ''}`;
			filePill.addEventListener('click', async (e) => {
				e.stopPropagation();
				await openTaskLocation();
			});

			// B. Ligne des Diffs & Métadonnées comparées (Ancienne vs Nouvelle valeur)
			if (prop.type === 'update_task') {
				const upProp = prop as UpdateTaskActionProposal;
				const diff = upProp.diff;

				const diffsRow = itemContent.createDiv({ cls: 'sbm-preview-diffs-row' });

				// 1. Échéance
				if (upProp.newDueDate !== undefined || diff?.newDueDate !== undefined) {
					const oldDue = diff?.oldDueDate || 'Non définie';
					const newDue = upProp.newDueDate || diff?.newDueDate;
					const dueDiffPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					dueDiffPill.createSpan({ text: '📅 ' });
					if (newDue) {
						dueDiffPill.createSpan({ text: `${oldDue} ➔ `, cls: 'sbm-diff-old' });
						dueDiffPill.createSpan({ text: `${newDue}`, cls: 'sbm-diff-new' });
					} else {
						dueDiffPill.createSpan({ text: `${oldDue} ➔ `, cls: 'sbm-diff-old' });
						dueDiffPill.createSpan({ text: 'Supprimée', cls: 'sbm-diff-removed' });
					}
				}

				// 2. Quadrant / Matrice
				if (upProp.newMatrixQuadrant !== undefined || diff?.newQuadrant !== undefined) {
					const oldQ = diff?.oldQuadrant ? diff.oldQuadrant.toUpperCase() : 'Non classé';
					const newQ = (upProp.newMatrixQuadrant || diff?.newQuadrant || '').toUpperCase();
					const quadPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					quadPill.createSpan({ text: '🎯 ' });
					quadPill.createSpan({ text: `${oldQ} ➔ `, cls: 'sbm-diff-old' });
					quadPill.createSpan({ text: `${newQ}`, cls: 'sbm-diff-new' });
				}

				// 3. Priorité
				if (upProp.newPriority !== undefined || diff?.newPriority !== undefined) {
					const oldP = diff?.oldPriority || 'Normale';
					const newP = upProp.newPriority || diff?.newPriority || 'Normale';
					const prioPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					prioPill.createSpan({ text: '🔺 ' });
					prioPill.createSpan({ text: `${oldP} ➔ `, cls: 'sbm-diff-old' });
					prioPill.createSpan({ text: `${newP}`, cls: 'sbm-diff-new' });
				}

				// 4. Énergie
				if (upProp.newEnergy !== undefined || diff?.newEnergy !== undefined) {
					const oldE = diff?.oldEnergy ? `#energie/${diff.oldEnergy}` : 'Non définie';
					const newE = upProp.newEnergy || diff?.newEnergy;
					const energyPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					energyPill.createSpan({ text: '⚡ ' });
					energyPill.createSpan({ text: `${oldE} ➔ `, cls: 'sbm-diff-old' });
					energyPill.createSpan({ text: `#energie/${newE}`, cls: 'sbm-diff-new' });
				}

				// 5. Statut
				if (upProp.newStatus !== undefined || diff?.newStatus !== undefined) {
					const newS = upProp.newStatus || diff?.newStatus;
					if (newS === 'cancelled' || newS === '-') {
						const statusPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill is-cancelled-diff' });
						statusPill.createSpan({ text: '❌ Statut : - [ ] ➔ - [-] (Annulée)' });
					} else if (newS === 'done' || newS === 'completed') {
						const statusPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
						statusPill.createSpan({ text: '✅ Statut : - [ ] ➔ - [x] (Terminée)' });
					}
				}
			} else if (prop.type === 'move_note' || prop.type === 'rename_note') {
				const moveProp = prop as MoveNoteActionProposal;
				const renameProp = prop as RenameNoteActionProposal;
				const diffsRow = itemContent.createDiv({ cls: 'sbm-preview-diffs-row' });

				if (moveProp.destinationFolder) {
					const movePill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					movePill.createSpan({ text: '📁 Dossier cible : ' });
					movePill.createSpan({ text: moveProp.destinationFolder, cls: 'sbm-diff-new' });
				}

				const newName = moveProp.newFileName || renameProp.newFileName;
				if (newName) {
					const renamePill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					renamePill.createSpan({ text: '✏️ Nouveau nom : ' });
					renamePill.createSpan({ text: `${fileBasename} ➔ `, cls: 'sbm-diff-old' });
					renamePill.createSpan({ text: newName.replace(/\.md$/, ''), cls: 'sbm-diff-new' });
				}
			}

			// C. Raison / Explication de l'IA
			const reasonText = (prop as UpdateTaskActionProposal).reason || (prop as UpdateTaskActionProposal).diff?.reason || (prop.description !== taskTitle ? prop.description : '');
			if (reasonText && !reasonText.startsWith('Action sur')) {
				const reasonEl = itemContent.createDiv({ cls: 'sbm-preview-reason-box' });
				reasonEl.createSpan({ text: '💡 ' });
				reasonEl.createSpan({ text: reasonText });
			}

			rowMap.set(prop.id, { rowEl: itemRow, checkbox });
		});

		// Barre d'actions en bas
		const actionsRow = widgetEl.createDiv({ cls: 'sbm-preview-actions-row' });

		const applyBtn = actionsRow.createEl('button', {
			cls: 'sbm-preview-apply-btn mod-cta',
			text: '⚡ Appliquer les modifications sélectionnées'
		});

		const cancelBtn = actionsRow.createEl('button', {
			cls: 'sbm-preview-cancel-btn',
			text: 'Fermer'
		});

		applyBtn.addEventListener('click', async () => {
			const selectedProposals = proposals.filter(p => p.selected);
			if (selectedProposals.length === 0) {
				new Notice('Aucune modification sélectionnée.');
				return;
			}

			applyBtn.disabled = true;
			applyBtn.setText('Application en cours...');

			const results = await executor.executeProposals(selectedProposals);
			const successCount = results.filter(r => r.success).length;

			new Notice(`Second Brain : ${successCount}/${selectedProposals.length} modification(s) appliquée(s) !`);

			widgetEl.remove();

			if (onExecuted) {
				onExecuted(results);
			}
		});

		cancelBtn.addEventListener('click', () => {
			widgetEl.remove();
		});

		return widgetEl;
	}

	private static createActionTypeBadge(parentEl: HTMLElement, prop: ActionProposal): HTMLElement {
		const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge' });

		if (prop.type === 'update_task') {
			const up = prop as UpdateTaskActionProposal;
			if (up.newStatus === 'cancelled' || up.newStatus === '-') {
				badge.addClass('type-cancel');
				badge.setText('❌ Annuler / Obsolète');
			} else if (up.newMatrixQuadrant === 'q3' || up.newMatrixQuadrant === 'q4') {
				badge.addClass('type-demote');
				badge.setText('🔽 Rétrograder');
			} else if (up.newMatrixQuadrant === 'q1') {
				badge.addClass('type-promote');
				badge.setText('🔺 Prioriser');
			} else if (up.newDueDate === null) {
				badge.addClass('type-remove-due');
				badge.setText('🧹 Retirer échéance');
			} else if (up.newDueDate) {
				badge.addClass('type-postpone');
				badge.setText('⏩ Reporter');
			} else if (up.newEnergy !== undefined) {
				badge.addClass('type-energy');
				badge.setText('⚡ Ajuster énergie');
			} else {
				badge.setText('📝 Modifier tâche');
			}
		} else if (prop.type === 'create_task') {
			badge.addClass('type-create');
			badge.setText('➕ Créer tâche');
		} else if (prop.type === 'decompose_task') {
			badge.addClass('type-decompose');
			badge.setText('🧩 Décomposer');
		} else if (prop.type === 'move_note') {
			const move = prop as MoveNoteActionProposal;
			badge.addClass('type-move');
			badge.setText(move.newFileName ? '📁 Ranger & Renommer' : '📁 Ranger note');
		} else if (prop.type === 'rename_note') {
			badge.addClass('type-rename');
			badge.setText('✏️ Renommer note');
		} else if (prop.type === 'link_notes') {
			badge.addClass('type-link');
			badge.setText('🔗 Lier notes');
		} else if (prop.type === 'create_note') {
			badge.addClass('type-create-note');
			badge.setText('📝 Créer note');
		} else if (prop.type === 'append_to_note') {
			badge.addClass('type-append');
			badge.setText('📌 Ajouter à note');
		} else {
			badge.setText('📄 Note');
		}

		return badge;
	}
}
