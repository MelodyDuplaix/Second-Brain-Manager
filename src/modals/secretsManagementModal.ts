import { App, Modal, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';
import { InfomaniakService } from '../services/infomaniakService';

export interface ProviderSecretDef {
	id: 'gemini' | 'openai' | 'openrouter' | 'infomaniak';
	name: string;
	desc: string;
	icon: string;
	defaultSecretId: string;
	getSecretId: (plugin: SecondBrainPlugin) => string | undefined;
	setSecretId: (plugin: SecondBrainPlugin, id: string | undefined) => void;
}

export const SUPPORTED_PROVIDERS: ProviderSecretDef[] = [
	{
		id: 'gemini',
		name: 'Google Gemini',
		desc: 'Modèles Gemini 3.5 / 2.5 / 1.5 Flash et Pro (Google AI Studio)',
		icon: 'sparkles',
		defaultSecretId: 'gemini-api-key',
		getSecretId: (p) => p.settings.geminiSecretId,
		setSecretId: (p, id) => { p.settings.geminiSecretId = id; }
	},
	{
		id: 'openai',
		name: 'OpenAI (ChatGPT)',
		desc: 'Modèles GPT-4o, o3-mini, o1 (OpenAI Platform)',
		icon: 'bot',
		defaultSecretId: 'openai-api-key',
		getSecretId: (p) => p.settings.openaiSecretId,
		setSecretId: (p, id) => { p.settings.openaiSecretId = id; }
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		desc: 'Passerelle multi-modèles unifiée (Claude 3.5, Llama 3.3, DeepSeek R1...)',
		icon: 'cpu',
		defaultSecretId: 'openrouter-api-key',
		getSecretId: (p) => p.settings.openrouterSecretId,
		setSecretId: (p, id) => { p.settings.openrouterSecretId = id; }
	},
	{
		id: 'infomaniak',
		name: 'Infomaniak AI Services',
		desc: 'Hébergement souverain suisse (Qwen, Mistral, Apertus) — Product ID auto-détecté via /1/ai',
		icon: 'shield-check',
		defaultSecretId: 'infomaniak-api-key',
		getSecretId: (p) => p.settings.infomaniakSecretId,
		setSecretId: (p, id) => { p.settings.infomaniakSecretId = id; }
	}
];

export class SecretsManagementModal extends Modal {
	private plugin: SecondBrainPlugin;
	private onCloseCallback?: () => void;
	private targetProviderId?: string;

	constructor(app: App, plugin: SecondBrainPlugin, onCloseCallback?: () => void, targetProviderId?: string) {
		super(app);
		this.plugin = plugin;
		this.onCloseCallback = onCloseCallback;
		this.targetProviderId = targetProviderId;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sbm-secrets-modal');

		// Header
		const headerEl = contentEl.createDiv({ cls: 'sbm-secrets-modal-header' });
		const titleRow = headerEl.createDiv({ cls: 'sbm-secrets-modal-title-row' });
		const iconEl = titleRow.createSpan({ cls: 'sbm-secrets-modal-icon' });
		setIcon(iconEl, 'key');
		titleRow.createEl('h2', { text: 'Gestionnaire de clés d\'API et secrets' });

		headerEl.createEl('p', {
			cls: 'sbm-secrets-modal-desc',
			text: 'Enregistrez ou liez directement vos clés d\'accès pour chaque fournisseur LLM. Les clés sont sécurisées dans le trousseau Secret Storage d\'Obsidian.'
		});

		// Liste des secrets existants dans le trousseau Obsidian
		const secretStorage = (this.app as unknown as { secretStorage?: { listSecrets?: () => Promise<string[]> | string[]; setSecret?: (k: string, v: string) => Promise<void> } }).secretStorage;
		let keyringSecrets: string[] = [];

		if (secretStorage && typeof secretStorage.listSecrets === 'function') {
			try {
				const res = await secretStorage.listSecrets();
				if (Array.isArray(res)) keyringSecrets = res;
			} catch {
				// Ignorer
			}
		}

		// Cartes par fournisseur
		const listContainer = contentEl.createDiv({ cls: 'sbm-secrets-providers-list' });

		const providersToShow = this.targetProviderId
			? SUPPORTED_PROVIDERS.filter(p => p.id === this.targetProviderId)
			: SUPPORTED_PROVIDERS;

		for (const provider of providersToShow) {
			const currentSecretId = provider.getSecretId(this.plugin);
			const isLinked = !!currentSecretId;

			const card = listContainer.createDiv({ cls: `sbm-secret-provider-card ${isLinked ? 'is-linked' : 'not-linked'}` });

			// En-tête de carte
			const cardHeader = card.createDiv({ cls: 'sbm-secret-card-header' });
			const cardTitleLeft = cardHeader.createDiv({ cls: 'sbm-secret-card-title-left' });
			const pIcon = cardTitleLeft.createSpan({ cls: 'sbm-provider-icon' });
			setIcon(pIcon, provider.icon);

			const pTitleGroup = cardTitleLeft.createDiv();
			pTitleGroup.createEl('h3', { text: provider.name, cls: 'sbm-provider-name' });
			pTitleGroup.createEl('span', { text: provider.desc, cls: 'sbm-provider-desc' });

			// Badge de statut
			cardHeader.createSpan({
				cls: `sbm-secret-status-badge ${isLinked ? 'linked' : 'unlinked'}`,
				text: isLinked ? `✓ Lié : ${currentSecretId}` : '⚠️ Non configuré'
			});

			// Champs de formulaire
			const formArea = card.createDiv({ cls: 'sbm-secret-card-form' });

			// Pour Infomaniak : Statut d'auto-détection et champ de secours pour Product ID
			let prodInput: HTMLInputElement | null = null;
			if (provider.id === 'infomaniak') {
				const prodRow = formArea.createDiv({ cls: 'sbm-secret-input-row' });
				prodRow.createEl('label', {
					text: 'Product ID AI Tools (Auto-détecté ou manuel) :',
					cls: 'sbm-secret-input-label'
				});
				prodInput = prodRow.createEl('input', {
					cls: 'sbm-secret-input-text',
					type: 'text',
					placeholder: 'Auto-détecté via GET /1/ai ou saisir ex: 90065',
					value: this.plugin.settings.infomaniakProductId || ''
				});
				prodInput.addEventListener('change', async () => {
					this.plugin.settings.infomaniakProductId = prodInput?.value.trim() || undefined;
					await this.plugin.saveSettings();
				});
			}

			// Champ de saisie directe de clé API
			const keyRow = formArea.createDiv({ cls: 'sbm-secret-input-row' });
			keyRow.createEl('label', { text: 'Clé API / Token :', cls: 'sbm-secret-input-label' });

			const inputWrap = keyRow.createDiv({ cls: 'sbm-secret-input-wrapper' });
			const keyInput = inputWrap.createEl('input', {
				cls: 'sbm-secret-input-text',
				type: 'password',
				placeholder: isLinked ? '●●●●●●●● (Entrez une nouvelle clé pour la remplacer)' : 'Coller la clé API / Token ici...'
			});

			// Bouton Afficher/Masquer le mot de passe
			const toggleShowBtn = inputWrap.createEl('button', { cls: 'sbm-secret-toggle-visibility-btn' });
			setIcon(toggleShowBtn, 'eye');
			toggleShowBtn.title = 'Afficher / Masquer la clé';
			toggleShowBtn.addEventListener('click', (e) => {
				e.preventDefault();
				if (keyInput.type === 'password') {
					keyInput.type = 'text';
					setIcon(toggleShowBtn, 'eye-off');
				} else {
					keyInput.type = 'password';
					setIcon(toggleShowBtn, 'eye');
				}
			});

			// Boutons d'actions
			const actionsRow = formArea.createDiv({ cls: 'sbm-secret-actions-row' });

			// Bouton Enregistrer
			const saveBtn = actionsRow.createEl('button', {
				cls: 'sbm-secret-btn mod-cta',
				text: isLinked ? 'Mettre à jour la clé' : 'Enregistrer et lier la clé'
			});

			saveBtn.addEventListener('click', async () => {
				const keyValue = keyInput.value.trim();
				if (!keyValue && !isLinked) {
					new Notice(`Veuillez coller votre clé API pour ${provider.name}.`);
					return;
				}

				if (provider.id === 'infomaniak' && prodInput && prodInput.value.trim()) {
					this.plugin.settings.infomaniakProductId = prodInput.value.trim();
				}

				if (keyValue) {
					const secretIdToUse = currentSecretId || provider.defaultSecretId;
					if (secretStorage && typeof secretStorage.setSecret === 'function') {
						await secretStorage.setSecret(secretIdToUse, keyValue);
					} else {
						window.localStorage.setItem(`sbm_secret_${secretIdToUse}`, keyValue);
					}
					provider.setSecretId(this.plugin, secretIdToUse);

					if (provider.id === 'infomaniak') {
						saveBtn.setDisabled(true);
						saveBtn.setText('⏳ Test de connexion & Détection...');
						const check = await InfomaniakService.testConnection(keyValue, this.plugin.settings.llmEndpoint);
						if (check.success && check.productId) {
							this.plugin.settings.infomaniakProductId = check.productId;
							new Notice(`✓ Connexion Infomaniak réussie ! (Product ID : ${check.productId})`);
						} else if (!this.plugin.settings.infomaniakProductId) {
							new Notice(`⚠️ ${check.error || 'Échec de détection automatique du Product ID'}\nVous pouvez saisir votre Product ID dans le champ prévu.`);
						} else {
							new Notice(`Clé enregistrée pour Infomaniak (Secret: ${secretIdToUse})`);
						}
					} else {
						new Notice(`Clé API enregistrée pour ${provider.name} (Secret: ${secretIdToUse})`);
					}

					await this.plugin.saveSettings();
				} else if (provider.id === 'infomaniak') {
					await this.plugin.saveSettings();
					new Notice('Paramètres Infomaniak enregistrés.');
				}

				this.onOpen();
			});

			// Bouton Délier
			if (isLinked) {
				const unlinkBtn = actionsRow.createEl('button', {
					cls: 'sbm-secret-btn mod-warning',
					text: 'Délier'
				});
				unlinkBtn.addEventListener('click', async () => {
					provider.setSecretId(this.plugin, undefined);
					await this.plugin.saveSettings();
					new Notice(`Secret délié pour ${provider.name}`);
					this.onOpen();
				});
			}

			// Menu déroulant pour lier un secret existant du trousseau Obsidian si disponible
			if (keyringSecrets.length > 0) {
				const keyringRow = formArea.createDiv({ cls: 'sbm-secret-keyring-row' });
				keyringRow.createEl('span', { cls: 'sbm-keyring-label', text: 'Ou lier un secret existant du trousseau :' });
				const keyringSelect = keyringRow.createEl('select', { cls: 'dropdown sbm-keyring-select' });
				keyringSelect.createEl('option', { value: '', text: '-- Sélectionner dans le trousseau --' });
				keyringSecrets.forEach(sec => {
					const opt = keyringSelect.createEl('option', { value: sec, text: sec });
					if (sec === currentSecretId) opt.selected = true;
				});

				keyringSelect.addEventListener('change', async () => {
					const selectedSec = keyringSelect.value;
					if (selectedSec) {
						provider.setSecretId(this.plugin, selectedSec);
						if (provider.hasProductId && productIdInput) {
							this.plugin.settings.infomaniakProductId = productIdInput.value.trim() || undefined;
						}
						await this.plugin.saveSettings();
						new Notice(`Secret "${selectedSec}" lié à ${provider.name}`);
						this.onOpen();
					}
				});
			}
		}

		// Bouton Fermer en bas
		const footerEl = contentEl.createDiv({ cls: 'sbm-secrets-modal-footer' });
		const closeBtn = footerEl.createEl('button', { cls: 'sbm-secrets-close-btn mod-cta', text: 'Terminer' });
		closeBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (this.onCloseCallback) {
			this.onCloseCallback();
		}
	}
}
