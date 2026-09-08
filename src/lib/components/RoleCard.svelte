<script lang="ts">
	import type { Role } from '$game/types';

	let {
		role,
		word = null,
		name = '',
		flipped = $bindable(false),
		interactive = false,
		caption = ''
	}: {
		role: Role;
		word?: string | null;
		name?: string;
		flipped?: boolean;
		interactive?: boolean;
		caption?: string;
	} = $props();

	const LABEL: Record<Role, string> = {
		common: 'ประชาชน',
		master: 'ผู้ดำเนินเกม',
		imposter: 'ตัวปลอม'
	};
	const EN: Record<Role, string> = { common: 'People', master: 'Moderator', imposter: 'Imposter' };

	function tap() {
		if (interactive) flipped = true;
	}
</script>

<div class="card">
	<div class="inner" class:flipped>
		<button
			class="back"
			type="button"
			disabled={!interactive}
			onclick={tap}
			aria-label="เปิดดูบทบาทของคุณ"
		>
			<span class="mark">?</span>
			{#if interactive}<span class="prompt">แตะเพื่อเปิด</span>{/if}
		</button>

		<div class="front {role}">
			<span class="role">{LABEL[role]}</span>
			<span class="role-en">{EN[role]}</span>
			{#if word}
				<span class="word">{word}</span>
			{:else if name}
				<span class="name">{name}</span>
			{:else if role === 'common'}
				<span class="thin">คุณไม่รู้คำลับ ต้องถามเอา</span>
			{/if}
			{#if caption}<span class="cap">{caption}</span>{/if}
		</div>
	</div>
</div>

<style>
	.card {
		perspective: 1200px;
		width: 100%;
	}
	.inner {
		position: relative;
		width: 100%;
		min-height: 220px;
		transform-style: preserve-3d;
		transition: transform 0.55s cubic-bezier(0.4, 0.1, 0.2, 1);
	}
	.inner.flipped {
		transform: rotateY(180deg);
	}
	.back,
	.front {
		position: absolute;
		inset: 0;
		backface-visibility: hidden;
		border-radius: var(--r-card);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 26px 18px;
		text-align: center;
	}
	.back {
		appearance: none;
		border: 1px dashed var(--edge);
		background: var(--panel);
		color: var(--ink-faint);
		font-family: var(--text);
		cursor: pointer;
	}
	.back:disabled {
		cursor: default;
	}
	.back:focus-visible {
		outline: 2px solid var(--brass-hi);
		outline-offset: 2px;
	}
	.mark {
		font-family: var(--display);
		font-size: 60px;
		line-height: 1;
		color: var(--ink-dim);
	}
	.prompt {
		font-size: 13px;
	}

	.front {
		transform: rotateY(180deg);
		border: 1px solid transparent;
	}
	.front.common {
		background: var(--jade);
		color: var(--jade-ink);
	}
	.front.master {
		background: var(--brass);
		color: var(--brass-ink);
	}
	.front.imposter {
		background: var(--red-deep);
		color: var(--ink);
	}
	.role {
		font-family: var(--display);
		font-size: 34px;
		line-height: 1;
	}
	.role-en {
		font-size: 12px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.65;
	}
	.word {
		margin-top: 6px;
		font-weight: 700;
		font-size: 21px;
		background: rgba(0, 0, 0, 0.2);
		padding: 5px 14px;
		border-radius: 9px;
	}
	.name {
		margin-top: 4px;
		font-weight: 600;
		font-size: 18px;
	}
	.thin {
		font-size: 13px;
		opacity: 0.9;
	}
	.cap {
		margin-top: 4px;
		font-size: 12px;
		opacity: 0.75;
	}
</style>
