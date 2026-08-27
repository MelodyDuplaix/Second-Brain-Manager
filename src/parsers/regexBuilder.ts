import { TaskSyntaxConfig } from '../models/syntaxConfig';

export class DynamicRegexBuilder {
	public static buildCheckboxRegex(config: TaskSyntaxConfig): RegExp {
		const symbols = config.statusSymbols.map(s => this.escapeRegexChar(s)).join('');
		return new RegExp(`^(\\s*)-\\s*\\[([${symbols}])\\]\\s+(.*)$`);
	}

	public static buildDateSignifierRegex(signifier: string): RegExp {
		const escaped = this.escapeRegex(signifier);
		return new RegExp(`${escaped}\\s*(?:\\[\\[)?(\\d{4}-\\d{2}-\\d{2}|[^\\]\\s#^]+)(?:\\]\\])?`, 'u');
	}

	public static buildRecurrenceRegex(signifier: string): RegExp {
		const escaped = this.escapeRegex(signifier);
		return new RegExp(`${escaped}\\s+([a-zA-Z0-9_\\-]+(?:\\s+[a-zA-Z0-9_\\-]+)*)`, 'u');
	}

	public static buildTagRegex(prefix: string, isNumeric = false): RegExp {
		const escaped = this.escapeRegex(prefix);
		if (prefix.includes('/')) {
			return new RegExp(`#${escaped}([a-zA-Z0-9_-]+)`, 'i');
		}
		return isNumeric ? new RegExp(`#${escaped}\\/(\\d+)`, 'i') : new RegExp(`#${escaped}\\/([a-zA-ZÀ-ÿ0-9_-]+)`, 'i');
	}

	public static buildTagDateRegex(tagPrefix: string | string[]): RegExp {
		const names = Array.isArray(tagPrefix) ? tagPrefix.map(p => this.escapeRegex(p)).join('|') : this.escapeRegex(tagPrefix);
		return new RegExp(`(?:^|\\s)#(?:${names})\\/(?:\\[\\[)?(\\d{4}-\\d{2}-\\d{2}|\\d{2}-\\d{2}-\\d{4}|[^\\]\\s#^]+)(?:\\]\\])?`, 'ui');
	}

	public static buildDataviewFieldRegex(fieldName: string | string[]): RegExp {
		const names = Array.isArray(fieldName) ? fieldName.join('|') : fieldName;
		return new RegExp(`(?:\\[|\\()(?:${names})::\\s*(?:\\[\\[)?([^\\]\\)\\n]+?)(?:\\]\\])?(?:\\s*\\]|\\))`, 'i');
	}

	public static readonly DATAVIEW_ANY_FIELD_REGEX = /(?:\[|\()[a-zA-Z0-9_À-ÿ-]+::[^\n\])]*(?:\]|\))/gi;
	public static readonly ANY_TAG_DATE_REGEX = /(?:^|\s)#(?:due|scheduled|start|completion|completed|done|cancelled|canceled)\/(?:\[\[)?[^\s#^\]]+(?:\]\])?/gi;

	public static normalizeDate(rawDate?: string): string | undefined {
		if (!rawDate) return undefined;
		let str = rawDate.trim();
		// Strip wikilinks
		str = str.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();

		// If string contains multiple words, e.g. "17-08-2026 lu" or "2026-08-17 Mon"
		const parts = str.split(/\s+/);
		const dateCandidate = parts.find(p => /^\d{4}-\d{2}-\d{2}$/.test(p) || /^\d{2}-\d{2}-\d{4}$/.test(p)) || parts[0];

		if (/^\d{4}-\d{2}-\d{2}$/.test(dateCandidate)) {
			return dateCandidate;
		}

		const frMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateCandidate);
		if (frMatch) {
			const day = frMatch[1];
			const month = frMatch[2];
			const year = frMatch[3];
			return `${year}-${month}-${day}`;
		}

		return str;
	}

	public static escapeRegex(str: string): string {
		return str.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
	}

	private static escapeRegexChar(char: string): string {
		if (['-', ']', '^', '\\'].includes(char)) {
			return `\\${char}`;
		}
		return char;
	}
}
