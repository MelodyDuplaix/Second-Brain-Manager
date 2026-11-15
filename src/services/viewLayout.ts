/**
 * Règles de disposition des onglets du plugin.
 *
 * Les vues du plugin sont des singletons : un seul onglet par vue et par emplacement
 * (barre latérale gauche, barre latérale droite, zone principale). Le calendrier est donc
 * autorisé à la fois dans la barre latérale et en vue principale, mais jamais deux fois
 * au même endroit.
 *
 * Logique isolée d'Obsidian pour être vérifiable par des tests.
 */

/** Emplacement d'un onglet : les doublons se jugent par emplacement. */
export type LeafPlacement = 'left' | 'right' | 'main';

/**
 * Onglets à fermer pour qu'il ne reste qu'un exemplaire de chaque vue du plugin par emplacement.
 *
 * Le premier onglet rencontré est conservé : à l'ouverture d'Obsidian, c'est celui restauré
 * depuis `workspace.json`, qui a gardé son état (date affichée, défilement…). Les onglets
 * qui ne sont pas des vues du plugin ne sont jamais retournés.
 *
 * @param leaves      onglets dans l'ordre de parcours de l'espace de travail
 * @param viewType    type de vue déclaré par un onglet (`undefined` s'il n'en a pas)
 * @param placement   emplacement d'un onglet
 * @param isPluginView vrai si ce type de vue appartient au plugin
 */
export function findDuplicateLeaves<T>(
	leaves: readonly T[],
	viewType: (leaf: T) => string | undefined,
	placement: (leaf: T) => LeafPlacement,
	isPluginView: (type: string) => boolean
): T[] {
	const seen = new Set<string>();
	const duplicates: T[] = [];

	for (const leaf of leaves) {
		const type = viewType(leaf);
		if (!type || !isPluginView(type)) continue;
		const key = `${type}|${placement(leaf)}`;
		if (seen.has(key)) duplicates.push(leaf);
		else seen.add(key);
	}

	return duplicates;
}
