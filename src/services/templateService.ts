import { App, TFile, normalizePath } from 'obsidian';
import { SecondBrainSettings } from '../main';
import { normalizeCanonicalKey } from './vaultContextService';

export interface TemplateInfo {
	name: string;
	path: string;
	basename: string;
	folder: string;
}

export interface TemplateDetails {
	file: TFile;
	path: string;
	name: string;
	content: string;
	placeholders: string[];
}

export interface TemplateRenderContext {
	title: string;
	folder?: string;
	date?: string; // Format YYYY-MM-DD
	time?: string; // Format HH:mm
	variables?: Record<string, string | number | boolean>;
	frontmatter?: Record<string, unknown>;
}

export class TemplateService {
	/**
	 * Détermine le dossier des modèles / templates configuré ou auto-détecté.
	 */
	public static getTemplatesFolder(app: App, settings?: SecondBrainSettings): string {
		if (settings?.templatesFolder && settings.templatesFolder.trim()) {
			return normalizePath(settings.templatesFolder.trim());
		}

		// 1. Détection via plugin natif Obsidian "Templates"
		const coreTemplatesFolder = (app as any).internalPlugins?.plugins?.['templates']?.instance?.options?.folder;
		if (coreTemplatesFolder && typeof coreTemplatesFolder === 'string') {
			return normalizePath(coreTemplatesFolder.trim());
		}

		// 2. Détection via plugin communautaire "Templater"
		const templaterFolder = (app as any).plugins?.plugins?.['templater-obsidian']?.settings?.templates_folder ||
			(app as any).plugins?.plugins?.['templater-obsidian']?.settings?.template_folder;
		if (templaterFolder && typeof templaterFolder === 'string') {
			return normalizePath(templaterFolder.trim());
		}

		// 3. Dossiers conventionnels du coffre s'ils existent
		const candidates = ['Templates', '05 - Modèles', '05 - Templates', 'Modèles', 'Templates & Modèles'];
		for (const cand of candidates) {
			const folderObj = (app.vault as any).getFolderByPath ? (app.vault as any).getFolderByPath(cand) : app.vault.getAbstractFileByPath(cand);
			if (folderObj) {
				return cand;
			}
		}

		return 'Templates';
	}

	/**
	 * Liste tous les templates / modèles disponibles dans le coffre.
	 */
	public static listTemplates(
		app: App,
		settings?: SecondBrainSettings,
		query?: string
	): TemplateInfo[] {
		const templatesFolder = this.getTemplatesFolder(app, settings).toLowerCase();
		const allFiles = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];
		const results: TemplateInfo[] = [];
		const cleanQuery = query ? query.toLowerCase().trim() : undefined;

		for (const file of allFiles) {
			const normPath = normalizePath(file.path);
			const lowerPath = normPath.toLowerCase();

			// Fichier situé dans le dossier des templates ou sous-dossier
			const isInTemplatesFolder = lowerPath.startsWith(templatesFolder + '/') || lowerPath === templatesFolder;

			// Ou fichier marqué comme template par tag ou métadonnées
			let isMarkedAsTemplate = false;
			try {
				const cache = app.metadataCache?.getFileCache?.(file);
				if (cache?.tags && Array.isArray(cache.tags)) {
					isMarkedAsTemplate = cache.tags.some(t => {
						const tag = t.tag.toLowerCase();
						return tag === '#template' || tag === '#modele' || tag === '#templates' || tag === '#modèles';
					});
				}
				if (!isMarkedAsTemplate && cache?.frontmatter) {
					const typeVal = String(cache.frontmatter.type || cache.frontmatter.tags || '').toLowerCase();
					if (typeVal.includes('template') || typeVal.includes('modele')) {
						isMarkedAsTemplate = true;
					}
				}
			} catch {
				// ignore
			}

			if (isInTemplatesFolder || isMarkedAsTemplate) {
				if (cleanQuery) {
					const matchName = file.basename.toLowerCase().includes(cleanQuery);
					const matchPath = lowerPath.includes(cleanQuery);
					if (!matchName && !matchPath) continue;
				}

				results.push({
					name: file.basename,
					basename: file.basename,
					path: normPath,
					folder: file.parent ? normalizePath(file.parent.path) : ''
				});
			}
		}

		// Tri par nom
		return results.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
	}

	/**
	 * Résout le fichier TFile d'un template à partir de son nom ou chemin.
	 */
	public static resolveTemplateFile(
		app: App,
		settings: SecondBrainSettings | undefined,
		templateNameOrPath: string
	): TFile | null {
		if (!templateNameOrPath || typeof templateNameOrPath !== 'string') return null;

		const clean = templateNameOrPath
			.replace(/^\[\[/, '')
			.replace(/\]\]$/, '')
			.replace(/^["']/, '')
			.replace(/["']$/, '')
			.trim();

		if (!clean) return null;

		const templatesFolder = this.getTemplatesFolder(app, settings);
		const normalized = normalizePath(clean);
		const normalizedWithMd = normalized.endsWith('.md') ? normalized : `${normalized}.md`;

		// 1. Recherche par chemin exact
		let file = app.vault.getFileByPath(normalizedWithMd) || app.vault.getAbstractFileByPath(normalizedWithMd);
		if (file instanceof TFile) return file;

		file = app.vault.getFileByPath(normalized) || app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) return file;

		// 2. Recherche dans le dossier des templates
		const inFolder = normalizePath(`${templatesFolder}/${clean}`);
		const inFolderWithMd = inFolder.endsWith('.md') ? inFolder : `${inFolder}.md`;

		file = app.vault.getFileByPath(inFolderWithMd) || app.vault.getAbstractFileByPath(inFolderWithMd);
		if (file instanceof TFile) return file;

		file = app.vault.getFileByPath(inFolder) || app.vault.getAbstractFileByPath(inFolder);
		if (file instanceof TFile) return file;

		// 3. Recherche par nom canonique ou partiel parmi les templates
		const targetKey = normalizeCanonicalKey(clean);
		const allMarkdown = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];

		// D'abord dans le dossier templates
		const lowerFolder = templatesFolder.toLowerCase();
		for (const f of allMarkdown) {
			const norm = normalizePath(f.path).toLowerCase();
			if (norm.startsWith(lowerFolder + '/') || norm === lowerFolder) {
				const baseKey = normalizeCanonicalKey(f.basename);
				if (baseKey === targetKey || baseKey.includes(targetKey) || targetKey.includes(baseKey)) {
					return f;
				}
			}
		}

		// Ensuite dans tout le coffre
		for (const f of allMarkdown) {
			const baseKey = normalizeCanonicalKey(f.basename);
			if (baseKey === targetKey) {
				return f;
			}
		}

		return null;
	}

	/**
	 * Lit le contenu d'un modèle et extrait tous ses placeholders / variables.
	 */
	public static async readTemplate(
		app: App,
		settings: SecondBrainSettings | undefined,
		templateNameOrPath: string
	): Promise<TemplateDetails | null> {
		const file = this.resolveTemplateFile(app, settings, templateNameOrPath);
		if (!file || !(file instanceof TFile)) {
			return null;
		}

		const content = (typeof (app.vault as any).cachedRead === 'function')
			? await (app.vault as any).cachedRead(file)
			: await app.vault.read(file);

		// Extraction de tous les placeholders (Obsidian {{...}}, Templater <% ... %>, QuickAdd {{...}})
		const placeholders = new Set<string>();

		// 1. Obsidian & QuickAdd placeholders : {{...}}
		const doubleBraceMatches = content.match(/\{\{([^}]+)\}\}/g);
		if (doubleBraceMatches) {
			doubleBraceMatches.forEach(m => placeholders.add(m));
		}

		// 2. Templater placeholders : <% ... %>
		const templaterMatches = content.match(/<%\s*([^%>]+)\s*%>/g);
		if (templaterMatches) {
			templaterMatches.forEach(m => placeholders.add(m));
		}

		return {
			file,
			path: normalizePath(file.path),
			name: file.basename,
			content,
			placeholders: Array.from(placeholders)
		};
	}

	/**
	 * Rendu complet et fusion intelligente d'un modèle avec son contexte et ses variables.
	 */
	public static renderTemplate(
		templateContent: string,
		context: TemplateRenderContext,
		app?: App
	): string {
		if (!templateContent) return '';

		const title = context.title || 'Sans titre';
		const folder = context.folder || '';
		const now = new Date();
		const dateIso = context.date || now.toISOString().split('T')[0];
		const timeStr = context.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

		const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
		const frDate = isoMatch ? `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}` : dateIso;

		const dateObj = new Date(dateIso);
		const yesterday = new Date(dateObj);
		yesterday.setDate(yesterday.getDate() - 1);
		const yesterdayIso = yesterday.toISOString().split('T')[0];
		const yesterdayFr = `${String(yesterday.getDate()).padStart(2, '0')}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${yesterday.getFullYear()}`;

		const tomorrow = new Date(dateObj);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowIso = tomorrow.toISOString().split('T')[0];
		const tomorrowFr = `${String(tomorrow.getDate()).padStart(2, '0')}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${tomorrow.getFullYear()}`;

		// Moment format helper
		const formatWithMoment = (fmt: string, dateVal = dateIso): string => {
			try {
				const momentFn = (app as any)?.moment || (window as any)?.moment;
				if (typeof momentFn === 'function') {
					const m = momentFn(dateVal, 'YYYY-MM-DD');
					if (m.isValid()) return m.format(fmt);
				}
			} catch {
				// ignore
			}
			return dateVal;
		};

		let rendered = templateContent;

		// 1. Remplacement des variables personnalisées fournies
		if (context.variables && typeof context.variables === 'object') {
			for (const [key, rawVal] of Object.entries(context.variables)) {
				const val = String(rawVal ?? '');
				const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, '');

				// {{key}}, {{VALUE:key}}, {{VALUE}}
				const regexDouble = new RegExp(`\\{\\{\\s*(?:VALUE:)?${cleanKey}\\s*\\}\\}`, 'gi');
				rendered = rendered.replace(regexDouble, val);

				// <% tp.system.prompt("key", ...) %>, <% key %>, <% tp.user.key %>
				const regexTpPrompt = new RegExp(`<%\\s*tp\\.system\\.prompt\\([^)]*${cleanKey}[^)]*\\)\\s*%>`, 'gi');
				rendered = rendered.replace(regexTpPrompt, val);

				const regexTpVar = new RegExp(`<%\\s*(?:tp\\.user\\.)?${cleanKey}\\s*%>`, 'gi');
				rendered = rendered.replace(regexTpVar, val);
			}
		}

		// 2. Obsidian Core Placeholders : {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, etc.
		rendered = rendered
			.replace(/\{\{\s*title\s*\}\}/gi, title)
			.replace(/\{\{\s*NAME\s*\}\}/gi, title)
			.replace(/\{\{\s*date\s*\}\}/gi, dateIso)
			.replace(/\{\{\s*DATE\s*\}\}/gi, dateIso)
			.replace(/\{\{\s*time\s*\}\}/gi, timeStr)
			.replace(/\{\{\s*TIME\s*\}\}/gi, timeStr)
			.replace(/\{\{\s*yesterday\s*\}\}/gi, yesterdayFr)
			.replace(/\{\{\s*tomorrow\s*\}\}/gi, tomorrowFr)
			.replace(/\{\{\s*folder\s*\}\}/gi, folder);

		// Format personnalisé {{date:FORMAT}} ou {{DATE:FORMAT}}
		rendered = rendered.replace(/\{\{\s*DATE:([^}]+)\s*\}\}/gi, (_, fmt) => formatWithMoment(fmt.trim(), dateIso));
		rendered = rendered.replace(/\{\{\s*date:([^}]+)\s*\}\}/gi, (_, fmt) => formatWithMoment(fmt.trim(), dateIso));
		rendered = rendered.replace(/\{\{\s*time:([^}]+)\s*\}\}/gi, (_, fmt) => formatWithMoment(fmt.trim(), dateIso));

		// 3. Templater Placeholders : <% tp.file.title %>, <% tp.date.now() %>, etc.
		rendered = rendered
			.replace(/<%\s*tp\.file\.title\s*%>/gi, title)
			.replace(/<%\s*tp\.file\.folder\([^)]*\)\s*%>/gi, folder)
			.replace(/<%\s*tp\.file\.cursor\([^)]*\)\s*%>/gi, '')
			.replace(/<%\s*tp\.file\.creation_date\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, dateIso)
			.replace(/<%\s*tp\.file\.creation_date\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, frDate)
			.replace(/<%\s*tp\.file\.creation_date\([^)]*\)\s*%>/gi, dateIso)
			.replace(/<%\s*tp\.date\.now\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, dateIso)
			.replace(/<%\s*tp\.date\.now\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, frDate)
			.replace(/<%\s*tp\.date\.now\([^)]*-[0-9]+[^)]*\)\s*%>/gi, yesterdayFr)
			.replace(/<%\s*tp\.date\.now\([^)]*\+[0-9]+[^)]*\)\s*%>/gi, tomorrowFr)
			.replace(/<%\s*tp\.date\.now\(\)\s*%>/gi, dateIso)
			.replace(/<%\s*tp\.date\.yesterday\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, yesterdayIso)
			.replace(/<%\s*tp\.date\.yesterday\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, yesterdayFr)
			.replace(/<%\s*tp\.date\.yesterday\(\)\s*%>/gi, yesterdayFr)
			.replace(/<%\s*tp\.date\.tomorrow\([^)]*YYYY-MM-DD[^)]*\)\s*%>/gi, tomorrowIso)
			.replace(/<%\s*tp\.date\.tomorrow\([^)]*DD-MM-YYYY[^)]*\)\s*%>/gi, tomorrowFr)
			.replace(/<%\s*tp\.date\.tomorrow\(\)\s*%>/gi, tomorrowFr);

		// Format personnalisé <% tp.date.now("FORMAT") %>
		rendered = rendered.replace(/<%\s*tp\.date\.now\(["']([^"']+)["'][^)]*\)\s*%>/gi, (_, fmt) => formatWithMoment(fmt.trim(), dateIso));

		// 4. QuickAdd generic cleanups : {{VALUE}}, {{VALUE:prompt}}
		rendered = rendered.replace(/\{\{\s*VALUE(?::[^}]+)?\s*\}\}/gi, '');

		// 5. Nettoyage des prompts Templater résiduels non remplis : <% tp.system.prompt(...) %>
		rendered = rendered.replace(/<%\s*tp\.system\.prompt\([^)]*\)\s*%>/gi, '');

		// 6. Fusion Frontmatter si un frontmatter contextuel additionnel est fourni
		if (context.frontmatter && Object.keys(context.frontmatter).length > 0) {
			rendered = this.mergeFrontmatter(rendered, context.frontmatter);
		}

		return rendered;
	}

	/**
	 * Fusionne de nouvelles propriétés dans le bloc YAML frontmatter existant.
	 */
	private static mergeFrontmatter(content: string, newProperties: Record<string, unknown>): string {
		const isCRLF = content.includes('\r\n');
		const cleanContent = content.replace(/\r\n/g, '\n');

		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
		const match = cleanContent.match(frontmatterRegex);

		if (match) {
			const existingYaml = match[1];
			const restOfContent = cleanContent.slice(match[0].length);
			const yamlLines = existingYaml.split('\n');

			for (const [key, val] of Object.entries(newProperties)) {
				const valStr = Array.isArray(val) ? `[${val.map(v => JSON.stringify(v)).join(', ')}]` : (typeof val === 'string' ? val : JSON.stringify(val));
				const lineIdx = yamlLines.findIndex(l => l.startsWith(`${key}:`));
				if (lineIdx !== -1) {
					yamlLines[lineIdx] = `${key}: ${valStr}`;
				} else {
					yamlLines.push(`${key}: ${valStr}`);
				}
			}

			const updated = `---\n${yamlLines.join('\n')}\n---\n\n${restOfContent.trimStart()}`;
			return isCRLF ? updated.replace(/\n/g, '\r\n') : updated;
		} else {
			const yamlLines: string[] = ['---'];
			for (const [key, val] of Object.entries(newProperties)) {
				const valStr = Array.isArray(val) ? `[${val.map(v => JSON.stringify(v)).join(', ')}]` : (typeof val === 'string' ? val : JSON.stringify(val));
				yamlLines.push(`${key}: ${valStr}`);
			}
			yamlLines.push('---');
			const updated = `${yamlLines.join('\n')}\n\n${cleanContent}`;
			return isCRLF ? updated.replace(/\n/g, '\r\n') : updated;
		}
	}

	/**
	 * Déclenche l'exécution native du plugin Templater sur un fichier créé si Templater est installé et actif.
	 */
	public static async executeTemplaterIfAvailable(app: App, targetFile: TFile, rawTemplate?: string): Promise<boolean> {
		try {
			const templaterPlugin = (app as any).plugins?.plugins?.['templater-obsidian'];
			if (!templaterPlugin) return false;

			if (templaterPlugin.templater?.overwrite_file_commands) {
				await templaterPlugin.templater.overwrite_file_commands(targetFile);
				return true;
			} else if (templaterPlugin.templater?.parse_template && rawTemplate) {
				const parsed = await templaterPlugin.templater.parse_template({ target_file: targetFile, run_mode: 0 }, rawTemplate);
				if (parsed) {
					await app.vault.modify(targetFile, parsed);
					return true;
				}
			}
		} catch (err) {
			console.warn('[Second Brain Manager] Templater execution warning:', err);
		}
		return false;
	}
}
