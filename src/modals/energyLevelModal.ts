import { App, Modal, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';
import { VIEW_TYPE_BRIEFING, BriefingView } from '../views/briefingView';
import { VIEW_TYPE_DASHBOARD, DashboardView } from '../views/dashboardView';

export class EnergyLevelModal extends Modal {
	private plugin: SecondBrainPlugin;
	private onSelected?: (energy: number) => void;

	constructor(app: App, plugin: SecondBrainPlugin, onSelected?: (energy: number) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelected = onSelected;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sbm-energy-modal');

		const titleRow = contentEl.createDiv({ cls: 'sbm-modal-title-row' });
		const iconSpan = titleRow.createSpan({ cls: 'sbm-modal-title-icon' });
		setIcon(iconSpan, 'zap');
		titleRow.createEl('h2', { text: 'Niveau d\'énergie actuel', cls: 'sbm-modal-title' });

		const current = this.plugin.settings.energyLevel;

		contentEl.createEl('p', {
			cls: 'sbm-modal-description',
			text: 'Évaluez votre niveau d\'énergie pour adapter le mode de productivité (Mode Économie ≤ 3, Équilibré 4-7, Plein Potentiel 8-10) :'
		});

		const grid = contentEl.createDiv({ cls: 'sbm-energy-modal-grid' });

		for (let i = 1; i <= 10; i++) {
			const btn = grid.createEl('button', {
				cls: `sbm-energy-num-btn ${i <= 3 ? 'low' : i <= 7 ? 'med' : 'high'} ${i === current ? 'is-active' : ''}`
			});

			btn.createSpan({ text: i.toString(), cls: 'sbm-energy-num-val' });
			const modeLabel = i <= 3 ? '⚡ Éco' : i <= 7 ? '🌱 Équilibré' : '🔥 Plein';
			btn.createSpan({ text: modeLabel, cls: 'sbm-energy-num-sub' });

			btn.addEventListener('click', async () => {
				await this.applyEnergy(i);
			});
		}

		// Raccourcis clavier : 1 à 9 et 0 pour 10
		this.scope.register([], '1', () => { this.applyEnergy(1); return false; });
		this.scope.register([], '2', () => { this.applyEnergy(2); return false; });
		this.scope.register([], '3', () => { this.applyEnergy(3); return false; });
		this.scope.register([], '4', () => { this.applyEnergy(4); return false; });
		this.scope.register([], '5', () => { this.applyEnergy(5); return false; });
		this.scope.register([], '6', () => { this.applyEnergy(6); return false; });
		this.scope.register([], '7', () => { this.applyEnergy(7); return false; });
		this.scope.register([], '8', () => { this.applyEnergy(8); return false; });
		this.scope.register([], '9', () => { this.applyEnergy(9); return false; });
		this.scope.register([], '0', () => { this.applyEnergy(10); return false; });
	}

	private async applyEnergy(val: number): Promise<void> {
		this.plugin.settings.energyLevel = val;
		await this.plugin.saveSettings();

		const modeText = val <= 3 ? '⚡ Mode Économie' : val <= 7 ? '🌱 Mode Équilibré' : '🔥 Mode Plein Potentiel';
		new Notice(`Énergie mise à jour : ${val}/10 (${modeText})`);

		// Rafraîchir la vue Briefing si ouverte
		const briefingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_BRIEFING);
		for (const leaf of briefingLeaves) {
			if (leaf.view instanceof BriefingView) {
				await leaf.view.render();
			}
		}

		// Rafraîchir la vue Dashboard si ouverte
		const dashboardLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
		for (const leaf of dashboardLeaves) {
			if (leaf.view instanceof DashboardView) {
				await leaf.view.render();
			}
		}

		if (this.onSelected) {
			this.onSelected(val);
		}

		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
