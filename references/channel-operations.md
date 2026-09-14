# Team Channel — Operations

Paseo 0.6 không có chat-channel/message-bus API. Các primitives thật: `create_agent`, `send_agent_prompt`, `get_agent_activity`, terminals, heartbeats, và **shared workspace filesystem**. Team Channel là cơ chế opt-in cho multi-round conversation giữa 2+ agent, enforced bằng tooling (file + watchdog), không middleware giả định.

## Khi nào mở channel

- **Cần thiết**: live multi-round exchange giữa roles — General Lead↔Specialist Lead, nhiều peer leads song song, hoặc Reviewer hỏi Worker trực tiếp giữa review.
- **Không cần**: single-thread work — hierarchy `send_agent_prompt` + finish reports là đủ.
- Không mở channel chỉ để ghi heartbeat, thay thế handoff, hoặc làm cho một task nhỏ trông có vẻ được giám sát.

## Khởi tạo (bởi supervisor — Code Vương)

```bash
node <channel-tool> init \
  --channel-id <channelId> --workspace-id <workspaceId> \
  --by <supervisorAgentId> --members '<members-json>' --max-rounds <N> \
  [--mission-json '<mission-lease-json>']
```

- `<channel-tool>` = `$PASEO_HOME`… thực tế: `~/.agents/skills/paseo-team/assets/channel/channel.mjs` (bản đang dùng).
- Members JSON: `[{agentId, role, persona, parent?}]`; role ∈ supervisor/lead/peer/reviewer; General Lead là lead duy nhất không có `parent`, Specialist Lead phải có `parent` = General Lead agentId; peer/reviewer **bắt buộc** `parent` = lead agentId; supervisor member phải bằng `--by`; `--max-rounds` nên ≥ fan-out (vd 20) chứ không để default 3.
- Channel dir (global): `$PASEO_HOME/team-channels/v1/<workspaceId>/<channelId>/` (mặc định `$HOME/.paseo`). Không tạo `.team/` trong project.
- `init` cài 1 cron watchdog (`*/10 * * * *`, marker riêng — tần suất thấp, là lưới an toàn cho notification mất, không phải poll nhanh); `close` gỡ entry. Re-init giữ `createdAt`, mission và mọi budget không được truyền lại; flag budget chỉ override có chủ đích và bị reject nếu thấp hơn usage hiện tại. Dùng re-init để **đăng ký member mới** với full roster mới nhất.

## File layout

`channel.json` (state/members/budgets) · `mission.json` (durable mission lease/checkpoint) · `rules.md` (routing matrix — mọi member đọc trước khi post) · `messages/*.json` · `receipts/<agentId>.json` · `supervisor/reminders.json` + `heartbeat.json` (evidence/alerts). Cấm sửa tay `messages/`, `receipts/`, `supervisor/`; mission chỉ cập nhật qua command/tool có atomic write và giữ `missionId`/`leaseEpoch`.

Mission lease tối thiểu: `missionId`, `intentHash`, `ownerId`, `leaseEpoch`, `scope`, `nonGoals`, `acceptance`, `status`, `checkpoint`, `predecessor`, `handoffRef`, `updatedAt`. Mọi checkpoint, alert và candidate report phải tham chiếu `missionId + leaseEpoch`. `lease` là thao tác hành chính của supervisor: fence epoch cũ trước khi successor nhận việc; không tự động kill turn đang chạy.

## Lệnh (node channel.mjs …)

| Lệnh | Công dụng |
|---|---|
| `help [role\|command]` (hay `--help`/`-h`, kể cả gõ thiếu) | Cheat sheet: lệnh, message schema, routing matrix, "một turn đúng quy trình". Lọc theo role hoặc lệnh. **Điểm tự học của agent mới.** |
| `sync <dir> <agentId>` | Một snapshot read-only: mission, unread, open obligations, own budget và close hint. Entry point mặc định cho mỗi exchange point. |
| `unread <dir> <agentId>` | Inbound chưa đọc (authoritative read view) |
| `inbox <dir> <agentId>` | Mục mình nợ trả lời (open questions/escalates) |
| `post <dir> '<json>'` | Gửi; validate member/routing/replyTo/thread/budget; tự gán id/ts/round |
| `read <dir> <agentId> <id...>` hay `--all` | Ghi read receipt (không settle câu hỏi) |
| `threads <dir>` / `status <dir>` | Threads / ai nợ gì + closeHint |
| `mission <dir>` | Đọc mission lease bền vững |
| `checkpoint <dir> --by <agentId> --json '<object>'` | Owner ghi checkpoint/candidate evidence bằng atomic write |
| `lease <dir> --by <supervisor> --owner <lead> --handoff-ref <ref>` | Fence epoch cũ và rebind successor sau handoff |
| `wake <dir> <agentId>` | Tra cứu ai cần được đánh thức sau câu trả lời của agent này; không tự gửi tin nhắn. Watchdog/supervisor mới là bên gửi reminder khi cần |
| `pending <dir>` | Các question/escalate chưa settle |
| `rounds <dir> <agentId>` | Budget đã dùng của member |
| `close <dir> --by <supervisor>` | Supervisor đóng channel (sau `closeHint`) |

Message schema: `{ id, ts, channelId, threadId, replyTo, from, fromRole, to[], kind, body, round }`; kind ∈ question|answer|info|ack|eod|escalate|close.

## Routing matrix (canonical, enforce bởi `permit`/`post`)

| from | may send to |
|---|---|
| supervisor | anyone, `*` broadcast; may post `close` |
| lead | supervisor, any lead (peer leads, lead↔lead), own peers (parent = this lead), reviewers |
| peer | parent lead ONLY; **reply-only answer** cho reviewer's direct question (không initiate) |
| reviewer | parent lead và peers của lead đó ONLY; được chủ động hỏi Peer câu hỏi review cụ thể, Peer chỉ được trả lời và không nhận scope mới |

Denied default: peer→supervisor, peer→lead khác/peer/reviewer (trừ reply-only), reviewer→supervisor, reviewer→lead khác, lead→peers của lead khác. Role tokens (`to:["lead"]`) expand rồi filter theo matrix.

## Thao tác member (multi-round semantics)

- Correlation: reply set `replyTo` + inherit `threadId`; `post` reject replyTo sai thread.
- `question`/`escalate` actionable tới khi người được hỏi post `answer`/`ack`/`eod` bất kỳ trong thread. `read` không settle.
- Mỗi turn: `sync` → trả lời đúng những gì nợ → `read` receipt. `answer`/`ack` đã settle obligation thì không post thêm `eod`; chỉ dùng `eod` khi không có substantive reply. Chạy `sync` lần hai trước finish chỉ khi post vừa rồi có thể đổi close readiness. Batch-answer + `wake` dưới tải.
- Escalate (`kind: escalate`) chỉ tới supervisor; supervisor route theo attention thresholds, reply `ack`.

## Loop avoidance (3 guard)

1. **Budget**: `maxRoundsPerMember` (channel mới mặc định 3 — size theo fan-out, vd `--max-rounds 20`), `maxThreadsPerMember` (4), `maxMessages` (250; supervisor nên close trước). Re-init không truyền flag sẽ giữ budget cũ, không hạ về default.
2. **Reply-scoping**: `inbox` chỉ liệt kê câu hỏi trực tiếp chưa trả lời; trả lời đúng nợ rồi `eod`.
3. **Supervisor close**: `status` báo `closeHint` → supervisor `close`. Rounds hết mà còn open = non-converging → escalation thường.

## Deterministic supervisor watchdog

- `init` cài cron `*/10` chạy `supervisor.mjs <channelDir>` — tạo agent không, gọi LLM không; đọc log messages + receipts + reminder state + `paseo agent ls --global --json`, và khi adapter hỗ trợ thì đọc activity/log delta để ghi nhận compact evidence.
- Idle member có unread/open → reminder; member đang `running` không bị `send --no-wait` interrupt chỉ vì overdue; sentinel chỉ ghi alert/đề xuất checkpoint hoặc route tới Code Vương. `reminders.json` chống reminder storm.
- Watchdog theo dõi lifecycle/attention — không narrate khi bình thường, không đọc lại surface của owner đang chạy (không duplicate proof). Event-first là hành vi mặc định; watchdog `*/10` chỉ catch notification mất / seat im lặng quá estimate.
- Compact marker thiếu event ID/cursor là `COMPACT_EVIDENCE_PARTIAL`, không phải counter authoritative. `>2` marker chỉ tạo `SUCCESSOR_PROPOSAL` khi owner stale/gone hoặc đã tới safe boundary; không auto-kill.
- `--dry-run --agents-file <json>` để mô phỏng. `supervisor/watchdog.log` cho output bền.

## Channel brief fragment (khi Code Vương mở channel, append vào mọi role prompt)

<!-- brief:channel -->
```text
  Channel {{channelId}} at {{channelDir}}. Read rules.md once. At each real exchange point run `node channel.mjs sync {{channelDir}} {{agentId}}`; its missionId + leaseEpoch + scope/non-goals/acceptance are durable after compact. You are {{role}} (parent {{parentAgentId}}). Answer only open obligations through `post`, then mark consumed IDs with `read`; an answer/ack already settles its thread, so do not add ceremonial eod. Run sync again only if your post may change close readiness. No sleep/status/activity polling: with no event, return PENDING and stop the turn. Never hand-edit channel state. Before mutation after compact, sync and stop if lease/scope is unclear. Escalate only through kind escalate; never exceed your budget.
```

## Register member mới (lead tạo child)

Worker/Reviewer/Decision Peer tạo bởi Lead phải được đăng ký để tham gia channel: re-init với **full roster mới nhất** (supervisor agentId ở `--by`, cùng channel-id/workspace, peer/reviewer có `parent` đúng). Không cần opt-in của member.

## Verify mechanism

`assets/channel/test-channel.mjs` (routing, sync, threads, receipts, re-init budgets, close), `test-supervisor.mjs`, `test-cron-lifecycle.mjs`. Chạy với Node ≥ 18; không hard-code assertion count trong tài liệu.
## Channel discipline (chỉ áp dụng khi channel đã mở)

- Channel messages là record trao đổi; `mission.json` là nguồn sự thật cho mission lease. Notification có thể mất, nên không dựa vào notification một mình.
- Mỗi exchange bắt đầu bằng `sync`; trả lời obligation qua `post`, đánh dấu message đã đọc, rồi kết thúc. Chỉ `post` checkpoint khi có thay đổi material; không gửi heartbeat nghi thức.
- Turn kết thúc khi có blocker, verdict, work-chunk hoàn tất hoặc next action phải để lại record; role pause phải nói rõ blocker và điều kiện unblock.
- Supervisor dùng watchdog như lưới an toàn event-first; không poll `status/activity` giữa chừng khi không có event mới.
