import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteActionsService } from '../../src/services/noteActionsService';
import { LLMService } from '../../src/services/llmService';
import { DEFAULT_SETTINGS } from '../../src/main';

describe('NoteActionsService', () => {
	const mockPlugin = {
		settings: {
			...DEFAULT_SETTINGS,
			llmProvider: 'gemini'
		},
		getSecretApiKey: vi.fn().mockResolvedValue('test-key')
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('should extract tasks from meeting notes text and format them with wikilinks', async () => {
		const mockResponse = {
			content: '- [ ] Envoyer le devis à Marc 📅 2026-08-25 #tm/q1 #energie/3 [[Réunion Client]]\n- [ ] Préparer le pitch de présentation #tm/q2 [[Réunion Client]]'
		};
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue(mockResponse as any);

		const result = await NoteActionsService.extractTasks(
			'Lors de la réunion avec Marc, nous avons convenu d\'envoyer le devis demain.',
			'Réunion Client',
			mockPlugin as any
		);

		expect(result).toContain('Envoyer le devis à Marc');
		expect(result).toContain('[[Réunion Client]]');
		expect(result).toContain('- [ ]');
	});

	it('should breakdown a complex task into indented subtasks', async () => {
		const mockResponse = {
			content: '1. Rédiger le plan du document\n2. Collecter les données de vente\n3. Mettre en page le rapport final'
		};
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue(mockResponse as any);

		const subtasks = await NoteActionsService.breakdownTask(
			'- [ ] Écrire le rapport annuel #tm/q2',
			'Rapport',
			mockPlugin as any
		);

		expect(subtasks).toHaveLength(3);
		expect(subtasks[0]).toBe('\t- [ ] Rédiger le plan du document');
		expect(subtasks[1]).toBe('\t- [ ] Collecter les données de vente');
		expect(subtasks[2]).toBe('\t- [ ] Mettre en page le rapport final');
	});

	it('should sanitize dirty LLM outputs with doubled checkboxes in breakdownTask', async () => {
		const mockResponse = {
			content: '- [ ] - [ ] Isoler le script de collision\n[ ] [ ] Lister les mécaniques\n1. - [ ] Créer les assets visuels'
		};
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue(mockResponse as any);

		const subtasks = await NoteActionsService.breakdownTask(
			'- [ ] Designer le niveau 2 ⏳ 2026-08-08 #design #energie/6 #tm/q2',
			'Projet Jeu Vidéo',
			mockPlugin as any,
			'  '
		);

		expect(subtasks).toHaveLength(3);
		expect(subtasks[0]).toBe('  - [ ] Isoler le script de collision');
		expect(subtasks[1]).toBe('  - [ ] Lister les mécaniques');
		expect(subtasks[2]).toBe('  - [ ] Créer les assets visuels');
		expect(subtasks[0]).not.toContain('[ ] [ ]');
		expect(subtasks[0]).not.toContain('- [ ] - [ ]');
	});

	it('should generate a summary with summarize mode', async () => {
		const mockResponse = {
			content: 'Voici le résumé synthétique des décisions prises lors de la session.'
		};
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue(mockResponse as any);

		const summary = await NoteActionsService.summarizeOrRephrase(
			'Texte long contenant de nombreux paragraphes et explications détaillées.',
			'summary',
			mockPlugin as any
		);

		expect(summary).toBe('Voici le résumé synthétique des décisions prises lors de la session.');
	});

	it('should rephrase selected text for clarity', async () => {
		const mockResponse = {
			content: 'Notre équipe s\'engage à finaliser l\'ensemble des livrables pour la fin du mois.'
		};
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue(mockResponse as any);

		const rephrased = await NoteActionsService.summarizeOrRephrase(
			'On va essayer de faire tout ce qu\'on doit faire d\'ici fin du mois.',
			'rephrase',
			mockPlugin as any
		);

		expect(rephrased).toContain('livrables pour la fin du mois');
	});
});
