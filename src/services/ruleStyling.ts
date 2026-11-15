/**
 * Application des règles d'affichage (couleurs et priorités des réglages) dans toutes les vues :
 * calendrier, tableau de bord, briefing du matin, revue du soir, chat.
 *
 * `displayRules` décide ; ce module traduit une tâche en « sujet » de règle et pose la couleur
 * sur un élément, pour que chaque vue le fasse de la même façon.
 */
import { ObsidianTask } from '../models/task';
import { extractTags } from './calendarFilters';
import { CalendarDateField, getTaskDate, isTaskOpen } from './taskCalendarService';
import { ColorRule, PriorityRule, RuleSubject, prioritize, ruleColor } from './displayRules';

/** Date du jour au format AAAA-MM-JJ, en heure locale. */
export function localToday(now: Date = new Date()): string {
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${m}-${d}`;
}

/** Ce qu'une règle sait d'une tâche. */
export function taskRuleSubject(task: ObsidianTask, dateField: CalendarDateField = 'due'): RuleSubject {
	return {
		kind: 'task',
		text: `${task.title} ${task.rawText}`,
		tags: [...(task.domainTags || []), ...extractTags(task.rawText)],
		date: getTaskDate(task, dateField),
		path: task.filePath,
		done: !isTaskOpen(task)
	};
}

/**
 * Pose la couleur d'une règle sur un élément : liseré (`--chip-accent`) et fond teinté
 * (`has-rule-color`, voir styles.css). Sans règle qui correspond, l'élément est laissé tel quel.
 */
export function applyRuleColorTo(el: HTMLElement, color: string | null): void {
	if (!color) return;
	el.style.setProperty('--chip-accent', color);
	// Les entrées de journal lisent aussi leur couleur dans cette variable
	el.style.setProperty('--sbm-entry-color', color);
	el.style.setProperty('--sbm-rule-color', color);
	el.addClass('has-rule-color');
}

/** Couleur d'une tâche selon les règles, posée sur sa carte. */
export function colorTaskCard(
	el: HTMLElement,
	task: ObsidianTask,
	rules: readonly ColorRule[] | undefined,
	dateField: CalendarDateField = 'due'
): void {
	applyRuleColorTo(el, ruleColor(rules, taskRuleSubject(task, dateField), localToday()));
}

/** Liste de tâches réordonnée selon les règles de priorité ; les tâches masquées sont retirées. */
export function prioritizeTasks(
	tasks: readonly ObsidianTask[],
	rules: readonly PriorityRule[] | undefined,
	dateField: CalendarDateField = 'due'
): ObsidianTask[] {
	return prioritize(tasks, t => taskRuleSubject(t, dateField), rules, localToday());
}
