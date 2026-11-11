import { describe, it, expect, afterEach } from 'vitest';
import {
	EVENING_SECTION_HEADER,
	MORNING_SECTION_HEADER,
	buildDelegatedSection,
	computeUserRhythm,
	describeRhythm,
	extractDailySection,
	refineBriefingProposals,
	sameIntent,
	stripGeneratedSections,
	suggestedTaskCount
} from '../../src/services/briefingContext';
import { DelegationFeature } from '../../src/models/delegation';
import { ActionProposal } from '../../src/models/actions';
import { ObsidianTask } from '../../src/models/task';
import { CompletionEvent } from '../../src/models/gamification';

const event = (completedAt: string, extra: Partial<CompletionEvent> = {}): CompletionEvent => ({
	taskId: completedAt,
	completedAt,
	coins: 1,
	taskText: 'x',
	...extra
});

describe('Rythme réel de l’utilisateur', () => {
	it('se tait sans historique', () => {
		expect(computeUserRhythm(undefined, '2026-11-11')).toBeNull();
		expect(computeUserRhythm({}, '2026-11-11')).toBeNull();
	});

	it('mesure les jours actifs, la moyenne, hier et le moment préféré', () => {
		const events: Record<string, CompletionEvent> = {};
		// 3 jours actifs : 2, 2 et 3 tâches, toutes le matin
		['2026-11-10T09:00:00', '2026-11-10T10:00:00', '2026-11-08T09:30:00', '2026-11-08T11:00:00',
			'2026-11-05T08:00:00', '2026-11-05T09:00:00', '2026-11-05T10:00:00'].forEach(d => { events[d] = event(d, { categoryTags: ['#maison'] }); });
		// Trop vieux : ignoré ; aujourd'hui : compté à part
		events.old = event('2026-10-01T09:00:00');
		events.today = event('2026-11-11T09:00:00');
		const r = computeUserRhythm(events, '2026-11-11');
		expect(r).not.toBeNull();
		expect(r!.activeDays).toBe(3);
		expect(r!.totalCompleted).toBe(7);
		expect(r!.avgPerActiveDay).toBeCloseTo(7 / 3);
		expect(r!.completedYesterday).toBe(2);
		expect(r!.completedToday).toBe(1);
		expect(r!.peakMoment).toBe('le matin');
		expect(r!.favoriteTags).toEqual(['#maison']);
	});

	it('adapte le volume proposé au rythme et à l’énergie, avec des bornes prudentes sans historique', () => {
		expect(suggestedTaskCount(null, 2)).toBe(2);
		expect(suggestedTaskCount(null, 5)).toBe(3);
		expect(suggestedTaskCount(null, 9)).toBe(5);
		const rhythm = { windowDays: 14, activeDays: 5, totalCompleted: 20, avgPerActiveDay: 4, completedYesterday: 3, completedToday: 0, favoriteTags: [] };
		expect(suggestedTaskCount(rhythm, 2)).toBe(2);
		expect(suggestedTaskCount(rhythm, 5)).toBe(4);
		expect(suggestedTaskCount(rhythm, 9)).toBe(5);
		expect(describeRhythm(rhythm, 5)).toContain('4 tâche(s) terminée(s) en moyenne');
		expect(describeRhythm(null, 5)).toContain('Pas encore assez d’historique');
	});
});

describe('Continuité entre les briefings', () => {
	const note = `---\ndate: 2026-11-11\n---\n# Journal\n\nMes notes libres.\n\n${MORNING_SECTION_HEADER}\n\n*Généré à 08:00*\n\nCap du jour : finir le rapport.\n\n## 📝 Notes & Pensées\n\nUne idée.\n\n${EVENING_SECTION_HEADER}\n\nBilan : rapport presque fini, à terminer demain matin.\n`;

	it('extrait la section d’un briefing précédent', () => {
		expect(extractDailySection(note, MORNING_SECTION_HEADER)).toContain('finir le rapport');
		expect(extractDailySection(note, MORNING_SECTION_HEADER)).not.toContain('Une idée');
		expect(extractDailySection(note, EVENING_SECTION_HEADER)).toContain('terminer demain matin');
		expect(extractDailySection(note, '## Absent')).toBeUndefined();
		expect(extractDailySection(undefined, MORNING_SECTION_HEADER)).toBeUndefined();
	});

	it('retire les sections générées de la note du jour pour ne pas les renvoyer à l’IA', () => {
		const stripped = stripGeneratedSections(note)!;
		expect(stripped).toContain('Mes notes libres.');
		expect(stripped).toContain('Une idée.');
		expect(stripped).not.toContain('Cap du jour');
		expect(stripped).not.toContain('Bilan : rapport');
	});
});

describe('Garde-fou sur les propositions de l’IA', () => {
	it('reconnaît deux intitulés qui désignent la même chose', () => {
		expect(sameIntent('Appeler [[Claire]] pour le devis', 'Appeler Claire pour le devis 📅 2026-11-12')).toBe(true);
		expect(sameIntent('09:00 Réunion lancement', 'Réunion Lancement')).toBe(true);
		expect(sameIntent('Payer la facture d’électricité', 'Relire le devis')).toBe(false);
	});

	it('écarte les créations qui doublonnent une tâche, un rendez-vous ou une autre création, et laisse le reste à cocher', () => {
		const proposals = [
			{ id: '1', type: 'update_task', targetPath: 'a.md', lineNumber: 2, description: 'Reporter', selected: true },
			{ id: '2', type: 'create_task', targetPath: 'd.md', taskTitle: 'Relire le devis client', description: 'x', selected: true },
			{ id: '3', type: 'create_task', targetPath: 'd.md', taskTitle: '10:00 Réunion lancement', description: 'x', selected: true },
			{ id: '4', type: 'create_task', targetPath: 'd.md', taskTitle: 'Envoyer le compte-rendu à [[Léa]]', description: 'x', selected: true },
			{ id: '5', type: 'create_task', targetPath: 'd.md', taskTitle: 'Envoyer le compte rendu à Léa', description: 'x', selected: true }
		] as unknown as ActionProposal[];
		const kept = refineBriefingProposals(proposals, {
			existingTaskTitles: ['Relire le devis client 📅 2026-11-12'],
			eventTitles: ['Réunion Lancement']
		});
		expect(kept.map(p => p.id)).toEqual(['1', '4']);
		expect(kept[0].selected).toBe(true);
		expect(kept[1].selected).toBe(false);
	});
});

describe('Section des tâches données par d’autres', () => {
	afterEach(() => DelegationFeature.configure(false, '@'));

	const task = (title: string, delegatedBy?: string): ObsidianTask => ({
		rawText: `- [ ] ${title}`, cleanText: title, title, completed: false, statusChar: ' ', status: 'todo',
		filePath: 'Projets/Acme.md', lineNumber: 1, indentLevel: 0, domainTags: [], subtasks: [], delegatedBy
	});

	it('est vide quand la fonctionnalité est coupée ou sans tâche concernée', () => {
		expect(buildDelegatedSection([task('A', 'Léa')], [], t => t.title).count).toBe(0);
		DelegationFeature.configure(true, '@');
		expect(buildDelegatedSection([task('A')], [], t => t.title).count).toBe(0);
	});

	it('regroupe par personne, reliée à sa note de contact', () => {
		DelegationFeature.configure(true, '@');
		const res = buildDelegatedSection([task('A', 'Antoine'), task('B', 'antoine'), task('C', 'Léa')], ['Antoine Dupont'], t => t.title);
		expect(res.count).toBe(3);
		expect(res.section).toContain('Données par [[Antoine Dupont]] (2)');
		expect(res.section).toContain('Données par [[Léa]] (1)');
		expect(res.directive).toContain('engagements');
	});
});
