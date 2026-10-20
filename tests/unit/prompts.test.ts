import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_CONFIGURED_PROMPTS, ConfiguredPrompt } from '../../src/models/prompt';
import { NoteActionsService } from '../../src/services/noteActionsService';
import { LLMService } from '../../src/services/llmService';
import { DEFAULT_SETTINGS } from '../../src/main';

describe('Prompts & Actions IA Configuration', () => {
	const mockPlugin = {
		settings: {
			...DEFAULT_SETTINGS,
			llmProvider: 'gemini',
			llmModel: 'gemini-2.5-pro',
			configuredPrompts: [] as ConfiguredPrompt[]
		},
		getSecretApiKey: vi.fn().mockResolvedValue('test-key'),
		getPrompts(): ConfiguredPrompt[] {
			if (!this.settings.configuredPrompts || this.settings.configuredPrompts.length === 0) {
				this.settings.configuredPrompts = JSON.parse(JSON.stringify(DEFAULT_CONFIGURED_PROMPTS));
			}
			return this.settings.configuredPrompts;
		},
		getPrompt(id: string): ConfiguredPrompt | undefined {
			return this.getPrompts().find(p => p.id === id);
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
		addCommand: vi.fn()
	};

	beforeEach(() => {
		vi.restoreAllMocks();
		mockPlugin.settings.configuredPrompts = [];
	});

	it('should contain the 5 default built-in prompts with complete configurations', () => {
		expect(DEFAULT_CONFIGURED_PROMPTS).toHaveLength(5);
		const ids = DEFAULT_CONFIGURED_PROMPTS.map(p => p.id);
		expect(ids).toContain('correct');
		expect(ids).toContain('summarize');
		expect(ids).toContain('rephrase');
		expect(ids).toContain('extract_tasks');
		expect(ids).toContain('breakdown_task');

		const correctPrompt = DEFAULT_CONFIGURED_PROMPTS.find(p => p.id === 'correct');
		expect(correctPrompt?.name).toBe('Corriger sans reformuler');
		expect(correctPrompt?.showInContextMenu).toBe(true);
		expect(correctPrompt?.showInCommandPalette).toBe(true);
		expect(correctPrompt?.systemInstruction).toContain('NE REFORMULE PAS');
	});

	it('should initialize prompts in plugin if empty', () => {
		const prompts = mockPlugin.getPrompts();
		expect(prompts).toHaveLength(5);
		expect(mockPlugin.getPrompt('correct')).toBeDefined();
		expect(mockPlugin.getPrompt('correct')?.name).toBe('Corriger sans reformuler');
	});

	it('should use model override in NoteActionsService.summarizeOrRephrase when specified', async () => {
		const spy = vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Texte corrigé ultra-rapidement'
		} as any);

		const result = await NoteActionsService.summarizeOrRephrase(
			'Texte source',
			'correct',
			mockPlugin as any,
			undefined,
			'gemini-1.5-flash' // override lighter model
		);

		expect(result).toBe('Texte corrigé ultra-rapidement');
		expect(spy).toHaveBeenCalled();
		const callConfig = spy.mock.calls[0][1];
		expect(callConfig.model).toBe('gemini-1.5-flash');
	});

	it('should fallback to global model when no model override is provided', async () => {
		const spy = vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Texte résumé'
		} as any);

		await NoteActionsService.summarizeOrRephrase(
			'Texte source long',
			'summary',
			mockPlugin as any
		);

		expect(spy).toHaveBeenCalled();
		const callConfig = spy.mock.calls[0][1];
		expect(callConfig.model).toBe('gemini-2.5-pro');
	});

	it('should execute custom prompt with custom instruction and custom model', async () => {
		const customPrompt: ConfiguredPrompt = {
			id: 'custom-translate',
			name: 'Traduire en anglais',
			description: 'Traduction automatique',
			systemInstruction: 'Tu es un traducteur expert. Traduis en anglais.',
			model: 'gpt-4o-mini',
			icon: 'languages',
			showInContextMenu: true,
			showInCommandPalette: true,
			requiresSelection: true,
			actionType: 'custom',
			enabled: true
		};

		const spy = vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Hello, this is a translated text.'
		} as any);

		const result = await NoteActionsService.executeCustomPrompt(
			'Bonjour, ceci est un texte traduit.',
			customPrompt,
			mockPlugin as any
		);

		expect(result).toBe('Hello, this is a translated text.');
		expect(spy).toHaveBeenCalled();
		const messages = spy.mock.calls[0][0];
		const config = spy.mock.calls[0][1];

		expect(config.model).toBe('gpt-4o-mini');
		const systemMsg = messages.find((m: any) => m.role === 'system');
		expect(systemMsg.content).toContain('Tu es un traducteur expert');
	});

	it('should handle custom prompt command with editor selection and validation modal', async () => {
		vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Résultat personnalisé'
		} as any);

		const mockEditor = {
			getSelection: vi.fn().mockReturnValue('Texte sélectionné'),
			getValue: vi.fn().mockReturnValue('Texte total'),
			replaceSelection: vi.fn(),
			setValue: vi.fn()
		};

		const mockView = {
			editor: mockEditor,
			file: { basename: 'Note Test', path: 'Note Test.md' }
		};

		const mockApp = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(mockView)
			}
		};

		const customPrompt: ConfiguredPrompt = {
			id: 'custom-bullet',
			name: 'Points clés',
			description: 'Points clés',
			systemInstruction: 'Liste à puces',
			model: 'gemini-1.5-flash',
			icon: 'list',
			showInContextMenu: true,
			showInCommandPalette: true,
			requiresSelection: true,
			actionType: 'custom',
			enabled: true
		};

		const modal = await NoteActionsService.handleCustomPromptCommand(
			mockApp as any,
			mockPlugin as any,
			customPrompt,
			mockEditor as any,
			mockView as any
		);

		expect(modal).toBeDefined();
		await (modal as any).readyPromise;
		(modal as any).handleReplace();

		expect(mockEditor.replaceSelection).toHaveBeenCalledWith('Résultat personnalisé');
	});

	it('should pass model override to refineResult during follow-up refinement', async () => {
		const spy = vi.spyOn(LLMService, 'generateResponse').mockResolvedValue({
			content: 'Texte raffiné plus concis'
		} as any);

		const refined = await NoteActionsService.refineResult(
			'Texte source',
			'Premier résultat',
			'Plus concis svp',
			'correct',
			mockPlugin as any,
			'gemini-1.5-flash'
		);

		expect(refined).toBe('Texte raffiné plus concis');
		expect(spy).toHaveBeenCalled();
		const config = spy.mock.calls[0][1];
		expect(config.model).toBe('gemini-1.5-flash');
	});
});
