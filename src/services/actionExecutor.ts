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
				let targetPath = proposal.targetPath;
				let folder = proposal.folder;
				const fileName = proposal.fileName;

				// Si targetPath est manquant mais folder et fileName sont fournis
				if (!targetPath && (folder || fileName)) {
					folder = folder || this.settings.inboxFolder || '00 - Boîte de réception';
					const rawName = fileName || proposal.description || 'Nouvelle note';
					targetPath = `${folder}/${rawName}`;
				} else if (!targetPath) {
					targetPath = `${this.settings.inboxFolder || '00 - Boîte de réception'}/${proposal.description || 'Nouvelle note'}`;
				}

				// Nettoyage des sauts de ligne et caractères interdits dans le chemin
				targetPath = targetPath.replace(/[\r\n]+/g, ' ').replace(/[\\:*?"<>|]/g, '').trim();
				if (!targetPath.endsWith('.md')) {
					targetPath += '.md';
				}

				// Extraction du dossier parent et du nom de fichier
				const parts = targetPath.split('/');
				const cleanFileName = parts.pop() || 'Note.md';
				const folderPath = parts.length > 0 ? parts.join('/') : (folder || this.settings.inboxFolder || '');

				const finalPath = normalizePath(folderPath ? `${folderPath}/${cleanFileName}` : cleanFileName);

				if (folderPath) {
					await this.ensureFolderExists(normalizePath(folderPath));
				}

				const existing = this.app.vault.getFileByPath(finalPath) || this.app.vault.getAbstractFileByPath(finalPath);
				if (existing) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `La note "${finalPath}" existe déjà.`,
						createdOrModifiedPath: finalPath
					};
				}

				let fullContent = typeof proposal.content === 'string' ? proposal.content : '';
				if (!fullContent.trim()) {
					const titleHeading = cleanFileName.replace(/\.md$/, '');
					fullContent = `# ${titleHeading}\n\n${proposal.description ? `> ${proposal.description}\n\n` : ''}`;
				}

				if (proposal.tags && proposal.tags.length > 0) {
					const tagsHeader = proposal.tags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
					fullContent = `${tagsHeader}\n\n${fullContent}`;
				}

				await this.app.vault.create(finalPath, fullContent);
				return {
					proposalId: proposal.id,
					success: true,
					message: `Note "${finalPath}" créée avec succès.`,
					createdOrModifiedPath: finalPath
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
				const file = this.app.vault.getFileByPath(sourcePath) || this.app.vault.getAbstractFileByPath(sourcePath);

				if (!(file instanceof TFile)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier source introuvable : "${sourcePath}".`,
						createdOrModifiedPath: sourcePath
					};
				}

				const fallbackParent = sourcePath.includes('/') ? sourcePath.split('/').slice(0, -1).join('/') : '';
				const destFolder = proposal.destinationFolder 
					? normalizePath(proposal.destinationFolder) 
					: ((file.parent && file.parent.path && file.parent.path !== '/') ? file.parent.path : fallbackParent);
				
				if (destFolder && destFolder !== '/') {
					await this.ensureFolderExists(destFolder);
				}

				let finalFileName = proposal.newFileName ? proposal.newFileName.trim() : file.name;
				if (!finalFileName.endsWith('.md')) {
					finalFileName += '.md';
				}

				const newPath = destFolder && destFolder !== '/'
					? normalizePath(`${destFolder}/${finalFileName}`)
					: normalizePath(finalFileName);

				// Déplacement et/ou renommage propre avec mise à jour des liens internes Obsidian
				await this.app.fileManager.renameFile(file, newPath);

				const actionDesc = proposal.newFileName && proposal.destinationFolder
					? `Note déplacée et renommée vers "${newPath}".`
					: proposal.newFileName
						? `Note renommée en "${finalFileName}".`
						: `Note déplacée vers "${newPath}".`;

				return {
					proposalId: proposal.id,
					success: true,
					message: actionDesc,
					createdOrModifiedPath: newPath
				};
			}

			case 'rename_note': {
				const sourcePath = normalizePath(proposal.targetPath);
				const file = this.app.vault.getFileByPath(sourcePath) || this.app.vault.getAbstractFileByPath(sourcePath);

				if (!(file instanceof TFile)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier source introuvable pour renommage : "${sourcePath}".`,
						createdOrModifiedPath: sourcePath
					};
				}

				let newName = proposal.newFileName.trim();
				if (!newName.endsWith('.md')) {
					newName += '.md';
				}

				const fallbackParent = sourcePath.includes('/') ? sourcePath.split('/').slice(0, -1).join('/') : '';
				const parentDir = (file.parent && file.parent.path && file.parent.path !== '/')
					? file.parent.path
					: fallbackParent;

				const newPath = parentDir && parentDir !== '/'
					? normalizePath(`${parentDir}/${newName}`)
					: normalizePath(newName);

				await this.app.fileManager.renameFile(file, newPath);

				return {
					proposalId: proposal.id,
					success: true,
					message: `Note renommée en "${newName}".`,
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

		const cleanTitle = TaskMutator.cleanTaskPrefix(proposal.taskTitle);
		let taskLine = `- [ ] ${cleanTitle}`;

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
					if (proposal.newStatus === 'done' || proposal.newStatus === 'completed') {
						line = TaskMutator.setCompleted(line, true, undefined, this.settings);
					} else {
						line = TaskMutator.setStatus(line, proposal.newStatus, this.settings);
					}
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
				const parentLine = lines[lineIdx];
				const indentMatch = parentLine.match(/^(\s*)/);
				const parentIndent = indentMatch ? indentMatch[1] : '';
				const indentStep = parentIndent.includes('\t') ? '\t' : '  ';
				const childIndent = parentIndent + indentStep;

				const subtaskLines = proposal.subtasks.map((st) => {
					let line = TaskMutator.createSubtaskLine(childIndent, st.title);
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
