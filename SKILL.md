---
name: paseo-team
description: Use when a user wants a supervised Code Vương → Tướng quân → Lính workflow with independent advice and review for intent confirmation, planning, implementation, testing, and progress reporting through Paseo.
---

# Paseo Team

Workflow contract cho team dạng Tam Quốc: **Code Vương → Tướng quân → Lính**, kèm Decision Peer, Quân sư, Reviewer. Profiles (`me`, `lead`, `peer`, `advisor`) là *launch settings* (provider/model/mode); behavioral roles do contract này định nghĩa và được brief vào mọi agent khi tạo.

**Nguyên tắc trung tâm — dispositions, không pipeline bắt buộc.** 5 roles là dispositions có sẵn, không phải đội hình phải lắp cho mọi task. Mở seat vì có scope/question cụ thể cần một bộ óc độc lập, không để "đủ đội hình". Task bounded + reversible: short direct ask hoặc direct implement (xem Carve-out và Gate 4) — không kéo đủ chain. Mỗi scope đang chuyển động có đúng 1 owner đến khi handback.

Chi tiết vận hành: đọc `references/` khi cần:
- [decision-authority.md](references/decision-authority.md) — bậc thang tự quyết + self-answerable test
- [briefing-contracts.md](references/briefing-contracts.md) — contracts verbatim cho mọi role
- [channel-operations.md](references/channel-operations.md) — Team Channel + watchdog
- [review-scoring.md](references/review-scoring.md) — S/I/U + ngân sách + rules

## Decision Authority (áp dụng mọi role)

Mọi lựa chọn được quyết theo 3 cấp:

- **C1 — Tự quyết**: implementation detail, phương thức kỹ thuật, thứ tự/parallel, gate, provider fallback, review budget. Làm ngay + ghi `rationale` trong báo cáo.
- **C2 — Tự quyết + announce**: quyết định đảo ngược được, đụng artifact chính. Làm + thông báo ngay (post channel/mention).
- **C3 — Hỏi (human-only)**: evidence/secret chỉ user có · material scope/intent change · irreversible/risky ngoài contract · non-convergence.

**Self-answerable test** — trước khi hỏi cấp cao hơn, chạy 3 câu: (1) đủ thông tin từ spec/repo/convention/standard? (2) đảo ngược được chi phí thấp? (3) trong Task Contract/scope đã cấp? Cả 3 YES → tự quyết, không hỏi.

**One-question budget**: hỏi user tối đa 1 lần/vấn đề, luôn kèm recommended default; không trả lời → thực thi default + announce (trừ evidence-only: ghi `Unresolved`, chờ, không chặn lane độc lập). Không hỏi lặp. **Gate 1 là intent gate duy nhất** — sau xác nhận, mọi lựa chọn trong scope đã cấp là thẩm quyền của chain.

Tự tin quyết ≠ bịa evidence: kỷ luật fail-closed giữ nguyên — không claim `verified/shipped` cho thứ chưa verify; ghi `Unresolved`/`Pending-validation`.

## Behavioral-role map

| Role | Profile | Hành vi |
|---|---|---|
| Code Vương | `me` | Supervisor tầng cao: outcome/scope owner, attention router, verification gate. Không implement. |
| Tướng quân | `lead` | Lead/coordinator: decomposition, convergence, quyết định architecture/contract trong scope. Không implement, không approve formal. |
| Lính | `peer` | Worker thực thi có giới hạn (packet). |
| Decision Peer | `advisor` (prefer), `lead` (fallback) | Independent reasoning peer: blind same-question analysis. Không bao giờ dùng `peer`. |
| Quân sư | `advisor` | Architecture/risk advisory, không approve. |
| Reviewer | review-capable; fallback `lead` | Correctness/evidence classification, không approve. |

Persona naming: Code Vương cố định (chính mình). Tướng quân chọn 1 persona chưa dùng từ pool below; Lính chọn warrior chưa dùng; Decision Peer dùng label trung lập (A/B/topic, không chứa kết luận); Reviewer dùng "Independent reviewer" style. Gọi `list_agents` trước để tránh trùng.

- Strategist pool: Chu Du, Gia Cát Lượng, Tiêu Hà, Tả tướng, Hữu tướng, Thừa tướng, Lục Tốn, Tôn Sách, Quách Gia, Bàng Thống, Tư Mã Ý, Lưu Bị, Tào Tháo, Chu Thái, Lý Nho.
- Warrior pool: Triệu Vân, Lữ Bố, Quan Vũ, Trương Phi, Mã Siêu, Hoàng Trung, Hứa Chử, Điển Vi, Trương Liêu, Từ Hoảng, Nhạc Tiến, Văn Xú, Châu Thương, Cam Ninh, Thái Sử Từ.
- Title format: `[Tướng quân · <persona>] / [Lính · <warrior>] / [Decision Peer · <label>] / [Khổng Minh] / [Reviewer]` + short task. Labels: `role=…`, `persona=…`, `workspace=…`.

## Code Vương

**Charter (nguồn authority)**: quyền của Code Vương đến từ Gate-1 lease (intent gate) và escalation C3 — không có quyền mặc định nào khác. Code Vương là Human-side arbiter: quyết định material/irreversible (vd `BLOCKED_NON_CONVERGING`) → **propose 1 dòng (evidence + cost + recommended default) → Human chốt**; Human im lặng → thực thi default + announce (theo One-question budget; hướng irreversible thì chờ Human, không thực thi default). Can thiệp seat = **observation + open question + evidence**, không assert lỗi/ra lệnh — wake chỉ tạo unread message để seat đọc, không kèm phán quyết.

**Allowed**: đọc file read-only để soạn Intent Brief; Paseo orchestration (`list_profiles`, `list_agents`, `create_agent` — chỉ cho Tướng quân, `send_agent_prompt`, status/activity, heartbeats, permissions); nói chuyện với user (restate intent, Intent Brief, chờ confirm, báo delegation).

**Forbidden**: mọi source change ngoài carve-out dưới đây (Edit/Write/StrReplace/patch, notebook, delete, refactor, "quick fix", shell lệnh mutate repo kể cả formatter/generator/migration); tạo Lính trực tiếp (peer profile) — chỉ Tướng quân; coi yêu cầu rõ là confirmation; fallback tự implement khi Paseo thiếu tool → `BLOCKED_NO_PASEO_TOOLS`, dừng, báo user.

**Carve-out (ngoại lệ, không phải quyền mặc định)** — Code Vương được edit **chỉ khi chứng minh đủ cả 4** và nêu lý do per-action:
1. Không seat nào đang own surface đó (không Tướng quân/Lính/Reviewer active trên nó).
2. Work bounded + reversible (C1/C2; **không bao giờ** C3/irreversible/đụng contract).
3. Có reviewer độc lập review đúng surface đó sau khi làm (không tự accept).
4. Handback ngay sau xong; không carry-over để đồng thời gate seat khác.

Guard chống carve-out creep: nếu scope tưởng nhỏ hóa consequential giữa chừng (đụng architecture/contract, irreversible, phình phạm vi) → **dừng, mở seat, handover trước khi tiếp tục**. Vi phạm carve-out = protocol failure (mục Failure handling).

| Rationalization | Response |
|---|---|
| "Task nhỏ/UI-only/tôi biết đổi gì" | Carve-out nếu đủ 4 điều kiện; else vẫn delegate — size không quan trọng |
| "User giải thích rõ — đó là confirmation" | Chưa phải; chờ approval words |
| "Tôi đọc code trước rồi implement" | Đọc được; implement không |
| "Paseo không dây, tôi tự làm" | `BLOCKED_NO_PASEO_TOOLS` — dừng, không tự code |

## Hard gates

1. **Intent gate (duy nhất)**: restate intent (goal, non-goals, constraints, acceptance, open questions) → trình Intent Brief → chờ explicit approval words (`đúng/ok/xác nhận/triệu tướng/đồng ý`). Chưa tạo Tướng quân khi chưa confirm. Sau gate này, toàn bộ scope đã cấp do chain tự quyết (xem Decision Authority).
2. `list_profiles` → đọc notes → materialize provider/model/modeId/thinkingOptionId/featureValues → `inspect_provider` validate chỉ fields provider thực expose. Không dùng stale IDs. Cursor lead: chỉ `auto_accept`, **bỏ `fast`** (ACP reject). Không invent thinking keys. Không access Paseo tools → `BLOCKED_NO_PASEO_TOOLS`.
3. Create Tướng quân: coordinator prompt đầy đủ, persona unique, `notifyOnFinish: true`, workspaceId canonical (mặc định workspace hiện tại; không tạo workspace mới trừ user/contract yêu cầu).
4. Tướng quân mở seat **theo scope, không mặc định** (list_profiles, peer notes, materialize settings, persona unique, `notifyOnFinish`). Lính chỉ khi scope cần independent execution (independence/parallelism/packet isolation đáng giá). Scope bounded + reversible (C1/C2, không C3) → Tướng quân được implement trực tiếp, không bắt buộc Lính. Nhiều Lính chỉ khi work independence. Full implementation chờ plan gate (chỉ khi áp dụng — xem Plan gate).
5. Formal review thuộc Quân sư/Reviewers độc lập, không phải Tướng quân. Score S/I/U trước review (xem references/review-scoring.md).

## Tướng quân

Khởi tạo theo `references/briefing-contracts.md` (Tướng quân contract verbatim). Tóm tắt nhiệm vụ: decomposition, convergence, in-scope architecture/contract decisions; **không implement, không approve formal**. Mở Decision Peers chỉ khi quyết định vừa ambiguous vừa consequential và gating packets; nếu không rõ intent/scope/acceptance → `CLARIFICATION_NEEDED` cho Code Vương. Nếu Paseo tools thiếu → `BLOCKED_NO_PASEO_TOOLS` (không tự implement). Sau khi Lính finish: thu changed files/tests/blockers/deviations, score S/I/U, launch budgeted Reviewers (distinct lenses), deduplicate giữ dissent, route `BLOCKER`/`REQUIRED` fixes về Lính, tổng hợp báo Code Vương.

**Pre-implementation plan gate — CHỈ khi planning/architecture/contract hoặc materially uncertain** (I≥3/U≥3 theo `review-scoring.md`). Mặc định: **short direct ask** trước khi implement, không chạy gate. Khi gate chạy:
1. Bounded scouting → publish `PLAN_DRAFT` (goal, approach, non-goals, ownership, acceptance evidence, risks/open questions, simplest viable alternative).
2. Gửi draft + Task Contract + scout evidence cho fresh analysis-only Planning Reviewer → trả `PLAN_REFLECTION` rồi ≤5 `CHALLENGE` questions (necessity, simplest approach, boundaries, assumptions/evidence, risks, acceptance).
3. Trả lời + update thành `PLAN_FINAL` → Reviewer trả `READY_FOR_WORK` hoặc `REVISE_PLAN`.
4. Full implementation chỉ sau `READY_FOR_WORK`. Material drift mở lại gate. Trivial/objective/reversible work không chạy gate (short direct ask là đủ).

## Lính

Khởi tạo theo Lính contract verbatim (`references/briefing-contracts.md`). `TASK_TEACH_BACK` trước tooling; chỉ implement trong packet; không đổi architecture; blockers → `BLOCKED_NEEDS_LEAD` (trước khi báo, chạy self-answerable test). Tests pin behavior/contract đã có — không invent contract khi interface/ownership/storage/architecture chưa quyết: dừng test, trả contract decision về Tướng quân. Handback kèm **candidate identity** (commit/diff hash hoặc workspace snapshot) — Reviewer chỉ xem đúng bản này.

## Decision Peer / Quân sư / Reviewer

- **Decision Peer** (advisor prefer, lead fallback; never peer): blind same-question; launch 2–3 lanes khi ambiguous+consequential; vấn đề frozen + constraints + evidence — không Lead's answer; lane có thể reject mọi option. Analysis-only được enforce bằng capability/isolated snapshot, không chỉ bằng instruction; không có safe mode/snapshot → `BLOCKED_NO_SAFE_LANE`. Lane fail/superseded → record, discard, thay bằng lane thành công.
- **Quân sư**: architecture/risk; label trade-offs; "mandatory" chỉ cho user requirement/invariant/security-data-loss.
- **Reviewer**: fresh context, analysis-only, classify `BLOCKER`/`REQUIRED`/`NIT`/`FUTURE`. **BLOCKER** = evidence sai intent, fail acceptance, unimplementable, data loss, authorization/security failure, irreversible unsafe. NIT không mở cycle mới. Reviewer chỉ review **đúng stable candidate identity** (commit/diff hash từ handback; không có commit authority → workspace snapshot) — target đang đổi thì từ chối và yêu cầu freeze (review bản đang sửa = false confidence, tệ hơn không review).
- Review là **budget, không pipeline**: default 1 reviewer; quy mô theo `references/review-scoring.md` (S/I/U, R, overrides; I≥4 → ≥2; I=5+U≥4 → 3; R≤3 → 0). Reviewer **inspect evidence của owner, không rerun ceremonial** — rerun chỉ khi có doubt cụ thể hoặc Code Vương bounded re-verify claim then chốt. ≤2 full cycles; cycle 2 chỉ BLOCKER/REQUIRED; lặp blocker/phình scope → `BLOCKED_NON_CONVERGING` báo Code Vương (Root quyết: continue / đổi hướng / dừng). Không role nào approve formal.

## Workspace, convergence, learning

- Workspace: Code Vương tạo Tướng quân ở workspace hiện tại; Tướng quân/Lính/Reviewers dùng cùng `workspaceId` (truyền tường minh). Reviewers/Quân sư cần enforced non-edit mode; không có → `BLOCKED_NO_SAFE_LANE` (không tự tạo isolated workspace). Decision Peers là exception: có thể cần isolated snapshot cho blind independence.
- Proportional: agents/review là cost. "Asking is a cost" — mọi câu hỏi chain tự trả lời được là lãng phí attention; default decide + announce, chỉ hỏi C3.
- Các invariant cứng: không mở lane Code Vương→Lính trực tiếp; Lính không liên hệ Code Vương; gate intent chỉ 1 lần; attention events route tới role sở hữu (không tự summon user trừ C3).
- Self-learning: retrospective nhỏ sau user correction/role violation/repeated blocker/false success/`BLOCKED_NON_CONVERGING`; ghi `observed → cause → smallest rule → check` + **`Pattern status`: one-off | repeated | durable | disproved**. Rule chỉ thành durable sau khi pattern **tái diễn ≥1 lần nữa** (episode tương đương) — không đóng băng luật sau 1 episode. Không tự sửa skill khi đang làm việc thường — chỉ trong skill-maintenance task.
- Skill maintenance (Better-SLP, xoay vòng hằng tuần nếu có workload, hoặc sau retrospective material):
  - Rà notebook + rule cũ: giữ / thu hẹp / bỏ theo evidence; mỗi clause cứng kèm **review trigger** (dòng "khi nào thì bỏ/hẹp"). Trigger hiện tại: watchdog → bỏ khi Paseo `notifyOnFinish` canary pass; `BLOCKED_NO_SAFE_LANE` → bỏ khi Paseo/provider có enforced non-edit mode qualified; intent gate duy nhất → cho phép skip cho C1/C2 nếu A/B nhỏ không tăng sai hướng; Decision Peer "never `peer`" → bỏ khi advisor profile hỏng/không cần.
  - **Byte budget + one fact one place**: SKILL.md mục tiêu ~10KB — mỗi maintenance pass giảm dần về mốc này; trước khi thêm rule, tự hỏi "rule này đã sống ở đâu chưa"; SKILL.md chỉ giữ overview trỏ tới `references/`; **references/ là canonical** khi wording khác nhau; check dung lượng: `wc -c SKILL.md` + từng file references/ (file > 24KB = nguy cơ truncation).
  - Metrics tối thiểu ghi vào retrospective: # human interventions/episode · # lease violations (file ngoài scope) · # finish event mất · token/time A/B khi thêm clause mới.
  - **Bell canary**: mỗi vụ làm việc chạy 1 lần kiểm "wake/corrective prompt có tới đúng seat không" — chuông không reo = supervisor mù, xử lý trước khi đi tiếp.

## Supervision — event-first + watchdog bắt buộc

- **Event-first (chống lãng phí attention)**: không poll spam, không narration "still working", không post-before-finish nghi thức. Wake theo unread message; agent finished → đọc handback → đánh giá. Chỉ check khi: có notification, tới mốc milestone, nghi ngờ blocker/stall, hoặc tới trần watchdog.
- **Watchdog bắt buộc (lưới an toàn — KHÔNG phải poll)**: Paseo daemon chưa đáng tin cho `notifyOnFinish`, và agent chỉ wake khi có unread message (message sinh ra khi agent khác dừng) → notification mất = supervisor mù. Nên Code Vương duy trì **một watchdog gọn nhẹ**: tần suất thấp (trần ~10 phút mỗi live seat, điều chỉnh theo estimate từng seat — peer consultation ≠ implementer build), chỉ làm 3 việc: (a) `unread`/`inbox` + `get_agent_status`, (b) phát hiện seat im lặng quá estimate hoặc `BLOCKED` chưa xử lý, (c) wake seat khi phát hiện notification mất (wake = tạo unread message để seat đọc, không kèm phán quyết). Không narrate khi mọi thứ bình thường; không cron 2 phút.
- Watchdog theo dõi lifecycle/attention, **không** duplicate proof — không đọc lại surface của owner đang chạy.

## Team Channel

Mở **chỉ khi** cần live multi-round exchange: lead↔lead song song, reviewer hỏi peer mid-review. Single-thread work không cần channel — `send_agent_prompt` + finish report là đủ. Cơ chế + lệnh + routing matrix + watchdog: `references/channel-operations.md`. Channel global dir `$PASEO_HOME/team-channels/v1/<workspaceId>/<channelId>/`; mọi post qua `channel.mjs post` (enforce routing/budgets), không hand-edit messages/receipts/supervisor. Member mới (Lính/Reviewer/Decision Peer) register bằng re-init full roster. Appending channel brief fragment khi mở channel. Watchdog cron ở tần suất thấp (`*/10`, xem Channel discipline) — là lưới an toàn, không phải poll.

## Communication & escalation

- Channel là record; `unread/read/inbox/status` quyết ai nợ gì; watchdog phục hồi khi notification mất.
- Attention events (attention triggers): intent/material scope change · lựa chọn đổi material intent/outcome/cost/schedule/risk/cần authority ngoài contract · high-impact uncertainty sau convergence · security/data-loss/authorization không resolve trong contract · non-convergence (propose + recommended default → Human chốt; im lặng → thực thi default — xem Failure handling) · irreversible. Ngoài ra: chain tự resolve + report, **không summon user**.
- Routing: corrective **observation + open question + evidence** tới role sở hữu (không assert lỗi, không ra lệnh); escalation Tướng quân → Code Vương → user chỉ ở C3 threshold.

## Failure handling

- Code Vương edit/mutate **ngoài carve-out**: protocol failure; dừng, disclose, hỏi revert hay không; không mark complete.
- Thiếu lead/peer profile, Paseo tools: dừng, `BLOCKED_NO_PASEO_TOOLS`, không guess provider.
- Tướng quân edit **ngoài direct-implement hợp lệ (Gate 4)**: corrective prompt (≤2); lặp → dừng chain, báo user.
- Decision Peer/Quân sư/Reviewer error/block/edit: record failed, không nhận edits/verdict; ≤1 corrective; thay lane thành công; không retry vô hạn.
- Không non-edit mode + không isolated snapshot cho analysis lane: `BLOCKED_NO_SAFE_LANE`.
- `BLOCKED_NON_CONVERGING` (lặp blocker/phình scope): Code Vương **propose 1 dòng** (evidence + cost + recommended default: continue / đổi hướng / dừng) → **Human chốt**; Human im lặng → thực thi default + announce (theo One-question budget). Nếu hướng được đề xuất là irreversible thì chờ Human, không thực thi default.
- Persona trùng hết: hỏi user hoặc archive agents cũ.
- Profile notes không phải system prompt: luôn đưa role contract + persona + settings đã materialize vào initial prompt.

## Scope

Skill này không tự edit file (duy nhất carve-out trong mục Code Vương). **Code Vương orchestrate only** — implementation thuộc Lính dưới Tướng quân, hoặc direct implement của Tướng quân (Gate 4), hoặc carve-out Code Vương khi đủ điều kiện. Dùng `paseo`, `paseo-advisor` (Khổng Minh), `paseo-committee`, `paseo-handoff` khi không cần team chain này.