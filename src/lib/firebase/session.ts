import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { writable } from 'svelte/store';
import { auth } from './client';

export const myUid = writable<string | null>(null);
export const myName = writable<string>('');

const NAME_KEY = 'iw.name';

export function loadName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
}

export function saveName(name: string): void {
	myName.set(name);
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		/* private mode — keep in-memory only */
	}
}

let authPromise: Promise<string> | null = null;

export function ensureAuth(): Promise<string> {
	if (!authPromise) {
		authPromise = new Promise<string>((resolve, reject) => {
			onAuthStateChanged(auth, (user) => {
				if (user) {
					myUid.set(user.uid);
					resolve(user.uid);
				}
			});
			signInAnonymously(auth).catch(reject);
		});
	}
	return authPromise;
}
