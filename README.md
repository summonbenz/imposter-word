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

- **QUESTION** — เมื่อวงทายคำถูก Moderator แตะชื่อคนที่พูดคำนั้น (บังคับเลือก ไม่นับตัวเอง)
- **RESULT_*** — เฉลย 3 จังหวะ (host กดเลื่อน): คนโดนโหวตมากสุด → บทบาทของคนนั้น → สรุปคะแนน
- `voteSeconds = 0` ปิดเวลาโหวต · หมดเวลาช่วงถาม / ยอมแพ้ = แพ้ทั้งวง ข้ามการโหวต

## กติกาโหวต

- โหวต Moderator ได้ (ตามเกมต้นฉบับ) แต่ถ้าเสียงตกที่ Moderator = จับผิด
- **เสมอ** → เข้า `TIEBREAK`: คนที่ Moderator เลือกว่าทายคำถูก เป็นคนตัดสินเด็ดขาดว่าเสียงตกที่ใคร
  (เลือกได้เฉพาะในบรรดาคนที่คะแนนเท่ากัน; host ตัดสินแทนได้ถ้าคนนั้นหลุด)
- ไม่มีใครโหวตเลย → ถือว่า Imposter รอด

## แต้ม

- จับ Imposter ถูก + ทายคำได้ → Moderator และ People ทุกคน +1
- จับผิด + ทายคำได้ → Imposter +2
- ทายคำไม่ทัน → ทุกคน 0
- **โบนัส**: คนที่ Moderator เลือกว่าทายคำถูก +1 (ทุกครั้งที่ทายคำได้ รวมกับแต้มบทบาท)
