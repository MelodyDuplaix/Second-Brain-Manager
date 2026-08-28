import { ButtonComponent, Setting, setIcon, Notice, normalizePath } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';
import { FolderSuggest } from '../../suggesters/folderSuggest';
import { FileSuggest } from '../../suggesters/fileSuggest';
import { SecretsManagementModal, SUPPORTED_PROVIDERS } from '../../modals/secretsManagementModal';
import { ModelDiscoveryService } from '../../services/modelDiscoveryService';
import { GoogleCalendarService } from '../../services/googleCalendarService';
import { GoogleCalendarListEntry, CalendarRole } from '../../models/googleCalendar';

export class MainPage extends BaseSettingsPage {
	private discoveredCalendars: GoogleCalendarListEntry[] | null = null;

	render(): void {
		this.containerEl.empty();
		this.containerEl.addClass('sbm-main-settings-page');

		// 1. Module Gamification & Boutique (Sous-page dédiée)
		const gamificationGroup = new SettingGroup(this.containerEl).setHeading('Gamification et boutique');
		gamificationGroup.addSetting((setting: Setting) => {
			setting
				.setName('Récompenses de boutique')
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
		const generalGroup = new SettingGroup(this.containerEl).setHeading('Général et énergie');
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
		const foldersGroup = new SettingGroup(this.containerEl).setHeading('Dossiers du coffre');
		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier boîte de réception (Inbox)')
				.setDesc('Dossier dans lequel les nouvelles notes brutes sont stockées')
				.addText((text) => {
					text
						.setPlaceholder('00 - Inbox')
						.setValue(this.plugin.settings.inboxFolder)
						.onChange(async (value) => {
							this.plugin.settings.inboxFolder = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier du journal (Daily notes)')
				.setDesc('Dossier des notes quotidiennes du journal')
				.addText((text) => {
					text
						.setPlaceholder('04 - Journal')
						.setValue(this.plugin.settings.dailyNotesFolder)
						.onChange(async (value) => {
							this.plugin.settings.dailyNotesFolder = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Modèle de note quotidienne (Template)')
				.setDesc('Chemin du fichier modèle (.md) utilisé pour créer automatiquement la note quotidienne. Compatible Templater (<% ... %>).')
				.addText((text) => {
					text
						.setPlaceholder('Templates/Daily Note Template.md')
						.setValue(this.plugin.settings.dailyNoteTemplatePath || '')
						.onChange(async (value) => {
							this.plugin.settings.dailyNoteTemplatePath = normalizePath(value.trim());
							await this.plugin.saveSettings();
						});
					new FileSuggest(this.plugin.app, text.inputEl);
				});
		});

		foldersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Créer et ouvrir automatiquement la note quotidienne lors du briefing')
				.setDesc('Si activé, le lancement du briefing du matin crée la note quotidienne avec le modèle configuré (via Templater) et l\'ouvre dans votre espace de travail.')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.autoOpenDailyNoteOnBriefing !== false)
						.onChange(async (value) => {
							this.plugin.settings.autoOpenDailyNoteOnBriefing = value;
							await this.plugin.saveSettings();
						});
				});
		});

		// 4. Filtres de Confidentialité & Exclusion IA
		const filtersGroup = new SettingGroup(this.containerEl).setHeading('Filtres de confidentialité et exclusion IA');
		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossiers exclus de l\'IA')
				.setDesc('Dossiers dont les fichiers et tâches ne seront jamais indexés, analysés ni envoyés à l\'IA (séparés par des virgules ou retours à la ligne).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: Chaos/Archives, 99 - Privé, Templates, .trash')
						.setValue(this.plugin.settings.excludedFolders || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedFolders = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fichiers exclus de l\'IA')
				.setDesc('Fichiers ou motifs avec jokers (*) à exclure totalement des requêtes IA (séparés par des virgules ou retours à la ligne).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: MotsDePasse.md, Journal Intime.md, *.secret.md, *Confidentiel*')
						.setValue(this.plugin.settings.excludedFiles || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedFiles = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Tags exclus de l\'IA')
				.setDesc('Tags empêchant l\'envoi d\'une note ou d\'une tâche à l\'IA si elle le contient (séparés par des virgules ou retours à la ligne, ex: #secret, #prive).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: #secret, #prive, #confidentiel, #perso, #no-ai')
						.setValue(this.plugin.settings.excludedTags || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedTags = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		filtersGroup.addSetting((setting: Setting) => {
			setting
				.setName('Propriétés frontmatter exclues de l\'IA')
				.setDesc('Propriétés YAML de note excluant la note de l\'IA (ex: private, secret: true, publish: false, no-ai).')
				.addTextArea((textarea) => {
					textarea
						.setPlaceholder('ex: private, secret: true, publish: false, confidential: true, no-ai')
						.setValue(this.plugin.settings.excludedProperties || '')
						.onChange(async (value) => {
							this.plugin.settings.excludedProperties = value;
							await this.plugin.saveSettings();
						});
					textarea.inputEl.rows = 2;
				});
		});

		// 5. Syntaxes des Tâches & Priorités
		const syntaxGroup = new SettingGroup(this.containerEl).setHeading('Syntaxes des tâches et priorités');
		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format principal des métadonnées de tâches')
				.setDesc('Format utilisé pour insérer ou mettre à jour les échéances, dates et statuts de tâches (Emojis Obsidian Tasks, Dataview [due:: ...], ou Tags #due/...)')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('emoji', 'Tasks Emojis (📅, ⏳, 🛫, ✅, 🔺)')
						.addOption('dataview', 'Tasks Dataview ([due:: ...], [scheduled:: ...], [completion:: ...])')
						.addOption('tag', 'Tags (#due/..., #scheduled/..., #done/...)')
						.setValue(this.plugin.settings.taskFormat || 'emoji')
						.onChange(async (value: 'emoji' | 'dataview' | 'tag') => {
							this.plugin.settings.taskFormat = value;
							if (value === 'dataview') {
								this.plugin.settings.priorityMode = 'emoji';
							} else if (value === 'tag') {
								this.plugin.settings.priorityMode = 'tag';
							}
							await this.plugin.saveSettings();
							this.render();
						});
				});
		});

		syntaxGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format des priorités')
				.setDesc('Choisissez entre les émojis Obsidian Tasks (🔺 ⏫ 🔼 🔽 ⏬) ou les tags (#priorite/haute, #priority/high...)')
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
				.setName('Préfixe du tag d\'énergie')
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
				.setName('Préfixe du tag de pièces')
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
				.setName('Dates sous forme de liens wikilinks')
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
				.setName('Fournisseur de matrice')
				.setDesc('Sélectionnez le format de tag de matrice utilisé dans votre coffre')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('task-matrix', 'TaskMatrix (#tm/qN)')
						.addOption('focus-first', 'Focus First (#focus, #qN)')
						.addOption('custom', 'Tags personnalisés (#q1, #q2...)')
						.setValue(this.plugin.settings.matrixProvider)
						.onChange(async (value: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom') => {
							this.plugin.settings.matrixProvider = value;
							await this.plugin.saveSettings();
						});
				});
		});

		// 6. Agent IA & Secret Storage
		const aiGroup = new SettingGroup(this.containerEl).setHeading('Agent IA et clés secrètes');

		// 6.1 Gestionnaire centralisé de clés d'API et secrets (Popup multi-fournisseurs)
		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Gestionnaire de clés d\'API & Secrets')
				.setDesc('Configurez, liez ou déliez vos clés pour Gemini, OpenAI, OpenRouter et Infomaniak AI Services.')
				.addButton((btn) => {
					btn
						.setButtonText('🔑 Gérer les clés d\'API...')
						.setCta()
						.onClick(() => {
							new SecretsManagementModal(this.plugin.app, this.plugin, () => this.render()).open();
						});
				});

			// Badges récapitulatifs des fournisseurs configurés
			const badgesEl = activeDocument.createElement('div');
			badgesEl.addClass('sbm-configured-providers-badges');

			SUPPORTED_PROVIDERS.forEach(p => {
				const isConfigured = !!p.getSecretId(this.plugin);
				const badge = badgesEl.createSpan({
					cls: `sbm-provider-status-pill ${isConfigured ? 'active' : 'inactive'}`,
					text: `${p.name}: ${isConfigured ? '✓' : '—'}`
				});
				badge.title = isConfigured ? `Secret lié : ${p.getSecretId(this.plugin)}` : 'Non configuré';
			});

			setting.descEl.appendChild(badgesEl);
		});

		// 6.2 Sélection du Fournisseur LLM actif
		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur LLM')
				.setDesc('Sélectionnez le fournisseur d\'intelligence artificielle pour le chat et les briefings')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('gemini', 'Google Gemini (Gemini 3.5 / 2.5 / 1.5)')
						.addOption('openai', 'OpenAI ChatGPT (GPT-4o, o3-mini, o1)')
						.addOption('openrouter', 'OpenRouter (Claude 3.5, Llama 3.3, DeepSeek R1...)')
						.addOption('infomaniak', 'Infomaniak AI Services (Souverain / Suisse - Qwen, Mistral, Apertus)')
						.addOption('ollama', 'Ollama (Local sans clé API)')
						.addOption('lmstudio', 'LM Studio (Local sans clé API)')
						.setValue(this.plugin.settings.llmProvider)
						.onChange(async (value: 'gemini' | 'openai' | 'openrouter' | 'infomaniak' | 'ollama' | 'lmstudio') => {
							this.plugin.settings.llmProvider = value;
							if (value === 'gemini') {
								this.plugin.settings.llmModel = 'gemini-2.5-flash';
							} else if (value === 'openai') {
								this.plugin.settings.llmModel = 'gpt-4o-mini';
							} else if (value === 'openrouter') {
								this.plugin.settings.llmEndpoint = 'https://openrouter.ai/api/v1';
								this.plugin.settings.llmModel = 'anthropic/claude-3.5-sonnet';
							} else if (value === 'infomaniak') {
								this.plugin.settings.llmEndpoint = 'https://api.infomaniak.com';
								this.plugin.settings.llmModel = 'qwen3';
							} else if (value === 'ollama') {
								this.plugin.settings.llmEndpoint = 'http://localhost:11434';
								this.plugin.settings.llmModel = 'llama3.2';
							} else if (value === 'lmstudio') {
								this.plugin.settings.llmEndpoint = 'http://localhost:1234';
								this.plugin.settings.llmModel = 'local-model';
							}
							await this.plugin.saveSettings();
							this.render();
						});
				});
		});

		const currentProvider = this.plugin.settings.llmProvider;
		const knownModels = ModelDiscoveryService.getFallbackForProvider(currentProvider);

		// 6.3 Modèle par défaut avec mise en page protégée contre l'écrasement
		aiGroup.addSetting((setting: Setting) => {
			setting.settingEl.addClass('sbm-model-setting-item');
			setting
				.setName('Modèle par défaut')
				.setDesc('Sélectionnez le modèle IA actif ou actualisez la liste en direct depuis l\'API')
				.addDropdown((dropdown) => {
					let isCurrentInList = false;
					knownModels.forEach(m => {
						const label = m.name.length > 38 ? `${m.name.slice(0, 35)}...` : m.name;
						dropdown.addOption(m.name, label);
						if (m.name === this.plugin.settings.llmModel) isCurrentInList = true;
					});

					if (!isCurrentInList && this.plugin.settings.llmModel) {
						const currLabel = this.plugin.settings.llmModel.length > 38 ? `${this.plugin.settings.llmModel.slice(0, 35)}...` : this.plugin.settings.llmModel;
						dropdown.addOption(this.plugin.settings.llmModel, `⭐ ${currLabel}`);
					}

					dropdown.addOption('__custom__', '✏️ Saisir un modèle personnalisé...');
					dropdown.setValue(isCurrentInList ? this.plugin.settings.llmModel : (this.plugin.settings.llmModel ? this.plugin.settings.llmModel : '__custom__'));

					dropdown.onChange(async (val) => {
						if (val === '__custom__') {
							this.render();
						} else {
							this.plugin.settings.llmModel = val;
							await this.plugin.saveSettings();
							this.render();
						}
					});
				})
				.addButton((btn) => {
					btn
						.setButtonText('🔄 Détecter via API')
						.setTooltip('Interroger l\'API du fournisseur pour détecter les nouveaux modèles disponibles')
						.onClick(async () => {
							try {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Recherche...');
								const apiKey = await this.plugin.getSecretApiKey(this.plugin.settings.llmProvider);
								const live = await ModelDiscoveryService.fetchLiveModels(
									this.plugin.settings.llmProvider,
									apiKey,
									this.plugin.settings.llmEndpoint,
									this.plugin.settings.infomaniakProductId
								);
								btn.setDisabled(false);
								btn.setButtonText('🔄 Détecter via API');
								new Notice(`📡 ${live.length} modèle(s) détecté(s) auprès de ${this.plugin.settings.llmProvider.toUpperCase()}`);
								this.render();
							} catch {
								btn.setDisabled(false);
								btn.setButtonText('🔄 Détecter via API');
								new Notice('Impossible de contacter l\'API du fournisseur pour lister les modèles.');
							}
						});
				});
		});

		// Champ de saisie personnalisée si sélectionné ou modèle exotique
		const isPreset = knownModels.some(m => m.name === this.plugin.settings.llmModel);
		if (!isPreset) {
			aiGroup.addSetting((setting: Setting) => {
				setting
					.setName('Nom du modèle personnalisé')
					.setDesc('Saisissez l\'identifiant exact du modèle souhaité (ex: gemini-3.5-flash, custom-model-name)')
					.addText((text) => {
						text
							.setPlaceholder('ex: gemini-3.5-flash')
							.setValue(this.plugin.settings.llmModel)
							.onChange(async (val) => {
								this.plugin.settings.llmModel = val.trim() || 'gemini-2.5-flash';
								await this.plugin.saveSettings();
							});
					});
			});
		}



		if (this.plugin.settings.llmProvider === 'ollama' || this.plugin.settings.llmProvider === 'lm-studio' || this.plugin.settings.llmProvider === 'lmstudio') {
			aiGroup.addSetting((setting: Setting) => {
				setting
					.setName('URL du serveur local')
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

		aiGroup.addSetting((setting: Setting) => {
			setting
				.setName('Instructions personnalisées pour le prompt (Custom System Instructions)')
				.setDesc('Règles, préférences ou consignes additionnelles injectées dans tous les prompts de l\'IA (Briefing du matin, Décongestion/Reprise, Revue du soir, Chat Copilot).')
				.addTextArea((textArea) => {
					textArea
						.setPlaceholder('Exemple :\n- Sois concis et direct dans tes synthèses.\n- Mon fuseau horaire est Europe/Paris.\n- Ne me propose jamais de réunions le vendredi après-midi.\n- Tiens compte de mes objectifs du trimestre...')
						.setValue(this.plugin.settings.customPromptInstructions || '')
						.onChange(async (val) => {
							this.plugin.settings.customPromptInstructions = val;
							await this.plugin.saveSettings();
						});
					textArea.inputEl.rows = 6;
					textArea.inputEl.style.width = '100%';
					textArea.inputEl.style.minHeight = '120px';
					textArea.inputEl.style.fontFamily = 'monospace';
					textArea.inputEl.style.fontSize = '12px';
				});
		});

		// 6. Google Calendar & Agenda
		const calGroup = new SettingGroup(this.containerEl).setHeading('Google Calendar et agenda');

		calGroup.addSetting((setting: Setting) => {
			setting
				.setName('Client ID Google (Obligatoire)')
				.setDesc('Votre Google Cloud OAuth Client ID (Type Application de bureau ou Application Web).')
				.addText((text) => {
					text
						.setPlaceholder('ex: 123456789-xxx.apps.googleusercontent.com')
						.setValue(this.plugin.settings.googleClientId || '')
						.onChange(async (val) => {
							this.plugin.settings.googleClientId = val.trim();
							await this.plugin.saveSettings();
						});
				});
		});

		calGroup.addSetting((setting: Setting) => {
			setting
				.setName('Client Secret Google (Obligatoire)')
				.setDesc('Votre Google Cloud OAuth Client Secret (GOCSPX-...).')
				.addText((text) => {
					text
						.setPlaceholder('GOCSPX-...')
						.setValue(this.plugin.settings.googleClientSecret || '')
						.onChange(async (val) => {
							this.plugin.settings.googleClientSecret = val.trim();
							await this.plugin.saveSettings();
						});
					text.inputEl.type = 'password';
				});
		});

		const isLoggedIn = !!this.plugin.settings.googleRefreshToken;

		if (isLoggedIn) {
			calGroup.addSetting((setting: Setting) => {
				setting
					.setName('Statut : 🟢 Connecté à Google Calendar')
					.setDesc('Votre compte est authentifié. Personnalisez ci-dessous le rôle et le propriétaire de chaque calendrier pour guider précisément l\'IA.')
					.addButton((btn) => {
						btn
							.setButtonText('🔄 Actualiser la liste')
							.setTooltip('Interroger l\'API Google pour lister tous vos calendriers')
							.onClick(async () => {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Chargement...');
								try {
									this.discoveredCalendars = await GoogleCalendarService.listCalendars(this.plugin.settings);
									btn.setDisabled(false);
									btn.setButtonText('🔄 Actualiser la liste');
									new Notice(`📅 ${this.discoveredCalendars.length} calendrier(s) synchronisé(s).`);
									this.render();
								} catch (err: unknown) {
									btn.setDisabled(false);
									btn.setButtonText('🔄 Actualiser la liste');
									const msg = err instanceof Error ? err.message : String(err);
									new Notice(`❌ Erreur récupération calendriers : ${msg}`);
								}
							});
					})
					.addButton((btn) => {
						btn
							.setButtonText('🔄 Tester la connexion')
							.onClick(async () => {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Test...');
								try {
									const events = await GoogleCalendarService.getEvents(this.plugin.settings);
									btn.setDisabled(false);
									btn.setButtonText('🔄 Tester la connexion');
									new Notice(`✅ Connexion réussie ! ${events.length} événement(s) récupéré(s).`);
								} catch (err: unknown) {
									btn.setDisabled(false);
									btn.setButtonText('🔄 Tester la connexion');
									const msg = err instanceof Error ? err.message : String(err);
									new Notice(`❌ Erreur connexion : ${msg}`);
								}
							});
					})
					.addButton((btn) => {
						btn
							.setButtonText('Déconnecter')
							.setWarning()
							.onClick(async () => {
								await GoogleCalendarService.logoutGoogle(this.plugin);
								this.discoveredCalendars = null;
								this.render();
							});
					});
			});

			if (!this.plugin.settings.calendarsConfig) {
				this.plugin.settings.calendarsConfig = {};
			}

			// Charger la liste des calendriers en arrière-plan si pas encore faits
			if (this.discoveredCalendars === null) {
				GoogleCalendarService.listCalendars(this.plugin.settings).then((cals) => {
					this.discoveredCalendars = cals;
					this.render();
				}).catch(() => {
					this.discoveredCalendars = [];
				});
			}

			if (this.discoveredCalendars && this.discoveredCalendars.length > 0) {
				const calendarListGroup = new SettingGroup(this.containerEl).setHeading('Gestion & Rôles de chaque calendrier');

				this.discoveredCalendars.forEach((c) => {
					const defaultCalId = this.plugin.settings.defaultCalendarId || 'primary';
					const isPrimaryByDefault = c.id === defaultCalId || (defaultCalId === 'primary' && !!c.primary);

					if (!this.plugin.settings.calendarsConfig![c.id]) {
						this.plugin.settings.calendarsConfig![c.id] = {
							id: c.id,
							summary: c.summary,
							role: isPrimaryByDefault ? 'primary' : 'other_person'
						};
					}

					const conf = this.plugin.settings.calendarsConfig![c.id];

					calendarListGroup.addSetting((setting: Setting) => {
						const primaryBadge = c.primary ? ' (Compte principal)' : '';
						setting
							.setName(`📅 ${c.summary}${primaryBadge}`)
							.setDesc(`ID : ${c.id}${c.description ? ` — ${c.description.slice(0, 50)}` : ''}`)
							.addDropdown((dropdown) => {
								dropdown.addOption('primary', '🌟 Calendrier principal (Mon agenda de référence)');
								dropdown.addOption('secondary', '🎯 Calendrier secondaire (Mes événements perso/flexibles)');
								dropdown.addOption('other_person', '👥 Calendrier d\'une autre personne (Consultatif)');
								dropdown.addOption('ignore', '🚫 Ne pas requêter (Ignoré)');

								dropdown.setValue(conf.role);

								dropdown.onChange(async (val) => {
									conf.role = val as CalendarRole;
									if (val === 'primary') {
										this.plugin.settings.defaultCalendarId = c.id;
									}
									await this.plugin.saveSettings();
									this.render();
								});
							});

						if (conf.role === 'other_person') {
							setting.addText((text) => {
								text
									.setPlaceholder('Qui ? (ex: Sophie (conjointe), Équipe Tech...)')
									.setValue(conf.ownerName || '')
									.onChange(async (name) => {
										conf.ownerName = name.trim();
										await this.plugin.saveSettings();
									});
								text.inputEl.style.width = '200px';
							});
						}
					});
				});
			}
		} else {
			calGroup.addSetting((setting: Setting) => {
				setting
					.setName('Lancer l\'approbation Google Calendar')
					.setDesc('Démarre le serveur local temporaire et ouvre la page d\'autorisation Google dans votre navigateur. Assurez-vous d\'avoir ajouté l\'URI de redirection "http://127.0.0.1:42813/callback" dans votre console Google Cloud.')
					.addButton((btn) => {
						btn
							.setButtonText('🔗 Se connecter à Google Calendar')
							.setCta()
							.onClick(async () => {
								btn.setDisabled(true);
								btn.setButtonText('⏳ Attente d\'approbation...');
								await GoogleCalendarService.startGoogleLogin(this.plugin, (success) => {
									btn.setDisabled(false);
									btn.setButtonText('🔗 Se connecter à Google Calendar');
									if (success) {
										this.render();
									}
								});
							});
					});
			});
		}

	}
}
