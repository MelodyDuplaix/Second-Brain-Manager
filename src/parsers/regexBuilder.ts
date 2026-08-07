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
