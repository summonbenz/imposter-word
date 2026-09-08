import {
	DEFAULT_CONFIG,
	QUESTION_CHOICES,
	ROUND_CHOICES,
	VOTE_CHOICES,
	CODE_LENGTH,
	type Outcome,
	type Player,
	type RoomConfig,
	type TallyEntry
} from './types';

export function sanitizeConfig(input: Partial<RoomConfig> | undefined): RoomConfig {
	const i = input ?? {};
	return {
		questionSeconds: QUESTION_CHOICES.includes(i.questionSeconds as number)
			? (i.questionSeconds as number)
			: DEFAULT_CONFIG.questionSeconds,
		discussionSeconds: DEFAULT_CONFIG.discussionSeconds,
		voteSeconds: VOTE_CHOICES.includes(i.voteSeconds as number)
			? (i.voteSeconds as number)
			: DEFAULT_CONFIG.voteSeconds,
		rounds: ROUND_CHOICES.includes(i.rounds as number)
			? (i.rounds as number)
			: DEFAULT_CONFIG.rounds,
		packId: typeof i.packId === 'string' ? i.packId : DEFAULT_CONFIG.packId,
		lang: i.lang === 'en' ? 'en' : 'th'
	};
}

export function computeTally(
	votes: Record<string, string>, // voterUid -> targetUid
	players: Player[]
): { tally: TallyEntry[]; accusedUid: string | null; tie: boolean; tiedUids: string[] } {
	const counts: Record<string, number> = {};
	for (const p of players) counts[p.uid] = 0;
	for (const target of Object.values(votes)) {
		if (target in counts) counts[target] += 1;
	}
	const tally: TallyEntry[] = players
		.map((p) => ({ uid: p.uid, name: p.name, votes: counts[p.uid] }))
		.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

	const top = tally[0];
	if (!top || top.votes === 0) return { tally, accusedUid: null, tie: false, tiedUids: [] };
	const tiedUids = tally.filter((t) => t.votes === top.votes).map((t) => t.uid);
	const tie = tiedUids.length > 1;
	return { tally, accusedUid: tie ? null : top.uid, tie, tiedUids: tie ? tiedUids : [] };
}

export function computeOutcome(args: {
	wordFound: boolean;
	accusedUid: string | null;
	imposterUid: string;
}): Outcome {
	if (!args.wordFound) return 'ALL_LOSE';
	// after any tie is broken, accusedUid is always set (or null only if nobody voted at all)
	return args.accusedUid === args.imposterUid ? 'COMMONS_WIN' : 'IMPOSTER_WIN';
}

// Points follow the ballot, not the table: only players who named the imposter
// earn, and what they earn depends on whether the table followed them.
export function computeScoreDeltas(args: {
	outcome: Outcome;
	players: Player[];
	imposterUid: string | null;
	votes: Record<string, string>; // voterUid -> targetUid
}): Record<string, number> {
	const d: Record<string, number> = {};
	for (const p of args.players) d[p.uid] = 0;
	const imposterUid = args.imposterUid;
	if (args.outcome === 'ALL_LOSE' || !imposterUid) return d;

	// the imposter naming themselves is not a correct call
	const correct = args.players
		.map((p) => p.uid)
		.filter((u) => u !== imposterUid && args.votes[u] === imposterUid);

	if (args.outcome === 'COMMONS_WIN') {
		// the table got it: every voter who called it gets 2, the imposter nothing
		for (const u of correct) d[u] = 2;
	} else if (correct.length) {
		// the table got it wrong, but a minority saw through it
		for (const u of correct) d[u] = 1;
		d[imposterUid] = 1;
	} else {
		// nobody named the imposter at all
		d[imposterUid] = 2;
	}
	return d;
}

export function nextMasterUid(order: string[], currentMasterUid: string | null): string {
	if (!order.length) throw new Error('empty master order');
	if (!currentMasterUid) return order[0];
	const i = order.indexOf(currentMasterUid);
	return order[(i + 1) % order.length];
}

export function pickImposterUid(playerUids: string[], masterUid: string): string {
	const pool = playerUids.filter((u) => u !== masterUid);
	return pool[Math.floor(Math.random() * pool.length)];
}

export function shuffle<T>(arr: readonly T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function genCode(): string {
	let s = '';
	for (let i = 0; i < CODE_LENGTH; i++)
		s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
	return s;
}
