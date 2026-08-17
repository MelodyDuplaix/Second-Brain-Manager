import { describe, it, expect } from 'vitest';
import { MatrixAdapterFactory, TaskMatrixAdapter, FocusFirstAdapter, CustomTagMatrixAdapter } from '../../src/adapters/matrixAdapter';
import { ObsidianTask } from '../../src/models/task';

describe('MatrixAdapter', () => {
	const createTask = (rawText: string, matrixTag?: string): ObsidianTask => ({
		rawText,
		cleanText: rawText,
		title: 'Test task',
		completed: false,
		statusChar: ' ',
		status: 'todo',
		filePath: 'test.md',
		lineNumber: 1,
		indentLevel: 0,
		matrixTag,
		subtasks: []
	});

	describe('TaskMatrixAdapter', () => {
		const adapter = new TaskMatrixAdapter();

		it('should identify quadrants from #tm/qN or #qN', () => {
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #tm/q1', '#tm/q1'))).toBe('q1');
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #tm/q2', '#tm/q2'))).toBe('q2');
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #tm/q3', '#tm/q3'))).toBe('q3');
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #tm/q4', '#tm/q4'))).toBe('q4');
			expect(adapter.getQuadrant(createTask('- [ ] Tâche sans matrice'))).toBeNull();
		});

		it('should set quadrant preserving blockId', () => {
			const line = '- [ ] Tâche importante ^task-1';
			const updated = adapter.setQuadrant(line, 'q1');
			expect(updated).toBe('- [ ] Tâche importante #tm/q1 ^task-1');
		});

		it('should clear quadrant when set to null', () => {
			const line = '- [ ] Tâche avec #tm/q2 ^task-1';
			const updated = adapter.setQuadrant(line, null);
			expect(updated).toBe('- [ ] Tâche avec ^task-1');
		});
	});

	describe('FocusFirstAdapter', () => {
		const adapter = new FocusFirstAdapter();

		it('should map #focus to q1 and #q2 to q2', () => {
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #focus'))).toBe('q1');
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #q2'))).toBe('q2');
		});

		it('should set #focus for q1 and #qN for other quadrants', () => {
			expect(adapter.setQuadrant('- [ ] Tâche', 'q1')).toBe('- [ ] Tâche #focus');
			expect(adapter.setQuadrant('- [ ] Tâche', 'q2')).toBe('- [ ] Tâche #q2');
		});
	});

	describe('CustomTagMatrixAdapter', () => {
		const adapter = new CustomTagMatrixAdapter({
			q1Tag: '#urgent-important',
			q2Tag: '#important-non-urgent',
			q3Tag: '#urgent-non-important',
			q4Tag: '#non-urgent-non-important'
		});

		it('should identify custom mapped tags', () => {
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #urgent-important'))).toBe('q1');
			expect(adapter.getQuadrant(createTask('- [ ] Tâche #important-non-urgent'))).toBe('q2');
		});

		it('should set custom mapped tags', () => {
			expect(adapter.setQuadrant('- [ ] Tâche', 'q1')).toBe('- [ ] Tâche #urgent-important');
		});
	});

	describe('MatrixAdapterFactory', () => {
		it('should instantiate appropriate adapter', () => {
			expect(MatrixAdapterFactory.createAdapter('task-matrix')).toBeInstanceOf(TaskMatrixAdapter);
			expect(MatrixAdapterFactory.createAdapter('focus-first')).toBeInstanceOf(FocusFirstAdapter);
			expect(MatrixAdapterFactory.createAdapter('custom')).toBeInstanceOf(CustomTagMatrixAdapter);
		});
	});
});
