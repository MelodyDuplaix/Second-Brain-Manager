import { describe, it, expect } from 'vitest';
import { FEATURE_DEFINITIONS, isFeatureEnabled } from '../../src/models/features';

describe('Fonctionnalités activables', () => {
	it('tout est actif par défaut, et pour un coffre existant sans ces réglages', () => {
		for (const def of FEATURE_DEFINITIONS) {
			expect(isFeatureEnabled(undefined, def.key)).toBe(true);
			expect(isFeatureEnabled({}, def.key)).toBe(true);
		}
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
