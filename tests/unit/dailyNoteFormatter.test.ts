import { describe, it, expect } from 'vitest';
import { DailyNoteFormatter } from '../../src/services/dailyNoteFormatter';

describe('DailyNoteFormatter', () => {
	it('should convert standard task lines into bullet references to prevent task duplication', () => {
		const rawBriefing = `Voici votre plan du jour :
- [ ] Rédiger le rapport financier 📅 2026-08-25 #tm/q1 [[Rapport]]
- [ ] Faire les courses 📅 2026-08-25 [[Maison]]
- [x] Tâche déjà faite [[Projet]]
- [-] Tâche annulée [[Archive]]
- [/] Tâche en cours [[Travail]]

Passez une excellente journée !`;

		const formatted = DailyNoteFormatter.formatForDailyNote(rawBriefing);

		// Ne doit plus contenir de syntaxe de tâche Obsidian Tasks (- [ ])
		expect(formatted).not.toMatch(/^[-*+]\s+\[[ xX/-><~]\]/m);

		// Doit contenir des puces de référence
		expect(formatted).toContain('* 📌 Rédiger le rapport financier 📅 2026-08-25 #tm/q1 [[Rapport]]');
		expect(formatted).toContain('* 📌 Faire les courses 📅 2026-08-25 [[Maison]]');
		expect(formatted).toContain('* ✅ Tâche déjà faite [[Projet]]');
		expect(formatted).toContain('* 🚫 Tâche annulée [[Archive]]');
		expect(formatted).toContain('* ⏳ Tâche en cours [[Travail]]');
		expect(formatted).toContain('Passez une excellente journée !');
	});

	it('should convert tasks with blockId into direct block embeds', () => {
		const rawText = `- [ ] Payer le loyer 📅 2026-08-25 [[Finances]] ^rent-task-123`;

		const formatted = DailyNoteFormatter.formatForDailyNote(rawText);

		expect(formatted).toBe('![[Finances#^rent-task-123]]');
	});
});
