/**
 * Règles des gestes au doigt du calendrier.
 *
 * Sur mobile, le calendrier vit souvent dans un panneau latéral qu'on referme d'un balayage
 * horizontal. Ce balayage commence souvent sur une tâche : il ne doit pas la déplacer. Trois
 * garde-fous s'additionnent :
 * - l'appui long qui saisit un élément est assez long et exige un doigt immobile ;
 * - si le panneau lui-même bouge pendant le glisser, c'est qu'Obsidian le referme : on annule ;
 * - un relâcher en plein élan horizontal est un balayage, pas un dépôt : on annule aussi.
 */

/** Durée de l'appui long qui saisit un élément ou commence une sélection de créneau (ms). */
export const TOUCH_HOLD_MS = 420;

/** Mouvement toléré pendant l'appui long ; au-delà, le doigt fait défiler ou balaie (px). */
export const TOUCH_SLOP_PX = 8;

/** Décalage horizontal du panneau au-delà duquel on considère qu'il est en train de glisser (px). */
export const VIEW_SHIFT_PX = 12;

/** Vitesse horizontale au relâcher au-delà de laquelle le geste est un balayage (px/ms). */
export const FLING_SPEED = 0.7;

/** Fenêtre, avant le relâcher, sur laquelle la vitesse est mesurée (ms). */
export const FLING_WINDOW_MS = 100;

export interface PointerSample {
	x: number;
	y: number;
	t: number;
}

/** Ajoute un point à la trace et oublie ceux devenus trop anciens pour mesurer l'élan. */
export function pushSample(trail: PointerSample[], sample: PointerSample): void {
	trail.push(sample);
	const limit = sample.t - FLING_WINDOW_MS * 2;
	while (trail.length > 2 && trail[0].t < limit) trail.shift();
}

/**
 * Vitesse horizontale (px/ms) du doigt juste avant le relâcher.
 *
 * Un doigt immobile n'émet plus de mouvement : si le dernier point date d'avant la fenêtre,
 * la vitesse est nulle.
 */
export function releaseSpeedX(trail: PointerSample[], now: number): number {
	const recent = trail.filter(s => s.t >= now - FLING_WINDOW_MS);
	if (recent.length < 2) return 0;
	const first = recent[0];
	const last = recent[recent.length - 1];
	const dt = Math.max(1, last.t - first.t);
	return Math.abs(last.x - first.x) / dt;
}

/** Relâcher en plein balayage horizontal : le geste ne doit pas déposer l'élément. */
export function isFlingRelease(trail: PointerSample[], now: number): boolean {
	return releaseSpeedX(trail, now) > FLING_SPEED;
}

/** Le panneau du calendrier a glissé depuis le début du geste (barre latérale qu'on referme). */
export function viewShifted(originLeft: number, currentLeft: number): boolean {
	return Math.abs(currentLeft - originLeft) > VIEW_SHIFT_PX;
}

/**
 * Créneau couvert par une sélection, de l'ancre (créneau touché en premier) au point courant.
 *
 * L'ancre est le début du créneau touché : en remontant, ce créneau reste compris dans la
 * sélection au lieu d'en devenir la borne exclue.
 */
export function selectionRange(anchor: number, current: number, snap: number): { start: number; end: number } {
	if (current >= anchor) return { start: anchor, end: Math.max(current, anchor + snap) };
	return { start: current, end: anchor + snap };
}
