import { httpsCallable } from 'firebase/functions';
import type { RoomConfig } from '$game/types';
import { functions } from './client';

function call<Req extends object, Res>(name: string) {
	const fn = httpsCallable<Req, Res>(functions, name);
	return async (data: Req): Promise<Res> => (await fn(data)).data;
}

type Code = { code: string };

export const api = {
	createRoom: call<{ name: string; config?: Partial<RoomConfig> }, Code>('createRoom'),
	joinRoom: call<{ code: string; name: string }, Code>('joinRoom'),
	leaveRoom: call<Code, { ok: boolean }>('leaveRoom'),
	setReady: call<Code & { ready: boolean }, { ok: boolean }>('setReady'),
	renameSelf: call<Code & { name: string }, { ok: boolean }>('renameSelf'),
	updateConfig: call<Code & { config: Partial<RoomConfig> }, { ok: boolean }>('updateConfig'),
	startRound: call<Code, { ok: boolean }>('startRound'),
	ackReveal: call<Code, { ok: boolean }>('ackReveal'),
	forceQuestion: call<Code, { ok: boolean }>('forceQuestion'),
	markWordFound: call<Code & { guessedByUid: string }, { ok: boolean }>('markWordFound'),
	giveUp: call<Code, { ok: boolean }>('giveUp'),
	startVote: call<Code, { ok: boolean }>('startVote'),
	lockVote: call<Code & { targetUid: string }, { ok: boolean }>('lockVote'),
	breakTie: call<Code & { targetUid: string }, { ok: boolean }>('breakTie'),
	expirePhase: call<Code, { ok: boolean }>('expirePhase'),
	revealRole: call<Code, { ok: boolean }>('revealRole'),
	showSummary: call<Code, { ok: boolean }>('showSummary'),
	nextRound: call<Code, { ok: boolean }>('nextRound'),
	endMatch: call<Code, { ok: boolean }>('endMatch'),
	rematch: call<Code, { ok: boolean }>('rematch')
};

export function errText(e: unknown): string {
	const m = (e as { message?: string })?.message;
	// a missing/undeployed function surfaces as a bare "internal" (CORS-blocked 404)
	return m && m.toLowerCase() !== 'internal' ? m : 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
}
