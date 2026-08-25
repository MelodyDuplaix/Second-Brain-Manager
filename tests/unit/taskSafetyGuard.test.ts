import { describe, it, expect } from 'vitest';
import { TaskSafetyGuard } from '../../src/services/taskSafetyGuard';
import { UpdateTaskActionProposal } from '../../src/models/actions';
import { ObsidianTask } from '../../src/models/task';

describe('TaskSafetyGuard', () => {
	describe('isExplicitlyCritical', () => {
		it('should detect tasks in Quadrant 1 (Q1 / Focus)', () => {
			expect(TaskSafetyGuard.isExplicitlyCritical({ matrixTag: '#tm/q1' })).toBe(true);
			expect(TaskSafetyGuard.isExplicitlyCritical({ matrixTag: '#focus' })).toBe(true);
		});

		it('should detect tasks with highest or high priority', () => {
			expect(TaskSafetyGuard.isExplicitlyCritical({ priority: 'highest' })).toBe(true);
			expect(TaskSafetyGuard.isExplicitlyCritical({ priority: 'high' })).toBe(true);
		});

		it('should detect explicit critical tags', () => {
			expect(TaskSafetyGuard.isExplicitlyCritical({ domainTags: ['#critique'] })).toBe(true);
			expect(TaskSafetyGuard.isExplicitlyCritical({ domainTags: ['#vital'] })).toBe(true);
			expect(TaskSafetyGuard.isExplicitlyCritical({ domainTags: ['#urgent'] })).toBe(true);
		});

		it('should return false for regular non-critical tasks', () => {
			expect(TaskSafetyGuard.isExplicitlyCritical({ matrixTag: '#tm/q2', priority: 'normal' })).toBe(false);
			expect(TaskSafetyGuard.isExplicitlyCritical({ matrixTag: '#tm/q4', domainTags: ['#lecture'] })).toBe(false);
		});
	});

	describe('sanitizeProposal', () => {
		it('should prevent removing due date on an explicitly Q1 task and force safe postponement', () => {
			const mockTask: ObsidianTask = {
				title: 'Payer le loyer',
				completed: false,
				status: 'todo',
				lineNumber: 10,
				filePath: '02 - Domaines/Finances.md',
				rawLine: '- [ ] Payer le loyer 📅 2026-08-01 #tm/q1',
				indentLevel: 0,
				dueDate: '2026-08-01',
				matrixTag: '#tm/q1'
			};

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

			const sanitized = TaskSafetyGuard.sanitizeProposal(proposal, mockTask, '2026-08-25') as UpdateTaskActionProposal;

			expect(sanitized.newDueDate).toBe('2026-08-25');
			expect(sanitized.newMatrixQuadrant).toBe('q1');
			expect(sanitized.description).toContain('⚠️');
		});

		it('should prevent cancelling an explicitly Q1 task and convert it to a safe postponement', () => {
			const mockTask: ObsidianTask = {
				title: 'Urgence client',
				completed: false,
				status: 'todo',
				lineNumber: 5,
				filePath: '01 - Projets/Client.md',
				rawLine: '- [ ] Urgence client 📅 2026-08-01 #tm/q1',
				indentLevel: 0,
				dueDate: '2026-08-01',
				matrixTag: '#tm/q1'
			};

			const proposal: UpdateTaskActionProposal = {
				id: 'prop-2',
				type: 'update_task',
				targetPath: '01 - Projets/Client.md',
				lineNumber: 5,
				taskTitle: 'Urgence client',
				description: 'Annuler car tâche dépassée',
				selected: true,
				newStatus: 'cancelled'
			};

			const sanitized = TaskSafetyGuard.sanitizeProposal(proposal, mockTask, '2026-08-25') as UpdateTaskActionProposal;

			expect(sanitized.newStatus).toBeUndefined(); // Annulation bloquée
			expect(sanitized.newDueDate).toBe('2026-08-25');
			expect(sanitized.newMatrixQuadrant).toBe('q1');
			expect(sanitized.description).toContain('⚠️');
		});
	});
});
