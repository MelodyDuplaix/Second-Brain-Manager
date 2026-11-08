import { ObsidianTask } from '../models/task';


export type MatrixQuadrant = 'q1' | 'q2' | 'q3' | 'q4' | null;

export interface MatrixAdapter {
	getQuadrant(task: ObsidianTask): MatrixQuadrant;
	setQuadrant(rawLine: string, quadrant: MatrixQuadrant): string;
	/** Tag écrit pour un quadrant (ex. #tm/q2), chaîne vide si aucun */
	formatTag(quadrant: MatrixQuadrant): string;
}

export interface CustomMatrixTagMapping {
	q1Tag: string;
	q2Tag: string;
	q3Tag: string;
	q4Tag: string;
}

/**
 * Interrupteur global de la fonctionnalité « quadrants » (matrice d'Eisenhower).
 * Désactivée : aucun quadrant n'est lu ni écrit, et l'IA, le briefing, la reprise,
 * les pièces et les trophées n'en tiennent plus compte.
 */
export class MatrixFeature {
	private static enabled = true;

	public static setEnabled(value: boolean): void {
		this.enabled = value !== false;
	}

	public static isEnabled(): boolean {
		return this.enabled;
	}
}

/** Remplace le tag de quadrant en gardant le retrait (sous-tâches) et l'identifiant de bloc. */
function replaceQuadrantTag(rawLine: string, removeTags: RegExp, tagString: string | null): string {
	const indent = /^\s*/.exec(rawLine)?.[0] ?? '';
	const cleaned = rawLine.slice(indent.length).replace(removeTags, '').replace(/\s+/g, ' ').trim();
	if (!tagString) return `${indent}${cleaned}`;
	const blockIdMatch = /\s+(\^[a-zA-Z0-9_-]+)$/.exec(cleaned);
	if (blockIdMatch) {
		const blockId = blockIdMatch[1];
		const withoutBlockId = cleaned.slice(0, -blockId.length).trim();
		return `${indent}${withoutBlockId} ${tagString} ${blockId}`;
	}
	return `${indent}${cleaned} ${tagString}`;
}

/** Adaptateur utilisé quand les quadrants sont désactivés : ne lit ni n'écrit rien. */
export class DisabledMatrixAdapter implements MatrixAdapter {
	getQuadrant(): MatrixQuadrant {
		return null;
	}

	setQuadrant(rawLine: string): string {
		return rawLine;
	}

	formatTag(): string {
		return '';
	}
}

export class TaskMatrixAdapter implements MatrixAdapter {
	getQuadrant(task: ObsidianTask): MatrixQuadrant {
		const text = (task.matrixTag || task.rawText || task.rawLine || task.title || '').toLowerCase();
		if (text.includes('#tm/q1') || text.includes('#q1')) return 'q1';
		if (text.includes('#tm/q2') || text.includes('#q2')) return 'q2';
		if (text.includes('#tm/q3') || text.includes('#q3')) return 'q3';
		if (text.includes('#tm/q4') || text.includes('#q4')) return 'q4';
		return null;
	}

	setQuadrant(rawLine: string, quadrant: MatrixQuadrant): string {
		return replaceQuadrantTag(rawLine, /#(tm\/q[1-4]|q[1-4])(?![\w/-])/gi, quadrant ? this.formatTag(quadrant) : null);
	}

	formatTag(quadrant: MatrixQuadrant): string {
		return quadrant ? `#tm/${quadrant}` : '';
	}
}

export class FocusFirstAdapter implements MatrixAdapter {
	getQuadrant(task: ObsidianTask): MatrixQuadrant {
		const line = (task.matrixTag || task.rawText || task.rawLine || task.title || '').toLowerCase();
		if (line.includes('#focus') || line.includes('#q1') || line.includes('#tm/q1')) return 'q1';
		if (line.includes('#q2') || line.includes('#tm/q2')) return 'q2';
		if (line.includes('#q3') || line.includes('#tm/q3')) return 'q3';
		if (line.includes('#q4') || line.includes('#tm/q4')) return 'q4';
		return null;
	}

	setQuadrant(rawLine: string, quadrant: MatrixQuadrant): string {
		return replaceQuadrantTag(rawLine, /#(focus|q1|q2|q3|q4|tm\/q[1-4])(?![\w/-])/gi, quadrant ? this.formatTag(quadrant) : null);
	}

	formatTag(quadrant: MatrixQuadrant): string {
		if (!quadrant) return '';
		return quadrant === 'q1' ? '#focus' : `#${quadrant}`;
	}
}

export class CustomTagMatrixAdapter implements MatrixAdapter {
	constructor(private mapping: CustomMatrixTagMapping) {}

	getQuadrant(task: ObsidianTask): MatrixQuadrant {
		const line = (task.matrixTag || task.rawText || task.rawLine || task.title || '').toLowerCase();
		if (line.includes(this.mapping.q1Tag.toLowerCase()) || line.includes('#q1') || line.includes('#tm/q1')) return 'q1';
		if (line.includes(this.mapping.q2Tag.toLowerCase()) || line.includes('#q2') || line.includes('#tm/q2')) return 'q2';
		if (line.includes(this.mapping.q3Tag.toLowerCase()) || line.includes('#q3') || line.includes('#tm/q3')) return 'q3';
		if (line.includes(this.mapping.q4Tag.toLowerCase()) || line.includes('#q4') || line.includes('#tm/q4')) return 'q4';
		return null;
	}

	setQuadrant(rawLine: string, quadrant: MatrixQuadrant): string {
		const allCustomTags = [this.mapping.q1Tag, this.mapping.q2Tag, this.mapping.q3Tag, this.mapping.q4Tag, '#q1', '#q2', '#q3', '#q4', '#tm/q1', '#tm/q2', '#tm/q3', '#tm/q4'];
		const escaped = allCustomTags
			.filter(Boolean)
			.map(tag => tag.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'))
			.join('|');
		return replaceQuadrantTag(rawLine, new RegExp(`(?:${escaped})(?![\\w/-])`, 'gi'), quadrant ? this.formatTag(quadrant) : null);
	}

	formatTag(quadrant: MatrixQuadrant): string {
		if (!quadrant) return '';
		return { q1: this.mapping.q1Tag, q2: this.mapping.q2Tag, q3: this.mapping.q3Tag, q4: this.mapping.q4Tag }[quadrant];
	}
}

export class MatrixAdapterFactory {
	public static createAdapter(provider: string, customMapping?: CustomMatrixTagMapping): MatrixAdapter {
		if (!MatrixFeature.isEnabled()) return new DisabledMatrixAdapter();
		switch (provider) {
			case 'focus-first':
				return new FocusFirstAdapter();
			case 'custom':
				return new CustomTagMatrixAdapter(customMapping || {
					q1Tag: '#q1',
					q2Tag: '#q2',
					q3Tag: '#q3',
					q4Tag: '#q4'
				});
			case 'task-matrix':
			default:
				return new TaskMatrixAdapter();
		}
	}
}
