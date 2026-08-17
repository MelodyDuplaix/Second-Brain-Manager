const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgAttrMap {
	[key: string]: string | number | undefined;
}

export class DomUtils {
	/**
	 * Creates an SVG element with the specified namespace and attributes.
	 */
	public static createSvgElement<K extends keyof SVGElementTagNameMap>(
		tagName: K,
		attrs?: SvgAttrMap,
		textContent?: string
	): SVGElementTagNameMap[K] {
		const el = document.createElementNS(SVG_NS, tagName);
		if (attrs) {
			for (const [key, value] of Object.entries(attrs)) {
				if (value !== undefined) {
					el.setAttribute(key, String(value));
				}
			}
		}
		if (textContent !== undefined) {
			el.textContent = textContent;
		}
		return el;
	}

	/**
	 * Appends child to parent and returns the created element for chaining.
	 */
	public static appendSvgChild<K extends keyof SVGElementTagNameMap>(
		parent: Element,
		tagName: K,
		attrs?: SvgAttrMap,
		textContent?: string
	): SVGElementTagNameMap[K] {
		const child = this.createSvgElement(tagName, attrs, textContent);
		parent.appendChild(child);
		return child;
	}
}
