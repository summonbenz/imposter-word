<script lang="ts">
	let {
		endsAt,
		totalSeconds,
		onExpire = () => {}
	}: {
		endsAt: number | null;
		totalSeconds: number;
		onExpire?: () => void;
	} = $props();

	let now = $state(Date.now());
	let fired = false;
	let lastEndsAt: number | null = null;

	$effect(() => {
		if (endsAt !== lastEndsAt) {
			lastEndsAt = endsAt;
			fired = false;
		}
	});

	$effect(() => {
		const iv = setInterval(() => (now = Date.now()), 200);
		return () => clearInterval(iv);
	});

	const remaining = $derived(endsAt == null ? null : Math.max(0, endsAt - now));
	const pct = $derived(
		remaining == null ? 0 : Math.max(0, Math.min(100, (remaining / (totalSeconds * 1000)) * 100))
	);
	const warn = $derived(remaining != null && remaining <= 10_000);

	$effect(() => {
		if (remaining === 0 && !fired) {
			fired = true;
			onExpire();
		}
	});

	function fmt(ms: number) {
		const s = Math.ceil(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}
</script>

{#if remaining != null}
	<div class="votebar" class:warn>
		<span class="cap">เหลือเวลาโหวต</span>
		<div class="row">
			<div class="track"><div class="fill" style:width="{pct}%"></div></div>
			<span class="num">{fmt(remaining)}</span>
		</div>
	</div>
{/if}

<style>
	.votebar {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.cap {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.track {
		flex: 1;
		height: 6px;
		border-radius: var(--r-pill);
		background: var(--edge-hair);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--ink-dim);
		border-radius: var(--r-pill);
		transition: width 0.2s linear;
	}
	.num {
		font-family: var(--display);
		font-size: 18px;
		font-variant-numeric: tabular-nums;
		min-width: 3ch;
		text-align: right;
		color: var(--ink-dim);
	}
	.warn .fill {
		background: var(--red);
	}
	.warn .num {
		color: var(--red);
	}
</style>
