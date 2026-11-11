import { ObsidianTask } from '../models/task';
import { CompletionEvent } from '../models/gamification';
import { DelegationFeature } from '../models/delegation';
import { MatrixFeature } from '../adapters/matrixAdapter';
import { ActionProposal } from '../models/actions';
import { CalendarDate } from './taskCalendarService';

/* ==========================================================================
   Briques communes aux briefings (matin, soir, reprise) :
   rythme réel de l'utilisateur, conventions du coffre, règles de style,
   politique d'actions (aucune création forcée) et continuité entre les briefings.
   ========================================================================== */

export const MORNING_SECTION_HEADER = '## 🌅 Briefing & Focus du Jour';
export const EVENING_SECTION_HEADER = '## 🌙 Revue du Soir & Bilan';
export const RECOVERY_SECTION_PREFIX = '## 🧹';

/** Date du jour au format AAAA-MM-JJ, en heure locale (toISOString donnerait la veille après minuit en France). */
export function localDateStr(d: Date = new Date()): string {
	return CalendarDate.toISO(d);
}

/* ----- Rythme réel de l'utilisateur (historique des tâches terminées) ----- */

export interface UserRhythm {
	windowDays: number;
	/** Jours avec au moins une tâche terminée */
	activeDays: number;
	totalCompleted: number;
	/** Moyenne des tâches terminées par jour actif */
	avgPerActiveDay: number;
	completedYesterday: number;
	completedToday: number;
	/** Moment de la journée où l'utilisateur termine le plus de tâches (si net) */
	peakMoment?: 'le matin' | 'l’après-midi' | 'le soir';
	/** Tags les plus fréquents dans les tâches terminées */
	favoriteTags: string[];
}

export function computeUserRhythm(
	events: Record<string, CompletionEvent> | undefined,
	today: string,
	windowDays = 14
): UserRhythm | null {
	if (!events) return null;
	const since = CalendarDate.addDays(today, -windowDays);
	const yesterday = CalendarDate.addDays(today, -1);
	const perDay = new Map<string, number>();
	const moments = { matin: 0, aprem: 0, soir: 0 };
	const tags = new Map<string, number>();
	let total = 0;
	let completedToday = 0;

	for (const ev of Object.values(events)) {
		if (!ev?.completedAt) continue;
		const at = new Date(ev.completedAt);
		if (isNaN(at.getTime())) continue;
		const day = localDateStr(at);
		if (day === today) completedToday++;
		if (day < since || day >= today) continue;
		total++;
		perDay.set(day, (perDay.get(day) || 0) + 1);
		const h = at.getHours();
		if (h < 12) moments.matin++;
		else if (h < 18) moments.aprem++;
		else moments.soir++;
		for (const t of ev.categoryTags || []) {
			const tag = t.toLowerCase();
			tags.set(tag, (tags.get(tag) || 0) + 1);
		}
	}

	if (total === 0 && completedToday === 0) return null;

	let peakMoment: UserRhythm['peakMoment'];
	if (total >= 6) {
		const entries: Array<[UserRhythm['peakMoment'], number]> = [['le matin', moments.matin], ['l’après-midi', moments.aprem], ['le soir', moments.soir]];
		const [best, count] = entries.sort((a, b) => b[1] - a[1])[0];
		if (count / total >= 0.5) peakMoment = best;
	}

	const activeDays = perDay.size;
	return {
		windowDays,
		activeDays,
		totalCompleted: total,
		avgPerActiveDay: activeDays ? total / activeDays : 0,
		completedYesterday: perDay.get(yesterday) || 0,
		completedToday,
		peakMoment,
		favoriteTags: [...tags.entries()]
			.filter(([tag]) => !/^#?(tm\/|q[1-4]$|energie|energy|pieces|priorite|priority)/.test(tag))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4)
			.map(([tag]) => (tag.startsWith('#') ? tag : `#${tag}`))
	};
}

/**
 * Nombre de tâches qu'il est réaliste de proposer aujourd'hui : rythme observé ajusté à l'énergie.
 * Sans historique : 2 (énergie basse), 3 (moyenne), 5 (haute).
 */
export function suggestedTaskCount(rhythm: UserRhythm | null, energy: number): number {
	const factor = energy <= 3 ? 0.6 : energy <= 7 ? 1 : 1.25;
	if (!rhythm || rhythm.activeDays < 3) return energy <= 3 ? 2 : energy <= 7 ? 3 : 5;
	return Math.max(1, Math.min(8, Math.round(rhythm.avgPerActiveDay * factor)));
}

/** Description du rythme pour le prompt (vide sans historique exploitable). */
export function describeRhythm(rhythm: UserRhythm | null, energy: number): string {
	const capacity = suggestedTaskCount(rhythm, energy);
	const lines: string[] = [];
	if (rhythm && rhythm.activeDays >= 3) {
		const avg = rhythm.avgPerActiveDay.toFixed(1).replace('.', ',').replace(',0', '');
		lines.push(`- Rythme observé sur ${rhythm.windowDays} jours : ${avg} tâche(s) terminée(s) en moyenne les jours actifs (${rhythm.activeDays} jour(s) actif(s)).`);
		lines.push(`- Hier : ${rhythm.completedYesterday} tâche(s) terminée(s).`);
		if (rhythm.peakMoment) lines.push(`- L'utilisateur avance surtout ${rhythm.peakMoment} : place-y ce qui demande le plus de concentration.`);
		if (rhythm.favoriteTags.length) lines.push(`- Thèmes les plus souvent traités : ${rhythm.favoriteTags.join(', ')}.`);
	} else {
		lines.push('- Pas encore assez d’historique pour connaître le rythme habituel : reste prudent sur le volume.');
	}
	lines.push(`- Volume réaliste pour aujourd'hui (rythme × énergie ${energy}/10) : environ ${capacity} tâche(s) à mettre en avant, pas davantage.`);
	return lines.join('\n');
}

/* ----- Conventions du coffre et fonctionnalités actives ----- */

export interface VaultConventions {
	inboxFolder?: string;
	dailyNotePath?: string;
	projects?: string[];
	contacts?: string[];
	googleConnected: boolean;
	gamificationEnabled: boolean;
	matrixEnabled?: boolean;
}

export function describeVaultConventions(c: VaultConventions): string {
	const lines: string[] = [];
	if (c.inboxFolder) lines.push(`- Boîte de réception : « ${c.inboxFolder} ».`);
	if (c.dailyNotePath) lines.push(`- Note quotidienne du jour : « ${c.dailyNotePath} ».`);
	if (c.projects?.length) lines.push(`- Projets (${c.projects.length}) : ${c.projects.slice(0, 15).map(p => `[[${p}]]`).join(', ')}${c.projects.length > 15 ? '…' : ''}`);
	if (c.contacts?.length) lines.push(`- Contacts (${c.contacts.length}) : ${c.contacts.slice(0, 20).map(p => `[[${p}]]`).join(', ')}${c.contacts.length > 20 ? '…' : ''}`);
	const matrixOn = c.matrixEnabled ?? MatrixFeature.isEnabled();
	lines.push(matrixOn
		? '- La matrice d’Eisenhower (quadrants Q1 à Q4) est utilisée.'
		: '- Les quadrants d’Eisenhower ne sont PAS utilisés : n’en parle pas, raisonne en priorités et échéances.');
	if (!c.googleConnected) lines.push('- Aucun agenda n’est connecté : ne parle pas de rendez-vous ni de créneaux d’agenda.');
	if (!c.gamificationEnabled) lines.push('- La gamification est désactivée : ne mentionne ni pièces, ni récompenses, ni séries.');
	if (DelegationFeature.isEnabled()) {
		const t = DelegationFeature.getToken();
		const mode = DelegationFeature.getMode();
		if (mode === 'assignee') {
			lines.push(`- « ${t}Nom » dans une tâche l'attribue à cette personne. Les tâches attribuées à d'autres ne te sont pas fournies : celles que tu vois sont celles de l'utilisateur. Ne propose jamais de lui attribuer une tâche d'un autre, ni d'ajouter toi-même une mention ${t}.`);
		} else if (mode === 'from') {
			lines.push(`- Une tâche contenant « ${t}Nom » (ou ${t}[[Nom]]) a été donnée par cette personne : c'est un engagement envers elle.`);
		} else {
			lines.push(`- « ${t}Nom » dans une tâche indique une personne concernée (à contacter, à prévenir…) : simple contexte, la tâche reste celle de l'utilisateur.`);
		}
	}
	return lines.join('\n');
}

/* ----- Style et politique d'actions communs ----- */

export function sharedStyleGuidelines(): string {
	return `STYLE :
- Ton de copilote de confiance : chaleureux, direct et mature. Ni infantilisant, ni moralisateur, ni robotique.
- Écris un texte fluide et naturel, comme une personne qui connaît bien l'utilisateur, pas une suite de rubriques administratives. Pas de formules creuses ni de répétitions d'une section à l'autre.
- Proportionnalité : la longueur suit le volume réel. Journée calme = quelques lignes. N'écris JAMAIS de section vide ou de remplissage (« Aucun rendez-vous », « Rien à signaler ») : omets-la simplement.
- Cohérence : ne cite que des tâches, notes et rendez-vous présents dans les données fournies. N'invente ni échéance, ni engagement, ni contexte.
- Aucun émoji dans le texte (sauf métadonnées imposées par le format de tâche configuré).
- Notes, projets et personnes en wikilinks directs [[Nom]], jamais entre backticks.
- Tu peux utiliser des titres courts (###) pour aérer, mais garde une progression logique d'un bloc à l'autre.`;
}

/**
 * Politique d'actions : le bloc json:actions est facultatif, les créations sont l'exception.
 * `allowed` liste les types autorisés dans ce briefing.
 */
export function actionPolicy(opts: { dailyTargetPath: string; allowed: string[]; example?: string; userRequestedTasks?: boolean }): string {
	const createAllowed = opts.allowed.includes('create_task');
	const lines = [
		`ACTIONS PROPOSÉES (bloc \`\`\`json:actions — FACULTATIF) :`,
		`- N'ajoute ce bloc que si des modifications concrètes apportent une vraie valeur aujourd'hui. Si rien ne doit changer, n'en mets pas : c'est une réponse parfaitement valable.`,
		`- Types autorisés : ${opts.allowed.map(t => `"${t}"`).join(', ')}. Utilise les chemins exacts et numéros de ligne fournis.`,
		`- Préfère toujours ajuster l'existant (update_task : date, statut, priorité) plutôt que créer.`
	];
	if (createAllowed) {
		lines.push(
			`- "create_task" est l'exception : uniquement pour une action nouvelle, concrète, qui n'existe nulle part dans le coffre${opts.userRequestedTasks ? ' ou que l\'utilisateur a demandée' : ''} (ex. un engagement noté dans une note en vrac sans case à cocher).`,
			`- Ne crée JAMAIS de tâche pour : un rendez-vous d'agenda (l'import des rendez-vous est un bouton séparé), une tâche déjà listée, le contenu de la note quotidienne, un conseil général (pause, hydratation, « bien commencer la journée »), ou une simple reformulation d'une tâche existante.`,
			`- Une tâche créée va dans "${opts.dailyTargetPath}" sauf si un autre fichier du coffre est clairement plus pertinent.`
		);
	}
	lines.push(`Champs par type :\n${actionFieldsReference(opts.allowed)}`);
	if (opts.example) lines.push(`Exemple de format (à adapter, pas à recopier) :\n${opts.example}`);
	return lines.join('\n');
}

/** Rappel compact des champs attendus pour chaque type d'action autorisé. */
export function actionFieldsReference(allowed: string[]): string {
	const matrixOn = MatrixFeature.isEnabled();
	const ref: Record<string, string> = {
		update_task: `- update_task : targetPath, lineNumber, taskTitle, puis au moins un de newDueDate (AAAA-MM-JJ, ou null pour retirer l'échéance), newStartDate, newStatus ("cancelled" ou "done"), newPriority${matrixOn ? ', newMatrixQuadrant ("q1" à "q4")' : ''} ; et reason (une phrase).`,
		move_note: '- move_note : targetPath, destinationFolder (dossier existant), newFileName (facultatif), description.',
		rename_note: '- rename_note : targetPath, newFileName, description.',
		create_task: '- create_task : targetPath, taskTitle, dueDate ou scheduledDate (facultatifs), priority (facultatif), domainTags (facultatif), description.'
	};
	return allowed.map(t => ref[t]).filter(Boolean).join('\n');
}

/* ----- Personnes dans les tâches ----- */

/**
 * Section des tâches qui mentionnent quelqu'un, regroupée par personne (modes « donnée par » et « contexte » ;
 * en mode « attribuée », les tâches des autres sont déjà écartées : pas de section).
 * Les noms sont reliés aux notes de contact quand elles existent.
 */
export function buildDelegatedSection(
	tasks: ObsidianTask[],
	contacts: string[],
	formatTaskLine: (t: ObsidianTask) => string,
	limit = 15
): { section: string; directive: string; count: number } {
	const mode = DelegationFeature.getMode();
	if (!DelegationFeature.isEnabled() || mode === 'assignee') return { section: '', directive: '', count: 0 };
	const delegated = tasks.filter(t => t.person);
	if (!delegated.length) return { section: '', directive: '', count: 0 };
	const groups = DelegationFeature.groupByPerson(delegated, t => t.person);
	let shown = 0;
	const blocks: string[] = [];
	for (const g of groups) {
		if (shown >= limit) break;
		const person = DelegationFeature.resolvePerson(g.name, contacts);
		const items = g.items.slice(0, Math.max(1, limit - shown));
		shown += items.length;
		blocks.push(`- ${mode === 'from' ? 'Données par' : 'Liées à'} [[${person}]] (${g.items.length}) :\n${items.map(t => `  ${formatTaskLine(t)}`).join('\n')}`);
	}
	if (mode === 'from') {
		return {
			count: delegated.length,
			section: `\nTÂCHES DONNÉES PAR D'AUTRES PERSONNES (${delegated.length}, engagements envers elles) :\n${blocks.join('\n')}\n`,
			directive: `\n- **Tâches données par d'autres** : ce sont des engagements envers quelqu'un. Signale celles qui arrivent à échéance ou sont en retard, et suggère, si c'est utile, de prévenir la personne ([[Nom]]) ou de lui demander un délai. Ne les annule pas et ne les reporte pas sans le dire explicitement.`
		};
	}
	return {
		count: delegated.length,
		section: `\nTÂCHES LIÉES À DES PERSONNES (${delegated.length}) :\n${blocks.join('\n')}\n`,
		directive: `\n- **Personnes concernées** : quand une tâche citée mentionne quelqu'un, nomme-le ([[Nom]]) s'il faut le contacter ou le prévenir, sans en faire une rubrique à part.`
	};
}

/* ----- Continuité entre briefings (notes quotidiennes) ----- */

/** Contenu d'une section « ## … » d'une note (sans son titre), ou undefined. */
export function extractDailySection(content: string | undefined, header: string): string | undefined {
	if (!content) return undefined;
	const idx = content.indexOf(header);
	if (idx === -1) return undefined;
	const after = content.slice(idx + header.length);
	const next = after.search(/\n## /);
	const body = (next === -1 ? after : after.slice(0, next)).trim();
	return body || undefined;
}

/** Note quotidienne sans les sections générées par les briefings (évite que l'IA se recopie). */
export function stripGeneratedSections(content: string | undefined): string | undefined {
	if (!content) return content;
	let out = content;
	for (const header of [MORNING_SECTION_HEADER, EVENING_SECTION_HEADER]) {
		const idx = out.indexOf(header);
		if (idx === -1) continue;
		const after = out.slice(idx + header.length);
		const next = after.search(/\n## /);
		out = out.slice(0, idx) + (next === -1 ? '' : after.slice(next + 1));
	}
	return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Raccourcit un texte à `max` caractères, en coupant proprement. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
	return `${cut.slice(0, lastBreak > max * 0.6 ? lastBreak + 1 : max).trim()}…`;
}

/* ----- Garde-fou sur les propositions de l'IA ----- */

const STOP_WORDS = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'a', 'à', 'au', 'aux', 'pour', 'dans', 'en', 'par', 'sur', 'et', 'ou', 'avec', 'mon', 'ma', 'mes']);

function titleWords(title: string): string[] {
	return title
		.toLowerCase()
		.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
		.replace(/#[\p{L}\p{N}_/-]+/gu, ' ')
		.replace(/\b\d{1,2}[:h]\d{2}\b/g, ' ')
		.normalize('NFD').replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.split(/\s+/)
		.filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

/** Deux intitulés désignent-ils la même chose ? (inclusion, ou ≥ 80 % de mots communs) */
export function sameIntent(a: string, b: string): boolean {
	const wa = titleWords(a);
	const wb = titleWords(b);
	if (!wa.length || !wb.length) return false;
	const ja = wa.join(' ');
	const jb = wb.join(' ');
	if (ja === jb || (ja.length >= 8 && jb.includes(ja)) || (jb.length >= 8 && ja.includes(jb))) return true;
	const setB = new Set(wb);
	const common = wa.filter(w => setB.has(w)).length;
	return common / Math.min(wa.length, wb.length) >= 0.8 && common >= 2;
}

/**
 * Filtre les propositions de l'IA : retire les créations qui doublonnent une tâche existante,
 * un rendez-vous d'agenda ou une autre création ; les créations restantes sont à cocher
 * par l'utilisateur (rien n'est créé sans son accord explicite).
 */
export function refineBriefingProposals(
	proposals: ActionProposal[],
	ctx: { existingTaskTitles: string[]; eventTitles?: string[] }
): ActionProposal[] {
	const kept: ActionProposal[] = [];
	const createdTitles: string[] = [];
	for (const p of proposals) {
		if (p.type !== 'create_task') {
			kept.push(p);
			continue;
		}
		const title = (p as { taskTitle?: string }).taskTitle || p.description || '';
		if (!title.trim()) continue;
		const duplicate = ctx.existingTaskTitles.some(t => sameIntent(title, t))
			|| (ctx.eventTitles || []).some(t => sameIntent(title, t))
			|| createdTitles.some(t => sameIntent(title, t));
		if (duplicate) continue;
		createdTitles.push(title);
		kept.push({ ...p, selected: false });
	}
	return kept;
}
