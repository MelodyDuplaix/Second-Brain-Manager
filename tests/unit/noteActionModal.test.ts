import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteActionModal } from '../../src/modals/noteActionModal';
import { LLMService } from '../../src/services/llmService';
import { DEFAULT_SETTINGS } from '../../src/main';

describe('NoteActionModal', () => {
	const mockPlugin = {
		settings: {
			...DEFAULT_SETTINGS,
			llmModel: 'gemini-2.5-flash',
			llmProvider: 'gemini'
		},
		getSecretApiKey: vi.fn().mockResolvedValue('test-key')
	};

	const mockApp = {};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('should execute initial generation on open and call onApplyReplace on handleReplace', async () => {
		const onApplyReplace = vi.fn();
		const onApplyInsert = vi.fn();

		const modal = new NoteActionModal(mockApp as any, mockPlugin as any, {
			title: 'Corriger sans reformuler',
			icon: 'check-check',
			actionType: 'correct',
			sourceText: 'Texte avec fôtes',
			generateInitial: vi.fn().mockResolvedValue('Texte sans fautes'),
			onApplyReplace,
			onApplyInsert
		});

		modal.open();
		await modal.readyPromise;

		modal.handleReplace();
		expect(onApplyReplace).toHaveBeenCalledWith('Texte sans fautes');
		expect(onApplyInsert).not.toHaveBeenCalled();
	});

	it('should call onApplyInsert on handleInsert', async () => {
		const onApplyReplace = vi.fn();
		const onApplyInsert = vi.fn();

		const modal = new NoteActionModal(mockApp as any, mockPlugin as any, {
			title: 'Reformuler la sélection',
			icon: 'sparkles',
			actionType: 'rephrase',
			sourceText: 'Texte brut',
			generateInitial: vi.fn().mockResolvedValue('Texte élégant'),
			onApplyReplace,
			onApplyInsert
		});

		modal.open();
		await modal.readyPromise;

		modal.handleInsert();
		expect(onApplyInsert).toHaveBeenCalledWith('Texte élégant');
		expect(onApplyReplace).not.toHaveBeenCalled();
	});

	it('should update result when executeFollowUp is called', async () => {
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Texte encore plus concis'
		} as any);

		const onApplyReplace = vi.fn();
		const onApplyInsert = vi.fn();

		const modal = new NoteActionModal(mockApp as any, mockPlugin as any, {
			title: 'Résumer',
			icon: 'file-text',
			actionType: 'summarize',
			sourceText: 'Long texte de départ',
			generateInitial: vi.fn().mockResolvedValue('Premier résumé'),
			onApplyReplace,
			onApplyInsert
		});

		modal.open();
		await modal.readyPromise;

		await modal.executeFollowUp('Fais plus court');

		modal.handleReplace();
		expect(onApplyReplace).toHaveBeenCalledWith('Texte encore plus concis');
	});
});
