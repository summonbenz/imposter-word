# Imposter Word

เกมจับตัวปลอมด้วยคำลับ (แนว _Insider_) เล่นคู่กับห้องเสียงใน Discord
เว็บแอปทำหน้าที่กรรมการ: ถือคำลับ จับเวลา รันการโหวต และนับแต้ม ส่วนการถาม–ตอบ–ถกเถียงคุยกันเองในห้องเสียง

- **Frontend** — SvelteKit (SPA, `adapter-static`) + Firebase Web SDK
- **Backend** — Cloud Functions (callable, ทุก mutation ผ่านฟังก์ชัน) + Firestore + Auth (anonymous)
- ความลับของเกม (คำ + ใครคือ Imposter) อยู่ใน `rooms/{code}/secret` และ `rooms/{code}/private/{uid}`
  ซึ่ง security rules ปิดไม่ให้ client อ่าน — เปิดทีละจังหวะโดยฟังก์ชันตอนเฉลย

## รันบนเครื่อง (Emulator Suite)

ต้องมี Node 20+ และ **Java 11+** (Firestore emulator ใช้ Java)
ถ้าไม่มี Java มี JRE พกพาอยู่ที่ `.tools/` แล้ว — ตั้ง `JAVA_HOME` ชี้ไปที่โฟลเดอร์นั้นก่อนรัน emulator

```bash
npm install
npm --prefix functions install

# เทอร์มินัล 1 — emulator (auth + firestore + functions)
npm --prefix functions run build
firebase emulators:start --only auth,firestore,functions --project demo-imposter-word

# เทอร์มินัล 2 — เว็บแอป (ต่อ emulator อัตโนมัติเมื่อ dev)
npm run dev
```

เปิด <http://localhost:5173> แล้วเปิดหลายแท็บ/หลายเครื่องเพื่อจำลองผู้เล่นหลายคน (ขั้นต่ำ 4 คน)
Emulator UI: <http://127.0.0.1:4000>

> ครั้งแรก functions emulator อาจ time out ตอน discovery — ตั้ง `FUNCTIONS_DISCOVERY_TIMEOUT=120` แล้วรันใหม่

## ต่อกับ Firebase project จริง

1. สร้าง project + เปิด Firestore, Authentication (Anonymous), Cloud Functions (ต้องเป็นแพลน Blaze)
2. คัดลอก `.env.example` เป็น `.env` ใส่ค่าจาก Firebase console แล้วตั้ง `VITE_USE_EMULATOR=0`
3. แก้ `.firebaserc` ให้ `default` เป็น project id จริง
4. เปิด TTL policy บน field `rooms.expiresAt` (หรือปล่อยให้ scheduled `cleanupRooms` ลบเอง — ต้องเปิด Pub/Sub)
5. deploy

```bash
firebase deploy --only firestore:rules,functions
npm run build && firebase deploy --only hosting
```

Frontend เป็น SPA ล้วน (`ssr = false`, ไม่ prerender) — build ออกมามีแค่ `build/index.html` ไฟล์เดียว
ไม่มี `build/room/[code]/index.html` จริง ๆ ดังนั้นโฮสต์ต้อง **rewrite ทุก path ที่ไม่ match ไฟล์ static ให้ไปที่ `/index.html`**
ไม่งั้นเปิดลิงก์ตรง ๆ (เช่น `/room/NPPV5` ที่แชร์ให้เพื่อน) จะได้ 404 แม้จะกดสร้าง/เข้าห้องจากหน้าแรกได้ปกติ (เพราะนั่นเป็นการนำทางฝั่ง client ไม่ได้ยิง request ใหม่ไปที่โฮสต์)

- Firebase Hosting: จัดการให้แล้วผ่าน `hosting.rewrites` ใน `firebase.json`
- Vercel: ต้องมี `vercel.json` ที่ root พร้อม rewrite แบบเดียวกัน (มีให้แล้วในโปรเจกต์นี้)
- โฮสต์อื่น (Netlify ฯลฯ) ต้องตั้ง SPA fallback ในลักษณะเดียวกันเอง

## โครงสร้าง

```
functions/src/game/     ตรรกะเกมล้วน (types, กติกา, คิดแต้ม, ชุดคำ) — ใช้ร่วมกับ client ผ่าน alias $game
functions/src/index.ts   callable ทั้งหมด + scheduled cleanup
src/lib/firebase/        client wiring (auth, callables, onSnapshot stores, presence)
src/lib/components/       Timer, VoteBar, RoleCard
src/routes/               / (เข้า/สร้างห้อง) + /room/[code] (เกมทั้งหมด แยกตาม phase)
firestore.rules           อ่าน room ได้เฉพาะสมาชิก, private ได้เฉพาะเจ้าของ, votes/secret ปิดสนิท
```

บทบาท (key ภายในคือ `common` / `master` / `imposter`; ชื่อที่แสดง = People / Moderator / Imposter)

## Flow ของรอบหนึ่ง

`LOBBY → REVEAL → QUESTION → DISCUSSION → VOTE → [TIEBREAK] → RESULT_VOTES → RESULT_ROLE → RESULT_SUMMARY → (รอบต่อไป / MATCH_OVER)`

- **QUESTION** — เมื่อวงทายคำถูก Moderator แตะชื่อคนที่พูดคำนั้น (บังคับเลือก ไม่นับตัวเอง); Moderator เป็นคนกด "เริ่มโหวต" ตอนจบ DISCUSSION ด้วย (ไม่ใช่ host — กัน host ที่เป็น Imposter แอบเร่งเวลา)
- **RESULT_*** — เฉลย 3 จังหวะ (host กดเลื่อน): คนโดนโหวตมากสุด → บทบาทของคนนั้น → สรุปคะแนน
- **รีสตาร์ท** — host กด "รีสตาร์ทเกม กลับล็อบบี้" ได้ทุกเฟส (callable `rematch`): ล้างแต้ม/บทบาท/โหวต กลับ `LOBBY` แต่เก็บ `usedWords` ไว้ไม่ให้คำซ้ำ
- **เปลี่ยนชื่อ** — แตะชื่อตัวเองบน header ได้ทุกเฟส (callable `renameSelf`) ชื่อใน tally/ผลรอบที่แสดงอยู่จะเปลี่ยนตาม
- `voteSeconds = 0` ปิดเวลาโหวต · หมดเวลาช่วงถาม / ยอมแพ้ = แพ้ทั้งวง ข้ามการโหวต
- รหัสห้องยาว `CODE_LENGTH = 5` ตัว, เวลาถกเถียง (`discussionSeconds`) เป็นค่าคงที่ ปรับใน UI ไม่ได้

## กติกาโหวต

- **ห้ามโหวต Moderator** — ไม่ใช่ตัวเลือกในหน้าโหวต และ server ปฏิเสธถ้ายิง `targetUid` เป็น Moderator ตรง ๆ
- **เสมอ** → เข้า `TIEBREAK`: **Moderator เป็นคนตัดสินเด็ดขาด**ว่าเสียงตกที่ใคร (เลือกได้เฉพาะในบรรดาคนที่คะแนนเท่ากัน)
  — ให้สิทธิ์ Moderator เพราะเป็นที่นั่งเดียวที่ไม่มีทางเป็น Imposter (เดิมให้สิทธิ์คนที่ทายคำถูก แต่คนนั้นอาจเป็น Imposter เองก็ได้)
- ไม่มีใครโหวตเลย → ถือว่า Imposter รอด

## แต้ม

แต้มคิดจาก **บัตรโหวตของแต่ละคน** ไม่ใช่แค่บทบาท — ต้องทายคำได้ก่อนด้วย (ทายคำไม่ทัน = ALL_LOSE ไม่มีใครได้แต้ม):

- **เสียงส่วนมากจับ Imposter ถูก** (COMMONS_WIN) → ทุกคนที่โหวตให้ Imposter ได้คนละ **+2**, Imposter **+0**
- **เสียงส่วนมากจับผิดคน แต่มีคนโหวตถูกอยู่** (IMPOSTER_WIN, มีคนเห็น) → คนที่โหวตถูกได้คนละ **+1**, Imposter **+1**
- **ไม่มีใครโหวตถูกเลย** (IMPOSTER_WIN, ไม่มีใครเห็น) → Imposter **+2**
- Imposter โหวตชื่อตัวเองไม่นับเป็น "โหวตถูก"
- ผู้ดำเนินเกมโหวตด้วยเหมือนผู้เล่นคนอื่น (ไม่รู้ว่าใครคือ Imposter) เลยได้แต้มตามบัตรของตัวเอง
