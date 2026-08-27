import { App, Notice, normalizePath, TFile, TFolder, setIcon } from 'obsidian';
import {
	ActionProposal,
	ActionResult,
	UpdateTaskActionProposal,
	CreateTaskActionProposal,
	MoveNoteActionProposal,
	RenameNoteActionProposal,
	LinkNotesActionProposal,
	CreateNoteActionProposal
} from '../models/actions';
import { ActionExecutor } from '../services/actionExecutor';
import { FolderSuggest } from '../suggesters/folderSuggest';
import { FileSuggest } from '../suggesters/fileSuggest';
import { TaskPriority } from '../models/task';
import { MatrixQuadrant } from '../adapters/matrixAdapter';

export class ActionPreviewWidget {
	public static render(
		containerEl: HTMLElement,
		proposals: ActionProposal[],
		executor: ActionExecutor,
		app?: App,
		onExecuted?: (results: ActionResult[]) => void
	): HTMLElement {
		const widgetEl = containerEl.createDiv({ cls: 'sbm-action-preview-card' });

		// Sauvegarde des propositions initiales pour pouvoir réinitialiser individuellement
		const initialProposalsMap = new Map<string, string>();
		proposals.forEach(p => {
			initialProposalsMap.set(p.id, JSON.stringify(p));
		});

		// En-tête de la carte d'actions
		const headerEl = widgetEl.createDiv({ cls: 'sbm-preview-header' });
		const titleRow = headerEl.createDiv({ cls: 'sbm-preview-title-row' });

		titleRow.createEl('h4', {
			text: `📋 Plan d'Allègement & Tri Proposé (${proposals.length} élément${proposals.length > 1 ? 's' : ''})`,
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

			// A. En-tête de l'item : Badges d'actions combinées + Titre + Fichier source + Bouton ouvrir
			const itemHeader = itemContent.createDiv({ cls: 'sbm-preview-item-header' });
			const badgesContainer = itemHeader.createSpan({ cls: 'sbm-preview-badge-container' });
			this.renderActionTypeBadges(badgesContainer, prop);

			// Extraction du titre et du nom de fichier
			const getTitleAndLine = () => {
				let title = '';
				let line = 0;
				if (prop.type === 'update_task') {
					const upProp = prop as UpdateTaskActionProposal;
					title = upProp.taskTitle || upProp.diff?.taskTitle || prop.description;
					line = upProp.lineNumber;
				} else if (prop.type === 'create_task') {
					title = (prop as CreateTaskActionProposal).taskTitle;
				} else if (prop.type === 'move_note' || prop.type === 'rename_note') {
					const fn = prop.targetPath.split('/').pop()?.replace(/\.md$/, '') || prop.targetPath;
					title = prop.description || `Note : ${fn}`;
				} else {
					title = prop.description;
				}
				return { title, line };
			};

			const { title: initialTaskTitle, line: initialLineNumber } = getTitleAndLine();

			const openTaskLocation = async (targetLine?: number) => {
				if (!app) return;
				const normalized = normalizePath(prop.targetPath);
				const file = app.vault.getFileByPath(normalized) || app.vault.getAbstractFileByPath(normalized);
				if (file instanceof TFile) {
					const leaf = app.workspace.getLeaf ? app.workspace.getLeaf(false) : app.workspace.activeLeaf;
					if (leaf) {
						const l = targetLine !== undefined ? targetLine : initialLineNumber;
						await leaf.openFile(file, { eState: { line: Math.max(0, l - 1) } });
					}
				} else {
					new Notice(`Fichier introuvable : ${prop.targetPath}`);
				}
			};

			const titleSpan = itemHeader.createSpan({ cls: 'sbm-preview-task-title', text: initialTaskTitle });
			titleSpan.title = `Ouvrir ${prop.targetPath}${initialLineNumber ? ` à la ligne ${initialLineNumber}` : ''}`;
			titleSpan.addEventListener('click', async (e) => {
				e.stopPropagation();
				await openTaskLocation();
			});

			const fileBasename = prop.targetPath.replace(/\.md$/, '').split('/').pop() || prop.targetPath;
			const filePill = itemHeader.createSpan({
				cls: 'sbm-preview-file-pill',
				text: `📁 [[${fileBasename}]]${initialLineNumber ? ` : L${initialLineNumber}` : ''}`
			});
			filePill.title = `Ouvrir ${prop.targetPath}${initialLineNumber ? ` à la ligne ${initialLineNumber}` : ''}`;
			filePill.addEventListener('click', async (e) => {
				e.stopPropagation();
				await openTaskLocation();
			});

			// Bouton direct pour ouvrir la note source
			const openFileIconBtn = itemHeader.createEl('button', { cls: 'sbm-preview-open-file-btn' });
			setIcon(openFileIconBtn, 'external-link');
			openFileIconBtn.title = 'Ouvrir le fichier dans l\'éditeur';
			openFileIconBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				await openTaskLocation();
			});

			// B. Ligne des Diffs & Métadonnées comparées
			const diffsRow = itemContent.createDiv({ cls: 'sbm-preview-diffs-row' });
			this.renderDiffsRow(diffsRow, prop);

			// C. Raison / Explication de l'IA
			const reasonText = (prop as UpdateTaskActionProposal).reason || (prop as UpdateTaskActionProposal).diff?.reason || (prop.description !== initialTaskTitle ? prop.description : '');
			if (reasonText && !reasonText.startsWith('Action sur') && !reasonText.startsWith('Modifier la')) {
				const reasonEl = itemContent.createDiv({ cls: 'sbm-preview-reason-box' });
				reasonEl.createSpan({ text: '💡 ' });
				reasonEl.createSpan({ text: reasonText });
			}

			// D. Barre de boutons rapides & Tiroir multi-actions combinées
			const quickBar = itemContent.createDiv({ cls: 'sbm-preview-quick-bar' });
			const editDrawer = itemContent.createDiv({ cls: 'sbm-preview-edit-drawer is-collapsed' });

			const updateUI = () => {
				prop.selected = true;
				checkbox.checked = true;
				itemRow.removeClass('is-deselected');
				this.renderActionTypeBadges(badgesContainer, prop);
				this.renderDiffsRow(diffsRow, prop);
				const currentInfo = getTitleAndLine();
				titleSpan.setText(currentInfo.title);
			};

			this.renderQuickButtons(
				quickBar,
				prop,
				editDrawer,
				updateUI,
				app
			);

			// E. Tiroir de personnalisation multi-actions simultanées
			this.renderMultiActionEditDrawer(
				editDrawer,
				prop,
				initialProposalsMap.get(prop.id) || JSON.stringify(prop),
				updateUI,
				app
			);

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

			// Rendu des résultats avec boutons directs pour ouvrir les notes créées/modifiées
			this.renderExecutionResults(widgetEl, results, selectedProposals, app, onExecuted);
		});

		cancelBtn.addEventListener('click', () => {
			widgetEl.remove();
		});

		return widgetEl;
	}

	/**
	 * Rendu des badges d'actions combinées (affiche tous les changements actifs à la fois).
	 */
	private static renderActionTypeBadges(parentEl: HTMLElement, prop: ActionProposal): void {
		parentEl.empty();

		if (prop.type === 'update_task') {
			const up = prop as UpdateTaskActionProposal;
			let hasAny = false;

			// Statut
			if (up.newStatus === 'cancelled' || up.newStatus === '-') {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-cancel' });
				badge.setText('❌ Annuler');
				hasAny = true;
			} else if (up.newStatus === 'done' || up.newStatus === 'completed' || up.newStatus === 'x') {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-promote' });
				badge.setText('✅ Terminer');
				hasAny = true;
			} else if (up.newStatus === 'in_progress' || up.newStatus === 'in-progress' || up.newStatus === '/') {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-postpone' });
				badge.setText('⏳ En cours');
				hasAny = true;
			}

			// Échéance
			if (up.newDueDate === null) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-remove-due' });
				badge.setText('🧹 Retirer date');
				hasAny = true;
			} else if (up.newDueDate) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-postpone' });
				badge.setText(`📅 ${up.newDueDate}`);
				hasAny = true;
			}

			// Quadrant
			if (up.newMatrixQuadrant === 'q1') {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-promote' });
				badge.setText('🔺 Prioriser (Q1)');
				hasAny = true;
			} else if (up.newMatrixQuadrant === 'q2') {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-promote' });
				badge.setText('🎯 Focus Fond (Q2)');
				hasAny = true;
			} else if (up.newMatrixQuadrant === 'q3' || up.newMatrixQuadrant === 'q4') {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-demote' });
				badge.setText(`🔽 ${up.newMatrixQuadrant.toUpperCase()}`);
				hasAny = true;
			}

			// Énergie
			if (up.newEnergy !== undefined && up.newEnergy !== null) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-energy' });
				badge.setText(`⚡ ${up.newEnergy}/10`);
				hasAny = true;
			}

			// Priorité
			if (up.newPriority) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-promote' });
				badge.setText(`🔺 ${up.newPriority}`);
				hasAny = true;
			}

			if (!hasAny) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge' });
				badge.setText('📝 Modifier tâche');
			}
		} else if (prop.type === 'create_task') {
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-create' });
			badge.setText('➕ Créer tâche');
		} else if (prop.type === 'decompose_task') {
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-decompose' });
			badge.setText('🧩 Décomposer');
		} else if (prop.type === 'move_note' || prop.type === 'rename_note') {
			const move = prop as MoveNoteActionProposal;
			const rename = prop as RenameNoteActionProposal;
			let hasAny = false;

			if (move.destinationFolder) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-move' });
				badge.setText(`📁 Ranger dans ${move.destinationFolder}`);
				hasAny = true;
			}
			if (move.newFileName || rename.newFileName) {
				const name = move.newFileName || rename.newFileName;
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-rename' });
				badge.setText(`✏️ Renommer : ${name.replace(/\.md$/, '')}`);
				hasAny = true;
			}
			if (move.targetNoteName) {
				const dirIcon = move.linkDirection === 'backward' ? '⬅️' : move.linkDirection === 'both' ? '⇄' : '➔';
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-link' });
				badge.setText(`🔗 ${dirIcon} [[${move.targetNoteName}]]`);
				hasAny = true;
			}
			if (move.appendContent) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-append' });
				badge.setText('📌 Ajouter texte');
				hasAny = true;
			}

			if (!hasAny) {
				const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-move' });
				badge.setText('📁 Note');
			}
		} else if (prop.type === 'link_notes') {
			const link = prop as LinkNotesActionProposal;
			const dirIcon = link.linkDirection === 'backward' ? '⬅️' : link.linkDirection === 'both' ? '⇄' : '➔';
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-link' });
			badge.setText(`🔗 ${dirIcon} [[${link.targetNoteName}]]`);
		} else if (prop.type === 'create_note') {
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-create-note' });
			badge.setText('📝 Créer note');
		} else if (prop.type === 'append_to_note') {
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-append' });
			badge.setText('📌 Ajouter à note');
		} else if (prop.type === 'create_calendar_event') {
			const calProp = prop as any;
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-create' });
			badge.setText(`📅 Agenda : ${calProp.startDate || ''}${calProp.startTime ? ` à ${calProp.startTime}` : ''}`);
		} else if (prop.type === 'update_calendar_event') {
			const calProp = prop as any;
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge type-postpone' });
			badge.setText(`📅 Modifier agenda : ${calProp.title || calProp.eventId}`);
		} else {
			const badge = parentEl.createSpan({ cls: 'sbm-preview-action-type-badge' });
			badge.setText('📄 Action note');
		}
	}

	/**
	 * Rendu des diffs comparés pour toutes les actions actives.
	 */
	private static renderDiffsRow(diffsRow: HTMLElement, prop: ActionProposal): void {
		diffsRow.empty();

		const fileBasename = prop.targetPath.replace(/\.md$/, '').split('/').pop() || prop.targetPath;

		if (prop.type === 'update_task') {
			const upProp = prop as UpdateTaskActionProposal;
			const diff = upProp.diff;

			// 1. Échéance
			if (upProp.newDueDate !== undefined || diff?.newDueDate !== undefined) {
				const oldDue = diff?.oldDueDate || 'Non définie';
				const newDue = upProp.newDueDate !== undefined ? upProp.newDueDate : diff?.newDueDate;
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
				if (newQ) {
					const quadPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					quadPill.createSpan({ text: '🎯 ' });
					quadPill.createSpan({ text: `${oldQ} ➔ `, cls: 'sbm-diff-old' });
					quadPill.createSpan({ text: `#${newQ}`, cls: 'sbm-diff-new' });
				}
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
				const newE = upProp.newEnergy !== undefined ? upProp.newEnergy : diff?.newEnergy;
				if (newE !== undefined) {
					const energyPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
					energyPill.createSpan({ text: '⚡ ' });
					energyPill.createSpan({ text: `${oldE} ➔ `, cls: 'sbm-diff-old' });
					energyPill.createSpan({ text: `#energie/${newE}`, cls: 'sbm-diff-new' });
				}
			}

			// 5. Statut
			if (upProp.newStatus !== undefined || diff?.newStatus !== undefined) {
				const newS = upProp.newStatus || diff?.newStatus;
				if (newS === 'cancelled' || newS === '-') {
					const statusPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill is-cancelled-diff' });
					statusPill.createSpan({ text: '❌ Statut : Annulée [-]' });
				} else if (newS === 'done' || newS === 'completed' || newS === 'x') {
					const statusPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill is-done-diff' });
					statusPill.createSpan({ text: '✅ Statut : Terminée [x]' });
				} else if (newS === 'in-progress' || newS === 'in_progress' || newS === '/') {
					const statusPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill is-progress-diff' });
					statusPill.createSpan({ text: '⏳ Statut : En cours [/]' });
				}
			}
		} else if (prop.type === 'move_note' || prop.type === 'rename_note') {
			const moveProp = prop as MoveNoteActionProposal;
			const renameProp = prop as RenameNoteActionProposal;

			if (moveProp.destinationFolder) {
				const movePill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
				movePill.createSpan({ text: '📁 Dossier : ' });
				movePill.createSpan({ text: moveProp.destinationFolder, cls: 'sbm-diff-new' });
			}

			const newName = moveProp.newFileName || renameProp.newFileName;
			if (newName) {
				const renamePill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
				renamePill.createSpan({ text: '✏️ Nom : ' });
				renamePill.createSpan({ text: `${fileBasename} ➔ `, cls: 'sbm-diff-old' });
				renamePill.createSpan({ text: newName.replace(/\.md$/, ''), cls: 'sbm-diff-new' });
			}

			if (moveProp.targetNoteName) {
				const dirLabel = moveProp.linkDirection === 'backward' ? '⬅️ Dans cible' : moveProp.linkDirection === 'both' ? '⇄ Bidirectionnel' : '➔ Dans cette note';
				const linkPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
				linkPill.createSpan({ text: `🔗 Lien (${dirLabel}) : ` });
				linkPill.createSpan({ text: `[[${moveProp.targetNoteName}]]`, cls: 'sbm-diff-new' });
			}

			if (moveProp.appendContent) {
				const appendPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
				appendPill.createSpan({ text: '📌 Texte inséré', cls: 'sbm-diff-new' });
			}
		} else if (prop.type === 'link_notes') {
			const linkProp = prop as LinkNotesActionProposal;
			const linkPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
			linkPill.createSpan({ text: '🔗 Lier avec : ' });
			linkPill.createSpan({ text: `[[${linkProp.targetNoteName}]]`, cls: 'sbm-diff-new' });
		} else if (prop.type === 'create_note') {
			const createProp = prop as CreateNoteActionProposal;
			const notePill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
			notePill.createSpan({ text: '📝 Création : ' });
			notePill.createSpan({ text: `${createProp.folder || 'Inbox'}/${createProp.fileName || 'Note.md'}`, cls: 'sbm-diff-new' });
		} else if (prop.type === 'create_calendar_event') {
			const calProp = prop as any;
			const calPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
			calPill.createSpan({ text: '📅 Événement : ' });
			calPill.createSpan({ text: `${calProp.startDate}${calProp.startTime ? ` à ${calProp.startTime}` : ' (toute la journée)'}`, cls: 'sbm-diff-new' });
			if (calProp.location) {
				const locPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
				locPill.createSpan({ text: '📍 ' });
				locPill.createSpan({ text: calProp.location, cls: 'sbm-diff-new' });
			}
		} else if (prop.type === 'update_calendar_event') {
			const calProp = prop as any;
			const calPill = diffsRow.createDiv({ cls: 'sbm-preview-diff-pill' });
			calPill.createSpan({ text: '📅 Modification agenda : ' });
			calPill.createSpan({ text: calProp.title || calProp.eventId, cls: 'sbm-diff-new' });
		}
	}

	/**
	 * Boutons d'action rapide permettant d'appliquer ou combiner des actions d'un seul clic.
	 */
	private static renderQuickButtons(
		quickBar: HTMLElement,
		prop: ActionProposal,
		editDrawer: HTMLElement,
		updateUI: () => void,
		_app?: App
	): void {
		quickBar.empty();

		const todayStr = new Date().toISOString().split('T')[0];
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		const isTask = prop.type === 'update_task' || prop.type === 'create_task' || prop.type === 'decompose_task';

		if (isTask) {
			// Bouton Reporter à Demain (conserve les autres actions configurées)
			const deferBtn = quickBar.createEl('button', {
				cls: 'sbm-preview-quick-btn',
				text: '⏩ Demain'
			});
			deferBtn.title = `Reporter l'échéance à demain (${tomorrowStr})`;
			deferBtn.addEventListener('click', (e) => {
				e.preventDefault();
				if (prop.type === 'create_task') {
					(prop as CreateTaskActionProposal).dueDate = tomorrowStr;
				} else if (prop.type === 'update_task') {
					const up = prop as UpdateTaskActionProposal;
					up.newDueDate = tomorrowStr;
					if (up.newStatus === 'cancelled') up.newStatus = undefined;
				}
				updateUI();
			});

			// Bouton Reporter à Aujourd'hui
			const todayBtn = quickBar.createEl('button', {
				cls: 'sbm-preview-quick-btn',
				text: '📅 Aujourd\'hui'
			});
			todayBtn.title = `Replanifier à aujourd'hui (${todayStr})`;
			todayBtn.addEventListener('click', (e) => {
				e.preventDefault();
				if (prop.type === 'create_task') {
					(prop as CreateTaskActionProposal).dueDate = todayStr;
				} else if (prop.type === 'update_task') {
					const up = prop as UpdateTaskActionProposal;
					up.newDueDate = todayStr;
					if (up.newStatus === 'cancelled') up.newStatus = undefined;
				}
				updateUI();
			});

			// Bouton Retirer échéance (Sans date)
			const removeDueBtn = quickBar.createEl('button', {
				cls: 'sbm-preview-quick-btn',
				text: '🧹 Sans date'
			});
			removeDueBtn.title = 'Supprimer l\'échéance pour alléger la pression mentale';
			removeDueBtn.addEventListener('click', (e) => {
				e.preventDefault();
				if (prop.type === 'create_task') {
					(prop as CreateTaskActionProposal).dueDate = undefined;
				} else if (prop.type === 'update_task') {
					const up = prop as UpdateTaskActionProposal;
					up.newDueDate = null;
				}
				updateUI();
			});

			// Bouton Annuler / Obsolète (uniquement pertinent pour tâche existante)
			if (prop.type === 'update_task') {
				const cancelTaskBtn = quickBar.createEl('button', {
					cls: 'sbm-preview-quick-btn btn-danger',
					text: '❌ Annuler'
				});
				cancelTaskBtn.title = 'Marquer la tâche comme annulée / obsolète (- [-])';
				cancelTaskBtn.addEventListener('click', (e) => {
					e.preventDefault();
					const up = prop as UpdateTaskActionProposal;
					up.newStatus = up.newStatus === 'cancelled' ? undefined : 'cancelled';
					updateUI();
				});
			}

			// Bouton Prioriser (Q1) - peut se combiner avec la date et l'énergie
			const q1Btn = quickBar.createEl('button', {
				cls: 'sbm-preview-quick-btn',
				text: '🔺 Q1'
			});
			q1Btn.title = 'Classer en Q1 (Urgent & Important)';
			q1Btn.addEventListener('click', (e) => {
				e.preventDefault();
				if (prop.type === 'create_task') {
					const cr = prop as CreateTaskActionProposal;
					cr.matrixQuadrant = cr.matrixQuadrant === 'q1' ? undefined : 'q1';
				} else if (prop.type === 'update_task') {
					const up = prop as UpdateTaskActionProposal;
					up.newMatrixQuadrant = up.newMatrixQuadrant === 'q1' ? undefined : 'q1';
				}
				updateUI();
			});
		}

		// Bouton "⚙️ Modifier l'action" (Point unique et complet de configuration)
		const customizeBtn = quickBar.createEl('button', {
			cls: 'sbm-preview-quick-btn btn-customize',
			text: '⚙️ Modifier l\'action'
		});
		customizeBtn.title = 'Modifier et configurer les paramètres de l\'action (date, quadrant, énergie, dossier, renommage, liaisons...)';
		customizeBtn.addEventListener('click', (e) => {
			e.preventDefault();
			const isCollapsed = editDrawer.classList.contains('is-collapsed');
			this.toggleDrawer(editDrawer, isCollapsed);
		});
	}

	private static toggleDrawer(drawerEl: HTMLElement, open: boolean): void {
		drawerEl.toggleClass('is-collapsed', !open);
		drawerEl.toggleClass('is-expanded', open);
	}

	/**
	 * Rendu du tiroir multi-actions permettant de combiner simultanément TOUTES les actions et paramètres souhaités.
	 */
	private static renderMultiActionEditDrawer(
		drawerEl: HTMLElement,
		prop: ActionProposal,
		initialJson: string,
		updateUI: () => void,
		app?: App
	): void {
		drawerEl.empty();

		const drawerHeader = drawerEl.createDiv({ cls: 'sbm-edit-drawer-header' });
		const titleWrap = drawerHeader.createDiv({ cls: 'sbm-edit-drawer-title-wrap' });
		titleWrap.createSpan({ cls: 'sbm-edit-drawer-title', text: '⚙️ Modifier l\'action' });
		titleWrap.createEl('small', { cls: 'sbm-edit-drawer-subtitle', text: 'Vous pouvez modifier et combiner plusieurs paramètres ci-dessous.' });

		const closeBtn = drawerHeader.createEl('button', { cls: 'sbm-edit-drawer-close' });
		setIcon(closeBtn, 'x');
		closeBtn.title = 'Fermer la modification';
		closeBtn.addEventListener('click', () => {
			this.toggleDrawer(drawerEl, false);
		});

		const drawerBody = drawerEl.createDiv({ cls: 'sbm-edit-drawer-body' });

		if (prop.type === 'create_task') {
			const crProp = prop as CreateTaskActionProposal;
			const grid = drawerBody.createDiv({ cls: 'sbm-multi-action-grid' });

			// 1. Action Échéance
			const dateCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const dateHeader = dateCard.createDiv({ cls: 'sbm-facet-header' });
			dateHeader.createSpan({ cls: 'sbm-facet-title', text: '📅 Échéance' });

			const dateInput = dateCard.createEl('input', {
				type: 'date',
				cls: 'sbm-edit-input'
			});
			dateInput.value = crProp.dueDate || '';
			dateInput.addEventListener('change', () => {
				crProp.dueDate = dateInput.value.trim() || undefined;
				updateUI();
			});

			const dateChips = dateCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const todayStr = new Date().toISOString().split('T')[0];
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = tomorrow.toISOString().split('T')[0];
			const nextWeek = new Date();
			nextWeek.setDate(nextWeek.getDate() + 7);
			const nextWeekStr = nextWeek.toISOString().split('T')[0];

			const addChip = (label: string, val: string | undefined) => {
				const chip = dateChips.createEl('button', { cls: 'sbm-edit-chip-btn', text: label });
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					crProp.dueDate = val;
					dateInput.value = val || '';
					updateUI();
				});
			};

			addChip('Aujourd\'hui', todayStr);
			addChip('Demain', tomorrowStr);
			addChip('+7 jours', nextWeekStr);
			addChip('🧹 Sans date', undefined);

			// 2. Action Quadrant Matrice Eisenhower
			const quadCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const quadHeader = quadCard.createDiv({ cls: 'sbm-facet-header' });
			quadHeader.createSpan({ cls: 'sbm-facet-title', text: '🎯 Quadrant Eisenhower' });

			const quadChips = quadCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const quadrants: Array<{ val: MatrixQuadrant | undefined; label: string }> = [
				{ val: 'q1', label: '🔺 Q1 (Urgent & Important)' },
				{ val: 'q2', label: '🎯 Q2 (Fond / Stratégique)' },
				{ val: 'q3', label: '⏩ Q3 (Délégué / Urgent)' },
				{ val: 'q4', label: '⚪ Q4 (Secondaire)' },
				{ val: undefined, label: 'Effacer' }
			];

			quadrants.forEach(q => {
				const chip = quadChips.createEl('button', {
					cls: `sbm-edit-chip-btn ${crProp.matrixQuadrant === q.val ? 'is-active' : ''}`,
					text: q.label
				});
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					crProp.matrixQuadrant = q.val;
					quadChips.querySelectorAll('.sbm-edit-chip-btn').forEach(c => c.removeClass('is-active'));
					if (q.val) chip.addClass('is-active');
					updateUI();
				});
			});

			// 3. Actions Énergie & Priorité
			const metaRow = grid.createDiv({ cls: 'sbm-action-facet-card sbm-two-col-facet' });

			const energyCol = metaRow.createDiv({ cls: 'sbm-facet-col' });
			energyCol.createEl('label', { cls: 'sbm-edit-label', text: '⚡ Niveau d\'Énergie' });
			const energySelect = energyCol.createEl('select', { cls: 'dropdown sbm-edit-select' });
			const defaultEnergyOpt = energySelect.createEl('option', { value: '', text: 'Non définie' });
			if (crProp.energy === undefined) defaultEnergyOpt.selected = true;

			for (let i = 1; i <= 10; i++) {
				const opt = energySelect.createEl('option', { value: i.toString(), text: `⚡ ${i}/10` });
				if (crProp.energy === i) opt.selected = true;
			}

			energySelect.addEventListener('change', () => {
				const val = energySelect.value ? parseInt(energySelect.value, 10) : undefined;
				crProp.energy = val;
				updateUI();
			});

			const prioCol = metaRow.createDiv({ cls: 'sbm-facet-col' });
			prioCol.createEl('label', { cls: 'sbm-edit-label', text: '🔺 Priorité' });
			const prioSelect = prioCol.createEl('select', { cls: 'dropdown sbm-edit-select' });

			const priorities: Array<{ val: TaskPriority | ''; label: string }> = [
				{ val: '', label: 'Normal / Non définie' },
				{ val: 'highest', label: '🔺 Highest' },
				{ val: 'high', label: '⏫ High' },
				{ val: 'medium', label: '🔼 Medium' },
				{ val: 'low', label: '🔽 Low' },
				{ val: 'lowest', label: '⏬ Lowest' }
			];

			priorities.forEach(p => {
				const opt = prioSelect.createEl('option', { value: p.val, text: p.label });
				if (crProp.priority === p.val) opt.selected = true;
			});

			prioSelect.addEventListener('change', () => {
				crProp.priority = (prioSelect.value || undefined) as any;
				updateUI();
			});

			// 4. Intitulé de la tâche
			const titleCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const titleHeader = titleCard.createDiv({ cls: 'sbm-facet-header' });
			titleHeader.createSpan({ cls: 'sbm-facet-title', text: '✏️ Intitulé de la tâche' });

			const titleInput = titleCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Titre de la tâche...'
			});
			titleInput.value = crProp.taskTitle || '';
			titleInput.addEventListener('input', () => {
				crProp.taskTitle = titleInput.value.trim();
				crProp.description = `⏰ Créer la tâche « ${crProp.taskTitle} » dans "${crProp.targetPath}"`;
				updateUI();
			});

			// 5. Note cible
			const targetCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const targetHeader = targetCard.createDiv({ cls: 'sbm-facet-header' });
			targetHeader.createSpan({ cls: 'sbm-facet-title', text: '📁 Note cible' });

			const targetInput = targetCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Chemin de la note (ex: 04 - Journal/2026-08-27.md, Projet X.md)...'
			});
			targetInput.value = crProp.targetPath || '';
			if (app) new FileSuggest(app, targetInput);
			targetInput.addEventListener('input', () => {
				crProp.targetPath = targetInput.value.trim();
				crProp.description = `⏰ Créer la tâche « ${crProp.taskTitle} » dans "${crProp.targetPath}"`;
				updateUI();
			});

		} else if (prop.type === 'update_task') {
			const upProp = prop as UpdateTaskActionProposal;

			// Grille des actions simultanées pour tâche
			const grid = drawerBody.createDiv({ cls: 'sbm-multi-action-grid' });

			// 1. Action Échéance
			const dateCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const dateHeader = dateCard.createDiv({ cls: 'sbm-facet-header' });
			dateHeader.createSpan({ cls: 'sbm-facet-title', text: '📅 Action 1 : Échéance' });
			
			const dateInput = dateCard.createEl('input', {
				type: 'date',
				cls: 'sbm-edit-input'
			});
			dateInput.value = upProp.newDueDate || '';
			dateInput.addEventListener('change', () => {
				upProp.newDueDate = dateInput.value.trim() || null;
				updateUI();
			});

			const dateChips = dateCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const todayStr = new Date().toISOString().split('T')[0];
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const tomorrowStr = tomorrow.toISOString().split('T')[0];
			const nextWeek = new Date();
			nextWeek.setDate(nextWeek.getDate() + 7);
			const nextWeekStr = nextWeek.toISOString().split('T')[0];

			const addChip = (label: string, val: string | null) => {
				const chip = dateChips.createEl('button', { cls: 'sbm-edit-chip-btn', text: label });
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					upProp.newDueDate = val;
					dateInput.value = val || '';
					updateUI();
				});
			};

			addChip('Aujourd\'hui', todayStr);
			addChip('Demain', tomorrowStr);
			addChip('+7 jours', nextWeekStr);
			addChip('🧹 Sans date', null);

			// 2. Action Quadrant Matrice Eisenhower
			const quadCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const quadHeader = quadCard.createDiv({ cls: 'sbm-facet-header' });
			quadHeader.createSpan({ cls: 'sbm-facet-title', text: '🎯 Action 2 : Quadrant Eisenhower' });

			const quadChips = quadCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const quadrants: Array<{ val: MatrixQuadrant | undefined; label: string }> = [
				{ val: 'q1', label: '🔺 Q1 (Urgent & Important)' },
				{ val: 'q2', label: '🎯 Q2 (Fond / Stratégique)' },
				{ val: 'q3', label: '⏩ Q3 (Délégué / Urgent)' },
				{ val: 'q4', label: '⚪ Q4 (Secondaire)' },
				{ val: undefined, label: 'Effacer' }
			];

			quadrants.forEach(q => {
				const chip = quadChips.createEl('button', {
					cls: `sbm-edit-chip-btn ${upProp.newMatrixQuadrant === q.val ? 'is-active' : ''}`,
					text: q.label
				});
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					upProp.newMatrixQuadrant = q.val;
					quadChips.querySelectorAll('.sbm-edit-chip-btn').forEach(c => c.removeClass('is-active'));
					if (q.val) chip.addClass('is-active');
					updateUI();
				});
			});

			// 3. Actions Énergie & Priorité (2 colonnes)
			const metaRow = grid.createDiv({ cls: 'sbm-action-facet-card sbm-two-col-facet' });

			const energyCol = metaRow.createDiv({ cls: 'sbm-facet-col' });
			energyCol.createEl('label', { cls: 'sbm-edit-label', text: '⚡ Action 3 : Niveau d\'Énergie' });
			const energySelect = energyCol.createEl('select', { cls: 'dropdown sbm-edit-select' });
			const defaultEnergyOpt = energySelect.createEl('option', { value: '', text: 'Non définie' });
			if (upProp.newEnergy === undefined) defaultEnergyOpt.selected = true;

			for (let i = 1; i <= 10; i++) {
				const opt = energySelect.createEl('option', { value: i.toString(), text: `⚡ ${i}/10` });
				if (upProp.newEnergy === i) opt.selected = true;
			}

			energySelect.addEventListener('change', () => {
				const val = energySelect.value ? parseInt(energySelect.value, 10) : undefined;
				upProp.newEnergy = val;
				updateUI();
			});

			const prioCol = metaRow.createDiv({ cls: 'sbm-facet-col' });
			prioCol.createEl('label', { cls: 'sbm-edit-label', text: '🔺 Action 4 : Priorité' });
			const prioSelect = prioCol.createEl('select', { cls: 'dropdown sbm-edit-select' });

			const priorities: Array<{ val: TaskPriority | ''; label: string }> = [
				{ val: '', label: 'Normal / Non définie' },
				{ val: 'highest', label: '🔺 Highest' },
				{ val: 'high', label: '⏫ High' },
				{ val: 'medium', label: '🔼 Medium' },
				{ val: 'low', label: '🔽 Low' },
				{ val: 'lowest', label: '⏬ Lowest' }
			];

			priorities.forEach(p => {
				const opt = prioSelect.createEl('option', { value: p.val, text: p.label });
				if (upProp.newPriority === p.val) opt.selected = true;
			});

			prioSelect.addEventListener('change', () => {
				upProp.newPriority = (prioSelect.value || null) as TaskPriority | null;
				updateUI();
			});

			// 4. Action Statut
			const statusCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const statusHeader = statusCard.createDiv({ cls: 'sbm-facet-header' });
			statusHeader.createSpan({ cls: 'sbm-facet-title', text: '🏷️ Action 5 : Statut de la tâche' });

			const statusChips = statusCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const statuses = [
				{ value: 'todo', label: 'À faire [ ]' },
				{ value: 'in_progress', label: '⏳ En cours [/]' },
				{ value: 'done', label: '✅ Terminée [x]' },
				{ value: 'cancelled', label: '❌ Annulée [-]' },
				{ value: '', label: 'Inchangé' }
			];

			statuses.forEach(s => {
				const chip = statusChips.createEl('button', {
					cls: `sbm-edit-chip-btn ${upProp.newStatus === s.value || (!upProp.newStatus && s.value === '') ? 'is-active' : ''}`,
					text: s.label
				});
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					upProp.newStatus = s.value || undefined;
					statusChips.querySelectorAll('.sbm-edit-chip-btn').forEach(c => c.removeClass('is-active'));
					chip.addClass('is-active');
					updateUI();
				});
			});

		} else if (prop.type === 'create_note') {
			// Pour la création de note : personnalisation du dossier, nom de fichier et contenu
			const createProp = prop as CreateNoteActionProposal;
			const grid = drawerBody.createDiv({ cls: 'sbm-multi-action-grid' });

			// 1. Dossier cible
			const folderCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const folderHeader = folderCard.createDiv({ cls: 'sbm-facet-header' });
			folderHeader.createSpan({ cls: 'sbm-facet-title', text: '📁 Dossier cible' });

			const folderInput = folderCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Ex: 00 - Inbox, 01 - Projets, 03 - Contacts...'
			});
			folderInput.value = createProp.folder || '';
			if (app) new FolderSuggest(app, folderInput);
			folderInput.addEventListener('input', () => {
				createProp.folder = folderInput.value.trim();
				createProp.targetPath = `${createProp.folder}/${createProp.fileName || 'Note.md'}`;
				updateUI();
			});

			const folderChips = folderCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const vaultFolders = this.getVaultTopFolders(app);
			vaultFolders.slice(0, 6).forEach(f => {
				const chip = folderChips.createEl('button', { cls: 'sbm-edit-chip-btn', text: `📁 ${f}` });
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					createProp.folder = f;
					folderInput.value = f;
					createProp.targetPath = `${f}/${createProp.fileName || 'Note.md'}`;
					updateUI();
				});
			});

			// 2. Nom de la note
			const nameCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const nameHeader = nameCard.createDiv({ cls: 'sbm-facet-header' });
			nameHeader.createSpan({ cls: 'sbm-facet-title', text: '📝 Nom de la nouvelle note' });

			const nameInput = nameCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Nom du fichier...'
			});
			nameInput.value = (createProp.fileName || createProp.targetPath.split('/').pop() || '').replace(/\.md$/, '');
			nameInput.addEventListener('input', () => {
				const val = nameInput.value.trim();
				createProp.fileName = val ? (val.endsWith('.md') ? val : `${val}.md`) : 'Note.md';
				createProp.targetPath = `${createProp.folder || '00 - Inbox'}/${createProp.fileName}`;
				updateUI();
			});

			// 3. Contenu de la note
			const contentCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const contentHeader = contentCard.createDiv({ cls: 'sbm-facet-header' });
			contentHeader.createSpan({ cls: 'sbm-facet-title', text: '📄 Contenu initial Markdown' });

			const contentTextarea = contentCard.createEl('textarea', {
				cls: 'sbm-edit-textarea',
				placeholder: 'Contenu Markdown de la note...'
			});
			contentTextarea.value = createProp.content || '';
			contentTextarea.addEventListener('input', () => {
				createProp.content = contentTextarea.value;
				updateUI();
			});
		} else if (prop.type === 'move_note' || prop.type === 'rename_note' || prop.type === 'link_notes' || prop.type === 'append_to_note') {
			// Pour les Notes existantes : Configuration multi-actions (Dossier + Renommage + Liaison + Ajout texte)
			const moveProp = prop as MoveNoteActionProposal;

			const grid = drawerBody.createDiv({ cls: 'sbm-multi-action-grid' });

			// 1. Action Déplacer
			const folderCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const folderHeader = folderCard.createDiv({ cls: 'sbm-facet-header' });
			folderHeader.createSpan({ cls: 'sbm-facet-title', text: '📁 Action 1 : Déplacer vers un dossier' });

			const folderInput = folderCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Ex: 01 - Projets, 02 - Domaines...'
			});
			folderInput.value = moveProp.destinationFolder || '';
			if (app) new FolderSuggest(app, folderInput);
			folderInput.addEventListener('input', () => {
				moveProp.destinationFolder = folderInput.value.trim() || undefined;
				updateUI();
			});

			const folderChips = folderCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const vaultFolders = this.getVaultTopFolders(app);
			vaultFolders.slice(0, 6).forEach(f => {
				const chip = folderChips.createEl('button', { cls: 'sbm-edit-chip-btn', text: `📁 ${f}` });
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					moveProp.destinationFolder = f;
					folderInput.value = f;
					updateUI();
				});
			});

			// 2. Action Renommer
			const renameCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const renameHeader = renameCard.createDiv({ cls: 'sbm-facet-header' });
			renameHeader.createSpan({ cls: 'sbm-facet-title', text: '✏️ Action 2 : Renommer la note' });

			const nameInput = renameCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Nouveau nom de fichier...'
			});
			const curName = moveProp.newFileName || moveProp.targetPath.split('/').pop()?.replace(/\.md$/, '') || '';
			nameInput.value = curName.replace(/\.md$/, '');
			nameInput.addEventListener('input', () => {
				const val = nameInput.value.trim();
				moveProp.newFileName = val ? (val.endsWith('.md') ? val : `${val}.md`) : undefined;
				updateUI();
			});

			// 3. Action Lier avec une autre note
			const linkCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const linkHeader = linkCard.createDiv({ cls: 'sbm-facet-header' });
			linkHeader.createSpan({ cls: 'sbm-facet-title', text: '🔗 Action 3 : Lier à une autre note' });

			const linkInput = linkCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Rechercher une note du coffre à lier [[...]]'
			});
			linkInput.value = moveProp.targetNoteName || '';
			if (app) new FileSuggest(app, linkInput);
			linkInput.addEventListener('input', () => {
				const clean = linkInput.value.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
				moveProp.targetNoteName = clean ? (clean.split('/').pop()?.replace(/\.md$/, '') || clean) : undefined;
				updateUI();
			});

			// Sélecteur de direction du lien (Sens normal, Inverse ou Bidirectionnel)
			const dirRow = linkCard.createDiv({ cls: 'sbm-edit-chips-row' });
			const currentDir = moveProp.linkDirection || 'forward';
			const directions: Array<{ val: 'forward' | 'backward' | 'both'; label: string; title: string }> = [
				{ val: 'forward', label: '➔ Dans cette note', title: 'Insère [[Cible]] dans cette note' },
				{ val: 'backward', label: '⬅️ Dans la note cible', title: 'Insère [[Cette note]] dans la note cible' },
				{ val: 'both', label: '⇄ Bidirectionnel', title: 'Insère le lien dans les deux notes simultanément' }
			];

			directions.forEach(d => {
				const chip = dirRow.createEl('button', {
					cls: `sbm-edit-chip-btn ${currentDir === d.val ? 'is-active' : ''}`,
					text: d.label
				});
				chip.title = d.title;
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					moveProp.linkDirection = d.val;
					dirRow.querySelectorAll('.sbm-edit-chip-btn').forEach(c => c.removeClass('is-active'));
					chip.addClass('is-active');
					updateUI();
				});
			});

			const explInput = linkCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Explication / contexte du lien (optionnel)...'
			});
			explInput.value = moveProp.contextExplanation || '';
			explInput.addEventListener('input', () => {
				moveProp.contextExplanation = explInput.value.trim() || undefined;
				updateUI();
			});

			// 4. Action Ajouter du contenu / Section
			const appendCard = grid.createDiv({ cls: 'sbm-action-facet-card' });
			const appendHeader = appendCard.createDiv({ cls: 'sbm-facet-header' });
			appendHeader.createSpan({ cls: 'sbm-facet-title', text: '📌 Action 4 : Insérer du texte dans la note' });

			const sectionInput = appendCard.createEl('input', {
				type: 'text',
				cls: 'sbm-edit-input',
				placeholder: 'Titre de la section cible (ex: Notes, Références)...'
			});
			sectionInput.value = moveProp.section || '';
			sectionInput.addEventListener('input', () => {
				moveProp.section = sectionInput.value.trim() || undefined;
				updateUI();
			});

			const appendTextarea = appendCard.createEl('textarea', {
				cls: 'sbm-edit-textarea',
				placeholder: 'Texte ou compte-rendu à insérer...'
			});
			appendTextarea.value = moveProp.appendContent || '';
			appendTextarea.addEventListener('input', () => {
				moveProp.appendContent = appendTextarea.value.trim() || undefined;
				updateUI();
			});
		}

		// Footer du tiroir avec boutons Appliquer / Réinitialiser
		const drawerFooter = drawerEl.createDiv({ cls: 'sbm-edit-drawer-footer' });

		const saveBtn = drawerFooter.createEl('button', {
			cls: 'sbm-edit-apply-btn mod-cta',
			text: '✓ Valider toutes les actions'
		});
		saveBtn.addEventListener('click', (e) => {
			e.preventDefault();
			updateUI();
			this.toggleDrawer(drawerEl, false);
			new Notice('Actions combinées enregistrées avec succès !');
		});

		const resetBtn = drawerFooter.createEl('button', {
			cls: 'sbm-edit-reset-btn',
			text: '↺ Réinitialiser'
		});
		resetBtn.title = 'Rétablir la proposition initiale du LLM';
		resetBtn.addEventListener('click', (e) => {
			e.preventDefault();
			try {
				const parsed = JSON.parse(initialJson);
				Object.assign(prop, parsed);
				updateUI();
				this.renderMultiActionEditDrawer(drawerEl, prop, initialJson, updateUI, app);
				new Notice('Proposition réinitialisée à sa valeur initiale.');
			} catch {
				// ignore
			}
		});
	}





	private static getVaultTopFolders(app?: App): string[] {
		if (!app) return ['01 - Projets', '02 - Domaines', '03 - Contacts', '04 - Journal', '00 - Boîte de réception'];
		const folders: string[] = [];
		const all = app.vault.getAllLoadedFiles();
		all.forEach(f => {
			if (f instanceof TFolder && f.path && f.path !== '/') {
				folders.push(f.path);
			}
		});
		return folders.sort();
	}

	/**
	 * Affiche l'écran de confirmation et les boutons directs d'ouverture de note.
	 */
	private static renderExecutionResults(
		widgetEl: HTMLElement,
		results: ActionResult[],
		selectedProposals: ActionProposal[],
		app?: App,
		onExecuted?: (results: ActionResult[]) => void
	): void {
		widgetEl.empty();
		widgetEl.addClass('sbm-preview-results-view');

		const successResults = results.filter(r => r.success);
		const errorResults = results.filter(r => !r.success);

		const resHeader = widgetEl.createDiv({ cls: 'sbm-results-header' });
		resHeader.createEl('h4', {
			text: `${successResults.length > 0 ? '🎉' : '⚠️'} ${successResults.length} modification${successResults.length > 1 ? 's' : ''} appliquée${successResults.length > 1 ? 's' : ''} avec succès !`,
			cls: 'sbm-results-title'
		});

		if (errorResults.length > 0) {
			const errBox = widgetEl.createDiv({ cls: 'sbm-results-error-box' });
			errBox.createSpan({ text: `⚠️ ${errorResults.length} action(s) n'ont pas pu aboutir :` });
			const errList = errBox.createDiv({ cls: 'sbm-results-error-list' });
			errorResults.forEach(r => {
				errList.createEl('div', { cls: 'sbm-result-error-msg', text: `• ${r.message}` });
			});
		}

		// Liste des notes créées ou modifiées avec succès avec boutons directs pour les ouvrir
		const successfulPaths = Array.from(new Set(
			successResults
				.map(r => r.createdOrModifiedPath)
				.filter((p): p is string => Boolean(p) && p !== 'Google Calendar')
		));

		if (successfulPaths.length > 0 && app) {
			const notesSection = widgetEl.createDiv({ cls: 'sbm-results-notes-section' });
			notesSection.createEl('span', { cls: 'sbm-results-notes-label', text: '📄 Notes créées ou modifiées :' });

			const notesList = notesSection.createDiv({ cls: 'sbm-results-notes-list' });

			successfulPaths.forEach(finalPath => {
				const basename = finalPath.split('/').pop()?.replace(/\.md$/, '') || finalPath;

				const noteCard = notesList.createDiv({ cls: 'sbm-result-note-card' });
				
				const noteInfo = noteCard.createDiv({ cls: 'sbm-result-note-info' });
				noteInfo.createSpan({ cls: 'sbm-result-note-title', text: `📝 [[${basename}]]` });
				noteInfo.createSpan({ cls: 'sbm-result-note-path', text: finalPath });

				const openBtn = noteCard.createEl('button', {
					cls: 'sbm-result-note-btn mod-cta',
					text: '📄 Ouvrir la note'
				});
				openBtn.title = `Ouvrir [[${basename}]] directement dans l'éditeur`;
				openBtn.addEventListener('click', async () => {
					await this.openNote(app, finalPath);
				});
			});
		}

		const closeRow = widgetEl.createDiv({ cls: 'sbm-results-close-row' });
		const doneBtn = closeRow.createEl('button', {
			cls: 'sbm-results-done-btn',
			text: 'Fermer'
		});
		doneBtn.addEventListener('click', () => {
			widgetEl.remove();
		});

		if (onExecuted) {
			onExecuted(results);
		}
	}

	public static async openNote(app: App, filePath: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const file = app.vault.getFileByPath(normalized) || app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			const leaf = app.workspace.getLeaf ? app.workspace.getLeaf(false) : app.workspace.activeLeaf;
			if (leaf) {
				await leaf.openFile(file);
			}
		} else {
			await app.workspace.openLinkText(normalized, '', false);
		}
		new Notice(`Note ouverte : [[${filePath.split('/').pop()?.replace('.md', '')}]]`);
	}
}
