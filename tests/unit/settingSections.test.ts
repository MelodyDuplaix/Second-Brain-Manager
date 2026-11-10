import { describe, it, expect, beforeAll } from 'vitest';
import { Setting } from 'obsidian';
import { SettingGroup } from '../../src/settings/settingGroup';

beforeAll(() => {
	(globalThis as unknown as { createDiv: () => unknown }).createDiv = () => ({ createDiv: () => ({}) });
});

describe('sections des réglages', () => {
	it('collects sections as nested native pages, with their groups inside', () => {
		const container = {} as HTMLElement;
		const defs = SettingGroup.collect(() => {
			SettingGroup.section(container, { id: 'tasks', name: 'Tâches', desc: 'Syntaxe et statuts', icon: 'list', displayValue: () => 'Avec quadrants' }, (el) => {
				new SettingGroup(el).setHeading('Syntaxe').addSetting((s: Setting) => { s.setName('Format'); });
				SettingGroup.section(el, { id: 'google', name: 'Google Agenda', desc: 'Connexion', icon: 'calendar' }, (inner) => {
					new SettingGroup(inner).setHeading('Connexion').addSetting((s: Setting) => { s.setName('Client ID'); });
				});
			});
			SettingGroup.section(container, { id: 'voice', name: 'Dictée', desc: 'Whisper', icon: 'mic' }, (el) => {
				new SettingGroup(el).setHeading('Reconnaissance vocale').addSetting((s: Setting) => { s.setName('Moteur'); });
			});
		}, () => { throw new Error('unused'); }) as any[];

		// Les deux sections consécutives forment un seul bloc d'entrées
		expect(defs).toHaveLength(1);
		const pages = defs[0].items;
		expect(pages.map((p: any) => p.name)).toEqual(['Tâches', 'Dictée']);
		expect(pages[0].id).toBe('tasks');
		expect(pages[0].displayValue()).toBe('Avec quadrants');

		const tasksItems = pages[0].items;
		expect(tasksItems[0].heading).toBe('Syntaxe');
		expect(tasksItems[0].items.map((i: any) => i.name)).toEqual(['Format']);
		const nested = tasksItems[1].items[0];
		expect(nested.type).toBe('page');
		expect(nested.name).toBe('Google Agenda');
		expect(nested.items[0].items.map((i: any) => i.name)).toEqual(['Client ID']);
	});
});
