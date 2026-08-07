export interface PopoverFieldConfig {
	title: string;
	type: 'date' | 'number' | 'priority-select';
	initialValue: string;
	min?: number;
	max?: number;
	options?: { label: string; value: string }[];
	onSubmit: (value: string) => void;
}

export class InlineMetaPopover {
	private popoverEl: HTMLElement | null = null;
	private outsideClickListener: ((e: MouseEvent) => void) | null = null;
	private keyListener: ((e: KeyboardEvent) => void) | null = null;

	public open(targetEl: HTMLElement, config: PopoverFieldConfig): void {
		this.close();

		const rect = targetEl.getBoundingClientRect();

		const popover = document.createElement('div');
		popover.className = 'sbm-inline-popover';
		popover.style.position = 'fixed';
		popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
		popover.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 220)}px`;
		popover.style.zIndex = '1000';

		popover.createEl('div', { cls: 'sbm-popover-title', text: config.title });

		if (config.type === 'priority-select') {
			const optionsList = popover.createEl('div', { cls: 'sbm-priority-options' });
			const priorities = [
				{ label: '🔺 Highest', value: 'highest' },
				{ label: '⏫ High', value: 'high' },
				{ label: '🔼 Medium', value: 'medium' },
				{ label: '⚪ Normal', value: 'normal' },
				{ label: '🔽 Low', value: 'low' },
				{ label: '⏬ Lowest', value: 'lowest' },
			];

			priorities.forEach(p => {
				const btn = optionsList.createEl('button', { cls: 'sbm-priority-btn', text: p.label });
				btn.addEventListener('click', () => {
					this.close();
					config.onSubmit(p.value);
				});
			});
		} else {
			const form = popover.createEl('form', { cls: 'sbm-popover-form' });
			const input = form.createEl('input', { type: config.type === 'date' ? 'date' : 'number' });
			input.value = config.initialValue;

			if (config.min !== undefined) input.min = config.min.toString();
			if (config.max !== undefined) input.max = config.max.toString();

			form.createEl('button', { type: 'submit', text: 'OK' });

			form.addEventListener('submit', (e) => {
				e.preventDefault();
				this.close();
				config.onSubmit(input.value);
			});

			setTimeout(() => input.focus(), 50);
		}

		document.body.appendChild(popover);
		this.popoverEl = popover;

		this.outsideClickListener = (e: MouseEvent) => {
			if (this.popoverEl && !this.popoverEl.contains(e.target as Node) && !targetEl.contains(e.target as Node)) {
				this.close();
			}
		};

		this.keyListener = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.close();
			}
		};

		document.addEventListener('mousedown', this.outsideClickListener);
		document.addEventListener('keydown', this.keyListener);
	}

	public close(): void {
		if (this.popoverEl) {
			this.popoverEl.remove();
			this.popoverEl = null;
		}

		if (this.outsideClickListener) {
			document.removeEventListener('mousedown', this.outsideClickListener);
			this.outsideClickListener = null;
		}

		if (this.keyListener) {
			document.removeEventListener('keydown', this.keyListener);
			this.keyListener = null;
		}
	}
}
