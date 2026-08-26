import { App, Modal, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';

export class BriefingEnergyModal extends Modal {
	private plugin: SecondBrainPlugin;
	private onConfirm: (energy: number) => void;
	private selectedEnergy: number;

	constructor(app: App, plugin: SecondBrainPlugin, onConfirm: (energy: number) => void) {
		super(app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
		this.selectedEnergy = this.plugin.settings.energyLevel || 5;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sbm-energy-modal');
		contentEl.addClass('sbm-briefing-energy-modal');

		const titleRow = contentEl.createDiv({ cls: 'sbm-modal-title-row' });
		const iconSpan = titleRow.createSpan({ cls: 'sbm-modal-title-icon' });
		setIcon(iconSpan, 'sun');
		titleRow.createEl('h2', { text: 'Briefing du Matin — Niveau d\'énergie', cls: 'sbm-modal-title' });

		contentEl.createEl('p', {
			cls: 'sbm-modal-description',
			text: 'Avant de lancer votre briefing, indiquez votre niveau d\'énergie pour que l\'IA adapte précisément votre programme de la journée :'
		});

		const grid = contentEl.createDiv({ cls: 'sbm-energy-modal-grid' });
		const buttons: HTMLButtonElement[] = [];

		for (let i = 1; i <= 10; i++) {
			const btn = grid.createEl('button', {
				cls: `sbm-energy-num-btn ${i <= 3 ? 'low' : i <= 7 ? 'med' : 'high'} ${i === this.selectedEnergy ? 'is-active' : ''}`
			});

			btn.createSpan({ text: i.toString(), cls: 'sbm-energy-num-val' });
			const modeLabel = i <= 3 ? '⚡ Éco' : i <= 7 ? '🌱 Équilibré' : '🔥 Plein';
			btn.createSpan({ text: modeLabel, cls: 'sbm-energy-num-sub' });

			btn.addEventListener('click', async () => {
				this.selectedEnergy = i;
				buttons.forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				await this.applyAndLaunch(i);
			});

			buttons.push(btn);
		}

		// Raccourcis clavier : 1 à 9 et 0 pour 10
		this.scope.register([], '1', () => { void this.applyAndLaunch(1); return false; });
		this.scope.register([], '2', () => { void this.applyAndLaunch(2); return false; });
		this.scope.register([], '3', () => { void this.applyAndLaunch(3); return false; });
		this.scope.register([], '4', () => { void this.applyAndLaunch(4); return false; });
		this.scope.register([], '5', () => { void this.applyAndLaunch(5); return false; });
		this.scope.register([], '6', () => { void this.applyAndLaunch(6); return false; });
		this.scope.register([], '7', () => { void this.applyAndLaunch(7); return false; });
		this.scope.register([], '8', () => { void this.applyAndLaunch(8); return false; });
		this.scope.register([], '9', () => { void this.applyAndLaunch(9); return false; });
		this.scope.register([], '0', () => { void this.applyAndLaunch(10); return false; });

		// Bouton Lancer directement avec l'énergie actuelle
		const actionsRow = contentEl.createDiv({ cls: 'sbm-modal-actions-row' });
		const launchBtn = actionsRow.createEl('button', {
			cls: 'mod-cta sbm-modal-cta-btn',
			text: `☀️ Lancer avec Énergie ${this.selectedEnergy}/10`
		});

		launchBtn.addEventListener('click', async () => {
			await this.applyAndLaunch(this.selectedEnergy);
		});
	}

	private async applyAndLaunch(val: number): Promise<void> {
		this.plugin.settings.energyLevel = val;
		await this.plugin.saveSettings();

		const modeText = val <= 3 ? '⚡ Mode Économie' : val <= 7 ? '🌱 Mode Équilibré' : '🔥 Mode Plein Potentiel';
		new Notice(`Énergie : ${val}/10 (${modeText}) — Lancement du briefing...`);

		this.close();
		this.onConfirm(val);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
