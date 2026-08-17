import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/services/toolRegistry';
import { VaultContextService } from '../../src/services/vaultContextService';
import { DEFAULT_SETTINGS } from '../../src/main';

describe('ToolRegistry', () => {
	const mockApp = {
		vault: {
			getMarkdownFiles: () => [],
			getAllLoadedFiles: () => [],
			getFileByPath: () => null,
			getAbstractFileByPath: () => null
		}
	} as unknown as Parameters<typeof VaultContextService>[0];

	const vaultContext = new VaultContextService(mockApp, DEFAULT_SETTINGS);
	const registry = new ToolRegistry(vaultContext);

	it('should provide complete tools definition matching OpenAI and Gemini formats', () => {
		const openAiSchema = ToolRegistry.getOpenAIToolsSchema();
		expect(openAiSchema.length).toBeGreaterThanOrEqual(10);
		expect(openAiSchema[0].type).toBe('function');
		expect(openAiSchema[0].function.name).toBe('search_vault');

		const geminiSchema = ToolRegistry.getGeminiToolsSchema();
		expect(geminiSchema[0].functionDeclarations.length).toBeGreaterThanOrEqual(10);
	});

	it('should generate valid propose_create_note action proposal', async () => {
		const res = await registry.executeTool({
			name: 'propose_create_note',
			arguments: {
				folder: '03 - Contacts',
				fileName: 'Claire Dupont',
				content: '# Fiche Contact\nDirectrice Marketing',
				tags: ['#contact', '#reseau']
			}
		});

		expect(res.actionProposals).toBeDefined();
		expect(res.actionProposals?.length).toBe(1);
		const prop = res.actionProposals?.[0];
		expect(prop?.type).toBe('create_note');
		expect(prop?.targetPath).toBe('03 - Contacts/Claire Dupont.md');
	});

	it('should generate valid propose_create_task action proposal', async () => {
		const res = await registry.executeTool({
			name: 'propose_create_task',
			arguments: {
				filePath: '01 - Projets/Second Brain.md',
				taskTitle: 'Finaliser les outils IA',
				dueDate: '2026-08-30',
				priority: 'high',
				energy: 5,
				matrixQuadrant: 'q1',
				domainTags: ['#dev'],
				linkedNotes: ['Claire Dupont']
			}
		});

		expect(res.actionProposals).toBeDefined();
		expect(res.actionProposals?.length).toBe(1);
		const prop = res.actionProposals?.[0];
		expect(prop?.type).toBe('create_task');
		expect(prop?.targetPath).toBe('01 - Projets/Second Brain.md');
	});

	it('should generate valid propose_decompose_task action proposal', async () => {
		const res = await registry.executeTool({
			name: 'propose_decompose_task',
			arguments: {
				filePath: '01 - Projets/Dev.md',
				parentLineNumber: 12,
				subtasks: ['Sous-étape 1', 'Sous-étape 2', 'Sous-étape 3']
			}
		});

		expect(res.actionProposals).toBeDefined();
		const prop = res.actionProposals?.[0];
		expect(prop?.type).toBe('decompose_task');
	});
});
