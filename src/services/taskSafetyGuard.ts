import { ObsidianTask } from '../models/task';
import { ActionProposal, UpdateTaskActionProposal } from '../models/actions';

export class TaskSafetyGuard {
	/**
	 * Mots-clés indiquant une tâche critique (finance, légal, administratif, santé, urgence vitale).
	 */
	private static readonly CRITICAL_KEYWORDS = [
		// Finance & Factures
		'loyer', 'facture', 'impôt', 'impot', 'taxe', 'crédit', 'credit', 'virement',
		'salaire', 'remboursement', 'banque', 'prélèvement', 'prelevement', 'urssaf',
		'cotisation', 'tva', 'déclaration', 'declaration', 'edf', 'eau', 'electricite',
		// Légal & Administratif
		'contrat', 'résiliation', 'resiliation', 'bail', 'assurance', 'passeport',
		'carte d\'identité', 'carte identite', 'visa', 'juridique', 'tribunal',
		'amende', 'notaire', 'carte grise', 'permis', 'préfecture', 'prefecture',
		// Santé & Médical
		'médecin', 'medecin', 'docteur', 'ordonnance', 'médicament', 'medicament',
		'dentiste', 'hôpital', 'hopital', 'analyse', 'rdv médical', 'rdv medical',
		'chirurgien', 'ophtalmo', 'pharmacie', 'mutuelle',
		// Délais stricts
		'deadline', 'date limite', 'critique', 'vital', 'urgentissime'
	];

	private static readonly CRITICAL_TAGS = [
		'#critique', '#finance', '#legal', '#sante', '#important', '#loyer', '#admin', '#vital', '#urgent'
	];

	/**
	 * Détermine si une tâche est critique et incompressible (ne doit jamais être délestée ni annulée par erreur).
	 */
	public static isCriticalTask(task: { title: string; domainTags?: string[]; matrixTag?: string }): boolean {
		const lowerTitle = task.title.toLowerCase();

		// Vérification par mots-clés
		const hasKeyword = this.CRITICAL_KEYWORDS.some(kw => {
			const regex = new RegExp(`\\b${kw}\\b`, 'i');
			return regex.test(lowerTitle);
		});

		if (hasKeyword) return true;

		// Vérification par tags
		if (task.domainTags && task.domainTags.some(t => this.CRITICAL_TAGS.includes(t.toLowerCase()))) {
			return true;
		}

		if (task.matrixTag && (task.matrixTag.toLowerCase().includes('#critique') || task.matrixTag.toLowerCase().includes('#vital'))) {
			return true;
		}

		return false;
	}

	/**
	 * Sécurise une proposition d'action pour empêcher le délestage ou l'annulation involontaire d'une tâche critique.
	 */
	public static sanitizeProposal(proposal: ActionProposal, task?: ObsidianTask, todayStr?: string): ActionProposal {
		if (proposal.type !== 'update_task') {
			return proposal;
		}

		const upProp = proposal as UpdateTaskActionProposal;
		const today = todayStr || new Date().toISOString().split('T')[0];
		const title = upProp.taskTitle || upProp.diff?.taskTitle || task?.title || upProp.description;

		const isCritical = this.isCriticalTask({
			title,
			domainTags: task?.domainTags,
			matrixTag: task?.matrixTag
		});

		if (isCritical) {
			// Si la proposition tentait d'annuler ou de retirer l'échéance d'une tâche critique
			if (upProp.newStatus === 'cancelled' || upProp.newDueDate === null || upProp.newMatrixQuadrant === 'q4') {
				upProp.newStatus = undefined; // Ne pas annuler
				upProp.newDueDate = today; // Reporter impérativement à aujourd'hui
				upProp.newMatrixQuadrant = 'q1'; // Rehausser en Q1
				upProp.newPriority = 'highest';
				upProp.description = `🚨 Tâche critique financière/légale/santé : report prioritaire en Q1 à aujourd'hui (${today}) sans délestage`;
				
				if (upProp.diff) {
					upProp.diff.newDueDate = today;
					upProp.diff.newQuadrant = 'q1';
					upProp.diff.newPriority = 'highest';
					upProp.diff.newStatus = undefined;
					upProp.diff.reason = '🚨 Tâche critique (finance/légal/santé) : interdiction de supprimer l\'échéance ou d\'annuler. Rehaussée en Q1 prioritaire pour aujourd\'hui.';
				}
				upProp.reason = upProp.diff?.reason;
			}
		}

		return upProp;
	}
}
