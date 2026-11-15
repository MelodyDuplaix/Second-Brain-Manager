/**
 * Poussée des blocs voisins dans la grille horaire du calendrier.
 *
 * Trois façons d'étirer ou de déplacer un bloc (événement, tâche ou entrée de journal) :
 *
 *   - **par un bord** : seule la durée du bloc change, les voisins ne bougent pas
 *     (aucune fonction ici, le calcul tient en une ligne dans la vue) ;
 *   - **par le mini-bouton du haut ou du bas** (`resolveEdgePush`) : le bord du voisin qui fait
 *     face **suit** le bord tiré, à écart constant. Le voisin s'allonge ou se raccourcit, et
 *     quand il ne peut plus se raccourcir il est décalé — en chaîne ;
 *   - **par le mini-bouton du milieu** (`resolveMovePush`) : le bloc se déplace à durée
 *     constante et pousse devant lui les blocs rencontrés, eux aussi à durée constante.
 *
 * Inspiré de ce que permettait le plugin Day Planner.
 * Logique isolée de l'interface pour être vérifiable par des tests.
 */

/** Sens d'une poussée : vers le haut (matin) ou vers le bas (soir). */
export type PushDirection = 'up' | 'down';

/** Un bloc de la grille, réduit à ce qui sert au calcul. */
export interface PushBlock {
	key: string;
	/** Minutes depuis minuit */
	start: number;
	end: number;
	/** Un bloc non déplaçable (événement à cheval sur plusieurs jours) fait mur : la chaîne s'arrête. */
	movable: boolean;
}

/** Nouvelle position calculée pour un bloc voisin. */
export interface PushShift {
	key: string;
	start: number;
	end: number;
}

export interface PushBounds {
	/** Minute la plus tôt atteignable (bord haut de la journée) */
	min: number;
	/** Minute la plus tard atteignable (bord bas de la journée) */
	max: number;
}

export const DEFAULT_PUSH_BOUNDS: PushBounds = { min: 0, max: 1440 };

/** Durée minimale d'un bloc : en dessous, il est décalé au lieu d'être encore raccourci. */
export const MIN_BLOCK_MINUTES = 15;

/**
 * Écart, en minutes, en dessous duquel deux blocs sont considérés comme collés.
 *
 * Collés (écart strictement inférieur), un bord qui s'éloigne du voisin le tire, à écart
 * constant. Sinon, le voisin ne suit pas : il ne bouge qu'à partir du contact, quand le bord
 * tiré atteint le sien.
 */
export const PULL_LINK_MAX_GAP = 5;

/**
 * Mini-bouton du haut ou du bas : le bord du voisin qui fait face suit le bord tiré.
 *
 * Deux comportements, selon que les blocs sont accrochés ou non (`PULL_LINK_MAX_GAP`) :
 *
 * - **collés** (écart d'origine inférieur à `PULL_LINK_MAX_GAP`) : un bord qui s'éloigne du voisin le tire, à écart
 *   constant. Avec un bloc de 10 h–11 h et un autre de 11 h–12 h, descendre de 30 min le
 *   bouton du haut du second allonge le premier de 30 min. Un bord qui s'approche, lui, ne
 *   pousse qu'au contact, comme pour des blocs éloignés ;
 * - **éloignés** : le voisin ne suit pas un bord qui s'écarte de lui. Il ne bouge qu'à partir du
 *   contact, quand le bord tiré atteint le sien, et il est alors poussé.
 *
 * Dans les deux cas, le voisin se raccourcit jusqu'à la durée minimale ; en dessous il est
 * décalé, et le bloc d'après prend le relais.
 *
 * Le calcul repart toujours des positions d'origine, jamais du dernier état calculé : pendant un
 * même glisser, revenir en arrière remet donc les voisins exactement où ils étaient.
 *
 * Seuls les blocs de la pile concernée sont candidats : vers le haut, ceux qui finissaient avant
 * le début d'origine du bloc tiré ; vers le bas, ceux qui commençaient après sa fin d'origine. Un
 * bloc qui le chevauchait déjà (affiché côte à côte) n'est donc jamais touché.
 *
 * La chaîne s'arrête au premier bloc qui n'a pas à bouger, au premier bloc non déplaçable, au
 * premier bloc dont seule la durée change, et au bord de la journée.
 *
 * @param blocks     tous les blocs du jour, bloc tiré compris
 * @param draggedKey clé du bloc tiré
 * @param edge       nouvelle minute du bord tiré (début si `up`, fin si `down`)
 * @param direction  bord tiré : haut (`up`) ou bas (`down`)
 */
export function resolveEdgePush(
	blocks: readonly PushBlock[],
	draggedKey: string,
	edge: number,
	direction: PushDirection,
	bounds: PushBounds = DEFAULT_PUSH_BOUNDS,
	minDuration = MIN_BLOCK_MINUTES
): PushShift[] {
	const dragged = blocks.find(b => b.key === draggedKey);
	if (!dragged) return [];
	const others = blocks.filter(b => b.key !== draggedKey);
	const shifts: PushShift[] = [];

	if (direction === 'up') {
		const candidates = others
			.filter(b => b.end <= dragged.start)
			.sort((a, b) => b.end - a.end || b.start - a.start);

		// Repères : début du bloc du dessous dans la chaîne, avant et après le glisser
		let anchorWas = dragged.start;
		let anchorNow = edge;

		for (const block of candidates) {
			const gap = anchorWas - block.end;
			// Le bord tiré s'éloigne (descend) d'un voisin accroché : il le tire, à écart constant.
			// Sinon, le voisin ne bouge qu'au contact : il est alors poussé.
			const pulled = gap < PULL_LINK_MAX_GAP && anchorNow > anchorWas;
			const end = pulled ? anchorNow - gap : Math.min(block.end, anchorNow);
			if (end === block.end) break;
			if (!block.movable) break;
			// Il ne peut plus se raccourcir : son début recule aussi
			const start = Math.min(block.start, end - minDuration);
			if (start < bounds.min) break;
			shifts.push({ key: block.key, start, end });
			// Si seule sa durée a changé, rien au-dessus n'est concerné
			if (start === block.start) break;
			anchorWas = block.start;
			anchorNow = start;
		}
		return shifts;
	}

	const candidates = others
		.filter(b => b.start >= dragged.end)
		.sort((a, b) => a.start - b.start || a.end - b.end);

	// Repères : fin du bloc du dessus dans la chaîne, avant et après le glisser
	let anchorWas = dragged.end;
	let anchorNow = edge;

	for (const block of candidates) {
		const gap = block.start - anchorWas;
		// Le bord tiré s'éloigne (remonte) d'un voisin accroché : il le tire, à écart constant.
		// Sinon, le voisin ne bouge qu'au contact : il est alors poussé.
		const pulled = gap < PULL_LINK_MAX_GAP && anchorNow < anchorWas;
		const start = pulled ? anchorNow + gap : Math.max(block.start, anchorNow);
		if (start === block.start) break;
		if (!block.movable) break;
		const end = Math.max(block.end, start + minDuration);
		if (end > bounds.max) break;
		shifts.push({ key: block.key, start, end });
		if (end === block.end) break;
		anchorWas = block.end;
		anchorNow = end;
	}
	return shifts;
}

/**
 * Mini-bouton du milieu : le bloc se déplace à durée constante et pousse devant lui les blocs
 * qu'il rencontre, eux aussi à durée constante.
 *
 * Seuls les blocs situés devant lui, dans le sens du déplacement, sont candidats ; ceux qu'il
 * quitte derrière lui ne sont pas rappelés. Comme pour `resolveEdgePush`, le calcul repart des
 * positions d'origine, et la chaîne s'arrête au premier bloc qui a la place, au premier bloc non
 * déplaçable et au bord de la journée.
 *
 * @param newStart nouveau début du bloc déplacé
 * @param newEnd   nouvelle fin du bloc déplacé (même durée)
 */
export function resolveMovePush(
	blocks: readonly PushBlock[],
	draggedKey: string,
	newStart: number,
	newEnd: number,
	bounds: PushBounds = DEFAULT_PUSH_BOUNDS
): PushShift[] {
	const dragged = blocks.find(b => b.key === draggedKey);
	if (!dragged || newStart === dragged.start) return [];
	const others = blocks.filter(b => b.key !== draggedKey);
	const shifts: PushShift[] = [];

	if (newStart > dragged.start) {
		// Vers le bas : tout ce qui commençait à partir de lui
		const candidates = others
			.filter(b => b.start >= dragged.start)
			.sort((a, b) => a.start - b.start || a.end - b.end);

		let floor = newEnd;
		for (const block of candidates) {
			if (block.start >= floor) break;
			if (!block.movable) break;
			const duration = block.end - block.start;
			const start = Math.min(floor, bounds.max - duration);
			if (start <= block.start) break;
			shifts.push({ key: block.key, start, end: start + duration });
			floor = start + duration;
		}
		return shifts;
	}

	// Vers le haut : tout ce qui finissait jusqu'à lui
	const candidates = others
		.filter(b => b.end <= dragged.end)
		.sort((a, b) => b.end - a.end || b.start - a.start);

	let ceiling = newStart;
	for (const block of candidates) {
		if (block.end <= ceiling) break;
		if (!block.movable) break;
		const duration = block.end - block.start;
		const end = Math.max(ceiling, bounds.min + duration);
		if (end >= block.end) break;
		shifts.push({ key: block.key, start: end - duration, end });
		ceiling = end - duration;
	}
	return shifts;
}
