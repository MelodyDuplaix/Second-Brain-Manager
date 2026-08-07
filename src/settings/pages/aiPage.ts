import { Setting, Notice } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';
import { SecretSelectModal } from '../../modals/secretSelectModal';

export class AIPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.renderHeader();

		const providerGroup = new SettingGroup(this.containerEl).setHeading('Modèle & Fournisseur IA');

		providerGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur LLM')
				.setDesc('Sélectionnez le modèle d\'intelligence artificielle pour le chat et les résumés')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('gemini', 'Google Gemini (1.5 Flash / Pro, 2.0)')
						.addOption('openai', 'OpenAI ChatGPT (GPT-4o, GPT-4o-mini)')
						.addOption('ollama', 'Ollama (Serveur Local)')
						.addOption('lm-studio', 'LM Studio (Serveur Local)')
						.setValue(this.plugin.settings.llmProvider)
						.onChange(async (value: 'gemini' | 'openai' | 'ollama' | 'lm-studio') => {
							this.plugin.settings.llmProvider = value;
							if (value === 'gemini') {
								this.plugin.settings.llmModel = 'gemini-1.5-flash';
							} else if (value === 'openai') {
								this.plugin.settings.llmModel = 'gpt-4o-mini';
							} else if (value === 'ollama') {
								this.plugin.settings.llmEndpoint = 'http://localhost:11434';
								this.plugin.settings.llmModel = 'llama3:latest';
							}
							await this.plugin.saveSettings();
							this.render();
						});
				});
		});

		providerGroup.addSetting((setting: Setting) => {
			setting
				.setName('Nom du Modèle')
				.setDesc('Identifiant exact du modèle (ex: gemini-1.5-flash, gpt-4o-mini, llama3:latest)')
				.addText((text) => {
					text.setValue(this.plugin.settings.llmModel).onChange(async (value) => {
						this.plugin.settings.llmModel = value.trim() || 'gemini-1.5-flash';
						await this.plugin.saveSettings();
					});
				});
		});

		if (this.plugin.settings.llmProvider === 'ollama' || this.plugin.settings.llmProvider === 'lm-studio') {
			providerGroup.addSetting((setting: Setting) => {
				setting
					.setName('URL de l\'Endpoint Local')
					.setDesc('URL du serveur local')
					.addText((text) => {
						text.setValue(this.plugin.settings.llmEndpoint).onChange(async (value) => {
							this.plugin.settings.llmEndpoint = value.trim();
							await this.plugin.saveSettings();
						});
					});
			});
		}

		if (this.plugin.settings.llmProvider === 'gemini' || this.plugin.settings.llmProvider === 'openai') {
			const provider = this.plugin.settings.llmProvider;
			const currentSecretId = provider === 'gemini' ? this.plugin.settings.geminiSecretId : this.plugin.settings.openaiSecretId;

			const secretGroup = new SettingGroup(this.containerEl).setHeading('Trousseau de Clés & Secret Storage');

			secretGroup.addSetting((setting: Setting) => {
				setting.setName(`Clé API ${provider.toUpperCase()}`);

				if (!currentSecretId) {
					setting
						.setDesc('Aucun secret lié. Liez une clé issue du trousseau officiel Obsidian (Secret Storage API).')
						.addButton((btn) => {
							btn
								.setButtonText('Lier un secret')
								.setCta()
								.onClick(() => {
									new SecretSelectModal(this.plugin.app, provider, async (selectedId) => {
										if (provider === 'gemini') {
											this.plugin.settings.geminiSecretId = selectedId;
										} else {
											this.plugin.settings.openaiSecretId = selectedId;
										}
										await this.plugin.saveSettings();
										this.render();
									}).open();
								});
						});
				} else {
					setting
						.setDesc(`Secret lié : ${currentSecretId}`)
						.addButton((modifyBtn) => {
							modifyBtn.setButtonText('Modifier').onClick(() => {
								new SecretSelectModal(this.plugin.app, provider, async (selectedId) => {
									if (provider === 'gemini') {
										this.plugin.settings.geminiSecretId = selectedId;
									} else {
										this.plugin.settings.openaiSecretId = selectedId;
									}
									await this.plugin.saveSettings();
									this.render();
								}).open();
							});
						})
						.addButton((unlinkBtn) => {
							unlinkBtn
								.setButtonText('Délier')
								.setWarning()
								.onClick(async () => {
									if (provider === 'gemini') {
										this.plugin.settings.geminiSecretId = undefined;
									} else {
										this.plugin.settings.openaiSecretId = undefined;
									}
									await this.plugin.saveSettings();
									new Notice(`Secret délié pour ${provider.toUpperCase()}`);
									this.render();
								});
						});
				}
			});
		}
	}
}
