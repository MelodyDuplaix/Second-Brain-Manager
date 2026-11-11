import { describe, it, expect } from 'vitest';
import { FEATURE_DEFINITIONS, isFeatureEnabled } from '../../src/models/features';

describe('Fonctionnalités activables', () => {
	it('les fonctionnalités d’origine sont actives par défaut, et pour un coffre existant sans ces réglages', () => {
		for (const def of FEATURE_DEFINITIONS) {
			const expected = def.defaultEnabled !== false;
			expect(isFeatureEnabled(undefined, def.key)).toBe(expected);
			expect(isFeatureEnabled({}, def.key)).toBe(expected);
		}
		for (const key of ['calendar', 'ai', 'briefings', 'gamification'] as const) {
			expect(isFeatureEnabled(undefined, key)).toBe(true);
		}
	});

	it('les tâches données par d’autres sont une option : coupée par défaut, activée explicitement', () => {
		expect(isFeatureEnabled(undefined, 'delegated')).toBe(false);
		expect(isFeatureEnabled({}, 'delegated')).toBe(false);
		expect(isFeatureEnabled({ featureDelegatedTasksEnabled: true }, 'delegated')).toBe(true);
		expect(isFeatureEnabled({ featureDelegatedTasksEnabled: false }, 'delegated')).toBe(false);
	});

	it('seul un réglage explicitement faux désactive une fonctionnalité', () => {
		expect(isFeatureEnabled({ featureCalendarEnabled: false }, 'calendar')).toBe(false);
		expect(isFeatureEnabled({ featureCalendarEnabled: false }, 'ai')).toBe(true);
		expect(isFeatureEnabled({ featureAiEnabled: true }, 'ai')).toBe(true);
	});

	it('chaque fonctionnalité a un réglage distinct et un descriptif', () => {
		const settings = new Set(FEATURE_DEFINITIONS.map(f => f.setting));
		expect(settings.size).toBe(FEATURE_DEFINITIONS.length);
		for (const def of FEATURE_DEFINITIONS) {
			expect(def.name.length).toBeGreaterThan(0);
			expect(def.includes.length).toBeGreaterThan(0);
		}
	});
});
