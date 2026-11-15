import { describe, it, expect, beforeEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { VaultContextService } from '../../src/services/vaultContextService';
import type { SecondBrainSettings } from '../../src/main';

/**
 * Coffre factice : juste ce qu'il faut pour `getOrCreateDailyNote`
 * (lecture du modèle, création des dossiers et du fichier, modification).
 */
function createVault() {
	const files = new Map<string, string>();
	const folders = new Set<string>();

	const makeFile = (path: string): TFile => {
		const f = new TFile();
		f.path = path;
		f.name = path.split('/').pop() || path;
		f.basename = f.name.replace(/\.md$/, '');
		return f;
	};

	const vault = {
		files,
		folders,
		getAbstractFileByPath(path: string) {
			if (files.has(path)) return makeFile(path);
			if (folders.has(path)) {
				const d = new TFolder();
				d.path = path;
				return d;
			}
			return null;
		},
		getFileByPath(path: string) {
			return files.has(path) ? makeFile(path) : null;
		},
		getMarkdownFiles() {
			return Array.from(files.keys()).map(makeFile);
		},
		async createFolder(path: string) {
			const parent = path.split('/').slice(0, -1).join('/');
			if (parent && !folders.has(parent)) throw new Error(`dossier parent absent : ${parent}`);
			if (folders.has(path)) throw new Error('déjà présent');
			folders.add(path);
		},
		async create(path: string, content: string) {
			const parent = path.split('/').slice(0, -1).join('/');
			if (parent && !folders.has(parent)) throw new Error(`dossier parent absent : ${parent}`);
			files.set(path, content);
			return makeFile(path);
		},
		async read(file: TFile) {
			return files.get(file.path) ?? '';
		},
		async cachedRead(file: TFile) {
			return files.get(file.path) ?? '';
		},
		async modify(file: TFile, content: string) {
			files.set(file.path, content);
		}
	};
	return vault;
}

/** Formatage minimal, suffisant pour « YYYY/MM/DD-MM-YYYY dd ». */
function fakeMoment(value: string) {
	const [y, m, d] = value.split('-');
	const days = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa'];
	return {
		isValid: () => Boolean(y && m && d),
		format: (fmt: string) => fmt
			.replace(/YYYY/g, y)
			.replace(/MM/g, m)
			.replace(/DD/g, d)
			.replace(/\bdd\b/g, days[new Date(`${value}T00:00:00Z`).getUTCDay()])
	};
}

function createApp(vault: ReturnType<typeof createVault>) {
	return {
		vault,
		metadataCache: { getFileCache: () => null, resolvedLinks: {}, getFirstLinkpathDest: () => null },
		plugins: { plugins: {} },
		internalPlugins: { plugins: {} },
		moment: (v: string) => fakeMoment(v)
	} as any;
}

const settings = (overrides: Record<string, unknown> = {}) => ({
	dailyNotesFolder: '04 - Journal',
	dateFormat: 'YYYY/MM/DD-MM-YYYY dd',
	dailyNoteTemplatePath: '99 - Modèles/Journal.md',
	...overrides
}) as unknown as SecondBrainSettings;

describe('Note quotidienne : rendu des placeholders du modèle', () => {
	let vault: ReturnType<typeof createVault>;

	beforeEach(() => {
		vault = createVault();
		vault.folders.add('04 - Journal');
		vault.folders.add('99 - Modèles');
		vault.files.set(
			'99 - Modèles/Journal.md',
			'---\ndate: {{date}}\n---\n\n# {{title}}\n\nISO : {{date:YYYY-MM-DD}}\n'
		);
	});

	it('remplit {{date}} au format ISO et non avec le nom de fichier formaté', async () => {
		const service = new VaultContextService(createApp(vault), settings());

		const res = await service.getOrCreateDailyNote('2026-11-13');

		expect(res.created).toBe(true);
		expect(res.path).toBe('04 - Journal/2026/11/13-11-2026 ve.md');

		const content = vault.files.get(res.path) || '';
		expect(content).toContain('date: 2026-11-13');
		expect(content).not.toContain('2026/11/13-11-2026');
		expect(content).not.toContain('{{date}}');
		expect(content).toContain('ISO : 2026-11-13');
	});

	it('remplit {{title}} avec le seul nom du fichier, sans les sous-dossiers du format', async () => {
		const service = new VaultContextService(createApp(vault), settings());

		const res = await service.getOrCreateDailyNote('2026-11-13');
		const content = vault.files.get(res.path) || '';

		expect(content).toContain('# 13-11-2026 ve');
		expect(content).not.toContain('# 2026/11/13-11-2026 ve');
	});

	it('crée les sous-dossiers du format (année / mois) avant la note', async () => {
		const service = new VaultContextService(createApp(vault), settings());

		const res = await service.getOrCreateDailyNote('2027-01-05');

		expect(res.file).not.toBeNull();
		expect(vault.folders.has('04 - Journal/2027')).toBe(true);
		expect(vault.folders.has('04 - Journal/2027/01')).toBe(true);
		expect(vault.files.has('04 - Journal/2027/01/05-01-2027 ma.md')).toBe(true);
	});

	it('sans modèle, le titre par défaut ne contient pas les sous-dossiers', async () => {
		const service = new VaultContextService(createApp(vault), settings({ dailyNoteTemplatePath: '' }));

		const res = await service.getOrCreateDailyNote('2026-11-13');

		expect(vault.files.get(res.path)).toContain('# Note du 13-11-2026 ve');
	});
});
