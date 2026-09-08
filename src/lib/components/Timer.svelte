<script lang="ts">
	let {
		endsAt,
		totalSeconds,
		label = '',
		warnAt = 30,
		onExpire = () => {}
	}: {
		endsAt: number | null;
		totalSeconds: number;
		label?: string;
		warnAt?: number;
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
	const warn = $derived(remaining != null && remaining <= warnAt * 1000);

	$effect(() => {
		if (remaining === 0 && !fired) {
			fired = true;
			onExpire();
		}
	});

	const R = 44;
	const CIRC = 2 * Math.PI * R;
	const frac = $derived(
		remaining == null ? 0 : Math.max(0, Math.min(1, remaining / (totalSeconds * 1000)))
	);

	function fmt(ms: number) {
		const s = Math.ceil(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}
</script>

{#if remaining != null}
	<div class="ring" class:warn>
		<svg viewBox="0 0 100 100" aria-hidden="true">
			<circle class="track" cx="50" cy="50" r={R} />
			<circle
				class="arc"
				cx="50"
				cy="50"
				r={R}
				stroke-dasharray={CIRC}
				stroke-dashoffset={CIRC * (1 - frac)}
			/>
		</svg>
		<div class="face">
			<span class="num">{fmt(remaining)}</span>
			{#if label}<span class="lbl">{label}</span>{/if}
		</div>
	</div>
{/if}

<style>
	.ring {
		position: relative;
		width: min(62vw, 220px);
		aspect-ratio: 1;
		margin: 4px auto 0;
	}
	svg {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}
	.track {
		fill: none;
		stroke: var(--edge-hair);
		stroke-width: 3;
	}
	.arc {
		fill: none;
		stroke: var(--brass);
		stroke-width: 5;
		stroke-linecap: round;
		transition: stroke-dashoffset 0.25s linear;
	}
	.face {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
	}
	.num {
		font-family: var(--display);
		font-size: clamp(38px, 12vw, 52px);
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
	}
	.lbl {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.warn .arc {
		stroke: var(--red);
		animation: pulse 0.6s ease 1;
	}
	.warn .num {
		color: var(--red);
	}
	@keyframes pulse {
		40% {
			stroke-width: 8;
		}
	}
</style>
