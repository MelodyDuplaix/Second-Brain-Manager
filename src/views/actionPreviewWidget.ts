import { Notice } from 'obsidian';
import { ActionProposal, ActionResult } from '../models/actions';
import { ActionExecutor } from '../services/actionExecutor';

export class ActionPreviewWidget {
	public static render(
		containerEl: HTMLElement,
		proposals: ActionProposal[],
		executor: ActionExecutor,
		onExecuted?: (results: ActionResult[]) => void
	): HTMLElement {
		const widgetEl = containerEl.createDiv({ cls: 'sbm-action-preview-card' });

		const headerEl = widgetEl.createDiv({ cls: 'sbm-preview-header' });
		const titleEl = headerEl.createEl('h4', { text: `📋 ${proposals.length} modification${proposals.length > 1 ? 's' : ''} proposée${proposals.length > 1 ? 's' : ''}` });
		titleEl.addClass('sbm-preview-title');

		const listEl = widgetEl.createDiv({ cls: 'sbm-preview-list' });

		const rowMap = new Map<string, { rowEl: HTMLElement; checkbox: HTMLInputElement }>();

		proposals.forEach(prop => {
			const itemRow = listEl.createDiv({ cls: 'sbm-preview-item' });

			const labelEl = itemRow.createEl('label', { cls: 'sbm-preview-label' });
			const checkbox = labelEl.createEl('input', { type: 'checkbox' });
			checkbox.checked = prop.selected;

			checkbox.addEventListener('change', () => {
				prop.selected = checkbox.checked;
				itemRow.toggleClass('is-deselected', !checkbox.checked);
			});

			labelEl.createEl('span', { text: prop.description, cls: 'sbm-preview-desc' });

			rowMap.set(prop.id, { rowEl: itemRow, checkbox });
		});

		// Barre d'actions
		const actionsRow = widgetEl.createDiv({ cls: 'sbm-preview-actions-row' });

		const applyBtn = actionsRow.createEl('button', {
			cls: 'sbm-preview-apply-btn mod-cta',
			text: '⚡ Tout appliquer'
		});

		const cancelBtn = actionsRow.createEl('button', {
			cls: 'sbm-preview-cancel-btn',
			text: 'Annuler'
		});

		applyBtn.addEventListener('click', async () => {
			const selectedCount = proposals.filter(p => p.selected).length;
			if (selectedCount === 0) {
				new Notice('Aucune action sélectionnée.');
				return;
			}

			applyBtn.disabled = true;
			cancelBtn.disabled = true;
			applyBtn.setText('Application...');

			const results = await executor.executeProposals(proposals);

			results.forEach(res => {
				const row = rowMap.get(res.proposalId);
				if (row) {
					row.checkbox.disabled = true;
					if (res.success) {
						row.rowEl.addClass('is-success');
						row.rowEl.createEl('span', { cls: 'sbm-preview-status-badge success', text: '✅ Appliqué' });
					} else {
						row.rowEl.addClass('is-error');
						row.rowEl.createEl('span', { cls: 'sbm-preview-status-badge error', text: `❌ ${res.message}` });
					}
				}
			});

			const successCount = results.filter(r => r.success).length;
			new Notice(`Second Brain : ${successCount}/${results.length} action(s) appliquée(s) avec succès !`);

			applyBtn.remove();
			cancelBtn.setText('Fermer');
			cancelBtn.disabled = false;

			if (onExecuted) {
				onExecuted(results);
			}
		});

		cancelBtn.addEventListener('click', () => {
			widgetEl.remove();
		});

		return widgetEl;
	}
}
