import { describe, it, expect } from 'vitest';
import { DynamicRegexBuilder } from '../../src/parsers/regexBuilder';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';

describe('DynamicRegexBuilder', () => {
	it('should escape special regex characters properly', () => {
		const raw = 'tag/with.special*chars+and?brackets[]()';
		const escaped = DynamicRegexBuilder.escapeRegex(raw);
		expect(escaped).toContain('\\*');
		expect(escaped).toContain('\\+');
		expect(escaped).toContain('\\?');
		expect(new RegExp(`^${escaped}$`).test(raw)).toBe(true);
	});

	it('should build valid checkbox regex matching default and custom status', () => {
		const regex = DynamicRegexBuilder.buildCheckboxRegex(DEFAULT_SYNTAX_CONFIG);
		expect(regex.test('- [ ] Tâche non faite')).toBe(true);
		expect(regex.test('- [x] Tâche terminée')).toBe(true);
		expect(regex.test('- [/] Tâche en cours')).toBe(true);
		expect(regex.test('- [-] Tâche annulée')).toBe(true);
		expect(regex.test('Pas une tâche')).toBe(false);
	});

	it('should build date signifier regex matching dates with and without wikilinks', () => {
		const regex = DynamicRegexBuilder.buildDateSignifierRegex(DEFAULT_SYNTAX_CONFIG.dueDateSignifier);
		const match1 = regex.exec('Tâche 📅 2026-08-31');
		expect(match1).not.toBeNull();
		expect(match1?.[1]).toBe('2026-08-31');

		const match2 = regex.exec('Tâche 📅 [[2026-08-31]]');
		expect(match2).not.toBeNull();
		expect(match2?.[1]).toBe('2026-08-31');
	});

	it('should build tag regex for numeric and textual controlled tags', () => {
		const energyRegex = DynamicRegexBuilder.buildTagRegex('energie', true);
		const matchEnergy = energyRegex.exec('Tâche #energie/7 suite');
		expect(matchEnergy).not.toBeNull();
		expect(matchEnergy?.[1]).toBe('7');

		const diffRegex = DynamicRegexBuilder.buildTagRegex('difficulte', false);
		const matchDiff = diffRegex.exec('Tâche #difficulte/difficile suite');
		expect(matchDiff).not.toBeNull();
		expect(matchDiff?.[1]).toBe('difficile');
	});
});
