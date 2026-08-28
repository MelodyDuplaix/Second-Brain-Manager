import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { TaskSafetyGuard } from './taskSafetyGuard';
import { VaultContextService } from './vaultContextService';
import { DailyNoteFormatter } from './dailyNoteFormatter';
import { GamificationService } from './gamificationService';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from '../models/syntaxConfig';
import { GoogleCalendarEvent } from '../models/googleCalendar';
import { GoogleCalendarService } from './googleCalendarService';
import SecondBrainPlugin from '../main';

export interface BriefingVaultData {
	dateStr: string;
	formattedDate: string;
	energy: number;
	modeText: string;
	focusProject?: string;
	inactivityText: string;
	inactivityDays: number;
	isRecoveryMode: boolean;
	quickWinTasks: ObsidianTask[];
	oneThingTask?: ObsidianTask;
	overdueTasks: ObsidianTask[];
	staleTasks: ObsidianTask[];
	todayTasks: ObsidianTask[];
	priorityTasks: ObsidianTask[];
	inboxTasks: ObsidianTask[];
	projectTasks: ObsidianTask[];
	looseNotes: string[];
	inboxNotePreviews: Array<{ path: string; name: string; preview: string }>;
	folders: string[];
	isCluttered: boolean;
	projects: string[];
	contacts: string[];
	dailyNoteContent?: string;
	calendarEvents?: GoogleCalendarEvent[];
	calendarEventsText?: string;
	customPromptInstructions?: string;
}

export class MorningBriefingService {
	/**
	 * Calcule la durée d'inactivité écoulée depuis la dernière session active ou événement.
	 */
	public static calculateInactivity(lastActiveTimestamp?: string | number): { inactivityText: string; inactivityDays: number } {
		const now = Date.now();
		if (!lastActiveTimestamp) {
			return { inactivityText: 'Reprise de session', inactivityDays: 0 };
		}

		const lastTime = typeof lastActiveTimestamp === 'string'
			? new Date(lastActiveTimestamp).getTime()
			: lastActiveTimestamp;

		if (isNaN(lastTime)) {
			return { inactivityText: 'Reprise de session', inactivityDays: 0 };
		}

		const diffMs = Math.max(0, now - lastTime);
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffHours / 24);

		if (diffDays >= 30) {
			const months = Math.floor(diffDays / 30);
			return { inactivityText: `Reprise après ${months} mois de pause`, inactivityDays: diffDays };
		} else if (diffDays >= 7) {
			const weeks = Math.floor(diffDays / 7);
			return { inactivityText: `Reprise après ${weeks} semaine(s) de pause`, inactivityDays: diffDays };
		} else if (diffDays >= 1) {
			return { inactivityText: `Reprise après ${diffDays} jour(s) de pause`, inactivityDays: diffDays };
		} else if (diffHours >= 2) {
			return { inactivityText: `Reprise après ${diffHours} heures de pause`, inactivityDays: 0 };
		}

		return { inactivityText: 'Reprise en douceur', inactivityDays: 0 };
	}

	/**
	 * Récupère et structure l'ensemble des données du coffre nécessaires pour le briefing.
	 */
	public static async collectBriefingData(
		app: App,
		plugin: SecondBrainPlugin,
		focusProject?: string
	): Promise<BriefingVaultData> {
		const today = new Date();
		const dateStr = today.toISOString().split('T')[0];

		// Formatage de la date en français (ex: "Lundi 24 Août 2026")
		const formattedDate = today.toLocaleDateString('fr-FR', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

		const energy = plugin.settings.energyLevel;
		const modeText = energy <= 3
			? 'Mode Économie (Faible énergie - priorité à la préservation et au délestage)'
			: energy <= 7
				? 'Mode Équilibré (Énergie moyenne - focus sur 1 tâche majeure et 2-3 secondaires)'
				: 'Mode Plein Potentiel (Haute énergie - idéal pour les chantiers complexes et créatifs)';

		// Calcul de la durée d'inactivité
		let lastActiveTime = plugin.pluginData?.lastActiveSession;
		if (!lastActiveTime && plugin.pluginData?.completionEvents) {
			const timestamps = Object.values(plugin.pluginData.completionEvents)
				.map(e => e.completedAt)
				.filter(Boolean);
			if (timestamps.length > 0) {
				timestamps.sort();
				lastActiveTime = timestamps[timestamps.length - 1];
			}
		}
		const { inactivityText, inactivityDays } = this.calculateInactivity(lastActiveTime);

		const matrixAdapter = MatrixAdapterFactory.createAdapter(
			plugin.settings.matrixProvider,
			plugin.settings.customMatrixMapping
		);

		const vaultContext = new VaultContextService(app, plugin.settings);
		const filterService = vaultContext.getFilterService();
		const structure = vaultContext.getVaultStructure();

		// Lecture de toutes les tâches ouvertes du coffre en parallèle (racines + sous-tâches)
		const allFiles = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];
		const files = allFiles.filter(f => !filterService.isFolderExcluded(f.path) && !filterService.isFileNameExcluded(f.path));
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					const content = (typeof (app.vault as any).cachedRead === 'function')
						? await (app.vault as any).cachedRead(file)
						: await app.vault.read(file);
					if (filterService.isFileExcluded(file, content)) {
						return [];
					}
					return TaskParser.parseAllTasks(content, file.path, plugin.settings);
				} catch {
					return [];
				}
			})
		);
		const allTasks = results.flat();
		const allOpenTasks = allTasks.filter(t => !t.completed && t.status !== 'cancelled' && !filterService.isTaskExcluded(t));

		// Classification
		const overdueTasks = allOpenTasks.filter(t =>
			(t.dueDate && t.dueDate < dateStr) ||
			(t.scheduledDate && t.scheduledDate < dateStr)
		);
		const todayTasks = allOpenTasks.filter(t =>
			t.dueDate === dateStr ||
			t.scheduledDate === dateStr ||
			(t.startDate && t.startDate <= dateStr)
		);

		// Identification des tâches très anciennes (souffrance / obsolescence)
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		const staleTasks = overdueTasks.filter(t =>
			(t.dueDate && t.dueDate <= sevenDaysAgo) ||
			(t.scheduledDate && t.scheduledDate <= sevenDaysAgo)
		);

		const inboxFolder = plugin.settings.inboxFolder ? normalizePath(plugin.settings.inboxFolder).toLowerCase() : '00 - inbox';
		const inboxTasks = allOpenTasks.filter(t => {
			const norm = normalizePath(t.filePath).toLowerCase();
			const isRoot = !norm.includes('/');
			return norm.startsWith(inboxFolder) || norm.includes('notes en vrac') || norm.includes('vrac') || isRoot;
		});

		const priorityTasks = allOpenTasks.filter(t => {
			const q = matrixAdapter.getQuadrant(t);
			return q === 'q1' || q === 'q2' || (t.priority && (t.priority === 'highest' || t.priority === 'high'));
		});

		// Identification des Quick Wins (tâches courtes, faciles ou faible énergie, non Q1)
		const quickWinTasks = allOpenTasks
			.filter(t => {
				const isLowEnergy = t.energy !== undefined && t.energy <= 3;
				const isEasy = t.difficulty && t.difficulty.toLowerCase() === 'facile';
				const isQ3orQ4 = matrixAdapter.getQuadrant(t) === 'q3' || matrixAdapter.getQuadrant(t) === 'q4';
				return isLowEnergy || isEasy || isQ3orQ4;
			})
			.slice(0, 3);

		// Identification de la tâche majeure (The One Thing) : priorité Q1
		let oneThingTask = allOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' && (t.dueDate === dateStr || (t.dueDate && t.dueDate < dateStr)));
		if (!oneThingTask) {
			oneThingTask = allOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || matrixAdapter.getQuadrant(t) === 'q2');
		}
		if (!oneThingTask && overdueTasks.length > 0) {
			oneThingTask = overdueTasks[0];
		}

		// Tâches spécifiques au projet focus si sélectionné
		const projectTasks = (focusProject && focusProject !== 'all')
			? allOpenTasks.filter(t =>
				(t.filePath && t.filePath.toLowerCase().includes(focusProject.toLowerCase())) ||
				(t.title && t.title.toLowerCase().includes(focusProject.toLowerCase())) ||
				(t.domainTags && Array.isArray(t.domainTags) && t.domainTags.some(tag => tag.toLowerCase().includes(focusProject.toLowerCase())))
			)
			: [];

		const looseNotes = structure.looseNotes || [];

		// Récupération des dossiers et des aperçus des notes en boîte de réception / vrac pour donner du contexte à l'IA
		const inboxFilesToScan = structure.inboxFiles.filter(p => !filterService.isFolderExcluded(p) && !filterService.isFileNameExcluded(p)).slice(0, 30);
		const rawPreviews = await Promise.all(
			inboxFilesToScan.map(async (normPath) => {
				const file = app.vault.getFileByPath(normPath) || app.vault.getAbstractFileByPath(normPath);
				let preview = '';
				if (file instanceof TFile) {
					try {
						const raw = (typeof (app.vault as any).cachedRead === 'function')
							? await (app.vault as any).cachedRead(file)
							: await app.vault.read(file);
						if (filterService.isFileExcluded(file, raw)) {
							return null;
						}
						const nonHeadingLine = raw.split('\n')
							.map(l => l.trim())
							.filter(l => l.length > 0 && !l.startsWith('---') && !l.startsWith('```'))[0] || '';
						preview = nonHeadingLine.slice(0, 120);
					} catch {
						preview = '';
					}
				}
				const name = normPath.split('/').pop()?.replace(/\.md$/, '') || normPath;
				return { path: normPath, name, preview };
			})
		);
		const inboxNotePreviews = rawPreviews.filter((p): p is { path: string; name: string; preview: string } => p !== null);

		// Déclenchement automatique du mode Reprise & Décongestion si encombrement ou pause
		const isCluttered = overdueTasks.length >= 4 || staleTasks.length >= 2 || inboxTasks.length >= 4 || inboxNotePreviews.length >= 3;
		const isRecoveryMode = isCluttered || inactivityDays >= 1;

		// Lecture ou création automatique de la note quotidienne du jour (avec template et Templater)
		let dailyNoteContent: string | undefined;
		const dailyRes = await vaultContext.getOrCreateDailyNote(dateStr, plugin.settings.dailyNoteTemplatePath);
		if (dailyRes.content) {
			dailyNoteContent = dailyRes.content;
		}

		// Lecture des événements Google Calendar du jour si configuré
		let calendarEventsText = '';
		let calendarEvents: GoogleCalendarEvent[] = [];
		if (plugin.settings.googleRefreshToken) {
			try {
				const startOfToday = new Date(today);
				startOfToday.setHours(0, 0, 0, 0);
				const endOfToday = new Date(today);
				endOfToday.setHours(23, 59, 59, 999);

				calendarEvents = await GoogleCalendarService.getEvents(plugin.settings, {
					timeMin: startOfToday.toISOString(),
					timeMax: endOfToday.toISOString()
				});
				calendarEventsText = GoogleCalendarService.formatEventsForPrompt(
					calendarEvents,
					dateStr,
					plugin.settings
				);
			} catch (calErr) {
				console.warn('[Second Brain Manager] Erreur récupération événements Google Calendar pour le briefing:', calErr);
			}
		}

		return {
			dateStr,
			formattedDate: capitalizedDate,
			energy,
			modeText,
			focusProject: focusProject && focusProject !== 'all' ? focusProject : undefined,
			inactivityText,
			inactivityDays,
			isRecoveryMode,
			quickWinTasks,
			oneThingTask,
			overdueTasks,
			staleTasks,
			todayTasks,
			priorityTasks,
			inboxTasks,
			projectTasks,
			looseNotes,
			inboxNotePreviews,
			folders: structure.folders,
			isCluttered,
			projects: structure.projects,
			contacts: structure.contacts,
			dailyNoteContent,
			calendarEvents,
			calendarEventsText,
			customPromptInstructions: plugin.settings.customPromptInstructions
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour un briefing percutant ou une reprise décongestionnée.
	 */
	public static buildBriefingMessages(data: BriefingVaultData, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ChatMessage[] {
		const formatTaskLine = (t: ObsidianTask): string => {
			return TaskMutator.formatTaskForPrompt(t, config);
		};

		const taskSyntaxDesc = TaskMutator.getTaskSyntaxPromptDescription(config);

		const oneThingText = data.oneThingTask
			? formatTaskLine(data.oneThingTask)
			: 'Aucune tâche majeure détectée.';

		const quickWinsText = (data.quickWinTasks && data.quickWinTasks.length > 0)
			? data.quickWinTasks.map(formatTaskLine).join('\n')
			: 'Aucune tâche rapide identifiée.';

		const overdueText = (data.overdueTasks && data.overdueTasks.length > 0)
			? data.overdueTasks.slice(0, 35).map(formatTaskLine).join('\n')
			: 'Aucune tâche en retard.';

		const staleText = (data.staleTasks && data.staleTasks.length > 0)
			? data.staleTasks.slice(0, 35).map(formatTaskLine).join('\n')
			: 'Aucune tâche ancienne en souffrance.';

		const todayText = (data.todayTasks && data.todayTasks.length > 0)
			? data.todayTasks.map(formatTaskLine).join('\n')
			: 'Aucune tâche expressément planifiée pour aujourd\'hui.';

		const priorityText = (data.priorityTasks && data.priorityTasks.length > 0)
			? data.priorityTasks.slice(0, 8).map(formatTaskLine).join('\n')
			: 'Aucune tâche Q1/Q2 prioritaire.';

		const inboxText = (data.inboxTasks && data.inboxTasks.length > 0)
			? data.inboxTasks.slice(0, 20).map(formatTaskLine).join('\n')
			: 'Aucun élément en boîte de réception.';

		const looseNotesText = (data.inboxNotePreviews && data.inboxNotePreviews.length > 0)
			? data.inboxNotePreviews.map(n => `- [[${n.name}]] (Chemin: "${n.path}")${n.preview ? ` : "${n.preview}"` : ''}`).join('\n')
			: 'Aucune note non classée en boîte de réception.';

		const foldersText = (data.folders && data.folders.length > 0)
			? data.folders.slice(0, 25).join(', ')
			: 'Racine';

		let focusProjectText = '';
		if (data.focusProject) {
			const tasksForProject = data.projectTasks.length > 0
				? data.projectTasks.map(formatTaskLine).join('\n')
				: `Aucune tâche explicite trouvée pour ${data.focusProject}.`;
			focusProjectText = `\nPROJET PRIORITAIRE DU JOUR DESIGNE PAR L'UTILISATEUR : "[[${data.focusProject}]]"\n` +
				`TACHES LIEES A CE PROJET :\n${tasksForProject}\n`;
		}

		let dailyNoteSnippet = '';
		if (data.dailyNoteContent) {
			dailyNoteSnippet = `\nContenu actuel de la note quotidienne du jour (${data.dateStr}) :\n${data.dailyNoteContent.slice(0, 1500)}\n`;
		}

		let focusDirectives = '';
		if (data.focusProject) {
			focusDirectives = `\n- **Projet Focus Majeur** : L'utilisateur a explicitement demandé de focaliser sa journée sur "[[${data.focusProject}]]". Fais de ce projet le cœur de ton Cap du Jour et privilégie ses tâches dans le plan de journée.`;
		}

		let customInstructionsSection = '';
		if (data.customPromptInstructions && data.customPromptInstructions.trim()) {
			customInstructionsSection = `\nINSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L'UTILISATEUR (À RESPECTER SCRUPULEUSEMENT) :\n${data.customPromptInstructions.trim()}\n`;
		}

		let calendarSectionText = '';
		if (data.calendarEventsText && data.calendarEventsText.trim() && !data.calendarEventsText.startsWith('Aucun')) {
			calendarSectionText = `\nAGENDA & CRÉNEAUX DU JOUR (Google Calendar - PRIORITÉ ABSOLUE) :\n${data.calendarEventsText}\nATTENTION : Ces rendez-vous sont des contraintes fermes prioritaires sur toutes les tâches. Tu dois impérativement articuler le plan d'action et les tâches dans les temps libres restants entre ces créneaux.\n`;
		}

		let systemPrompt = '';
		let userMessage = '';

		if (data.isRecoveryMode) {
			systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en productivité bienveillante, méthodologie GTD et reprise sereine après pause (Soft Landing & Décongestion large du coffre).

SITUATION DU COFFRE :
Le coffre est en état d'encombrement / de reprise (${data.inactivityText}, ${data.overdueTasks.length} tâches en retard dont ${data.staleTasks.length} anciennes/obsolètes, ${data.inboxNotePreviews.length} notes non classées).

PRISE EN COMPTE DES AGENDAS :
1. "Mon Agenda Principal & Secondaires" : Rendez-vous personnels de l'utilisateur. L'agenda principal bloque son temps de travail en priorité n°1. Tu dois impérativement construire le plan de reprise et les tâches dans les créneaux libres disponibles.
2. "Agendas Partagés / Proches" : Appartiennent à des tiers (ex: conjoint, collègues). Mentionne-les sobrement si pertinent à titre informatif (ex: "Agenda d'Antoine : ..."), sans formules lourdes ou moralisatrices, et sans les compter comme des contraintes de l'utilisateur ni signaler de conflit.${customInstructionsSection}

TON OBJECTIF :
Fournir un Briefing du Matin en **Mode Reprise & Décongestion Large**. Accueille chaleureusement l'utilisateur, déculpabilise-le totalement sur le retard accumulé, et propose un plan de journée recentré accompagné d'un **TRI LARGE et EXHAUSTIF** de toutes les tâches en retard et notes en vrac.

CONSIGNE DE STYLE STRICTE :
- N'utilise AUCUN émoji dans ta réponse textuelle (sauf si le format de tâche configuré l'impose explicitement pour les métadonnées). Reste sobre, clair, direct et bienveillant.

CONSIGNES DE REDACTION EN MODE REPRISE :
1. **Ton & Posture** : Chaleureux, constructif, réconfortant et direct. Zéro culpabilisation.${focusDirectives}
2. **Structure du Briefing de Reprise** :
   - **Accueil & Bilan Déculpabilisant** (2 phrases bienveillantes pour poser un cadre serein)
   - **Les Rendez-vous Fixes & Contraintes Agenda** (Rappel des créneaux incontournables du jour)
   - **Le Quick Win du Jour** (1 micro-tâche simple de 5 min pour amorcer le mouvement sans effort)
   - **The One Thing** (La seule tâche prioritaire et stratégique incontournable du jour selon l'énergie ${data.energy}/10, calée hors des rendez-vous)
   - **Plan de Tri & Décongestion Large** :
     - Annule systématiquement sans culpabilité les réunions passées et tâches obsolètes depuis longtemps sans conséquences actuelles (\`newStatus: "cancelled"\`).
     - Replanifie à aujourd'hui (${data.dateStr}) ou à une date réaliste les tâches prioritaires.
     - Rétrograde en Q2 ou déleste les échéances (\`newDueDate: null\`) des tâches secondaires pour faire baisser la pression mentale.
     - Propose le rangement et le renommage explicite de chaque note en vrac vers son projet ou domaine pertinent (\`type: "move_note"\`, \`type: "rename_note"\`).
   - **Conseil de Sérénité & Rythme** (Un conseil motivant pour garder l'esprit léger)
3. **Format des Tâches Recommandées** :
${taskSyntaxDesc}
4. **Bloc d'Actions Structurées (OBLIGATOIRE - Bloc \`\`\`json:actions)** :
Termine TOUJOURS ta réponse par un bloc de code JSON \`\`\`json:actions exhaustif contenant TOUTES les propositions d'actions (reports, annulations, rangements et renommages) afin que l'utilisateur puisse appliquer l'ensemble du tri large en 1 clic :
\`\`\`json:actions
[
  {
    "type": "update_task",
    "targetPath": "1 Notes partagés Antoine/Tracker menage.md",
    "lineNumber": 15,
    "taskTitle": "Passer l'aspirateur et la serpillère si besoin",
    "newDueDate": "${data.dateStr}",
    "reason": "Replanifier à aujourd'hui"
  },
  {
    "type": "update_task",
    "targetPath": "Note quotidienne/28-12-2025.md",
    "lineNumber": 18,
    "taskTitle": "Prendre médicament allergie",
    "newStatus": "cancelled",
    "reason": "Tâche médicale obsolète datant de 2025"
  },
  {
    "type": "move_note",
    "targetPath": "Notes en vrac/Liste d'appel VŒUX 2026.md",
    "destinationFolder": "01 - Projets",
    "newFileName": "Vœux 2026 - Liste d'appels.md",
    "description": "Ranger et renommer la liste d'appel dans les projets"
  },
  {
    "type": "rename_note",
    "targetPath": "00 - Inbox/Sans titre.md",
    "newFileName": "Idées Projet X.md",
    "description": "Donner un nom clair et explicite à la note"
  }
]
\`\`\`
Utilise les chemins exacts et numéros de ligne fournis.`;

			userMessage = `Voici la situation actuelle de mon coffre pour ce ${data.formattedDate} (${data.inactivityText}, Niveau d'énergie : ${data.energy}/10 - ${data.modeText}) :

Dossiers disponibles : ${foldersText}
Projets actifs : ${(data.projects && data.projects.join(', ')) || 'Aucun'}
Contacts récents : ${(data.contacts && data.contacts.join(', ')) || 'Aucun'}
${focusProjectText}
${calendarSectionText}
TACHE MAJEURE DETECTEE (THE ONE THING) :
${oneThingText}

QUICK WINS DISPONIBLES :
${quickWinsText}

TACHES EN RETARD ET ANCIENNES (${data.overdueTasks.length} au total) :
${overdueText}

TACHES EN SOUFFRANCE (> 7 jours de retard, ${data.staleTasks.length} au total) :
${staleText}

NOTES EN VRAC ET BOITE DE RECEPTION (${data.inboxNotePreviews.length} notes non rangées / ${data.inboxTasks.length} tâches en vrac) :
Notes en vrac :
${looseNotesText}

Tâches en vrac :
${inboxText}
${dailyNoteSnippet}
Propose-moi mon briefing en mode reprise avec un tri large et déculpabilisant des tâches et notes, accompagné du bloc json:actions pour que je puisse tout appliquer en 1 clic. N'utilise aucun émoji dans ta réponse textuelle (sauf si la syntaxe des tâches configurée l'exige).`;

		} else {
			// Mode Briefing Quotidien standard
			systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en productivité bienveillante, méthodologie GTD et matrice d'Eisenhower.

PRISE EN COMPTE DES AGENDAS :
1. "Mon Agenda Principal & Secondaires" : Rendez-vous personnels de l'utilisateur. L'agenda principal bloque son temps de travail en priorité n°1. Tu dois impérativement construire le plan de journée et ordonner les tâches dans les créneaux libres disponibles.
2. "Agendas Partagés / Proches" : Appartiennent à des tiers (ex: conjoint, collègues). Mentionne-les sobrement si pertinent à titre informatif (ex: "Agenda d'Antoine : ..."), sans formules lourdes ou moralisatrices, et sans les compter comme des contraintes de l'utilisateur ni signaler de conflit.${customInstructionsSection}

TON OBJECTIF :
Fournir un Briefing du Matin clair, motivant, ultra-structuré et sur-mesure pour organiser la journée de l'utilisateur en respectant scrupuleusement son niveau d'énergie (${data.energy}/10 - ${data.modeText}) et ses rendez-vous d'agenda.

CONSIGNE DE STYLE STRICTE :
- N'utilise AUCUN émoji dans ta réponse textuelle (sauf si le format de tâche configuré l'impose explicitement pour les métadonnées). Reste sobre, clair, direct et professionnel.

CONSIGNES DE REDACTION :
1. **Ton & Posture** : Chaleureux, constructif, direct et rassurant. Pas de bavardage inutile ni de méta-commentaire.${focusDirectives}
2. **Structure du Briefing** :
   - **Cap du Jour** (Le focus ou projet n°1 incontournable)
   - **Rendez-vous & Contraintes Fixes de l'Agenda** (Rappel clair des heures de réunions/rendez-vous à honorer en priorité)
   - **Plan de Journée Recommandé** (Les tâches sélectionnées et positionnées dans les créneaux disponibles selon l'énergie)
   - **Alertes & Points d'Attention** (Urgences réelles ou points de vigilance)
   - **Conseil d'Énergie & Rythme** (Un conseil pratique pour optimiser la journée sans stress)
3. **Format des Tâches Recommandées** :
${taskSyntaxDesc}
4. **Actions Exécutables (Bloc JSON \`\`\`json:actions)** :
Si des actions concrètes sont proposées, inclus le bloc JSON \`\`\`json:actions afin que l'utilisateur puisse les approuver en 1 clic.`;

			userMessage = `Voici l'état actuel de mon coffre pour ce ${data.formattedDate} :

Niveau d'énergie : ${data.energy}/10 (${data.modeText})
Dossiers disponibles : ${foldersText}
Projets actifs : ${(data.projects && data.projects.join(', ')) || 'Aucun'}
Contacts récents : ${(data.contacts && data.contacts.join(', ')) || 'Aucun'}
${focusProjectText}
${calendarSectionText}
TACHES PLANIFIEES POUR AUJOURD'HUI :
${todayText}

TACHES PRIORITAIRES (Q1 / Q2) :
${priorityText}

TACHES EN RETARD (${data.overdueTasks.length} détectées) :
${overdueText}

TACHES EN BOITE DE RECEPTION / NOTES EN VRAC (${data.inboxTasks.length} détectées) :
${inboxText}

NOTES EN VRAC :
${looseNotesText}
${dailyNoteSnippet}
Propose-moi mon briefing et mon plan d'action optimisé pour aujourd'hui avec le bloc json:actions pour les actions proposées. N'utilise aucun émoji dans ta réponse textuelle (sauf si la syntaxe des tâches configurée l'exige).`;
		}

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userMessage }
		];
	}

	/**
	 * Extrait les propositions d'actions JSON retournées par l'IA et les valide.
	 */
	public static extractProposalsFromResponse(
		responseText: string,
		vaultTasks: ObsidianTask[] = [],
		todayStr?: string
	): { cleanText: string; proposals: ActionProposal[] } {
		const jsonMatch = responseText.match(/```(?:json:actions|actions|json)\s*([\s\S]*?)```/);

		if (!jsonMatch) {
			return {
				cleanText: responseText.trim(),
				proposals: []
			};
		}

		const cleanText = responseText.replace(jsonMatch[0], '').trim();

		try {
			const parsed = JSON.parse(jsonMatch[1].trim());
			if (Array.isArray(parsed) && parsed.length > 0) {
				const validatedProposals: ActionProposal[] = parsed
					.filter(p => p && typeof p === 'object' && p.type)
					.map((p, index) => {
						const rawTarget = p.targetPath || (p.folder ? `${p.folder}/${p.fileName || 'Note'}` : p.fileName) || p.description || 'Note';
						const targetPath = String(rawTarget).replace(/[\r\n]+/g, ' ').trim();
						const lineNum = Number(p.lineNumber || 1);

						const matchedTask = vaultTasks.find(vt => vt.filePath === targetPath && vt.lineNumber === lineNum)
							|| vaultTasks.find(vt => vt.filePath === targetPath);

						const taskTitle = p.taskTitle || matchedTask?.title || p.description || 'Tâche';
						const prop: ActionProposal = {
							...p,
							id: p.id || `briefing-ai-${index}-${Date.now()}`,
							type: p.type,
							targetPath,
							lineNumber: lineNum,
							taskTitle,
							description: p.description || p.reason || taskTitle,
							selected: true
						};

						return TaskSafetyGuard.sanitizeProposal(prop, matchedTask, todayStr);
					});

				return {
					cleanText,
					proposals: validatedProposals
				};
			}
		} catch (err) {
			console.warn('[Second Brain Manager] Erreur de parsing des actions JSON du briefing:', err);
		}

		return {
			cleanText,
			proposals: []
		};
	}

	/**
	 * Exécute la génération du briefing en streaming.
	 */
	public static async generateBriefing(
		app: App,
		plugin: SecondBrainPlugin,
		signal?: AbortSignal,
		onChunk?: (chunk: string, fullText: string) => void,
		focusProject?: string
	): Promise<{ text: string; data: BriefingVaultData; allTasks: ObsidianTask[] }> {
		const data = await this.collectBriefingData(app, plugin, focusProject);
		const messages = this.buildBriefingMessages(data, plugin.settings);

		const apiKey = await plugin.getSecretApiKey(plugin.settings.llmProvider);
		const config: LLMConfig = {
			provider: plugin.settings.llmProvider,
			endpoint: plugin.settings.llmEndpoint,
			model: plugin.settings.llmModel,
			productId: plugin.settings.infomaniakProductId,
			apiKey,
			signal: signal || new AbortController().signal
		};

		let generatedText = '';
		await LLMService.generateStreamingResponse(
			messages,
			config,
			(chunk, full) => {
				generatedText = full;
				onChunk(chunk, full);
			}
		);

		const allTasks = [
			...data.overdueTasks,
			...data.todayTasks,
			...data.priorityTasks,
			...data.inboxTasks,
			...data.projectTasks
		];

		return {
			text: generatedText,
			data,
			allTasks
		};
	}

	/**
	 * Enregistre ou met à jour la section Briefing du matin dans la Daily Note du jour.
	 */
	public static async saveBriefingToDailyNote(
		app: App,
		plugin: SecondBrainPlugin,
		briefingText: string,
		dateStr: string
	): Promise<string> {
		const vaultContext = new VaultContextService(app, plugin.settings);
		const dailyRes = await vaultContext.getOrCreateDailyNote(dateStr, plugin.settings.dailyNoteTemplatePath);
		const filePath = dailyRes.path;

		const cleanText = DailyNoteFormatter.formatForDailyNote(briefingText);
		const sectionHeader = '## 🌅 Briefing & Focus du Jour';
		const sectionContent = `${sectionHeader}\n\n*Généré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (Énergie : ${plugin.settings.energyLevel}/10)*\n\n${cleanText}\n`;

		const existingFile = app.vault.getFileByPath(filePath) || app.vault.getAbstractFileByPath(filePath);

		if (existingFile instanceof TFile) {
			await app.vault.process(existingFile, (content) => {
				if (content.includes(sectionHeader)) {
					// Remplacement de la section existante
					const regex = new RegExp(`## 🌅 Briefing & Focus du Jour[\\s\\S]*?(?=\\n## |$)`, 'g');
					return content.replace(regex, sectionContent.trim());
				} else {
					// Ajout en haut ou en fin de document
					return `${content.trim()}\n\n${sectionContent.trim()}\n`;
				}
			});
			return filePath;
		} else {
			const initialContent = `---\ndate: ${dateStr}\ntags: [journal, daily-note]\n---\n\n# Journal du ${dateStr}\n\n${sectionContent}\n## 📝 Notes & Pensées\n\n`;
			await app.vault.create(filePath, initialContent);
		}

		if (plugin?.pluginData && typeof plugin.savePluginData === 'function') {
			const newlyUnlocked = GamificationService.recordWorkflowEvent(plugin.pluginData, 'morning_briefing');
			await plugin.savePluginData();
			if (newlyUnlocked && newlyUnlocked.length > 0) {
				for (const b of newlyUnlocked) {
					new Notice(`🏆 NOUVEAU BADGE DÉBLOQUÉ : ${b.name} !\n${b.description}`, 7000);
				}
			}
		}

		return filePath;
	}

	/**
	 * Planifie pour aujourd'hui (date due ou start) les tâches sélectionnées du briefing dans leurs notes sources.
	 */
	public static async planTasksForToday(
		app: App,
		plugin: SecondBrainPlugin,
		tasks: ObsidianTask[],
		dateStr: string
	): Promise<number> {
		let updatedCount = 0;
		const tasksByFile = new Map<string, ObsidianTask[]>();

		for (const task of tasks) {
			if (!task.dueDate || task.dueDate < dateStr) {
				const list = tasksByFile.get(task.filePath) || [];
				list.push(task);
				tasksByFile.set(task.filePath, list);
			}
		}

		for (const [filePath, fileTasks] of tasksByFile.entries()) {
			const normPath = normalizePath(filePath);
			const file = app.vault.getFileByPath(normPath) || app.vault.getAbstractFileByPath(normPath);
			if (!(file instanceof TFile)) continue;

			await app.vault.process(file, (content) => {
				const lines = content.split('\n');
				for (const t of fileTasks) {
					const idx = t.lineNumber - 1;
					if (lines[idx] !== undefined) {
						lines[idx] = TaskMutator.setDueDate(lines[idx], dateStr, plugin.settings);
						updatedCount++;
					}
				}
				return lines.join('\n');
			});
		}

		return updatedCount;
	}
}
