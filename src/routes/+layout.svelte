<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { ensureAuth, myName, loadName } from '$lib/firebase/session';

	let { children } = $props();

	onMount(() => {
		myName.set(loadName());
		ensureAuth().catch(() => {});
	});
</script>

<div class="app">
	{@render children()}
</div>
