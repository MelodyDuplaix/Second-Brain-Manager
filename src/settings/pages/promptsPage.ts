import { Setting, Notice, setIcon } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';
import { ConfiguredPrompt, DEFAULT_CONFIGURED_PROMPTS } from '../../models/prompt';
import { ModelDiscoveryService } from '../../services/modelDiscoveryService';

export class PromptsPage extends BaseSettingsPage {
	private expandedPromptIds: Set<string> = new Set();

	render(): void {
		this.containerEl.empty();
		this.renderHeader();

		// Guide descriptif
		const infoBox = this.containerEl.createDiv({ cls: 'sbm-subpage-info-box' });
		const infoIcon = infoBox.createSpan({ cls: 'sbm-subpage-info-icon' });
		setIcon(infoIcon, 'info');
		infoBox.createDiv({
			text: 'Personnalisez les actions et prompts IA de l\'éditeur Markdown. Vous pouvez assigner un modèle d\'IA spécifique à chaque prompt (ex: un modèle léger & ultra-rapide comme Gemini 1.5/2.5 Flash ou GPT-4o mini pour la correction d\'orthographe), personnaliser les consignes système, et contrôler leur visibilité dans le menu contextuel ou la palette.',
			cls: 'sbm-subpage-info-text'
		});

		const currentProvider = this.plugin.settings.llmProvider;
		const knownModels = ModelDiscoveryService.getFallbackForProvider(currentProvider);
		const globalModel = this.plugin.settings.llmModel;
		const prompts = this.plugin.getPrompts();

		// Catalogue des prompts existants
		const catalogGroup = new SettingGroup(this.containerEl).setHeading('Catalogue des prompts & actions IA', 'sparkles');

		prompts.forEach((prompt, index) => {
			const isExpanded = this.expandedPromptIds.has(prompt.id);
			const promptCard = catalogGroup.getGroupEl().createDiv({
				cls: `sbm-prompt-card ${isExpanded ? 'sbm-prompt-card-expanded' : ''} ${!prompt.enabled ? 'sbm-prompt-card-disabled' : ''}`
			});

			// En-tête de la carte
			const cardHeader = promptCard.createDiv({ cls: 'sbm-prompt-card-header' });

			const headerLeft = cardHeader.createDiv({ cls: 'sbm-prompt-header-left' });
			const iconEl = headerLeft.createSpan({ cls: 'sbm-prompt-icon' });
			setIcon(iconEl, prompt.icon || 'sparkles');

			const titleGroup = headerLeft.createDiv({ cls: 'sbm-prompt-title-group' });
			const titleRow = titleGroup.createDiv({ cls: 'sbm-prompt-title-row' });
			titleRow.createSpan({ text: prompt.name, cls: 'sbm-prompt-name' });

			// Badges
			const badgesRow = titleGroup.createDiv({ cls: 'sbm-prompt-badges-row' });
			if (prompt.actionType === 'builtin') {
				badgesRow.createSpan({ text: 'Intégré', cls: 'sbm-prompt-badge sbm-badge-builtin' });
			} else {
				badgesRow.createSpan({ text: 'Personnalisé', cls: 'sbm-prompt-badge sbm-badge-custom' });
			}

			// Badge modèle
			if (prompt.model && prompt.model.trim()) {
				badgesRow.createSpan({
					text: `⚡ ${prompt.model}`,
					cls: 'sbm-prompt-badge sbm-badge-model'
				});
			} else {
				badgesRow.createSpan({
					text: `Défaut (${globalModel})`,
					cls: 'sbm-prompt-badge sbm-badge-default-model'
				});
			}

			if (prompt.showInContextMenu) {
				badgesRow.createSpan({ text: '👁️ Clic droit', cls: 'sbm-prompt-badge sbm-badge-location' });
			}
			if (prompt.showInCommandPalette) {
				badgesRow.createSpan({ text: '⌨️ Palette', cls: 'sbm-prompt-badge sbm-badge-location' });
			}

			const headerRight = cardHeader.createDiv({ cls: 'sbm-prompt-header-right' });

			// Master toggle
			new Setting(headerRight)
				.setClass('sbm-prompt-header-toggle')
				.addToggle((toggle) => {
					toggle
						.setTooltip(prompt.enabled ? 'Désactiver cette action' : 'Activer cette action')
						.setValue(prompt.enabled)
						.onChange(async (val) => {
							prompt.enabled = val;
							await this.plugin.saveSettings();
							this.render();
						});
				});

			// Expand / collapse button
			const expandBtn = headerRight.createEl('button', {
				cls: 'sbm-prompt-expand-btn',
				attr: { 'aria-label': isExpanded ? 'Replier' : 'Déplier' }
			});
			setIcon(expandBtn, isExpanded ? 'chevron-up' : 'chevron-down');
			expandBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (isExpanded) {
					this.expandedPromptIds.delete(prompt.id);
				} else {
					this.expandedPromptIds.add(prompt.id);
				}
				this.render();
			});

			cardHeader.addEventListener('click', () => {
				if (isExpanded) {
					this.expandedPromptIds.delete(prompt.id);
				} else {
					this.expandedPromptIds.add(prompt.id);
				}
				this.render();
			});

			// Corps détaillé dépliable
			if (isExpanded) {
				const detailsEl = promptCard.createDiv({ cls: 'sbm-prompt-card-details' });

				// 1. Nom
				new Setting(detailsEl)
					.setName('Intitulé de l\'action')
					.setDesc('Nom affiché dans la palette de commandes et le menu contextuel')
					.addText((text) => {
						text
							.setValue(prompt.name)
							.onChange(async (val) => {
								prompt.name = val.trim() || prompt.name;
								await this.plugin.saveSettings();
							});
					});

				// 2. Description
				new Setting(detailsEl)
					.setName('Description')
					.setDesc('Rôle et objectif de ce prompt')
					.addText((text) => {
						text
							.setValue(prompt.description || '')
							.onChange(async (val) => {
								prompt.description = val.trim();
								await this.plugin.saveSettings();
							});
					});

				// 3. Modèle IA dédié (Sélection de modèle plus léger ou par défaut)
				new Setting(detailsEl)
					.setName('Modèle IA pour cette action')
					.setDesc('Assignez un modèle dédié (ex: modèle léger et rapide) ou utilisez le modèle par défaut du coffre')
					.addDropdown((dropdown) => {
						dropdown.addOption('', `(Par défaut : ${globalModel})`);

						// Proposer les modèles connus pour le fournisseur actif
						knownModels.forEach((m) => {
							const isLighter = m.name.includes('flash') || m.name.includes('mini') || m.name.includes('haiku');
							const label = isLighter ? `${m.name} ⚡ (Léger & rapide)` : m.name;
							dropdown.addOption(m.name, label);
						});

						const isKnown = !prompt.model || knownModels.some((m) => m.name === prompt.model);
						if (!isKnown && prompt.model) {
							dropdown.addOption(prompt.model, `Personnalisé : ${prompt.model}`);
						}
						dropdown.addOption('__custom__', '✏️ Saisir un nom de modèle spécifique...');

						dropdown.setValue(!prompt.model ? '' : (isKnown ? prompt.model : prompt.model));

						dropdown.onChange(async (val) => {
							if (val === '__custom__') {
								const customName = prompt('Nom du modèle IA personnalisé (ex: gemini-1.5-flash, gpt-4o-mini) :');
								if (customName && customName.trim()) {
									prompt.model = customName.trim();
								} else {
									prompt.model = '';
								}
							} else {
								prompt.model = val;
							}
							await this.plugin.saveSettings();
							this.render();
						});
					});

				// 4. Emplacement : Clic droit
				new Setting(detailsEl)
					.setName('Afficher dans le menu contextuel (clic droit)')
					.setDesc('Rendre cette action accessible lors d\'un clic droit dans l\'éditeur')
					.addToggle((toggle) => {
						toggle
							.setValue(prompt.showInContextMenu)
							.onChange(async (val) => {
								prompt.showInContextMenu = val;
								await this.plugin.saveSettings();
							});
					});

				// 5. Emplacement : Palette de commandes
				new Setting(detailsEl)
					.setName('Disponible dans la palette de commandes')
					.setDesc('Rendre cette action exécutable via la palette (Ctrl+P / Cmd+P)')
					.addToggle((toggle) => {
						toggle
							.setValue(prompt.showInCommandPalette)
							.onChange(async (val) => {
								prompt.showInCommandPalette = val;
								await this.plugin.saveSettings();
								this.plugin.registerCustomPromptCommands();
							});
					});

				// 6. Condition : Sélection requise
				new Setting(detailsEl)
					.setName('Nécessite une sélection de texte')
					.setDesc('Si activé, l\'action n\'apparaît et ne s\'applique que si du texte est sélectionné')
					.addToggle((toggle) => {
						toggle
							.setValue(Boolean(prompt.requiresSelection))
							.onChange(async (val) => {
								prompt.requiresSelection = val;
								await this.plugin.saveSettings();
							});
					});

				// 7. Consigne système / Prompt
				const promptSection = detailsEl.createDiv({ cls: 'sbm-prompt-instruction-section' });
				promptSection.createDiv({
					text: 'Consigne système / Prompt IA :',
					cls: 'sbm-prompt-instruction-label'
				});
				const textarea = promptSection.createEl('textarea', {
					cls: 'sbm-prompt-instruction-textarea'
				});
				textarea.value = prompt.systemInstruction;
				textarea.rows = 5;
				textarea.addEventListener('change', async () => {
					prompt.systemInstruction = textarea.value.trim();
					await this.plugin.saveSettings();
				});

				// 8. Actions (Réinitialiser pour builtin, Supprimer pour custom)
				const actionsFooter = detailsEl.createDiv({ cls: 'sbm-prompt-actions-footer' });
				if (prompt.actionType === 'builtin') {
					const resetBtn = actionsFooter.createEl('button', {
						cls: 'sbm-prompt-btn-secondary',
						text: '↺ Réinitialiser aux valeurs d\'origine'
					});
					resetBtn.addEventListener('click', async () => {
						const defaultDef = DEFAULT_CONFIGURED_PROMPTS.find((d) => d.id === prompt.id);
						if (defaultDef) {
							prompt.name = defaultDef.name;
							prompt.description = defaultDef.description;
							prompt.systemInstruction = defaultDef.systemInstruction;
							prompt.model = defaultDef.model;
							prompt.showInContextMenu = defaultDef.showInContextMenu;
							prompt.showInCommandPalette = defaultDef.showInCommandPalette;
							prompt.requiresSelection = defaultDef.requiresSelection;
							prompt.enabled = defaultDef.enabled;
							await this.plugin.saveSettings();
							new Notice(`Prompt "${prompt.name}" réinitialisé aux valeurs d'origine.`);
							this.render();
						}
					});
				} else {
					const deleteBtn = actionsFooter.createEl('button', {
						cls: 'sbm-prompt-btn-danger',
						text: '🗑️ Supprimer ce prompt personnalisé'
					});
					deleteBtn.addEventListener('click', async () => {
						prompts.splice(index, 1);
						this.expandedPromptIds.delete(prompt.id);
						await this.plugin.saveSettings();
						new Notice(`Prompt "${prompt.name}" supprimé.`);
						this.render();
					});
				}
			}
		});

		// Section d'ajout d'un nouveau prompt
		const addGroup = new SettingGroup(this.containerEl).setHeading('Ajouter un nouveau prompt personnalisé', 'plus-circle');

		let newName = '';
		let newDesc = '';
		let newModel = '';
		let newInContextMenu = true;
		let newInCommandPalette = true;
		let newRequiresSelection = true;
		let newInstruction = '';

		addGroup.addSetting((setting) => {
			setting
				.setName('Nom du nouveau prompt')
				.setDesc('Ex: Traduire en anglais, Synthétiser pour un email, Vulgariser...')
				.addText((text) => {
					text.setPlaceholder('Ex: Traduire en anglais').onChange((val) => {
						newName = val.trim();
					});
				});
		});

		addGroup.addSetting((setting) => {
			setting
				.setName('Description courte')
				.setDesc('Brève explication du rôle du prompt')
				.addText((text) => {
					text.setPlaceholder('Ex: Traduit le texte sélectionné en anglais professionnel').onChange((val) => {
						newDesc = val.trim();
					});
				});
		});

		addGroup.addSetting((setting) => {
			setting
				.setName('Modèle IA pour ce prompt')
				.setDesc('Sélectionnez un modèle léger ou laissez par défaut')
				.addDropdown((dropdown) => {
					dropdown.addOption('', `(Par défaut : ${globalModel})`);
					knownModels.forEach((m) => {
						const isLighter = m.name.includes('flash') || m.name.includes('mini') || m.name.includes('haiku');
						const label = isLighter ? `${m.name} ⚡ (Léger & rapide)` : m.name;
						dropdown.addOption(m.name, label);
					});
					dropdown.onChange((val) => {
						newModel = val;
					});
				});
		});

		addGroup.addSetting((setting) => {
			setting
				.setName('Afficher dans le menu contextuel (clic droit)')
				.addToggle((toggle) => {
					toggle.setValue(newInContextMenu).onChange((val) => {
						newInContextMenu = val;
					});
				});
		});

		addGroup.addSetting((setting) => {
			setting
				.setName('Disponible dans la palette de commandes')
				.addToggle((toggle) => {
					toggle.setValue(newInCommandPalette).onChange((val) => {
						newInCommandPalette = val;
					});
				});
		});

		addGroup.addSetting((setting) => {
			setting
				.setName('Nécessite une sélection de texte')
				.addToggle((toggle) => {
					toggle.setValue(newRequiresSelection).onChange((val) => {
						newRequiresSelection = val;
					});
				});
		});

		const newInstructionContainer = addGroup.getGroupEl().createDiv({ cls: 'sbm-prompt-instruction-section' });
		newInstructionContainer.createDiv({
			text: 'Consigne système / Prompt IA :',
			cls: 'sbm-prompt-instruction-label'
		});
		const newTextarea = newInstructionContainer.createEl('textarea', {
			cls: 'sbm-prompt-instruction-textarea'
		});
		newTextarea.placeholder = 'Ex: Tu es un traducteur bilingue chevronné. Traduis le texte suivant en anglais britannique fluide et professionnel. Renvoie UNIQUEMENT la traduction sans commentaire.';
		newTextarea.rows = 4;
		newTextarea.addEventListener('input', () => {
			newInstruction = newTextarea.value.trim();
		});

		addGroup.addSetting((setting) => {
			setting.addButton((btn) => {
				btn
					.setButtonText('+ Créer ce prompt')
					.setCta()
					.onClick(async () => {
						if (!newName) {
							new Notice('Veuillez renseigner un nom pour le prompt.');
							return;
						}
						if (!newInstruction) {
							new Notice('Veuillez définir une consigne système pour le prompt.');
							return;
						}

						const newPrompt: ConfiguredPrompt = {
							id: `custom-${Date.now()}`,
							name: newName,
							description: newDesc,
							systemInstruction: newInstruction,
							model: newModel || '',
							icon: 'sparkles',
							showInContextMenu: newInContextMenu,
							showInCommandPalette: newInCommandPalette,
							requiresSelection: newRequiresSelection,
							actionType: 'custom',
							enabled: true
						};

						prompts.push(newPrompt);
						this.expandedPromptIds.add(newPrompt.id);
						await this.plugin.saveSettings();
						this.plugin.registerCustomPromptCommands();
						new Notice(`Prompt "${newName}" créé avec succès !`);
						this.render();
					});
			});
		});
	}
}
