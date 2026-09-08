import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { readable } from 'svelte/store';
import type { PrivateState, PublicRoom } from '$game/types';
import { db } from './client';

export type RoomState = PublicRoom | 'missing' | null;

export function roomStore(code: string) {
	return readable<RoomState>(null, (set) =>
		onSnapshot(
			doc(db, 'rooms', code),
			(snap) => set(snap.exists() ? (snap.data() as PublicRoom) : 'missing'),
			() => set('missing')
		)
	);
}

export function privateStore(code: string, uid: string) {
	return readable<PrivateState | null>(null, (set) =>
		onSnapshot(
			doc(db, 'rooms', code, 'private', uid),
			(snap) => set(snap.exists() ? (snap.data() as PrivateState) : null),
			() => set(null)
		)
	);
}

/** Writes a heartbeat every 10s and streams every player's last-seen time. */
export function presenceStore(code: string, uid: string) {
	const beat = () =>
		setDoc(doc(db, 'rooms', code, 'presence', uid), { at: Date.now() }).catch(() => {});
	beat();
	const iv = setInterval(beat, 10_000);

	return readable<Record<string, number>>({}, (set) => {
		const unsub = onSnapshot(
			collection(db, 'rooms', code, 'presence'),
			(snap) => {
				const m: Record<string, number> = {};
				snap.forEach((d) => (m[d.id] = (d.data() as { at: number }).at));
				set(m);
			},
			() => set({})
		);
		return () => {
			clearInterval(iv);
			unsub();
		};
	});
}
