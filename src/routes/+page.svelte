<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, errText } from '$lib/firebase/api';
	import { ensureAuth, myName, saveName } from '$lib/firebase/session';
	import { CODE_LENGTH, MIN_PLAYERS } from '$game/types';

	let name = $state('');
	let code = $state('');
	let pending = $state<'' | 'create' | 'join'>('');
	let error = $state('');

	const busy = $derived(pending !== '');

	$effect(() => {
		const unsub = myName.subscribe((n) => {
			if (n && !name) name = n;
		});
		return unsub;
	});

	async function run(kind: 'create' | 'join', fn: () => Promise<void>) {
		error = '';
		if (name.trim().length < 1) {
			error = 'ใส่ชื่อเล่นก่อนเริ่ม';
			return;
		}
		pending = kind;
		try {
			await ensureAuth();
			saveName(name.trim());
			await fn();
		} catch (e) {
			error = errText(e);
		} finally {
			pending = '';
		}
	}

	const create = () =>
		run('create', async () => {
			const { code: c } = await api.createRoom({ name: name.trim() });
			await goto(`/room/${c}`);
		});

	const join = () =>
		run('join', async () => {
			const c = code.trim().toUpperCase();
			if (!new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`).test(c)) {
				error = `รหัสห้องมี ${CODE_LENGTH} ตัวอักษร`;
				return;
			}
			await api.joinRoom({ code: c, name: name.trim() });
			await goto(`/room/${c}`);
		});

	const enter = (fn: () => void) => (e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			fn();
		}
	};
</script>

<div class="panel">
	<div class="stage">
		<div class="bill-head">
			<h1 class="masthead"><span>Imposter</span><span>Word</span></h1>
			<div class="bill-rule" aria-hidden="true"></div>
		</div>
		<p class="tagline">
			ทั้งวงช่วยกันทายคำลับให้ได้<br />
			แต่มีหนึ่งคนรู้คำนั้นมาตั้งแต่แรก
		</p>
		<p class="housenote">
			เล่น {MIN_PLAYERS} คนขึ้นไป แนะนำให้เล่นใน Voice Chat หรือนั่งวงเดียวกัน<br />
			แอปถือคำลับ จับเวลา และนับแต้มให้
		</p>
	</div>

	<div class="admin">
		<div class="field">
			<label class="field-label" for="name">ชื่อเล่นของคุณ</label>
			<input
				class="input"
				id="name"
				type="text"
				bind:value={name}
				maxlength="20"
				placeholder="บอส"
				enterkeyhint="go"
				onkeydown={enter(create)}
			/>
		</div>

		<button class="btn btn-primary" onclick={create} disabled={busy}>
			{pending === 'create' ? 'กำลังสร้างห้อง…' : 'สร้างห้องใหม่'}
		</button>

		<div class="or"><span>หรือเข้าห้องของเพื่อน</span></div>

		<div class="field">
			<label class="field-label" for="code">รหัสห้อง {CODE_LENGTH} ตัว</label>
			<input
				class="input input-code"
				id="code"
				type="text"
				autocapitalize="characters"
				autocomplete="off"
				spellcheck="false"
				value={code}
				oninput={(e) => (code = e.currentTarget.value.toUpperCase())}
				maxlength={CODE_LENGTH}
				placeholder="QH7KD"
				enterkeyhint="go"
				onkeydown={enter(join)}
			/>
		</div>
		<button class="btn" onclick={join} disabled={busy}>
			{pending === 'join' ? 'กำลังเข้าห้อง…' : 'เข้าห้อง'}
		</button>

		{#if error}<p class="notice">{error}</p>{/if}
	</div>

	<section class="howto">
		<h2>วิธีเล่น</h2>

		<h3>บทบาท</h3>
		<ul class="cast" role="list">
			<li class="master">
				<p class="who">ผู้ดำเนินเกม <span>Moderator</span></p>
				<p class="what">รู้คำลับ ตอบคำถามได้แค่ใช่/ไม่ใช่/ไม่แน่ใจ</p>
			</li>
			<li class="imposter">
				<p class="who">คนร้าย <span>Imposter</span></p>
				<p class="what">รู้คำลับเหมือนกัน แต่ต้องไม่ให้ใครจับได้ว่ารู้</p>
			</li>
			<li class="common">
				<p class="who">ประชาชน <span>People</span></p>
				<p class="what">ไม่รู้คำลับ ต้องถามเอา มีกันหลายคน</p>
			</li>
		</ul>

		<h3>ในหนึ่งเกมมีเฟสอะไรบ้าง</h3>
		<ol class="order" role="list">
			<li>
				<b>เปิดบทบาท</b>
				<span>แต่ละคนแอบดูการ์ดของตัวเองในเครื่องตัวเอง</span>
			</li>
			<li>
				<b>ถามหาคำ</b>
				<span>ถามผู้ดำเนินเกมเป็นคำถามใช่หรือไม่ใช่ จนมีคนพูดคำลับออกมา</span>
			</li>
			<li>
				<b>ถกเถียง</b>
				<span>ได้คำแล้ว คราวนี้หาว่าใครรู้คำมาตั้งแต่ต้น</span>
			</li>
			<li>
				<b>โหวต</b>
				<span>ชี้ตัวพร้อมกัน แล้วแอปเฉลยให้</span>
			</li>
		</ol>

		<h3>วิธีการนับคะแนน</h3>
		<dl class="score">
			<dt>เสียงส่วนมากจับคนร้ายได้</dt>
			<dd>คนที่โหวตคนร้าย ได้คนละ 2 แต้ม คนร้ายไม่ได้แต้ม</dd>
			<dt>วงจับผิดคน แต่มีคนโหวตคนร้ายถูก</dt>
			<dd>คนที่โหวตถูก ได้คนละ 1 แต้ม คนร้ายได้ 1 แต้ม</dd>
			<dt>ไม่มีใครโหวตถูกเลย</dt>
			<dd>คนร้ายได้ 2 แต้ม</dd>
			<dt>ทายคำไม่ทัน</dt>
			<dd>ไม่มีใครได้แต้ม</dd>
		</dl>
	</section>
</div>

<style>
	/* ---------- the bill ---------- */
	.bill-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 9px;
	}
	.bill-rule {
		width: min(72%, 240px);
		border-top: 2px solid var(--brass);
	}
	.bill-rule::after {
		content: '';
		display: block;
		margin-top: 3px;
		border-top: 1px solid var(--brass-line);
	}
	.housenote {
		margin: -4px 0 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--ink-faint);
	}

	/* ---------- box office ---------- */
	.or {
		display: flex;
		align-items: center;
		gap: 14px;
		color: var(--ink-faint);
		font-size: 12px;
	}
	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--edge-hair);
	}

	/* ---------- how to play ---------- */
	.howto {
		margin-top: 12px;
		padding-top: 22px;
		border-top: 1px solid var(--brass-line);
	}
	.howto h2 {
		font-family: var(--display);
		font-weight: 400;
		font-size: 23px;
		margin: 0 0 14px;
	}
	.howto h3 {
		font-family: var(--text);
		font-size: 13px;
		font-weight: 600;
		color: var(--ink-dim);
		margin: 24px 0 6px;
	}

	.cast,
	.order {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	/* cast — the left rule carries the same colour as your role card in the game */
	.cast li {
		border-left: 3px solid var(--edge);
		padding: 7px 0 7px 13px;
		margin-top: 10px;
	}
	.cast li:first-child {
		margin-top: 0;
	}
	.cast li.master {
		border-left-color: var(--brass);
	}
	.cast li.imposter {
		border-left-color: var(--red);
	}
	.cast li.common {
		border-left-color: var(--jade);
	}
	.who {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.who span {
		font-size: 12px;
		font-weight: 400;
		color: var(--ink-faint);
		margin-left: 5px;
	}
	.what {
		margin: 2px 0 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--ink-dim);
	}

	/* running order — a genuine sequence, so it is numbered */
	.order li {
		display: grid;
		grid-template-columns: 22px 1fr;
		gap: 0 10px;
		padding: 9px 0;
		border-top: 1px solid var(--edge-hair);
		counter-increment: beat;
	}
	.order li:first-child {
		border-top: 0;
	}
	.order {
		counter-reset: beat;
	}
	.order li::before {
		content: counter(beat);
		font-family: var(--display);
		font-size: 15px;
		line-height: 1.4;
		color: var(--brass);
		grid-row: span 2;
	}
	.order b {
		font-size: 14px;
		font-weight: 600;
	}
	.order span {
		grid-column: 2;
		font-size: 13px;
		line-height: 1.5;
		color: var(--ink-dim);
	}

	/* scoring — three outcomes, not a sequence */
	.score {
		margin: 0;
		display: grid;
		grid-template-columns: minmax(0, 10.5em) 1fr;
		gap: 0;
	}
	.score dt,
	.score dd {
		margin: 0;
		padding: 9px 0;
		font-size: 13px;
		line-height: 1.45;
		border-top: 1px solid var(--edge-hair);
	}
	.score dt:first-of-type,
	.score dt:first-of-type + dd {
		border-top: 0;
	}
	.score dt {
		padding-right: 12px;
		color: var(--ink-dim);
	}
	.score dd {
		color: var(--ink);
	}

	@media (max-width: 359px) {
		.score {
			grid-template-columns: 1fr;
		}
		.score dd {
			border-top: 0;
			padding-top: 0;
			padding-bottom: 11px;
		}
		.score dt:first-of-type + dd {
			padding-top: 0;
		}
	}
</style>
