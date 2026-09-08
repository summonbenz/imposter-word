// Shared domain model. Pure types + constants only — no firebase imports.
// Imported by Cloud Functions (authoritative) and by the Svelte client (rendering).

export type Role = 'common' | 'master' | 'imposter';

export type Phase =
	| 'LOBBY'
	| 'REVEAL'
	| 'QUESTION'
	| 'DISCUSSION'
	| 'VOTE'
	| 'TIEBREAK' // vote tied — the word-finder picks who it lands on
	| 'RESULT_VOTES'
	| 'RESULT_ROLE'
	| 'RESULT_SUMMARY'
	| 'MATCH_OVER';

export type Outcome =
	| 'COMMONS_WIN' // imposter caught and the word was found
	| 'IMPOSTER_WIN' // wrong accusation (or no votes), word was found
	| 'ALL_LOSE'; // word never found in time

export interface RoomConfig {
	questionSeconds: number; // 180 | 300 | 480
	discussionSeconds: number; // fixed
	voteSeconds: number; // 0 = off | 30 | 45 | 60 | 90 | 120
	rounds: number; // 0 = endless (host ends) | 3 | 5
	packId: string;
	lang: 'th' | 'en';
}

export const DEFAULT_CONFIG: RoomConfig = {
	questionSeconds: 300,
	discussionSeconds: 60,
	voteSeconds: 45,
	rounds: 5,
	packId: 'th-general',
	lang: 'th'
};

export const CODE_LENGTH = 5;
export const MIN_PLAYERS = 4;
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2h idle
export const PRESENCE_STALE_MS = 20 * 1000;

export const QUESTION_CHOICES = [180, 300, 480];
export const VOTE_CHOICES = [0, 30, 45, 60, 90, 120];
export const ROUND_CHOICES = [0, 3, 5];

export interface Player {
	uid: string;
	name: string;
	isHost: boolean;
	ready: boolean;
	score: number;
}

export interface TallyEntry {
	uid: string;
	name: string;
	votes: number;
}

export interface RoundResults {
	// written by finalizeVotes → RESULT_VOTES (or TIEBREAK)
	tally: TallyEntry[];
	accusedUid: string | null; // top-voted; null when nobody voted, or until a tie is broken
	tie: boolean; // true only while a tie is unresolved
	tiedUids: string[]; // the players level at the top, when tie
	tieBrokenBy: string | null; // uid of the word-finder who broke the tie
	// added by revealRole → RESULT_ROLE
	accusedRole: Role | null;
	imposterUid: string | null;
	imposterName: string | null;
	wordFound: boolean;
	word: string | null;
	outcome: Outcome | null;
	scoreDeltas: Record<string, number> | null;
}

export interface PublicRoom {
	code: string;
	status: Phase;
	round: number;
	config: RoomConfig;
	players: Player[];
	playerUids: string[]; // mirror of players[].uid, for security rules
	hostUid: string;
	masterUid: string | null;
	masterOrder: string[];
	createdAt: number;
	expiresAt: number;
	phaseEndsAt: number | null; // server ms epoch during QUESTION / DISCUSSION / VOTE
	wordFoundBy: string | null; // uid the Moderator marked as the guesser, or null
	revealAcks: string[];
	votesLocked: number;
	results: RoundResults | null;
}

// rooms/{code}/private/{uid}
export interface PrivateState {
	role: Role;
	word: string | null; // master + imposter only
	round: number;
}

// rooms/{code}/secret/state — never readable by clients
export interface SecretState {
	word: string;
	imposterUid: string;
	masterUid: string;
	round: number;
	usedWords: string[];
}

// rooms/{code}/votes/{uid}
export interface VoteDoc {
	targetUid: string;
	at: number;
}

export function roleOf(uid: string, masterUid: string | null, imposterUid: string | null): Role {
	if (uid === masterUid) return 'master';
	if (uid === imposterUid) return 'imposter';
	return 'common';
}
