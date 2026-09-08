import { thGeneral } from './packs/th-general';

const PACKS: Record<string, { label: string; words: string[] }> = {
	'th-general': { label: 'ทั่วไป (ไทย)', words: thGeneral }
};

export const PACK_LIST = Object.entries(PACKS).map(([id, p]) => ({ id, label: p.label }));

export function getPack(id: string): string[] {
	return (PACKS[id] ?? PACKS['th-general']).words;
}

export function pickWord(packId: string, used: string[]): string {
	const all = getPack(packId);
	const fresh = all.filter((w) => !used.includes(w));
	const pool = fresh.length ? fresh : all;
	return pool[Math.floor(Math.random() * pool.length)];
}
