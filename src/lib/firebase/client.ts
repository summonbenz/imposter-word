import { browser } from '$app/environment';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const config = {
	apiKey: import.meta.env.VITE_FB_API_KEY || 'demo-key',
	authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN || 'demo-imposter-word.firebaseapp.com',
	projectId: import.meta.env.VITE_FB_PROJECT_ID || 'demo-imposter-word',
	appId: import.meta.env.VITE_FB_APP_ID || 'demo-app'
};

const region = import.meta.env.VITE_FB_REGION || 'asia-southeast1';
const useEmulator =
	(import.meta.env.VITE_USE_EMULATOR ?? (import.meta.env.DEV ? '1' : '0')) === '1';

export const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, region);

type EmuFlag = { __IW_EMU__?: boolean };

if (browser && useEmulator && !(globalThis as unknown as EmuFlag).__IW_EMU__) {
	(globalThis as unknown as EmuFlag).__IW_EMU__ = true;
	const host = import.meta.env.VITE_EMU_HOST || '127.0.0.1';
	connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
	connectFirestoreEmulator(db, host, 8080);
	connectFunctionsEmulator(functions, host, 5001);
}
