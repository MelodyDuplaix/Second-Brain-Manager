import { ButtonComponent, Setting, setIcon, Notice } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';
import { FolderSuggest } from '../../suggesters/folderSuggest';
import { SecretSelectModal } from '../../modals/secretSelectModal';

export class MainPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.containerEl.addClass('sbm-main-settings-page');

		// 1. Module Gamification & Boutique (Sous-page dédiée)
		const gamificationGroup = new SettingGroup(this.containerEl).setHeading('Gamification & Boutique');
		gamificationGroup.addSetting((setting: Setting) => {
			setting
				.setName('Récompenses de Boutique')
				.setDesc('Gérer le catalogue des récompenses, leurs coûts en pièces et les ajouts')
				.addButton((button: ButtonComponent) => {
					button.setIcon('chevron-right').onClick(() => {
						this.openPage('rewards-page');
					});
					button.buttonEl.addClass('clickable-icon');
				});

			const iconEl = activeDocument.createElement('div');
			iconEl.addClass('sbm-settings-page-title-icon');
			setIcon(iconEl, 'gift');

			setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
			setting.nameEl.addClass('sbm-settings-page-title');
			setting.settingEl.addClass('sbm-settings-page-title-setting');
			setting.settingEl.setAttribute('tabindex', '0');
			setting.settingEl.setAttribute('role', 'button');

			const handleOpen = () => {
				this.openPage('rewards-page');
			};

			setting.settingEl.addEventListener('click', handleOpen);
			setting.settingEl.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handleOpen();
				}
			});
		});

		// 2. Général & Énergie
		const generalGroup = new SettingGroup(this.containerEl).setHeading('Général & Énergie');
		generalGroup.addSetting((setting: Setting) => {
			setting
				.setName('Niveau d\'énergie initial')
				.setDesc('Votre niveau d\'énergie de base par défaut (de 1 à 10)')
				.addSlider((slider) => {
					slider
						.setLimits(1, 10, 1)
						.setValue(this.plugin.settings.energyLevel)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.energyLevel = value;
							await this.plugin.saveSettings();
						});
				});
		});

		// 3. Dossiers du Coffre
		const foldersGroup = new SettingGroup(this.containerEl).setHeading('Dossiers du Coffre');
		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier Inbox')
				.setDesc('Dossier dans lequel les nouvelles notes brutes sont stockées')
				.addText((text) => {
					text
						.setPlaceholder('00 - Inbox')
						.setValue(this.plugin.settings.inboxFolder)
						.onChange(async (value) => {
							this.plugin.settings.inboxFolder = value.trim();
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier Journal (Daily Notes)')
				.setDesc('Dossier des notes quotidiennes du journal')
				.addText((text) => {
					text
						.setPlaceholder('04 - Journal')
						.setValue(this.plugin.settings.dailyNotesFolder)
						.onChange(async (value) => {
							this.plugin.settings.dailyNotesFolder = value.trim();
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		// 4. Syntaxes des Tâches & Priorités
		const syntaxGroup = new SettingGroup(this.containerEl).setHeading('Syntaxes des Tâches & Priorités');
		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format des Priorités')
				.setDesc('Choisissez entre les emojis Obsidian Tasks (🔺 ⏫ 🔼 🔽 ⏬) ou les tags (#priorite/haute, #priority/high...)')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('emoji', 'Emojis Obsidian Tasks (🔺 ⏫ 🔼 🔽 ⏬)')
						.addOption('tag', 'Tags (#priorite/haute, #priority/high...)')
						.setValue(this.plugin.settings.priorityMode)
						.onChange(async (value: 'emoji' | 'tag') => {
							this.plugin.settings.priorityMode = value;
							await this.plugin.saveSettings();
							this.render();
						});
				});
		});

		if (this.plugin.settings.priorityMode === 'tag') {
			syntaxGroup.addSetting((setting: Setting) => {
				setting
					.setName('Nom du tag racine de priorité')
					.setDesc('Préfixe utilisé pour les niveaux de priorité sous forme de tags (ex: priorite -> #priorite/haute, #priorite/urgente ou priority -> #priority/high)')
					.addText((text) => {
						text
							.setPlaceholder('priorite')
							.setValue(this.plugin.settings.priorityTagPrefix)
							.onChange(async (value) => {
								this.plugin.settings.priorityTagPrefix = value.trim() || 'priorite';
								await this.plugin.saveSettings();
							});
					});
			});
		}

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Préfixe Tag Énergie')
				.setDesc('Préfixe des tags d\'énergie (ex: energie -> #energie/4)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.energyTagPrefix)
						.onChange(async (value) => {
							this.plugin.settings.energyTagPrefix = value.trim() || 'energie';
							await this.plugin.saveSettings();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Préfixe Tag Pièces')
				.setDesc('Préfixe des tags de récompense (ex: pieces -> #pieces/5)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.piecesTagPrefix)
						.onChange(async (value) => {
							this.plugin.settings.piecesTagPrefix = value.trim() || 'pieces';
							await this.plugin.saveSettings();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format des dates')
				.setDesc('Format Moment.js (ex: YYYY-MM-DD)')
				.addText((text) => {
					text
						.setPlaceholder('YYYY-MM-DD')
						.setValue(this.plugin.settings.dateFormat)
						.onChange(async (value) => {
							this.plugin.settings.dateFormat = value.trim() || 'YYYY-MM-DD';
							await this.plugin.saveSettings();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dates sous forme de Wikilinks')
				.setDesc('Encadrer les dates dans des wikilinks [[YYYY-MM-DD]]')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.useWikilinks)
						.onChange(async (value) => {
							this.plugin.settings.useWikilinks = value;
							await this.plugin.saveSettings();
						});
				});
		});

		// 5. Matrice Eisenhower
		const matrixGroup = new SettingGroup(this.containerEl).setHeading('Matrice Eisenhower');
		matrixGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur de Matrice')
				.setDesc('Sélectionnez le format de tag de matrice utilisé dans votre coffre')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('task-matrix', 'TaskMatrix (#tm/qN)')
						.addOption('focus-first', 'Focus First (#focus, #qN)')
						.addOption('custom', 'Tags Personnalisés (#q1, #q2...)')
						.setValue(this.plugin.settings.matrixProvider)
						.onChange(async (value: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom') => {
							this.plugin.settings.matrixProvider = value;
							await this.plugin.saveSettings();
						});
				});
		});

		// 6. Agent IA & Secret Storage
		const aiGroup = new SettingGroup(this.containerEl).setHeading('Agent IA & Secret Storage');
		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur LLM')
				.setDesc('Sélectionnez le modèle d\'intelligence artificielle pour le chat et les briefings')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('gemini', 'Google Gemini (1.5 Flash / Pro, 2.0)')
						.addOption('openai', 'OpenAI ChatGPT (GPT-4o, GPT-4o-mini)')
						.addOption('ollama', 'Ollama (Local sans clé API)')
						.addOption('lm-studio', 'LM Studio (Local sans clé API)')
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

		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Modèle IA')
				.setDesc('Nom du modèle (ex: gemini-1.5-flash, gpt-4o-mini, llama3)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.llmModel)
						.onChange(async (value) => {
							this.plugin.settings.llmModel = value.trim() || 'gemini-1.5-flash';
							await this.plugin.saveSettings();
						});
				});
		});

		if (this.plugin.settings.llmProvider === 'ollama' || this.plugin.settings.llmProvider === 'lm-studio') {
			aiGroup.addSetting((setting: Setting) => {
				setting
					.setName('URL de l\'Endpoint Local')
					.setDesc('URL du serveur IA local')
					.addText((text) => {
						text
							.setValue(this.plugin.settings.llmEndpoint)
							.onChange(async (value) => {
								this.plugin.settings.llmEndpoint = value.trim();
								await this.plugin.saveSettings();
							});
					});
			});
		}

		if (this.plugin.settings.llmProvider === 'gemini' || this.plugin.settings.llmProvider === 'openai') {
			const provider = this.plugin.settings.llmProvider;
			const currentSecretId = provider === 'gemini' ? this.plugin.settings.geminiSecretId : this.plugin.settings.openaiSecretId;

			aiGroup.addSetting((setting: Setting) => {
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
							modifyBtn
								.setButtonText('Modifier')
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
