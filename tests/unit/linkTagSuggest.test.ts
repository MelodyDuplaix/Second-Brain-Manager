import { describe, it, expect } from 'vitest';
import { findTrigger, applyCompletion } from '../../src/suggesters/linkTagSuggest';

const complete = (value: string, insertion: string, caret = value.length) => {
	const ctx = findTrigger(value, caret);
	if (!ctx) throw new Error('pas de déclencheur');
	return applyCompletion(value, ctx, insertion);
};

describe('autocomplétion des liens et des tags', () => {
	it('detects a link or a tag being typed just before the caret', () => {
		expect(findTrigger('Réunion [[Pro', 13)).toMatchObject({ kind: 'link', start: 8, query: 'Pro' });
		expect(findTrigger('Dentiste #san', 13)).toMatchObject({ kind: 'tag', start: 9, query: 'san' });
		expect(findTrigger('#', 1)).toMatchObject({ kind: 'tag', start: 0, query: '' });
		expect(findTrigger('[[Projet]] fini', 15)).toBeNull();
		expect(findTrigger('C#', 2)).toBeNull();
		expect(findTrigger('Lien [[Note#Titre', 17)).toBeNull();
	});

	it('completes a link and puts the caret after it', () => {
		expect(complete('Réunion [[Pro', '[[Projet X]]')).toEqual({ value: 'Réunion [[Projet X]]', caret: 20 });
	});

	it('does not double the closing brackets already typed', () => {
		const value = 'Voir [[Pro]] demain';
		expect(complete(value, '[[Projet]]', 10).value).toBe('Voir [[Projet]] demain');
	});

	it('completes a tag with one space after it', () => {
		expect(complete('Dentiste #san', '#santé ')).toEqual({ value: 'Dentiste #santé ', caret: 16 });
		expect(complete('Dentiste #san demain', '#santé ', 13).value).toBe('Dentiste #santé demain');
	});
});
