import { describe, it, expect } from 'vitest';
import { TaskMutator } from '../../src/mutators/taskMutator';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';

describe('TaskMutator', () => {
	it('should mark task as completed with completion date before blockId', () => {
		const line = '- [ ] Acheter du pain 📅 2026-08-07 ^task-pain';
		const updated = TaskMutator.setCompleted(line, true, '2026-08-07', DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [x] Acheter du pain 📅 2026-08-07 ✅ 2026-08-07 ^task-pain');
	});

	it('should update due date with wikilinks when configured', () => {
		const config = {
			...DEFAULT_SYNTAX_CONFIG,
			useWikilinks: true
		};

		const line = '- [ ] Réparer le vélo 📅 2026-08-01';
		const updated = TaskMutator.setDueDate(line, '2026-08-15', config);

		expect(updated).toBe('- [ ] Réparer le vélo 📅 [[2026-08-15]]');
	});

	it('should update controlled tags preserving blockId anchor', () => {
		const line = '- [ ] Ecrire un chapitre #energie/2 ^chapitre-1';
		const updated = TaskMutator.setControlledTag(line, 'energie', 8, DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [ ] Ecrire un chapitre #energie/8 ^chapitre-1');
	});
});
