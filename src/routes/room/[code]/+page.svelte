<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, errText } from '$lib/firebase/api';
	import { ensureAuth, loadName } from '$lib/firebase/session';
	import { presenceStore, privateStore, roomStore, type RoomState } from '$lib/firebase/room';
	import { PACK_LIST } from '$game/words';
	import { MIN_PLAYERS, PRESENCE_STALE_MS, QUESTION_CHOICES, ROUND_CHOICES, VOTE_CHOICES } from '$game/types';
	import type { Outcome, Player, PrivateState, PublicRoom } from '$game/types';
	import Timer from '$lib/components/Timer.svelte';
	import VoteBar from '$lib/components/VoteBar.svelte';
	import RoleCard from '$lib/components/RoleCard.svelte';

	const code = ($page.params.code ?? '').toUpperCase();

	let uid = $state<string | null>(null);
	let room = $state<RoomState>(null);
	let priv = $state<PrivateState | null>(null);
	let presence = $state<Record<string, number>>({});
	let error = $state('');
	let busy = $state(false);
	let now = $state(Date.now());

	let votePick = $state<string | null>(null);
	let locked = $state(false);
	let copied = $state(false);

	onMount(() => {
		const iv = setInterval(() => (now = Date.now()), 1000);
		const unsubs: Array<() => void> = [];
		(async () => {
			const u = await ensureAuth();
			uid = u;
			const name = loadName();
			if (!name) {
				await goto('/');
				return;
			}
			try {
				await api.joinRoom({ code, name });
			} catch (e) {
				error = errText(e);
			}
			unsubs.push(roomStore(code).subscribe((v) => (room = v)));
			unsubs.push(privateStore(code, u).subscribe((v) => (priv = v)));
			unsubs.push(presenceStore(code, u).subscribe((v) => (presence = v)));
		})();
		return () => {
			clearInterval(iv);
			unsubs.forEach((f) => f());
		};
	});

	const r = $derived(room && room !== 'missing' ? (room as PublicRoom) : null);
	const me = $derived(r && uid ? (r.players.find((p) => p.uid === uid) ?? null) : null);
	const isHost = $derived(!!me?.isHost);
	const isMaster = $derived(!!r && !!uid && r.masterUid === uid);
	const res = $derived(r?.results ?? null);
	const accused = $derived(
		res?.accusedUid && r ? (r.players.find((p) => p.uid === res.accusedUid) ?? null) : null
	);
	const topVotes = $derived(res?.tally?.[0]?.votes ?? 0);
	const standings = $derived(r ? [...r.players].sort((a, b) => b.score - a.score) : []);
	const allReady = $derived(!!r && r.players.length >= MIN_PLAYERS && r.players.every((p) => p.ready));
	const acked = $derived(!!r && !!uid && r.revealAcks.includes(uid));
	const wordFinder = $derived(
		r?.wordFoundBy ? (r.players.find((p) => p.uid === r.wordFoundBy) ?? null) : null
	);
	const iAmFinder = $derived(!!r && !!uid && r.wordFoundBy === uid);
	const tiedPlayers = $derived<Player[]>(
		r && res?.tiedUids?.length
			? res.tiedUids
					.map((u) => r.players.find((p) => p.uid === u))
					.filter((p): p is Player => !!p)
			: []
	);

	$effect(() => {
		if (r?.status !== 'VOTE') {
			locked = false;
			votePick = null;
		}
	});

	function live(u: string): boolean {
		const at = presence[u];
		return at != null && now - at < PRESENCE_STALE_MS;
	}

	async function act(fn: () => Promise<unknown>) {
		error = '';
		busy = true;
		try {
			await fn();
		} catch (e) {
			error = errText(e);
		} finally {
			busy = false;
		}
	}

	const setCfg = (patch: Record<string, unknown>) => act(() => api.updateConfig({ code, config: patch }));

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable */
		}
	}

	const OUTCOME: Record<Outcome, { head: string; sub: string; win: boolean }> = {
		COMMONS_WIN: { head: 'ประชาชนชนะ', sub: 'จับตัวปลอมได้ และทายคำสำเร็จ', win: true },
		IMPOSTER_WIN: { head: 'ตัวปลอมชนะ', sub: 'วงลงมติผิดคน', win: false },
		ALL_LOSE: { head: 'แพ้ทั้งวง', sub: 'ทายคำไม่ทันเวลา', win: false }
	};

	const roundText = $derived(
		r && r.status !== 'LOBBY'
			? `รอบ ${r.round}${r.config.rounds ? ` / ${r.config.rounds}` : ''}`
			: 'ล็อบบี้'
	);
	const lastRound = $derived(!!r && r.config.rounds > 0 && r.round >= r.config.rounds);

	const expire = () => act(() => api.expirePhase({ code }));
</script>

<div class="panel">
	{#if room === 'missing'}
		<div class="stage">
			<h1 class="proclaim">ไม่พบห้อง {code}</h1>
			<p class="hint">ห้องอาจปิดไปแล้ว หรือพิมพ์รหัสผิด</p>
			<a class="btn btn-primary" href="/">กลับหน้าแรก</a>
		</div>
	{:else if !r}
		<p class="center-hint">กำลังเข้าห้อง {code}…</p>
		{#if error}<p class="notice">{error}</p>{/if}
	{:else}
		<div class="header">
			<span class="room">{r.code}</span>
			<span>{roundText}</span>
		</div>

		{#if r.status === 'LOBBY'}
			<div class="stage">
				<span class="hint">รหัสห้อง ส่งให้เพื่อน</span>
				<button class="bigcode" onclick={copyCode}>{r.code}</button>
				<span class="hint">{copied ? 'คัดลอกแล้ว' : 'แตะเพื่อคัดลอก'}</span>
			</div>

			<div class="paper">
				<h3>ผู้เล่น {r.players.length} คน</h3>
				<div class="roster">
					{#each r.players as p (p.uid)}
						<div class="roster-row">
							<span class="who">
								<span class="status-dot" class:live={live(p.uid)}></span>
								<span>{p.name}{p.uid === uid ? ' (คุณ)' : ''}</span>
							</span>
							<span class="who">
								{#if p.isHost}<span class="chip chip-host">host</span>{/if}
								{#if p.ready}<span class="chip chip-ready">พร้อม</span>{/if}
							</span>
						</div>
					{/each}
				</div>
			</div>

			{#if isHost}
				<div class="paper">
					<h3>ตั้งค่ารอบ</h3>
					<div class="field">
						<span class="field-label">เวลาถาม (นาที)</span>
						<div class="seg">
							{#each QUESTION_CHOICES as s (s)}
								<button aria-pressed={r.config.questionSeconds === s} onclick={() => setCfg({ questionSeconds: s })}>
									{s / 60}
								</button>
							{/each}
						</div>
					</div>
					<div class="field">
						<span class="field-label">เวลาโหวต (วินาที)</span>
						<div class="seg">
							{#each VOTE_CHOICES as s (s)}
								<button aria-pressed={r.config.voteSeconds === s} onclick={() => setCfg({ voteSeconds: s })}>
									{s === 0 ? 'ปิด' : s}
								</button>
							{/each}
						</div>
					</div>
					<div class="field">
						<span class="field-label">จำนวนรอบ</span>
						<div class="seg">
							{#each ROUND_CHOICES as s (s)}
								<button aria-pressed={r.config.rounds === s} onclick={() => setCfg({ rounds: s })}>
									{s === 0 ? 'ไม่จำกัด' : s}
								</button>
							{/each}
						</div>
					</div>
					<div class="field">
						<span class="field-label">ชุดคำ</span>
						<div class="seg">
							{#each PACK_LIST as pk (pk.id)}
								<button aria-pressed={r.config.packId === pk.id} onclick={() => setCfg({ packId: pk.id })}>
									{pk.label}
								</button>
							{/each}
						</div>
					</div>
				</div>
			{/if}

			<div class="btns">
				<button
					class="btn"
					class:btn-primary={!me?.ready}
					onclick={() => act(() => api.setReady({ code, ready: !me?.ready }))}
					disabled={busy}
				>
					{me?.ready ? 'ยังไม่พร้อม' : 'พร้อมแล้ว'}
				</button>

				{#if isHost}
					<button class="btn btn-primary" onclick={() => act(() => api.startRound({ code }))} disabled={busy || !allReady}>
						เริ่มรอบ
					</button>
				{/if}
			</div>

			{#if isHost && !allReady}
				<p class="center-hint">ต้องมีอย่างน้อย {MIN_PLAYERS} คน และทุกคนกดพร้อม</p>
			{:else if !isHost}
				<p class="center-hint">รอ host เริ่มรอบ</p>
			{/if}

		{:else if r.status === 'REVEAL'}
			<div class="stage">
				<h2 class="proclaim">บทบาทของคุณ</h2>
				{#if priv}
					<RoleCard role={priv.role} word={priv.word} interactive flipped={acked} />
				{/if}
			</div>
			{#if priv}
				<div class="btns">
					<button class="btn btn-primary" onclick={() => act(() => api.ackReveal({ code }))} disabled={busy || acked}>
						{acked ? 'พร้อมแล้ว' : 'เห็นแล้ว พร้อมเริ่ม'}
					</button>
					{#if isHost}
						<button class="btn btn-quiet" onclick={() => act(() => api.forceQuestion({ code }))} disabled={busy}>
							ข้ามไปช่วงถาม
						</button>
					{/if}
				</div>
				<p class="center-hint">พร้อมแล้ว {r.revealAcks.length} จาก {r.players.length} คน</p>
			{/if}

		{:else if r.status === 'QUESTION'}
			<div class="stage">
				<Timer endsAt={r.phaseEndsAt} totalSeconds={r.config.questionSeconds} label="เหลือเวลาถาม" onExpire={expire} />
			</div>
			<div class="word-line" class:known={!!priv?.word}>
				<span>คำลับ</span>
				<span class="w">{priv?.word ?? 'ซ่อนอยู่'}</span>
			</div>
			{#if isMaster}
				<div class="admin">
					<h3>เมื่อวงทายคำถูก แตะชื่อคนที่พูดคำนั้น</h3>
					<div class="tokens">
						{#each r.players.filter((p) => p.uid !== r.masterUid) as p (p.uid)}
							<button
								class="token"
								disabled={busy}
								onclick={() => act(() => api.markWordFound({ code, guessedByUid: p.uid }))}
							>
								<span class="pip"></span>
								<span>{p.name}</span>
							</button>
						{/each}
					</div>
					<button class="btn btn-danger" onclick={() => act(() => api.giveUp({ code }))} disabled={busy}>
						ยอมแพ้ หมดมุกแล้ว
					</button>
					<p class="center-hint">คนที่คุณเลือกได้โบนัส 1 คะแนน</p>
				</div>
			{:else}
				<p class="center-hint">ถามผู้ดำเนินเกมเป็นคำถามใช่หรือไม่ใช่ ในห้องเสียง</p>
			{/if}

		{:else if r.status === 'DISCUSSION'}
			<div class="stage">
				<Timer endsAt={r.phaseEndsAt} totalSeconds={r.config.discussionSeconds} label="เวลาถกเถียง" onExpire={expire} />
				<h2 class="proclaim">ทายคำได้แล้ว</h2>
				<p class="hint">คุยกันว่าใครคือตัวปลอมที่แอบรู้คำมาตั้งแต่ต้น</p>
			</div>
			{#if isHost}
				<button class="btn btn-primary" onclick={() => act(() => api.startVote({ code }))} disabled={busy}>
					เริ่มโหวต
				</button>
			{/if}

		{:else if r.status === 'VOTE'}
			{#if r.config.voteSeconds > 0}
				<VoteBar endsAt={r.phaseEndsAt} totalSeconds={r.config.voteSeconds} onExpire={expire} />
			{/if}
			<div class="admin">
				<h2>โหวตหาตัวปลอม</h2>
				<p class="hint">เลือกคนที่คุณคิดว่าแอบรู้คำมาตั้งแต่ต้น</p>
				<div class="tokens">
					{#each r.players as p (p.uid)}
						<button
							class="token"
							class:picked={votePick === p.uid}
							disabled={locked || p.uid === uid}
							onclick={() => (votePick = p.uid)}
						>
							<span class="pip"></span>
							<span>{p.name}{p.uid === uid ? ' (คุณ)' : ''}</span>
							{#if r.masterUid === p.uid}<span class="chip">ผู้ดำเนินเกม</span>{/if}
						</button>
					{/each}
				</div>
				<button
					class="btn btn-primary"
					disabled={busy || locked || !votePick}
					onclick={() =>
						act(async () => {
							await api.lockVote({ code, targetUid: votePick! });
							locked = true;
						})}
				>
					{locked ? 'ล็อกโหวตแล้ว' : 'ล็อกโหวต'}
				</button>
				<p class="center-hint">ล็อกแล้ว {r.votesLocked} จาก {r.players.length} คน เปิดพร้อมกันเมื่อครบหรือหมดเวลา</p>
			</div>

		{:else if r.status === 'TIEBREAK'}
			<div class="stage">
				<h2 class="proclaim">คะแนนเสมอ</h2>
				<p class="hint">
					{#if iAmFinder}คุณเป็นคนทายคำถูก เลือกได้เลยว่าจะให้ตกที่ใคร
					{:else}{wordFinder?.name ?? 'ผู้ทายคำถูก'} เป็นคนตัดสินว่าจะให้ตกที่ใคร{/if}
				</p>
			</div>
			{#if iAmFinder || isHost}
				<div class="tokens">
					{#each tiedPlayers as p (p.uid)}
						<button
							class="token"
							disabled={busy}
							onclick={() => act(() => api.breakTie({ code, targetUid: p.uid }))}
						>
							<span class="pip"></span>
							<span>{p.name}</span>
							{#if r.masterUid === p.uid}<span class="chip">ผู้ดำเนินเกม</span>{/if}
						</button>
					{/each}
				</div>
				{#if isHost && !iAmFinder}
					<p class="center-hint">คุณตัดสินแทนได้ในฐานะ host</p>
				{/if}
			{:else}
				<div class="tally">
					{#each tiedPlayers as p (p.uid)}
						<div class="tally-row top">
							<span class="tn">{p.name}</span>
							<span class="tb"><i style:width="100%"></i></span>
							<span class="tc">{res?.tally.find((t) => t.uid === p.uid)?.votes ?? 0}</span>
						</div>
					{/each}
				</div>
			{/if}

		{:else if r.status === 'RESULT_VOTES'}
			<div class="stage">
				<h2 class="proclaim">วงลงมติแล้ว</h2>
				{#if accused}
					<span class="hint">คนที่โดนโหวตมากที่สุด</span>
					<div class="accused">{accused.name}</div>
					<span class="hint">{topVotes} เสียง จาก {r.players.length}</span>
				{:else}
					<div class="accused">ไม่มีเสียง</div>
					<span class="hint">ไม่มีใครถูกกล่าวหา</span>
				{/if}
			</div>
			<div class="tally">
				{#each res?.tally ?? [] as t, i (t.uid)}
					<div class="tally-row" class:top={i === 0 && t.votes > 0}>
						<span class="tn">{t.name}</span>
						<span class="tb"><i style:width="{topVotes ? (t.votes / topVotes) * 100 : 0}%"></i></span>
						<span class="tc">{t.votes}</span>
					</div>
				{/each}
			</div>
			{#if isHost}
				<button class="btn btn-primary" onclick={() => act(() => api.revealRole({ code }))} disabled={busy}>
					{accused ? `เปิดบทบาทของ ${accused.name}` : 'เปิดผล'}
				</button>
			{:else}
				<p class="center-hint">ยังไม่เฉลยว่าใครเป็นอะไร รอ host เปิด</p>
			{/if}

		{:else if r.status === 'RESULT_ROLE'}
			<div class="stage">
				<h2 class="proclaim">{accused ? `บทบาทของ ${accused.name}` : 'ผลการกล่าวหา'}</h2>
				{#if res?.accusedRole}
					<RoleCard role={res.accusedRole} name={accused?.name ?? ''} flipped />
				{/if}
				<div class="judgement" class:hit={res?.outcome === 'COMMONS_WIN'}>
					{res?.outcome === 'COMMONS_WIN' ? 'วงจับถูก' : 'จับผิดคน'}
				</div>
			</div>
			{#if isHost}
				<button class="btn btn-primary" onclick={() => act(() => api.showSummary({ code }))} disabled={busy}>
					สรุปผล
				</button>
			{:else}
				<p class="center-hint">รอ host สรุปผล</p>
			{/if}

		{:else if r.status === 'RESULT_SUMMARY'}
			{#if res?.outcome}
				<div class="stage">
					<div class="verdict" class:win={OUTCOME[res.outcome].win}>{OUTCOME[res.outcome].head}</div>
					<p class="hint">{OUTCOME[res.outcome].sub}</p>
				</div>
			{/if}
			<p class="recap">
				ตัวปลอมรอบนี้คือ <b>{res?.imposterName ?? '—'}</b>{#if res?.word} คำคือ <b>{res.word}</b>{/if}
				{#if wordFinder && res?.wordFound}<br /><b>{wordFinder.name}</b> ทายคำถูก +1{/if}
				{#if res?.tieBrokenBy && wordFinder}<br />ตัดสินเสมอโดย <b>{wordFinder.name}</b>{/if}
			</p>
			<div class="paper">
				<h3>แต้มรอบนี้</h3>
				<div class="ledger">
					{#each standings as p (p.uid)}
						<div class="ledger-row">
							<span>{p.name}</span>
							<span class="d" class:up={(res?.scoreDeltas?.[p.uid] ?? 0) > 0}>
								{(res?.scoreDeltas?.[p.uid] ?? 0) > 0 ? '+' : ''}{res?.scoreDeltas?.[p.uid] ?? 0}
							</span>
							<span class="t">{p.score}</span>
						</div>
					{/each}
				</div>
			</div>
			{#if isHost}
				<div class="btns">
					<button class="btn btn-primary" onclick={() => act(() => api.nextRound({ code }))} disabled={busy}>
						{lastRound ? 'ไปหน้าสรุปเกม' : 'รอบต่อไป'}
					</button>
					<button class="btn btn-quiet" onclick={() => act(() => api.endMatch({ code }))} disabled={busy}>
						จบเกม
					</button>
				</div>
			{:else}
				<p class="center-hint">รอ host ไปต่อ</p>
			{/if}

		{:else if r.status === 'MATCH_OVER'}
			<div class="stage">
				<div class="verdict win">{standings[0]?.name} ชนะ</div>
				<p class="hint">จบเกม {r.round} รอบ</p>
			</div>
			<div class="paper">
				<div class="ledger">
					{#each standings as p, i (p.uid)}
						<div class="ledger-row" class:champ={i === 0}>
							<span>{i + 1}. {p.name}</span>
							<span class="t">{p.score}</span>
						</div>
					{/each}
				</div>
			</div>
			<div class="btns">
				{#if isHost}
					<button class="btn btn-primary" onclick={() => act(() => api.rematch({ code }))} disabled={busy}>
						เล่นอีกเกม กลุ่มเดิม
					</button>
				{/if}
				<a class="btn btn-quiet" href="/">ออกจากห้อง</a>
			</div>
		{/if}

		{#if error}<p class="notice">{error}</p>{/if}
	{/if}
</div>

<style>
	.word-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border: 1px solid var(--edge-hair);
		border-radius: var(--r-pill);
		font-size: 13px;
		color: var(--ink-faint);
	}
	.word-line .w {
		font-family: var(--display);
		font-size: 18px;
		color: var(--ink-dim);
	}
	.word-line.known {
		border-color: var(--brass);
	}
	.word-line.known .w {
		color: var(--brass-hi);
	}

	.tokens {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.token {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		text-align: left;
		padding: 13px 14px;
		border: 1px solid var(--edge);
		border-radius: var(--r-btn);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.token:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.token > span:nth-child(2) {
		flex: 1;
	}
	.token .pip {
		width: 15px;
		height: 15px;
		border-radius: 50%;
		border: 2px solid var(--ink-faint);
		flex: none;
	}
	.token.picked {
		border-color: var(--brass);
		background: var(--surface-hi);
	}
	.token.picked .pip {
		border-color: var(--brass);
		background: var(--brass);
	}

	.accused {
		font-family: var(--display);
		font-size: clamp(40px, 13vw, 56px);
		line-height: 1;
	}

	.tally {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.tally-row {
		display: grid;
		grid-template-columns: 5.5em 1fr 2ch;
		gap: 10px;
		align-items: center;
		font-size: 13px;
		color: var(--ink-faint);
	}
	.tally-row.top {
		color: var(--ink);
	}
	.tb {
		height: 8px;
		background: var(--edge-hair);
		border-radius: var(--r-pill);
		overflow: hidden;
	}
	.tb i {
		display: block;
		height: 100%;
		background: var(--ink-faint);
		border-radius: var(--r-pill);
	}
	.tally-row.top .tb i {
		background: var(--brass);
	}
	.tc {
		text-align: right;
		font-family: var(--display);
		font-variant-numeric: tabular-nums;
	}

	.judgement {
		font-family: var(--display);
		font-size: 26px;
		color: var(--red);
	}
	.judgement.hit {
		color: var(--jade);
	}

	.verdict {
		font-family: var(--display);
		font-size: clamp(30px, 9vw, 40px);
		line-height: 1.05;
		color: var(--red);
		text-wrap: balance;
	}
	.verdict.win {
		color: var(--jade);
	}

	.recap {
		text-align: center;
		font-size: 13px;
		color: var(--ink-dim);
		padding: 10px 14px;
		border: 1px solid var(--edge-hair);
		border-radius: var(--r-card);
	}
	.recap b {
		color: var(--ink);
		font-weight: 600;
	}

	.ledger {
		display: flex;
		flex-direction: column;
	}
	.ledger-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 16px;
		align-items: baseline;
		padding: 9px 0;
		border-top: 1px solid var(--edge-hair);
		font-size: 14px;
	}
	.ledger-row:first-child {
		border-top: 0;
	}
	.ledger-row.champ {
		color: var(--brass);
	}
	.ledger-row .d {
		font-size: 13px;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.ledger-row .d.up {
		color: var(--jade);
	}
	.ledger-row .t {
		font-family: var(--display);
		font-variant-numeric: tabular-nums;
		min-width: 2ch;
		text-align: right;
	}
</style>
