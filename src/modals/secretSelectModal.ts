import { App, Modal, Setting, Notice } from 'obsidian';

export class SecretSelectModal extends Modal {
	private onSelect: (secretId: string) => Promise<void>;
	private provider: string;

	constructor(app: App, provider: string, onSelect: (secretId: string) => Promise<void>) {
		super(app);
		this.provider = provider;
		this.onSelect = onSelect;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: `Lier un secret pour ${this.provider.toUpperCase()}` });
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Sélectionnez un secret existant dans votre trousseau Obsidian ou enregistrez un nouvel identifiant de clé secrète.'
		});

		// Liste des secrets existants dans le trousseau
		const secretStorage = (this.app as unknown as { secretStorage?: { listSecrets?: () => Promise<string[]> | string[]; setSecret?: (k: string, v: string) => Promise<void> } }).secretStorage;
		let existingSecrets: string[] = [];

		if (secretStorage && typeof secretStorage.listSecrets === 'function') {
			try {
				const res = await secretStorage.listSecrets();
				if (Array.isArray(res)) existingSecrets = res;
			} catch {
				// Ignorer silencieusement si la méthode n'est pas supportée
			}
		}

		if (existingSecrets.length > 0) {
			contentEl.createEl('h3', { text: 'Secrets existants disponibles' });
			const listEl = contentEl.createEl('div', { cls: 'sbm-secret-list' });

			existingSecrets.forEach(secretId => {
				const item = listEl.createEl('div', { cls: 'sbm-secret-item' });
				item.createEl('span', { cls: 'sbm-secret-id', text: secretId });
				const chooseBtn = item.createEl('button', { cls: 'sbm-secret-choose-btn', text: 'Sélectionner' });
				chooseBtn.addEventListener('click', async () => {
					await this.onSelect(secretId);
					new Notice(`Secret "${secretId}" lié avec succès.`);
					this.close();
				});
			});
		}

		// Option pour créer / lier un nouvel identifiant de secret
		contentEl.createEl('h3', { text: 'Enregistrer ou lier un nouveau secret' });
		const formEl = contentEl.createEl('div', { cls: 'sbm-new-secret-form' });

		let customSecretId = `${this.provider}-api-key`;
		let secretValue = '';

		new Setting(formEl)
			.setName('Identifiant du secret')
			.setDesc('Nom du secret dans le trousseau (ex: gemini-api-key)')
			.addText(text => text
				.setValue(customSecretId)
				.onChange(val => { customSecretId = val.trim(); }));

		new Setting(formEl)
			.setName('Valeur de la clé API (optionnel)')
			.setDesc('Si la clé n\'est pas encore enregistrée dans le trousseau')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Entrez la clé secrète...');
				text.onChange(val => { secretValue = val.trim(); });
			})
			.addButton(btn => btn
				.setButtonText('Lier ce secret')
				.setCta()
				.onClick(async () => {
					if (!customSecretId) {
						new Notice('Veuillez renseigner un identifiant de secret.');
						return;
					}

					// Si une valeur a été saisie, on l'enregistre dans le SecretStorage
					if (secretValue && secretStorage && typeof secretStorage.setSecret === 'function') {
						await secretStorage.setSecret(customSecretId, secretValue);
					} else if (secretValue) {
						window.localStorage.setItem(`sbm_secret_${customSecretId}`, secretValue);
					}

					await this.onSelect(customSecretId);
					new Notice(`Secret "${customSecretId}" lié avec succès.`);
					this.close();
				}));
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
