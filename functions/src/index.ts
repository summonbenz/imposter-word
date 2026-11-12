import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';

import {
	CODE_LENGTH,
	MIN_PLAYERS,
	ROOM_TTL_MS,
	roleOf,
	type Player,
	type PublicRoom,
	type PrivateState,
	type RoundResults,
	type SecretState,
	type VoteDoc
} from './game/types';
import {
	computeOutcome,
	computeScoreDeltas,
	computeTally,
	genCode,
	nextMasterUid,
	pickImposterUid,
	sanitizeConfig,
	shuffle
} from './game/rules';
import { pickWord } from './game/words';

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

// ---------- helpers ----------

const nowMs = () => Date.now();
const nextExpiry = () => nowMs() + ROOM_TTL_MS;
const roomRef = (code: string) => db.doc(`rooms/${code}`);
const secretRef = (code: string) => roomRef(code).collection('secret').doc('state');
const privateRef = (code: string, uid: string) => roomRef(code).collection('private').doc(uid);
const voteRef = (code: string, uid: string) => roomRef(code).collection('votes').doc(uid);
const presenceRef = (code: string, uid: string) => roomRef(code).collection('presence').doc(uid);

// phases where a round is being played out and its secret still matters
const LIVE_PHASES: PublicRoom['status'][] = ['REVEAL', 'QUESTION', 'DISCUSSION', 'VOTE', 'TIEBREAK'];

function requireAuth(req: CallableRequest): string {
	const uid = req.auth?.uid;
	if (!uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อน');
	return uid;
}

function cleanName(raw: unknown): string {
	const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 20) : '';
	if (!s) throw new HttpsError('invalid-argument', 'ใส่ชื่อก่อน');
	return s;
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`);
function cleanCode(raw: unknown): string {
	const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
	if (!CODE_RE.test(s)) throw new HttpsError('invalid-argument', 'รหัสห้องไม่ถูกต้อง');
	return s;
}

async function readRoom(t: Transaction, code: string): Promise<PublicRoom> {
	const snap = await t.get(roomRef(code));
	if (!snap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
	return snap.data() as PublicRoom;
}

/** Transaction that only needs the room doc: read happens first, callback only writes. */
async function withRoom<T>(
	code: string,
	fn: (room: PublicRoom, t: Transaction) => T | Promise<T>
): Promise<T> {
	return db.runTransaction(async (t) => fn(await readRoom(t, code), t));
}

function requireHost(room: PublicRoom, uid: string) {
	if (room.hostUid !== uid) throw new HttpsError('permission-denied', 'ทำได้เฉพาะ host');
}
// the Moderator never holds a suspect role, so phase pushes that could rush the
// table (opening the vote) belong to them, not to the host
function requireMaster(room: PublicRoom, uid: string) {
	if (room.masterUid !== uid)
		throw new HttpsError('permission-denied', 'ทำได้เฉพาะผู้ดำเนินเกม');
}
function requireMember(room: PublicRoom, uid: string) {
	if (!room.playerUids.includes(uid)) throw new HttpsError('permission-denied', 'ไม่ได้อยู่ในห้องนี้');
}

// ---------- lobby ----------

export const createRoom = onCall(async (req) => {
	const uid = requireAuth(req);
	const name = cleanName(req.data?.name);
	const config = sanitizeConfig(req.data?.config);

	for (let attempt = 0; attempt < 8; attempt++) {
		const code = genCode();
		const ref = roomRef(code);
		try {
			await db.runTransaction(async (t) => {
				if ((await t.get(ref)).exists) throw new HttpsError('already-exists', 'code-taken');
				const player: Player = { uid, name, isHost: true, ready: false, score: 0 };
				const room: PublicRoom = {
					code,
					status: 'LOBBY',
					round: 0,
					config,
					players: [player],
					playerUids: [uid],
					hostUid: uid,
					masterUid: null,
					masterOrder: [],
					createdAt: nowMs(),
					expiresAt: nextExpiry(),
					phaseEndsAt: null,
					wordFoundBy: null,
					revealAcks: [],
					votesLocked: 0,
					votedUids: [],
					results: null,
					notice: null
				};
				t.set(ref, room);
			});
			return { code };
		} catch (e) {
			if (e instanceof HttpsError && e.message === 'code-taken') continue;
			throw e;
		}
	}
	throw new HttpsError('resource-exhausted', 'สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง');
});

export const joinRoom = onCall(async (req) => {
	const uid = requireAuth(req);
	const name = cleanName(req.data?.name);
	const code = cleanCode(req.data?.code);

	await withRoom(code, (room, t) => {
		if (room.players.some((p) => p.uid === uid)) {
			t.update(roomRef(code), {
				players: room.players.map((p) => (p.uid === uid ? { ...p, name } : p)),
				expiresAt: nextExpiry()
			});
			return;
		}
		if (room.status !== 'LOBBY')
			throw new HttpsError('failed-precondition', 'เกมเริ่มไปแล้ว เข้าร่วมไม่ได้');
		if (room.players.length >= 12) throw new HttpsError('resource-exhausted', 'ห้องเต็มแล้ว');
		const player: Player = { uid, name, isHost: false, ready: false, score: 0 };
		t.update(roomRef(code), {
			players: [...room.players, player],
			playerUids: [...room.playerUids, uid],
			expiresAt: nextExpiry()
		});
	});
	return { code };
});

export const leaveRoom = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		if (room.status !== 'LOBBY') return; // mid-game leaves are handled by presence, not removal
		if (!room.players.some((p) => p.uid === uid)) return;
		const players = room.players.filter((p) => p.uid !== uid);
		if (players.length === 0) {
			t.delete(roomRef(code));
			return;
		}
		const hostUid = room.hostUid === uid ? players[0].uid : room.hostUid;
		t.update(roomRef(code), {
			players: players.map((p) => ({ ...p, isHost: p.uid === hostUid })),
			playerUids: players.map((p) => p.uid),
			hostUid,
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

export const setReady = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const ready = req.data?.ready === true;
	await withRoom(code, (room, t) => {
		requireMember(room, uid);
		if (room.status !== 'LOBBY') throw new HttpsError('failed-precondition', 'ไม่ได้อยู่ในล็อบบี้');
		t.update(roomRef(code), {
			players: room.players.map((p) => (p.uid === uid ? { ...p, ready } : p)),
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

// rename yourself at any point; names baked into this round's results follow along
export const renameSelf = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const name = cleanName(req.data?.name);
	await withRoom(code, (room, t) => {
		requireMember(room, uid);
		const r = room.results;
		t.update(roomRef(code), {
			players: room.players.map((p) => (p.uid === uid ? { ...p, name } : p)),
			results: r
				? {
						...r,
						tally: r.tally.map((e) => (e.uid === uid ? { ...e, name } : e)),
						imposterName: r.imposterUid === uid ? name : r.imposterName
					}
				: null,
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

export const updateConfig = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		requireHost(room, uid);
		if (room.status !== 'LOBBY')
			throw new HttpsError('failed-precondition', 'ปรับตั้งค่าได้เฉพาะในล็อบบี้');
		t.update(roomRef(code), {
			config: sanitizeConfig({ ...room.config, ...req.data?.config }),
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

/** Drop the table back to the lobby: dealt roles and ballots go, everyone un-readies. */
function resetToLobby(
	t: Transaction,
	code: string,
	room: PublicRoom,
	players: Player[],
	opts: { keepScores: boolean; round: number; notice: string | null }
) {
	for (const p of room.players) {
		t.delete(privateRef(code, p.uid));
		t.delete(voteRef(code, p.uid));
	}
	t.update(roomRef(code), {
		status: 'LOBBY',
		round: opts.round,
		players: players.map((p) => ({
			...p,
			ready: false,
			score: opts.keepScores ? p.score : 0
		})),
		playerUids: players.map((p) => p.uid),
		masterUid: null,
		masterOrder: [],
		phaseEndsAt: null,
		wordFoundBy: null,
		revealAcks: [],
		votesLocked: 0,
		votedUids: [],
		results: null,
		notice: opts.notice,
		expiresAt: nextExpiry()
	});
}

// Host removes a player. Mid-round the round is voided rather than played on short-handed:
// carrying on would tell the table whether the kicked player was the Imposter.
export const kickPlayer = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const target = typeof req.data?.targetUid === 'string' ? req.data.targetUid : null;
	await withRoom(code, (room, t) => {
		requireHost(room, uid);
		if (!target) throw new HttpsError('invalid-argument', 'เลือกผู้เล่นที่จะเตะ');
		if (target === uid) throw new HttpsError('invalid-argument', 'เตะตัวเองไม่ได้');
		const kicked = room.players.find((p) => p.uid === target);
		if (!kicked) return; // already gone
		const players = room.players.filter((p) => p.uid !== target);
		t.delete(presenceRef(code, target));
		t.delete(privateRef(code, target));
		t.delete(voteRef(code, target));

		if (LIVE_PHASES.includes(room.status)) {
			resetToLobby(t, code, room, players, {
				keepScores: true,
				round: Math.max(0, room.round - 1), // the voided round doesn't count
				notice: `${kicked.name} ถูกเตะออก รอบที่เล่นอยู่ถูกยกเลิก แต้มยังอยู่ครบ`
			});
			return;
		}
		t.update(roomRef(code), {
			players,
			playerUids: players.map((p) => p.uid),
			masterOrder: room.masterOrder.filter((u) => u !== target),
			revealAcks: room.revealAcks.filter((u) => u !== target),
			notice: `${kicked.name} ถูกเตะออกจากห้อง`,
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

// ---------- round lifecycle ----------

function writeNewRound(
	t: Transaction,
	code: string,
	room: PublicRoom,
	opts: { fromLobby: boolean; used: string[] }
) {
	const ref = roomRef(code);
	const order =
		opts.fromLobby || room.masterOrder.length !== room.players.length
			? shuffle(room.playerUids)
			: room.masterOrder;
	const masterUid = opts.fromLobby ? order[0] : nextMasterUid(order, room.masterUid);
	const imposterUid = pickImposterUid(room.playerUids, masterUid);
	const word = pickWord(room.config.packId, opts.used);
	const round = room.round + 1;

	t.set(secretRef(code), {
		word,
		imposterUid,
		masterUid,
		round,
		usedWords: [...opts.used, word]
	} satisfies SecretState);

	for (const p of room.players) {
		const role = roleOf(p.uid, masterUid, imposterUid);
		t.set(privateRef(code, p.uid), {
			role,
			word: role === 'common' ? null : word,
			round
		} satisfies PrivateState);
		t.delete(voteRef(code, p.uid));
	}

	t.update(ref, {
		status: 'REVEAL',
		round,
		masterUid,
		masterOrder: order,
		phaseEndsAt: null,
		wordFoundBy: null,
		revealAcks: [],
		votesLocked: 0,
		votedUids: [],
		results: null,
		notice: null,
		expiresAt: nextExpiry()
	});
}

export const startRound = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await db.runTransaction(async (t) => {
		const [rSnap, sSnap] = await t.getAll(roomRef(code), secretRef(code));
		if (!rSnap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
		const room = rSnap.data() as PublicRoom;
		requireHost(room, uid);
		if (room.status !== 'LOBBY')
			throw new HttpsError('failed-precondition', 'เริ่มได้จากล็อบบี้เท่านั้น');
		if (room.players.length < MIN_PLAYERS)
			throw new HttpsError('failed-precondition', `ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน`);
		if (!room.players.every((p) => p.ready))
			throw new HttpsError('failed-precondition', 'ยังมีผู้เล่นไม่กด "พร้อม"');
		const used = sSnap.exists ? ((sSnap.data() as SecretState).usedWords ?? []) : [];
		writeNewRound(t, code, room, { fromLobby: true, used });
	});
	return { ok: true };
});

export const ackReveal = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		if (room.status !== 'REVEAL') return;
		requireMember(room, uid);
		const acks = room.revealAcks.includes(uid) ? room.revealAcks : [...room.revealAcks, uid];
		const allIn = room.players.every((p) => acks.includes(p.uid));
		t.update(
			roomRef(code),
			allIn
				? {
						revealAcks: acks,
						status: 'QUESTION',
						phaseEndsAt: nowMs() + room.config.questionSeconds * 1000,
						expiresAt: nextExpiry()
					}
				: { revealAcks: acks, expiresAt: nextExpiry() }
		);
	});
	return { ok: true };
});

export const forceQuestion = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		requireMaster(room, uid);
		if (room.status !== 'REVEAL') throw new HttpsError('failed-precondition', 'ไม่ได้อยู่ช่วงเปิดบทบาท');
		t.update(roomRef(code), {
			status: 'QUESTION',
			phaseEndsAt: nowMs() + room.config.questionSeconds * 1000,
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

export const markWordFound = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const by = typeof req.data?.guessedByUid === 'string' ? req.data.guessedByUid : null;
	await withRoom(code, (room, t) => {
		if (room.status !== 'QUESTION') throw new HttpsError('failed-precondition', 'ยังไม่ถึงช่วงถาม');
		if (room.masterUid !== uid) throw new HttpsError('permission-denied', 'เฉพาะผู้ดำเนินเกม');
		if (!by || !room.playerUids.includes(by) || by === room.masterUid)
			throw new HttpsError('invalid-argument', 'เลือกคนที่ทายคำถูกก่อน');
		t.update(roomRef(code), {
			status: 'DISCUSSION',
			wordFoundBy: by,
			phaseEndsAt: nowMs() + room.config.discussionSeconds * 1000,
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

function finalizeAllLose(t: Transaction, code: string, room: PublicRoom, secret: SecretState) {
	const results: RoundResults = {
		tally: [],
		accusedUid: null,
		tie: false,
		tiedUids: [],
		tieBrokenBy: null,
		accusedRole: null,
		imposterUid: secret.imposterUid,
		imposterName: room.players.find((p) => p.uid === secret.imposterUid)?.name ?? null,
		wordFound: false,
		word: secret.word,
		outcome: 'ALL_LOSE',
		scoreDeltas: Object.fromEntries(room.players.map((p) => [p.uid, 0]))
	};
	t.update(roomRef(code), {
		status: 'RESULT_SUMMARY',
		phaseEndsAt: null,
		results,
		expiresAt: nextExpiry()
	});
}

export const giveUp = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await db.runTransaction(async (t) => {
		const [rSnap, sSnap] = await t.getAll(roomRef(code), secretRef(code));
		if (!rSnap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
		const room = rSnap.data() as PublicRoom;
		if (room.status !== 'QUESTION') throw new HttpsError('failed-precondition', 'ยังไม่ถึงช่วงถาม');
		if (room.masterUid !== uid) throw new HttpsError('permission-denied', 'เฉพาะผู้ดำเนินเกม');
		if (!sSnap.exists) throw new HttpsError('internal', 'ข้อมูลรอบหาย');
		finalizeAllLose(t, code, room, sSnap.data() as SecretState);
	});
	return { ok: true };
});

function toVote(t: Transaction, code: string, room: PublicRoom) {
	t.update(roomRef(code), {
		status: 'VOTE',
		phaseEndsAt: room.config.voteSeconds > 0 ? nowMs() + room.config.voteSeconds * 1000 : null,
		votesLocked: 0,
		votedUids: [],
		expiresAt: nextExpiry()
	});
}

export const startVote = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		requireMaster(room, uid);
		if (room.status !== 'DISCUSSION') throw new HttpsError('failed-precondition', 'ยังไม่ถึงช่วงถกเถียง');
		toVote(t, code, room);
	});
	return { ok: true };
});

async function finalizeVotesInternal(code: string) {
	await db.runTransaction(async (t) => {
		const rSnap = await t.get(roomRef(code));
		if (!rSnap.exists) return;
		const room = rSnap.data() as PublicRoom;
		if (room.status !== 'VOTE') return; // already finalized by another caller
		const vSnap = await t.get(roomRef(code).collection('votes'));
		const votes: Record<string, string> = {};
		vSnap.forEach((d) => {
			votes[d.id] = (d.data() as VoteDoc).targetUid;
		});
		const { tally, accusedUid, tie, tiedUids } = computeTally(votes, room.players);
		const results: RoundResults = {
			tally,
			accusedUid,
			tie,
			tiedUids,
			tieBrokenBy: null,
			accusedRole: null,
			imposterUid: null,
			imposterName: null,
			wordFound: !!room.wordFoundBy,
			word: null,
			outcome: null,
			scoreDeltas: null
		};
		t.update(roomRef(code), {
			// a tie hands the call to the Moderator before results are shown
			status: tie ? 'TIEBREAK' : 'RESULT_VOTES',
			phaseEndsAt: null,
			results,
			expiresAt: nextExpiry()
		});
	});
}

export const breakTie = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const target = typeof req.data?.targetUid === 'string' ? req.data.targetUid : null;
	await withRoom(code, (room, t) => {
		if (room.status !== 'TIEBREAK') throw new HttpsError('failed-precondition', 'ไม่มีคะแนนเสมอให้ตัดสิน');
		// a tie is the Moderator's call: they are the one seat that never holds a suspect role
		requireMaster(room, uid);
		const r = room.results;
		if (!r) throw new HttpsError('internal', 'ข้อมูลรอบหาย');
		if (!target || !r.tiedUids.includes(target))
			throw new HttpsError('invalid-argument', 'เลือกจากคนที่คะแนนเสมอกันเท่านั้น');
		t.update(roomRef(code), {
			status: 'RESULT_VOTES',
			results: { ...r, accusedUid: target, tie: false, tieBrokenBy: room.masterUid },
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

export const lockVote = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const target = typeof req.data?.targetUid === 'string' ? req.data.targetUid : null;
	let triggerFinalize = false;

	await db.runTransaction(async (t) => {
		const [rSnap, vSnap] = await t.getAll(roomRef(code), voteRef(code, uid));
		if (!rSnap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
		const room = rSnap.data() as PublicRoom;
		if (room.status !== 'VOTE') throw new HttpsError('failed-precondition', 'ยังไม่ถึงช่วงโหวต');
		requireMember(room, uid);
		if (!target || !room.playerUids.includes(target))
			throw new HttpsError('invalid-argument', 'เลือกผู้เล่นไม่ถูกต้อง');
		// the Moderator sits out of suspicion entirely — a vote can never land on them
		if (target === room.masterUid)
			throw new HttpsError('invalid-argument', 'โหวตผู้ดำเนินเกมไม่ได้');
		if (vSnap.exists) throw new HttpsError('failed-precondition', 'ล็อกโหวตไปแล้ว');
		t.set(voteRef(code, uid), { targetUid: target, at: nowMs() } satisfies VoteDoc);
		const locked = room.votesLocked + 1;
		t.update(roomRef(code), {
			votesLocked: locked,
			votedUids: [...(room.votedUids ?? []), uid],
			expiresAt: nextExpiry()
		});
		if (locked >= room.players.length) triggerFinalize = true;
	});

	if (triggerFinalize) await finalizeVotesInternal(code);
	return { ok: true };
});

export const expirePhase = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	const snap = await roomRef(code).get();
	if (!snap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
	const room0 = snap.data() as PublicRoom;
	requireMember(room0, uid);
	if (room0.phaseEndsAt == null || nowMs() < room0.phaseEndsAt) return { ok: false };

	if (room0.status === 'QUESTION') {
		await db.runTransaction(async (t) => {
			const [rSnap, sSnap] = await t.getAll(roomRef(code), secretRef(code));
			const room = rSnap.data() as PublicRoom;
			if (room.status !== 'QUESTION' || room.phaseEndsAt == null || nowMs() < room.phaseEndsAt) return;
			if (!sSnap.exists) return;
			finalizeAllLose(t, code, room, sSnap.data() as SecretState);
		});
	} else if (room0.status === 'DISCUSSION') {
		await withRoom(code, (room, t) => {
			if (room.status !== 'DISCUSSION' || room.phaseEndsAt == null || nowMs() < room.phaseEndsAt)
				return;
			toVote(t, code, room);
		});
	} else if (room0.status === 'VOTE') {
		await finalizeVotesInternal(code);
	}
	return { ok: true };
});

// ---------- result reveal (3 beats) ----------

export const revealRole = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await db.runTransaction(async (t) => {
		const [rSnap, sSnap] = await t.getAll(roomRef(code), secretRef(code));
		const vSnap = await t.get(roomRef(code).collection('votes'));
		if (!rSnap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
		const room = rSnap.data() as PublicRoom;
		requireHost(room, uid);
		if (room.status !== 'RESULT_VOTES')
			throw new HttpsError('failed-precondition', 'ยังไม่ถึงจังหวะเปิดบทบาท');
		if (!sSnap.exists || !room.results) throw new HttpsError('internal', 'ข้อมูลรอบหาย');
		const secret = sSnap.data() as SecretState;
		const votes: Record<string, string> = {};
		vSnap.forEach((d) => {
			votes[d.id] = (d.data() as VoteDoc).targetUid;
		});
		const r = room.results;
		const outcome = computeOutcome({
			wordFound: r.wordFound,
			accusedUid: r.accusedUid,
			imposterUid: secret.imposterUid
		});
		const results: RoundResults = {
			...r,
			accusedRole: r.accusedUid
				? roleOf(r.accusedUid, secret.masterUid, secret.imposterUid)
				: null,
			imposterUid: secret.imposterUid,
			imposterName: room.players.find((p) => p.uid === secret.imposterUid)?.name ?? null,
			word: secret.word,
			outcome,
			scoreDeltas: computeScoreDeltas({
				outcome,
				players: room.players,
				imposterUid: secret.imposterUid,
				votes
			})
		};
		t.update(roomRef(code), { status: 'RESULT_ROLE', results, expiresAt: nextExpiry() });
	});
	return { ok: true };
});

export const showSummary = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		requireHost(room, uid);
		if (room.status !== 'RESULT_ROLE') throw new HttpsError('failed-precondition', 'ยังไม่ถึงจังหวะสรุป');
		const deltas = room.results?.scoreDeltas ?? {};
		t.update(roomRef(code), {
			status: 'RESULT_SUMMARY',
			players: room.players.map((p) => ({ ...p, score: p.score + (deltas[p.uid] ?? 0) })),
			expiresAt: nextExpiry()
		});
	});
	return { ok: true };
});

export const nextRound = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await db.runTransaction(async (t) => {
		const [rSnap, sSnap] = await t.getAll(roomRef(code), secretRef(code));
		if (!rSnap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
		const room = rSnap.data() as PublicRoom;
		requireHost(room, uid);
		if (room.status !== 'RESULT_SUMMARY') throw new HttpsError('failed-precondition', 'ยังไม่จบรอบ');
		if (room.config.rounds > 0 && room.round >= room.config.rounds) {
			t.update(roomRef(code), { status: 'MATCH_OVER', phaseEndsAt: null, expiresAt: nextExpiry() });
			return;
		}
		// kicks can leave the table short — wait in the lobby for more people, scores intact
		if (room.players.length < MIN_PLAYERS) {
			resetToLobby(t, code, room, room.players, {
				keepScores: true,
				round: room.round,
				notice: `ผู้เล่นเหลือไม่ถึง ${MIN_PLAYERS} คน รอเพื่อนเข้ามาเพิ่มก่อนเล่นต่อ`
			});
			return;
		}
		const used = sSnap.exists ? ((sSnap.data() as SecretState).usedWords ?? []) : [];
		writeNewRound(t, code, room, { fromLobby: false, used });
	});
	return { ok: true };
});

export const endMatch = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await withRoom(code, (room, t) => {
		requireHost(room, uid);
		if (room.status === 'LOBBY' || room.status === 'MATCH_OVER') return;
		t.update(roomRef(code), { status: 'MATCH_OVER', phaseEndsAt: null, expiresAt: nextExpiry() });
	});
	return { ok: true };
});

// back to the lobby with scores wiped — from the end screen, or mid-match as a restart.
// The word history survives so a restarted match doesn't re-deal a word people just saw.
export const rematch = onCall(async (req) => {
	const uid = requireAuth(req);
	const code = cleanCode(req.data?.code);
	await db.runTransaction(async (t) => {
		const [rSnap, sSnap] = await t.getAll(roomRef(code), secretRef(code));
		if (!rSnap.exists) throw new HttpsError('not-found', 'ไม่พบห้องนี้');
		const room = rSnap.data() as PublicRoom;
		requireHost(room, uid);
		if (room.status === 'LOBBY') return;
		const used = sSnap.exists ? ((sSnap.data() as SecretState).usedWords ?? []) : [];
		t.set(secretRef(code), { usedWords: used });
		resetToLobby(t, code, room, room.players, { keepScores: false, round: 0, notice: null });
	});
	return { ok: true };
});

// ---------- housekeeping ----------

export const cleanupRooms = onSchedule('every 60 minutes', async () => {
	const q = await db.collection('rooms').where('expiresAt', '<', Date.now()).limit(200).get();
	for (const doc of q.docs) await db.recursiveDelete(doc.ref);
});
