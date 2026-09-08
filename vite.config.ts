import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		// the client shares pure game logic from functions/src/game via the $game
		// alias; that dir sits outside src/, so the dev server must be allowed to read it
		fs: {
			allow: [import.meta.dirname]
		}
	}
});
