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
		},
		workspace: {
			getLeavesOfType: () => [],
			getLeaf: () => ({
				openFile: async () => {}
			}),
			openLinkText: async () => {}
		},
		commands: {
			commands: {
				'app:open-daily-note': { id: 'app:open-daily-note', name: "Daily notes: Open today's daily note" },
				'workspace:toggle-left-sidebar': { id: 'workspace:toggle-left-sidebar', name: 'Toggle left sidebar' },
				'graph:open': { id: 'graph:open', name: 'Graph view: Open graph view' }
			},
			executeCommandById: (id: string) => id === 'app:open-daily-note' || id === 'workspace:toggle-left-sidebar' || id === 'graph:open'
		}
	} as unknown as Parameters<typeof VaultContextService>[0];

	const vaultContext = new VaultContextService(mockApp, DEFAULT_SETTINGS);
	const registry = new ToolRegistry(vaultContext);

	it('should provide complete tools definition matching OpenAI and Gemini formats', () => {
		const openAiSchema = ToolRegistry.getOpenAIToolsSchema();
		expect(openAiSchema.length).toBeGreaterThanOrEqual(13);
		expect(openAiSchema[0].type).toBe('function');
		expect(openAiSchema[0].function.name).toBe('search_vault');

		const geminiSchema = ToolRegistry.getGeminiToolsSchema();
		expect(geminiSchema[0].functionDeclarations.length).toBeGreaterThanOrEqual(13);
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

	it('should generate valid propose_create_calendar_event action proposal', async () => {
		const res = await registry.executeTool({
			name: 'propose_create_calendar_event',
			arguments: {
				title: 'Point d\'équipe',
				startDate: '2026-08-28',
				startTime: '10:00',
				endTime: '11:00',
				location: 'Visioconférence'
			}
		});

		expect(res.actionProposals).toBeDefined();
		const prop = res.actionProposals?.[0];
		expect(prop?.type).toBe('create_calendar_event');
		expect((prop as any)?.title).toBe('Point d\'équipe');
		expect((prop as any)?.startDate).toBe('2026-08-28');
		expect((prop as any)?.startTime).toBe('10:00');
	});

	it('should search Obsidian commands correctly via search_commands', async () => {
		const searchRes = await registry.executeTool({
			name: 'search_commands',
			arguments: { query: 'daily' }
		});
		expect(searchRes.output).toContain('app:open-daily-note');
		expect(searchRes.output).toContain("Daily notes: Open today's daily note");
	});

	it('should execute Obsidian command correctly via execute_command', async () => {
		const execRes = await registry.executeTool({
			name: 'execute_command',
			arguments: { commandId: 'graph:open' }
		});
		expect(execRes.output).toContain('exécutée avec succès');
		expect(execRes.output).toContain('Graph view: Open graph view');
	});

	it('should generate valid propose_open_note and propose_execute_command action proposals', async () => {
		const openPropRes = await registry.executeTool({
			name: 'propose_open_note',
			arguments: { filePath: '01 - Projets/Alpha.md', newLeaf: true }
		});
		expect(openPropRes.actionProposals).toHaveLength(1);
		expect(openPropRes.actionProposals?.[0].type).toBe('open_note');
		expect((openPropRes.actionProposals?.[0] as any).newLeaf).toBe(true);

		const cmdPropRes = await registry.executeTool({
			name: 'propose_execute_command',
			arguments: { commandId: 'app:open-daily-note' }
		});
		expect(cmdPropRes.actionProposals).toHaveLength(1);
		expect(cmdPropRes.actionProposals?.[0].type).toBe('execute_command');
		expect((cmdPropRes.actionProposals?.[0] as any).commandId).toBe('app:open-daily-note');
	});

	it('should handle list_calendars and search_calendar_events gracefully when disconnected', async () => {
		const listRes = await registry.executeTool({
			name: 'list_calendars',
			arguments: {}
		});
		expect(listRes.output).toContain('Google Calendar n\'est pas connecté');

		const searchRes = await registry.executeTool({
			name: 'search_calendar_events',
			arguments: { query: 'Dentiste' }
		});
		expect(searchRes.output).toContain('Google Calendar n\'est pas encore connecté');
	});
});
