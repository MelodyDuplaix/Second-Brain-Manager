import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteActionModal } from '../../src/modals/noteActionModal';
import { LLMService } from '../../src/services/llmService';
import { DEFAULT_SETTINGS } from '../../src/main';

describe('NoteActionModal', () => {
	const mockPlugin = {
		settings: {
			...DEFAULT_SETTINGS,
			llmModel: 'gemini-2.5-pro',
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

	it('should use overrideModel consistently for both header and footer and follow-up requests', async () => {
		const spy = vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Texte raffiné avec le modèle léger'
		} as any);

		const modal = new NoteActionModal(mockApp as any, mockPlugin as any, {
			title: 'Corriger sans reformuler',
			icon: 'check-check',
			actionType: 'correct',
			sourceText: 'Texte source',
			overrideModel: 'gemini-1.5-flash', // Lighter model
			generateInitial: vi.fn().mockResolvedValue('Texte corrigé initial'),
			onApplyReplace: vi.fn(),
			onApplyInsert: vi.fn()
		});

		modal.open();
		await modal.readyPromise;

		// Verify model is gemini-1.5-flash and not the default gemini-2.5-pro
		expect((modal as any).currentModel).toBe('gemini-1.5-flash');

		await modal.executeFollowUp('Ajoute une majuscule');

		expect(spy).toHaveBeenCalled();
		const config = spy.mock.calls[0][1];
		expect(config.model).toBe('gemini-1.5-flash');
	});

	it('should allow modifying currentModel for follow-up responses', async () => {
		const spy = vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Texte raffiné avec le modèle modifié'
		} as any);

		const modal = new NoteActionModal(mockApp as any, mockPlugin as any, {
			title: 'Corriger sans reformuler',
			icon: 'check-check',
			actionType: 'correct',
			sourceText: 'Texte source',
			overrideModel: 'gemini-1.5-flash',
			generateInitial: vi.fn().mockResolvedValue('Texte corrigé'),
			onApplyReplace: vi.fn(),
			onApplyInsert: vi.fn()
		});

		modal.open();
		await modal.readyPromise;

		// User changes model to gpt-4o-mini
		(modal as any).currentModel = 'gpt-4o-mini';
		(modal as any).updateModelBtn();
		(modal as any).updateHeaderModelBadge();

		await modal.executeFollowUp('Rends plus formel');

		expect(spy).toHaveBeenCalled();
		const config = spy.mock.calls[0][1];
		expect(config.model).toBe('gpt-4o-mini');
	});
});
