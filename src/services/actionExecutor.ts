import { App, TFile, TFolder, normalizePath, MarkdownView } from 'obsidian';
import {
	ActionProposal,
	ActionResult,
	CreateTaskActionProposal,
	UpdateTaskActionProposal,
	DecomposeTaskActionProposal,
	CreateCalendarEventActionProposal,
	UpdateCalendarEventActionProposal
} from '../models/actions';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { GoogleCalendarService } from './googleCalendarService';
import { VaultContextService, normalizeCanonicalKey, isTFile } from './vaultContextService';
import { SecondBrainSettings } from '../main';

export class ActionExecutor {
	private app: App;
	private settings: SecondBrainSettings;
	private vaultContext: VaultContextService;

	constructor(app: App, settings: SecondBrainSettings, vaultContext?: VaultContextService) {
		this.app = app;
		this.settings = settings;
		this.vaultContext = vaultContext || new VaultContextService(app, settings);
	}

	/**
	 * Synchronise le contenu modifié à la fois dans les onglets d'éditeurs actuellement ouverts (MarkdownView.editor)
	 * et directement sur le disque (app.vault.modify) de façon atomique et déterministe.
	 */
	public async updateFileAndOpenEditors(file: TFile, updater: (content: string) => string): Promise<boolean> {
		let modified = false;
		const targetCanonicalKey = normalizeCanonicalKey(file.path);

		// 1. Lecture et écriture directe sur disque via Vault API
		let newContent = '';
		try {
			const oldContent = await this.app.vault.read(file);
			newContent = updater(oldContent);
			if (newContent !== oldContent) {
				await this.app.vault.modify(file, newContent);
				modified = true;
				console.log(`[Second Brain Manager] Fichier "${file.path}" modifié avec succès sur le disque.`);
			} else {
				console.warn(`[Second Brain Manager] Le contenu de "${file.path}" n'a pas changé après application de l'updater.`);
			}
		} catch (vaultErr) {
			console.error(`[Second Brain Manager] Échec lors de la modification de "${file.path}" via vault.modify:`, vaultErr);
			// Fallback process si read/modify a rencontré un souci
			try {
				if (typeof (this.app.vault as any).process === 'function') {
					await (this.app.vault as any).process(file, (content: string) => {
						const updated = updater(content);
						if (updated !== content) {
							modified = true;
							newContent = updated;
						}
						return updated;
					});
				}
			} catch (procErr) {
				console.error(`[Second Brain Manager] Échec du fallback vault.process:`, procErr);
			}
		}

		// 2. Synchronisation instantanée dans les éditeurs ouverts (Live Preview / Mode Source)
		try {
			if (this.app.workspace && typeof this.app.workspace.getLeavesOfType === 'function') {
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				for (const leaf of leaves) {
					const view = leaf.view as MarkdownView;
					if (view && (view as any).file && view.editor) {
						const leafPath = (view as any).file.path;
						if (normalizeCanonicalKey(leafPath) === targetCanonicalKey) {
							if (newContent) {
								view.editor.setValue(newContent);
							}
						}
					}
				}
			}
		} catch (editorErr) {
			console.warn('[Second Brain Manager] Erreur lors de la synchronisation de l\'éditeur ouvert:', editorErr);
		}

		return modified;
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
				console.log(`[Second Brain Manager] Exécution de la proposition (${proposal.type}) pour "${proposal.targetPath}":`, proposal);
				const result = await this.executeSingleProposal(proposal);
				console.log(`[Second Brain Manager] Résultat de l'exécution:`, result);
				results.push(result);
			} catch (err: unknown) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				console.error(`[Second Brain Manager] Erreur lors de l'exécution de la proposition:`, err);
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

	/**
	 * Résout intelligemment le fichier cible d'une action à partir d'un chemin, nom de note,
	 * date ou mention de journal / note quotidienne, et le crée si demandé.
	 */
	public async resolveTargetFile(
		rawPath: string,
		options: {
			createIfMissing?: boolean;
			isDailyNote?: boolean;
			defaultFolder?: string;
			initialContent?: string;
		} = {}
	): Promise<{ file: TFile | null; path: string; created: boolean }> {
		if (!rawPath || typeof rawPath !== 'string') {
			rawPath = '';
		}

		let clean = rawPath
			.replace(/^\[\[/, '')
			.replace(/\]\]$/, '')
			.replace(/[\r\n]+/g, ' ')
			.trim();

		// Nettoyage des guillemets éventuels
		clean = clean.replace(/^["']/, '').replace(/["']$/, '').trim();

		const lower = clean.toLowerCase();

		// 1. Détection note quotidienne / Journal
		const isDailyExplicit = options.isDailyNote ||
			lower.includes('note quotidienne') ||
			lower.includes('journal') ||
			lower.includes('daily note') ||
			lower.includes('daily-note') ||
			lower.includes('dailynote') ||
			lower.includes('quotidienne') ||
			lower.includes("aujourd'hui") ||
			lower.includes('aujourdhui') ||
			/\b\d{4}-\d{2}-\d{2}\b/.test(clean) ||
			/\b\d{2}-\d{2}-\d{4}\b/.test(clean);

		if (isDailyExplicit) {
			// Extraction date si présente
			const isoMatch = clean.match(/\b(\d{4}-\d{2}-\d{2})\b/);
			const frMatch = clean.match(/\b(\d{2}-\d{2}-\d{4})\b/);
			let targetDate: string | undefined;
			if (isoMatch) {
				targetDate = isoMatch[1];
			} else if (frMatch) {
				const parts = frMatch[1].split('-');
				targetDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
			} else {
				targetDate = new Date().toISOString().split('T')[0];
			}

			const dailyCheck = await this.vaultContext.getDailyNote(targetDate);
			if (dailyCheck.exists) {
				const f = this.app.vault.getFileByPath(dailyCheck.path) || this.app.vault.getAbstractFileByPath(dailyCheck.path);
				if (isTFile(f)) {
					return { file: f, path: dailyCheck.path, created: false };
				}
			}

			if (options.createIfMissing) {
				const dailyRes = await this.vaultContext.getOrCreateDailyNote(targetDate);
				return { file: dailyRes.file, path: dailyRes.path, created: dailyRes.created };
			} else {
				return { file: null, path: dailyCheck.path, created: false };
			}
		}

		// 2. Résolution canonique déterministe (sans devinette, insensible aux accents, à la casse et aux sous-dossiers)
		const canonicalFile = this.vaultContext.resolveFileCanonically(clean);
		if (isTFile(canonicalFile)) {
			return { file: canonicalFile, path: normalizePath(canonicalFile.path), created: false };
		}

		// 3. Si introuvable et création demandée
		if (options.createIfMissing) {
			const baseOnly = clean.split('/').pop()?.replace(/\.md$/, '').trim() || clean;
			let folder = options.defaultFolder;
			let fileName = baseOnly;

			if (clean.includes('/')) {
				const parts = clean.split('/');
				fileName = parts.pop() || 'Nouvelle note';
				folder = parts.join('/');
			} else if (!folder) {
				folder = this.settings.inboxFolder || '00 - Boîte de réception';
			}

			fileName = fileName.replace(/[\\:*?"<>|#^[\]]/g, '').trim();
			if (!fileName.endsWith('.md')) {
				fileName += '.md';
			}

			const normFolder = normalizePath(folder);
			if (normFolder && normFolder !== '.' && normFolder !== '/') {
				await this.ensureFolderExists(normFolder);
			}

			const finalPath = normalizePath(normFolder && normFolder !== '.' && normFolder !== '/'
				? `${normFolder}/${fileName}`
				: fileName);

			const existing = this.app.vault.getFileByPath(finalPath) || this.app.vault.getAbstractFileByPath(finalPath);
			if (isTFile(existing)) {
				return { file: existing, path: finalPath, created: false };
			}

			const content = options.initialContent !== undefined ? options.initialContent : `# ${fileName.replace(/\.md$/, '')}\n\n`;
			const createdFile = await this.app.vault.create(finalPath, content);
			return { file: createdFile, path: finalPath, created: true };
		}

		const directNorm = normalizePath(clean.endsWith('.md') ? clean : `${clean}.md`);
		return { file: null, path: directNorm, created: false };
	}

	/**
	 * Insère intelligemment une ligne de tâche dans le contenu d'une note.
	 * 1. Recherche une section de tâches actives (ex: "## Taches à faire", "## À faire", "## Tâches", "## Actions").
	 *    Exclut explicitement les sections de tâches terminées ("## Taches faites", "## Tâches terminées", "## Archives").
	 * 2. Si trouvée, insère après la dernière tâche existante de cette section ou directement sous le titre.
	 * 3. Sinon, si des tâches existent ailleurs dans la note (hors blocs de code), insère après la dernière tâche.
	 * 4. Sinon, insère avant un éventuel callout de pied de page (navigation/footer) ou à la fin de la note.
	 */
	public static insertTaskIntoNoteContent(content: string, taskLine: string): string {
		const isCRLF = content.includes('\r\n');
		const lines = content.replace(/\r\n/g, '\n').split('\n');

		const cleanHeadingForComparison = (str: string): string => {
			return str.trim()
				.replace(/^#{1,6}\s+/, '')
				.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprime les accents : à->a, â->a, é->e, etc.
				.toLowerCase()
				.replace(/[^\w\s-]/g, '')
				.trim();
		};

		const isExcludedSection = (cleaned: string): boolean => {
			const excludedKeywords = ['faites', 'terminees', 'archives', 'journal', 'log', 'history', 'liens', 'links', 'references', 'demain', 'tomorrow', 'done', 'completed', 'finished'];
			return excludedKeywords.some(kw => cleaned.includes(kw));
		};

		const isActiveTaskSection = (cleaned: string): boolean => {
			if (isExcludedSection(cleaned)) return false;
			const activePrefixes = [
				'taches a faire', 'taches du jour', 'a faire', 'actions a faire',
				'to do', 'todo', 'tasks', 'active tasks', 'next actions', 'action items',
				'programme', 'objectifs', 'goals', 'objectives', 'focus', 'priorites', 'priorities'
			];
			return activePrefixes.some(kw => cleaned === kw || cleaned.startsWith(kw + ' ') || cleaned.includes(kw));
		};

		const isGenericTaskSection = (cleaned: string): boolean => {
			if (isExcludedSection(cleaned)) return false;
			const genericKeywords = ['taches', 'tache', 'tasks', 'task', 'actions', 'action'];
			return genericKeywords.some(kw => cleaned === kw || cleaned.startsWith(kw + ' '));
		};

		let targetHeaderIdx = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			// On ne cible que les sous-titres (H2 à H6) pour ne pas confondre avec le titre principal H1 de la note
			if (/^#{2,6}\s+/.test(line)) {
				const cleaned = cleanHeadingForComparison(line);
				if (isActiveTaskSection(cleaned)) {
					targetHeaderIdx = i;
					break;
				}
			}
		}

		if (targetHeaderIdx === -1) {
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (/^#{2,6}\s+/.test(line)) {
					const cleaned = cleanHeadingForComparison(line);
					if (isGenericTaskSection(cleaned)) {
						targetHeaderIdx = i;
						break;
					}
				}
			}
		}

		const joinLines = (arr: string[]) => isCRLF ? arr.join('\r\n') : arr.join('\n');

		// Si un en-tête de section a été trouvé
		if (targetHeaderIdx !== -1) {
			let insertIdx = targetHeaderIdx + 1;
			let inCodeBlock = false;
			let lastTaskIdx = -1;

			for (let i = targetHeaderIdx + 1; i < lines.length; i++) {
				const trimmed = lines[i].trim();
				if (trimmed.startsWith('```')) {
					inCodeBlock = !inCodeBlock;
					if (inCodeBlock && lastTaskIdx === -1) {
						insertIdx = i;
						break;
					}
				}
				if (inCodeBlock) continue;

				if (/^#{1,3}\s+/.test(trimmed)) {
					break;
				}

				if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]') || trimmed.startsWith('- [/]') || trimmed.startsWith('- [-]')) {
					lastTaskIdx = i;
					insertIdx = i + 1;
				} else if (lastTaskIdx !== -1 && trimmed === '') {
					insertIdx = i;
					break;
				}
			}

			lines.splice(insertIdx, 0, taskLine);
			return joinLines(lines);
		}

		// 2. Si pas de section dédiée trouvée, chercher la dernière tâche markdown du document (hors code block)
		let lastDocTaskIdx = -1;
		let inCode = false;
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('```')) {
				inCode = !inCode;
				continue;
			}
			if (!inCode && (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]') || trimmed.startsWith('- [/]'))) {
				lastDocTaskIdx = i;
			}
		}

		if (lastDocTaskIdx !== -1) {
			lines.splice(lastDocTaskIdx + 1, 0, taskLine);
			return joinLines(lines);
		}

		// 3. Chercher si la note se termine par un footer / navigation callout (ex: >[!column, >[!day, ---)
		let footerStartIdx = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('>[!column') || trimmed.startsWith('>[!day') || trimmed.startsWith('---') || trimmed.startsWith('*Note créée')) {
				footerStartIdx = i;
			} else if (footerStartIdx !== -1 && trimmed === '') {
				// Continue backwards
			} else if (footerStartIdx !== -1) {
				break;
			}
		}

		if (footerStartIdx > 0) {
			lines.splice(footerStartIdx, 0, taskLine, '');
			return joinLines(lines);
		}

		// 4. Par défaut, ajouter à la fin
		return isCRLF ? `${content.trim()}\r\n\r\n${taskLine}\r\n` : `${content.trim()}\n\n${taskLine}\n`;
	}

	private async executeSingleProposal(proposal: ActionProposal): Promise<ActionResult> {
		switch (proposal.type) {
			case 'create_note': {
				let targetPath = proposal.targetPath;
				let folder = proposal.folder;
				const fileName = proposal.fileName;

				if (!targetPath && (folder || fileName)) {
					folder = folder || this.settings.inboxFolder || '00 - Boîte de réception';
					const rawName = fileName || proposal.description || 'Nouvelle note';
					targetPath = `${folder}/${rawName}`;
				} else if (!targetPath) {
					targetPath = `${this.settings.inboxFolder || '00 - Boîte de réception'}/${proposal.description || 'Nouvelle note'}`;
				}

				let fullContent = typeof proposal.content === 'string' ? proposal.content : '';
				const rawFileName = fileName || targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Nouvelle note';
				if (!fullContent.trim()) {
					const titleHeading = rawFileName.replace(/\.md$/, '');
					fullContent = `# ${titleHeading}\n\n${proposal.description ? `> ${proposal.description}\n\n` : ''}`;
				}

				if (proposal.tags && proposal.tags.length > 0) {
					const tagsHeader = proposal.tags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
					fullContent = `${tagsHeader}\n\n${fullContent}`;
				}

				const resolved = await this.resolveTargetFile(targetPath, {
					createIfMissing: true,
					defaultFolder: folder || this.settings.inboxFolder || '00 - Boîte de réception',
					initialContent: fullContent
				});

				const file = resolved.file;
				if (!file || !isTFile(file)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Impossible d'accéder au fichier : "${targetPath}".`,
						createdOrModifiedPath: resolved.path
					};
				}

				if (!resolved.created) {
					await this.updateFileAndOpenEditors(file, (oldContent) => {
						if (!oldContent.trim()) {
							return fullContent;
						}
						return `${oldContent.trim()}\n\n---\n\n${fullContent}`;
					});

					return {
						proposalId: proposal.id,
						success: true,
						message: `Note existante "[[${file.basename}]]" complétée dans "${file.parent?.path || ''}".`,
						createdOrModifiedPath: resolved.path
					};
				} else {
					return {
						proposalId: proposal.id,
						success: true,
						message: `Note "[[${file.basename}]]" créée avec succès dans "${file.parent?.path || ''}".`,
						createdOrModifiedPath: resolved.path
					};
				}
			}

			case 'append_to_note': {
				const resolved = await this.resolveTargetFile(proposal.targetPath, {
					createIfMissing: true,
					defaultFolder: this.settings.inboxFolder || '00 - Boîte de réception'
				});

				const file = resolved.file;
				if (!file || !isTFile(file)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier introuvable : "${proposal.targetPath}".`,
						createdOrModifiedPath: resolved.path
					};
				}

				await this.updateFileAndOpenEditors(file, (content) => {
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
					message: `Contenu ajouté dans "[[${file.basename}]]".`,
					createdOrModifiedPath: resolved.path
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
				const resolved = await this.resolveTargetFile(proposal.targetPath, { createIfMissing: false });
				const file = resolved.file;

				if (!file || !isTFile(file)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier introuvable pour liaison : "${proposal.targetPath}".`,
						createdOrModifiedPath: resolved.path
					};
				}

				const direction = proposal.linkDirection || 'forward';
				const summary = await this.executeNoteLink(file, proposal.targetNoteName, direction, proposal.contextExplanation);

				return {
					proposalId: proposal.id,
					success: true,
					message: `Liaison effectuée : ${summary}.`,
					createdOrModifiedPath: resolved.path
				};
			}

			case 'move_note':
			case 'rename_note': {
				const resolved = await this.resolveTargetFile(proposal.targetPath, { createIfMissing: false });
				const file = resolved.file;

				if (!file || !isTFile(file)) {
					return {
						proposalId: proposal.id,
						success: false,
						message: `Fichier source introuvable : "${proposal.targetPath}".`,
						createdOrModifiedPath: resolved.path
					};
				}

				const sourcePath = normalizePath(file.path);
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

				let currentFile: TFile = file;

				if (newPath !== sourcePath) {
					await this.app.fileManager.renameFile(file, newPath);
					const renamed = this.app.vault.getFileByPath(newPath) || this.app.vault.getAbstractFileByPath(newPath);
					if (renamed instanceof TFile) {
						currentFile = renamed;
					}
				}

				if (proposal.targetNoteName) {
					const direction = proposal.linkDirection || 'forward';
					await this.executeNoteLink(currentFile, proposal.targetNoteName, direction, (proposal as any).contextExplanation);
				}

				if ((proposal as any).appendContent) {
					const textToAppend = (proposal as any).appendContent;
					const section = (proposal as any).section;
					await this.app.vault.process(currentFile, (content) => {
						if (section) {
							const sectionHeader = `## ${section}`;
							if (content.includes(sectionHeader)) {
								return content.replace(sectionHeader, `${sectionHeader}\n\n${textToAppend}`);
							} else {
								return `${content.trim()}\n\n${sectionHeader}\n${textToAppend}\n`;
							}
						}
						return `${content.trim()}\n\n${textToAppend}\n`;
					});
				}

				const actionsDesc: string[] = [];
				if (proposal.destinationFolder && destFolder !== fallbackParent) actionsDesc.push(`déplacée vers "${destFolder}"`);
				if (proposal.newFileName && proposal.newFileName !== file.name) actionsDesc.push(`renommée en "${finalFileName}"`);
				if (proposal.targetNoteName) actionsDesc.push(`liée à [[${proposal.targetNoteName}]] (${proposal.linkDirection || 'forward'})`);
				if ((proposal as any).appendContent) actionsDesc.push(`contenu ajouté`);

				const summary = actionsDesc.length > 0
					? `Note ${actionsDesc.join(', ')}.`
					: `Note traitée ("${newPath}").`;

				return {
					proposalId: proposal.id,
					success: true,
					message: summary,
					createdOrModifiedPath: newPath
				};
			}

			case 'create_calendar_event': {
				const calProp = proposal as CreateCalendarEventActionProposal;
				try {
					await GoogleCalendarService.createEvent(this.settings, {
						summary: calProp.title,
						startDate: calProp.startDate,
						startTime: calProp.startTime,
						endDate: calProp.endDate,
						endTime: calProp.endTime,
						description: calProp.eventDescription,
						location: calProp.location,
						calendarId: calProp.calendarId
					});
					return {
						proposalId: proposal.id,
						success: true,
						message: `Événement Google Calendar "${calProp.title}" créé avec succès (${calProp.startDate}${calProp.startTime ? ` à ${calProp.startTime}` : ''}).`
					};
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					return {
						proposalId: proposal.id,
						success: false,
						message: `Erreur création Google Calendar : ${errorMsg}`
					};
				}
			}

			case 'update_calendar_event': {
				const calProp = proposal as UpdateCalendarEventActionProposal;
				try {
					await GoogleCalendarService.updateEvent(this.settings, calProp.eventId, {
						summary: calProp.title,
						startDate: calProp.startDate,
						startTime: calProp.startTime,
						endDate: calProp.endDate,
						endTime: calProp.endTime,
						description: calProp.eventDescription,
						location: calProp.location,
						calendarId: calProp.calendarId
					});
					return {
						proposalId: proposal.id,
						success: true,
						message: `Événement Google Calendar "${calProp.title || calProp.eventId}" mis à jour avec succès.`
					};
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					return {
						proposalId: proposal.id,
						success: false,
						message: `Erreur modification Google Calendar : ${errorMsg}`
					};
				}
			}
		}
	}

	private async executeCreateTask(proposal: CreateTaskActionProposal): Promise<ActionResult> {
		const resolved = await this.resolveTargetFile(proposal.targetPath, {
			createIfMissing: true,
			defaultFolder: this.settings.dailyNotesFolder || '04 - Journal'
		});

		const file = resolved.file;
		if (!file || !isTFile(file)) {
			return {
				proposalId: proposal.id,
				success: false,
				message: `Impossible d'accéder au fichier : "${proposal.targetPath}".`,
				createdOrModifiedPath: resolved.path
			};
		}

		// Si la note cible est une note quotidienne (ou mentionne aujourd'hui/date) et qu'aucune date planifiée n'est spécifiée,
		// on assigne automatiquement la date de la note comme scheduledDate pour alimenter les requêtes Obsidian Tasks / Dataview
		const isDailyNote = resolved.path.toLowerCase().includes('journal') ||
			resolved.path.toLowerCase().includes('quotidienne') ||
			/\b\d{4}-\d{2}-\d{2}\b/.test(resolved.path) ||
			/\b\d{2}-\d{2}-\d{4}\b/.test(resolved.path);

		if (isDailyNote && !proposal.scheduledDate) {
			const isoMatch = resolved.path.match(/\b(\d{4}-\d{2}-\d{2})\b/);
			const frMatch = resolved.path.match(/\b(\d{2}-\d{2}-\d{4})\b/);
			if (isoMatch) {
				proposal.scheduledDate = isoMatch[1];
			} else if (frMatch) {
				const parts = frMatch[1].split('-');
				proposal.scheduledDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
			} else {
				proposal.scheduledDate = new Date().toISOString().split('T')[0];
			}
		}

		const cleanTitle = TaskMutator.cleanTaskPrefix(proposal.taskTitle);
		let taskLine = `- [ ] ${cleanTitle}`;

		if (proposal.dueDate) {
			taskLine = TaskMutator.setDueDate(taskLine, proposal.dueDate, this.settings);
		}
		if (proposal.scheduledDate) {
			taskLine = TaskMutator.setScheduledDate(taskLine, proposal.scheduledDate, this.settings);
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
			if (this.settings.taskFormat === 'dataview') {
				taskLine = TaskMutator.setControlledTag(taskLine, 'matrix', proposal.matrixQuadrant, this.settings);
			} else {
				const matrixAdapter = MatrixAdapterFactory.createAdapter(this.settings.matrixProvider, this.settings.customMatrixMapping);
				taskLine = matrixAdapter.setQuadrant(taskLine, proposal.matrixQuadrant);
			}
		}
		if (proposal.domainTags && proposal.domainTags.length > 0) {
			const tagsStr = proposal.domainTags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
			taskLine = `${taskLine} ${tagsStr}`;
		}
		if (proposal.linkedNotes && proposal.linkedNotes.length > 0) {
			const linksStr = proposal.linkedNotes.map(n => n.startsWith('[[') ? n : `[[${n}]]`).join(' ');
			taskLine = `${taskLine} ${linksStr}`;
		}
		if (proposal.blockId) {
			taskLine = `${taskLine} ^${proposal.blockId.replace(/^\^/, '')}`;
		}

		await this.updateFileAndOpenEditors(file, (content) => {
			return ActionExecutor.insertTaskIntoNoteContent(content, taskLine);
		});

		const noteBase = file.basename || resolved.path.split('/').pop()?.replace('.md', '') || resolved.path;

		return {
			proposalId: proposal.id,
			success: true,
			message: `Tâche créée : "${proposal.taskTitle}" dans "[[${noteBase}]]".`,
			createdOrModifiedPath: resolved.path
		};
	}

	private async executeUpdateTask(proposal: UpdateTaskActionProposal): Promise<ActionResult> {
		const resolved = await this.resolveTargetFile(proposal.targetPath, { createIfMissing: false });
		const file = resolved.file;

		if (!file || !isTFile(file)) {
			return {
				proposalId: proposal.id,
				success: false,
				message: `Fichier introuvable : "${proposal.targetPath}".`,
				createdOrModifiedPath: resolved.path
			};
		}

		await this.updateFileAndOpenEditors(file, (content) => {
			const lines = content.split('\n');
			let lineIdx = proposal.lineNumber - 1;

			if (lines[lineIdx] === undefined || !lines[lineIdx].includes('- [')) {
				if (proposal.taskTitle) {
					const cleanSearch = TaskMutator.cleanTaskPrefix(proposal.taskTitle).toLowerCase();
					const foundIdx = lines.findIndex(l => l.includes('- [') && l.toLowerCase().includes(cleanSearch));
					if (foundIdx !== -1) {
						lineIdx = foundIdx;
					}
				}
			}

			if (lines[lineIdx] !== undefined) {
				let line = lines[lineIdx];

				if (proposal.newStatus !== undefined) {
					if (proposal.newStatus === 'done' || proposal.newStatus === 'completed') {
						const todayStr = new Date().toISOString().split('T')[0];
						line = TaskMutator.setCompleted(line, true, todayStr, this.settings);
					} else {
						line = TaskMutator.setStatus(line, proposal.newStatus, this.settings);
					}
				}
				if (proposal.newDueDate !== undefined) {
					line = TaskMutator.setDueDate(line, proposal.newDueDate, this.settings);
				}
				if ((proposal as any).newScheduledDate !== undefined) {
					line = TaskMutator.setScheduledDate(line, (proposal as any).newScheduledDate, this.settings);
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
				if (proposal.newPieces !== undefined) {
					line = TaskMutator.setControlledTag(line, 'pieces', proposal.newPieces, this.settings);
				}
				if (proposal.newMatrixQuadrant !== undefined) {
					if (this.settings.taskFormat === 'dataview') {
						line = TaskMutator.setControlledTag(line, 'matrix', proposal.newMatrixQuadrant, this.settings);
					} else {
						const matrixAdapter = MatrixAdapterFactory.createAdapter(this.settings.matrixProvider, this.settings.customMatrixMapping);
						line = matrixAdapter.setQuadrant(line, proposal.newMatrixQuadrant);
					}
				}

				lines[lineIdx] = line;
			}

			return lines.join('\n');
		});

		return {
			proposalId: proposal.id,
			success: true,
			message: `Tâche à la ligne ${proposal.lineNumber} mise à jour dans "[[${file.basename}]]".`,
			createdOrModifiedPath: resolved.path
		};
	}

	private async executeDecomposeTask(proposal: DecomposeTaskActionProposal): Promise<ActionResult> {
		const resolved = await this.resolveTargetFile(proposal.targetPath, { createIfMissing: false });
		const file = resolved.file;

		if (!file || !isTFile(file)) {
			return {
				proposalId: proposal.id,
				success: false,
				message: `Fichier introuvable : "${proposal.targetPath}".`,
				createdOrModifiedPath: resolved.path
			};
		}

		await this.updateFileAndOpenEditors(file, (content) => {
			const lines = content.split('\n');
			let lineIdx = proposal.parentLineNumber - 1;

			if (lines[lineIdx] === undefined || !lines[lineIdx].includes('- [')) {
				const foundIdx = lines.findIndex(l => l.includes('- ['));
				if (foundIdx !== -1) {
					lineIdx = foundIdx;
				}
			}

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
			message: `${proposal.subtasks.length} sous-tâches insérées dans "[[${file.basename}]]".`,
			createdOrModifiedPath: resolved.path
		};
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);
		if (!normalized || normalized === '/' || normalized === '.') return;

		try {
			const folder = (this.app.vault as any).getFolderByPath ? (this.app.vault as any).getFolderByPath(normalized) : this.app.vault.getAbstractFileByPath(normalized);
			if (folder instanceof TFolder) return;
		} catch {
			// continue
		}

		const parts = normalized.split('/');
		let current = '';

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			try {
				const existing = (this.app.vault as any).getFolderByPath ? (this.app.vault as any).getFolderByPath(current) : this.app.vault.getAbstractFileByPath(current);
				if (!existing) {
					await this.app.vault.createFolder(current);
				}
			} catch {
				// Dossier existant ou créé en parallèle
			}
		}
	}

	public async executeNoteLink(
		sourceFile: TFile,
		targetNoteName: string,
		direction: 'forward' | 'backward' | 'both' = 'forward',
		explanation?: string
	): Promise<string> {
		const cleanTargetName = targetNoteName
			.replace(/^\[\[/, '')
			.replace(/\]\]$/, '')
			.replace(/\.md$/, '')
			.trim();

		const sourceBasename = sourceFile.basename || sourceFile.name.replace(/\.md$/, '');

		// Trouver le fichier cible dans le coffre
		const targetResolved = await this.resolveTargetFile(cleanTargetName, { createIfMissing: false });
		const targetFile = targetResolved.file;

		const messages: string[] = [];

		// 1. Sens Forward ou Both : insérer [[targetNoteName]] dans sourceFile
		if (direction === 'forward' || direction === 'both') {
			const linkText = `- [[${cleanTargetName}]]${explanation ? ` — ${explanation}` : ''}`;
			await this.updateFileAndOpenEditors(sourceFile, (content) => {
				if (content.includes(`[[${cleanTargetName}]]`)) {
					return content;
				}
				return `${content.trim()}\n\n### Liens associés\n${linkText}\n`;
			});
			messages.push(`lien vers [[${cleanTargetName}]] dans [[${sourceBasename}]]`);
		}

		// 2. Sens Backward ou Both : insérer [[sourceBasename]] dans targetFile
		if (direction === 'backward' || direction === 'both') {
			if (targetFile && isTFile(targetFile)) {
				const reverseLinkText = `- [[${sourceBasename}]]${explanation ? ` — ${explanation}` : ''}`;
				await this.updateFileAndOpenEditors(targetFile, (content) => {
					if (content.includes(`[[${sourceBasename}]]`)) {
						return content;
					}
					return `${content.trim()}\n\n### Liens associés\n${reverseLinkText}\n`;
				});
				messages.push(`lien inverse vers [[${sourceBasename}]] dans [[${cleanTargetName}]]`);
			} else {
				messages.push(`note cible [[${cleanTargetName}]] introuvable pour liaison inverse`);
			}
		}

		return messages.join(' et ');
	}
}
