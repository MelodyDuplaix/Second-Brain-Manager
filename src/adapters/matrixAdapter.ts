import { ObsidianTask } from '../models/task';


export type MatrixQuadrant = 'q1' | 'q2' | 'q3' | 'q4' | null;

export interface MatrixAdapter {
	getQuadrant(task: ObsidianTask): MatrixQuadrant;
	setQuadrant(rawLine: string, quadrant: MatrixQuadrant): string;
}

export interface CustomMatrixTagMapping {
	q1Tag: string;
	q2Tag: string;
	q3Tag: string;
	q4Tag: string;
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
		const cleaned = rawLine.replace(/#(tm\/q[1-4]|q[1-4])/gi, '').replace(/\s+/g, ' ').trim();
		if (!quadrant) return cleaned;

		const tagString = `#tm/${quadrant}`;
		const blockIdMatch = /\s+(\^[a-zA-Z0-9_-]+)$/.exec(cleaned);

		if (blockIdMatch) {
			const blockId = blockIdMatch[1];
			const lineWithoutBlockId = cleaned.slice(0, -blockId.length).trim();
			return `${lineWithoutBlockId} ${tagString} ${blockId}`;
		}

		return `${cleaned} ${tagString}`;
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
		const cleaned = rawLine.replace(/#(focus|q1|q2|q3|q4|tm\/q[1-4])/gi, '').replace(/\s+/g, ' ').trim();
		if (!quadrant) return cleaned;

		const tagString = quadrant === 'q1' ? '#focus' : `#${quadrant}`;
		const blockIdMatch = /\s+(\^[a-zA-Z0-9_-]+)$/.exec(cleaned);

		if (blockIdMatch) {
			const blockId = blockIdMatch[1];
			const lineWithoutBlockId = cleaned.slice(0, -blockId.length).trim();
			return `${lineWithoutBlockId} ${tagString} ${blockId}`;
		}

		return `${cleaned} ${tagString}`;
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
		let cleaned = rawLine;

		allCustomTags.forEach(tag => {
			if (tag) {
				const escaped = tag.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
				cleaned = cleaned.replace(new RegExp(escaped, 'gi'), '');
			}
		});

		cleaned = cleaned.replace(/\s+/g, ' ').trim();
		if (!quadrant) return cleaned;

		const tagMap = {
			q1: this.mapping.q1Tag,
			q2: this.mapping.q2Tag,
			q3: this.mapping.q3Tag,
			q4: this.mapping.q4Tag,
		};

		const tagString = tagMap[quadrant];
		const blockIdMatch = /\s+(\^[a-zA-Z0-9_-]+)$/.exec(cleaned);

		if (blockIdMatch) {
			const blockId = blockIdMatch[1];
			const lineWithoutBlockId = cleaned.slice(0, -blockId.length).trim();
			return `${lineWithoutBlockId} ${tagString} ${blockId}`;
		}

		return `${cleaned} ${tagString}`;
	}
}

export class MatrixAdapterFactory {
	public static createAdapter(provider: string, customMapping?: CustomMatrixTagMapping): MatrixAdapter {
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
