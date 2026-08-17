import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { ActionProposal, ActionResult, CreateTaskActionProposal, UpdateTaskActionProposal, DecomposeTaskActionProposal } from '../models/actions';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { SecondBrainSettings } from '../main';

export class ActionExecutor {
	private app: App;
	private settings: SecondBrainSettings;

	constructor(app: App, settings: SecondBrainSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Exécute l'ensemble des propositions sélectionnées par l'utilisateur de manière atomique.
	 */
	public async executeProposals(proposals: ActionProposal[]): Promise<ActionResult[]> {
		const results: ActionResult[] = [];

		for (const proposal of proposals) {
			if (!proposal.selected) {
				continue;
			}

			try {
				const result = await this.executeSingleProposal(proposal);
				results.push(result);
			} catch (err: unknown) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				results.push({
					proposalId: proposal.id,
					success: false,
					message: `Erreur lors de l'exécution : ${errorMsg}`,
					createdOrModifiedPath: proposal.targetPath
				});
			}
		}

		return results;
	}

	private async executeSingleProposal(proposal: ActionProposal): Promise<ActionResult> {
		switch (proposal.type) {
			case 'create_note': {
				const normalizedPath = normalizePath(proposal.targetPath);
				const folderPath = normalizePath(proposal.folder);

				// Création récursive du dossier si nécessaire
				await this.ensureFolderExists(folderPath);

				const existing = this.app.vault.getFileByPath(normalizedPath) || this.app.vault.getAbstractFileByPath(normalizedPath);
				if (existing) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `La note "${normalizedPath}" existe déjà.`,
						createdOrModifiedPath: normalizedPath
					};
				}

				let fullContent = proposal.content;
				if (proposal.tags && proposal.tags.length > 0) {
					const tagsHeader = proposal.tags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
					fullContent = `${tagsHeader}\n\n${fullContent}`;
				}

				await this.app.vault.create(normalizedPath, fullContent);
				return {
					proposalId: proposal.id,
					success: true,
					message: `Note "${normalizedPath}" créée avec succès.`,
					createdOrModifiedPath: normalizedPath
				};
			}

			case 'append_to_note': {
				const normalizedPath = normalizePath(proposal.targetPath);
				let file = this.app.vault.getFileByPath(normalizedPath) || this.app.vault.getAbstractFileByPath(normalizedPath);

				// Si le fichier n'existe pas (ex: daily note pas encore créée), on le crée
				if (!file) {
					const folder = normalizedPath.split('/').slice(0, -1).join('/');
					if (folder) await this.ensureFolderExists(folder);
					file = await this.app.vault.create(normalizedPath, '');
				}

				if (!(file instanceof TFile)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier introuvable : "${normalizedPath}".`,
						createdOrModifiedPath: normalizedPath
					};
				}

				await this.app.vault.process(file, (content) => {
					if (proposal.section) {
						const sectionHeader = `## ${proposal.section}`;
						if (content.includes(sectionHeader)) {
							return content.replace(sectionHeader, `${sectionHeader}\n\n${proposal.entryText}`);
						} else {
							return `${content.trim()}\n\n${sectionHeader}\n${proposal.entryText}\n`;
						}
					}
					return `${content.trim()}\n\n${proposal.entryText}\n`;
				});

				return {
					proposalId: proposal.id,
					success: true,
					message: `Contenu ajouté dans "${normalizedPath}".`,
					createdOrModifiedPath: normalizedPath
				};
			}

			case 'create_task': {
				return this.executeCreateTask(proposal);
			}

			case 'update_task': {
				return this.executeUpdateTask(proposal);
			}

			case 'decompose_task': {
				return this.executeDecomposeTask(proposal);
			}

			case 'link_notes': {
				const normalizedPath = normalizePath(proposal.targetPath);
				const file = this.app.vault.getFileByPath(normalizedPath) || this.app.vault.getAbstractFileByPath(normalizedPath);

				if (!(file instanceof TFile)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier introuvable pour liaison : "${normalizedPath}".`,
						createdOrModifiedPath: normalizedPath
					};
				}

				const linkText = `- [[${proposal.targetNoteName}]]${proposal.contextExplanation ? ` — ${proposal.contextExplanation}` : ''}`;
				await this.app.vault.process(file, (content) => {
					if (content.includes(`[[${proposal.targetNoteName}]]`)) {
						return content; // Lien déjà présent
					}
					return `${content.trim()}\n\n### Liens associés\n${linkText}\n`;
				});

				return {
					proposalId: proposal.id,
					success: true,
					message: `Lien vers "[[${proposal.targetNoteName}]]" inséré dans "${normalizedPath}".`,
					createdOrModifiedPath: normalizedPath
				};
			}

			case 'move_note': {
				const sourcePath = normalizePath(proposal.targetPath);
				const destFolder = normalizePath(proposal.destinationFolder);
				const file = this.app.vault.getFileByPath(sourcePath) || this.app.vault.getAbstractFileByPath(sourcePath);

				if (!(file instanceof TFile)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier source introuvable : "${sourcePath}".`,
						createdOrModifiedPath: sourcePath
					};
				}

				await this.ensureFolderExists(destFolder);
				const newPath = normalizePath(`${destFolder}/${file.name}`);

				// Déplacement propre avec mise à jour des liens internes Obsidian
				await this.app.fileManager.renameFile(file, newPath);

				return {
					proposalId: proposal.id,
					success: true,
					message: `Note déplacée vers "${newPath}".`,
					createdOrModifiedPath: newPath
				};
			}
		}
	}

	private async executeCreateTask(proposal: CreateTaskActionProposal): Promise<ActionResult> {
		const normalizedPath = normalizePath(proposal.targetPath);
		let file = this.app.vault.getFileByPath(normalizedPath) || this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!file) {
			const folder = normalizedPath.split('/').slice(0, -1).join('/');
			if (folder) await this.ensureFolderExists(folder);
			file = await this.app.vault.create(normalizedPath, `# ${normalizedPath.split('/').pop()?.replace('.md', '')}\n\n`);
		}

		if (!(file instanceof TFile)) {
			return {
				proposalId: proposal.id,
				success: false,
				message: `Impossible d'accéder au fichier : "${normalizedPath}".`,
				createdOrModifiedPath: normalizedPath
			};
		}

		let taskLine = `- [ ] ${proposal.taskTitle}`;

		if (proposal.dueDate) {
			taskLine = TaskMutator.setDueDate(taskLine, proposal.dueDate, this.settings);
		}
		if (proposal.startDate) {
			taskLine = TaskMutator.setStartDate(taskLine, proposal.startDate, this.settings);
		}
		if (proposal.priority) {
			taskLine = TaskMutator.setPriority(taskLine, proposal.priority, this.settings);
		}
		if (proposal.energy !== undefined) {
			taskLine = TaskMutator.setControlledTag(taskLine, 'energie', proposal.energy, this.settings);
		}
		if (proposal.pieces !== undefined) {
			taskLine = TaskMutator.setControlledTag(taskLine, 'pieces', proposal.pieces, this.settings);
		}
		if (proposal.matrixQuadrant) {
			const matrixAdapter = MatrixAdapterFactory.createAdapter(this.settings.matrixProvider, this.settings.customMatrixMapping);
			taskLine = matrixAdapter.setQuadrant(taskLine, proposal.matrixQuadrant);
		}
		if (proposal.domainTags && proposal.domainTags.length > 0) {
			const tagsStr = proposal.domainTags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
			taskLine = `${taskLine} ${tagsStr}`;
		}
		if (proposal.linkedNotes && proposal.linkedNotes.length > 0) {
			const linksStr = proposal.linkedNotes.map(n => `[[${n}]]`).join(' ');
			taskLine = `${taskLine} ${linksStr}`;
		}
		if (proposal.blockId) {
			taskLine = `${taskLine} ^${proposal.blockId}`;
		}

		await this.app.vault.process(file, (content) => {
			return `${content.trim()}\n${taskLine}\n`;
		});

		return {
			proposalId: proposal.id,
			success: true,
			message: `Tâche créée : "${proposal.taskTitle}" dans "${normalizedPath}".`,
			createdOrModifiedPath: normalizedPath
		};
	}

	private async executeUpdateTask(proposal: UpdateTaskActionProposal): Promise<ActionResult> {
		const normalizedPath = normalizePath(proposal.targetPath);
		const file = this.app.vault.getFileByPath(normalizedPath) || this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!(file instanceof TFile)) {
			return {
				proposalId: proposal.id,
				success: false,
				message: `Fichier introuvable : "${normalizedPath}".`,
				createdOrModifiedPath: normalizedPath
			};
		}

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const lineIdx = proposal.lineNumber - 1;

			if (lines[lineIdx] !== undefined) {
				let line = lines[lineIdx];

				if (proposal.newStatus !== undefined) {
					line = TaskMutator.setCompleted(line, proposal.newStatus === 'done', undefined, this.settings);
				}
				if (proposal.newDueDate !== undefined) {
					line = TaskMutator.setDueDate(line, proposal.newDueDate, this.settings);
				}
				if (proposal.newStartDate !== undefined) {
					line = TaskMutator.setStartDate(line, proposal.newStartDate, this.settings);
				}
				if (proposal.newPriority !== undefined) {
					line = TaskMutator.setPriority(line, proposal.newPriority, this.settings);
				}
				if (proposal.newEnergy !== undefined) {
					line = TaskMutator.setControlledTag(line, 'energie', proposal.newEnergy, this.settings);
				}
				if (proposal.newMatrixQuadrant !== undefined) {
					const matrixAdapter = MatrixAdapterFactory.createAdapter(this.settings.matrixProvider, this.settings.customMatrixMapping);
					line = matrixAdapter.setQuadrant(line, proposal.newMatrixQuadrant);
				}

				lines[lineIdx] = line;
			}

			return lines.join('\n');
		});

		return {
			proposalId: proposal.id,
			success: true,
			message: `Tâche à la ligne ${proposal.lineNumber} mise à jour dans "${normalizedPath}".`,
			createdOrModifiedPath: normalizedPath
		};
	}

	private async executeDecomposeTask(proposal: DecomposeTaskActionProposal): Promise<ActionResult> {
		const normalizedPath = normalizePath(proposal.targetPath);
		const file = this.app.vault.getFileByPath(normalizedPath) || this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!(file instanceof TFile)) {
			return {
				proposalId: proposal.id,
				success: false,
				message: `Fichier introuvable : "${normalizedPath}".`,
				createdOrModifiedPath: normalizedPath
			};
		}

		await this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const lineIdx = proposal.parentLineNumber - 1;

			if (lines[lineIdx] !== undefined) {
				const subtaskLines = proposal.subtasks.map((st) => {
					let line = TaskMutator.createSubtaskLine(0, st.title);
					if (st.energy !== undefined) {
						line = TaskMutator.setControlledTag(line, 'energie', st.energy, this.settings);
					}
					if (st.pieces !== undefined) {
						line = TaskMutator.setControlledTag(line, 'pieces', st.pieces, this.settings);
					}
					return line;
				});

				lines.splice(lineIdx + 1, 0, ...subtaskLines);
			}

			return lines.join('\n');
		});

		return {
			proposalId: proposal.id,
			success: true,
			message: `${proposal.subtasks.length} sous-tâches insérées dans "${normalizedPath}".`,
			createdOrModifiedPath: normalizedPath
		};
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);
		if (!normalized || normalized === '/' || normalized === '.') return;

		const folder = this.app.vault.getFolderByPath(normalized) || this.app.vault.getAbstractFileByPath(normalized);
		if (folder instanceof TFolder) return;

		const parts = normalized.split('/');
		let current = '';

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getFolderByPath(current) || this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
