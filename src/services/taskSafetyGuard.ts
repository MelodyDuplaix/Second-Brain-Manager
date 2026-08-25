import { ObsidianTask } from '../models/task';
import { ActionProposal, UpdateTaskActionProposal } from '../models/actions';

export class TaskSafetyGuard {
	/**
	 * Détermine si une tâche est explicitement marquée comme prioritaire / critique
	 * via ses métadonnées utilisateur (Quadrant Q1, Priorité Haute/Highest, ou tag explicite).
	 */
	public static isExplicitlyCritical(task: { domainTags?: string[]; matrixTag?: string; priority?: string }): boolean {
		// Quadrant 1 (Urgent & Important)
		if (task.matrixTag && (task.matrixTag.includes('q1') || task.matrixTag.includes('focus'))) {
			return true;
		}

		// Priorité haute définie par l'utilisateur
		if (task.priority === 'highest' || task.priority === 'high') {
			return true;
		}

		// Tags explicites de criticité
		if (task.domainTags && task.domainTags.some(t => {
			const tag = t.toLowerCase();
			return tag === '#critique' || tag === '#important' || tag === '#urgent' || tag === '#vital';
		})) {
			return true;
		}

		return false;
	}

	/**
	 * Sécurise une proposition d'action : si une tâche est explicitement classée en Q1 / Priorité Haute par l'utilisateur,
	 * empêche sa suppression d'échéance ou son annulation involontaire.
	 */
	public static sanitizeProposal(proposal: ActionProposal, task?: ObsidianTask, todayStr?: string): ActionProposal {
		if (proposal.type !== 'update_task') {
			return proposal;
		}

		const upProp = proposal as UpdateTaskActionProposal;
		const today = todayStr || new Date().toISOString().split('T')[0];

		const isCritical = task ? this.isExplicitlyCritical(task) : false;

		if (isCritical) {
			// Si une tâche explicitement Q1/Haute priorité risquait d'être annulée ou privée d'échéance
			if (upProp.newStatus === 'cancelled' || upProp.newDueDate === null) {
				upProp.newStatus = undefined;
				upProp.newDueDate = today;
				upProp.newMatrixQuadrant = 'q1';
				upProp.description = `⚠️ Tâche prioritaire (Q1) : report sécurisé à aujourd'hui (${today})`;
				
				if (upProp.diff) {
					upProp.diff.newDueDate = today;
					upProp.diff.newQuadrant = 'q1';
					upProp.diff.newStatus = undefined;
					upProp.diff.reason = 'Tâche prioritaire Q1 : maintien de l\'échéance avec report sécurisé à aujourd\'hui.';
				}
				upProp.reason = upProp.diff?.reason;
			}
		}

		return upProp;
	}
}
