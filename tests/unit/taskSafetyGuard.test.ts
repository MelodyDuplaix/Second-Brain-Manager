import { describe, it, expect } from 'vitest';
import { TaskSafetyGuard } from '../../src/services/taskSafetyGuard';
import { UpdateTaskActionProposal } from '../../src/models/actions';

describe('TaskSafetyGuard', () => {
	describe('isCriticalTask', () => {
		it('should detect financial critical tasks like rent or bills', () => {
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Payer le loyer de septembre' })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Régler la facture EDF' })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Déclaration des impôts 2026' })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Paiement URSSAF' })).toBe(true);
		});

		it('should detect health and medical critical tasks', () => {
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Rendez-vous médecin spécialiste' })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Acheter médicament ordonnance à la pharmacie' })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'RDV dentiste contrôle' })).toBe(true);
		});

		it('should detect administrative and legal critical tasks', () => {
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Renouveler mon passeport en préfecture' })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Envoyer résiliation bail appartement' })).toBe(true);
		});

		it('should detect critical tags', () => {
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Projet X', domainTags: ['#critique'] })).toBe(true);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Document', domainTags: ['#finance'] })).toBe(true);
		});

		it('should return false for regular non-critical tasks', () => {
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Nettoyer le bureau' })).toBe(false);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Lire le livre sur TypeScript' })).toBe(false);
			expect(TaskSafetyGuard.isCriticalTask({ title: 'Arroser les plantes' })).toBe(false);
		});
	});

	describe('sanitizeProposal', () => {
		it('should prevent removing due date on a critical task and force postponement in Q1', () => {
			const proposal: UpdateTaskActionProposal = {
				id: 'prop-1',
				type: 'update_task',
				targetPath: '02 - Domaines/Finances.md',
				lineNumber: 10,
				taskTitle: 'Payer le loyer',
				description: 'Supprimer échéance pour délester',
				selected: true,
				newDueDate: null, // Tentative de retrait d'échéance
				newMatrixQuadrant: 'q4'
			};

			const sanitized = TaskSafetyGuard.sanitizeProposal(proposal, undefined, '2026-08-25') as UpdateTaskActionProposal;

			expect(sanitized.newDueDate).toBe('2026-08-25');
			expect(sanitized.newMatrixQuadrant).toBe('q1');
			expect(sanitized.newPriority).toBe('highest');
			expect(sanitized.description).toContain('🚨');
		});

		it('should prevent cancelling a critical task and convert it to a top-priority postponement', () => {
			const proposal: UpdateTaskActionProposal = {
				id: 'prop-2',
				type: 'update_task',
				targetPath: '02 - Domaines/Sante.md',
				lineNumber: 5,
				taskTitle: 'Prendre RDV médecin pour ordonnance',
				description: 'Annuler car tâche dépassée',
				selected: true,
				newStatus: 'cancelled'
			};

			const sanitized = TaskSafetyGuard.sanitizeProposal(proposal, undefined, '2026-08-25') as UpdateTaskActionProposal;

			expect(sanitized.newStatus).toBeUndefined(); // Annulation bloquée
			expect(sanitized.newDueDate).toBe('2026-08-25');
			expect(sanitized.newMatrixQuadrant).toBe('q1');
			expect(sanitized.description).toContain('🚨');
		});
	});
});
