# Mission Ledger — Record & Reference

Ledger là bản ghi bền vững cho **một mission**, để (1) tham chiếu khi cần **restore thủ công** và (2) đọc lại khi **reflect**. Đây là bản ghi, không phải cơ chế tự động: không phát hiện agent chết, không tự relaunch, không sửa lease/epoch, không đụng vào channel state.

Phần quan trọng nhất là `INTENT` và `MISSION` của **từng** seat. Phần còn lại ghi ngắn.

## Vị trí

- **Ledger nằm CÙNG folder với team chat.** `$PASEO_HOME/team-channels/v1/<enc(workspaceId)>/<enc(missionSlug)>/ledger.md`, trong đó `$PASEO_HOME` mặc định là `$HOME/.paseo` và `<enc(...)>` là `encodeURIComponent`.
- **Mission folder CHÍNH LÀ channel folder.** `missionSlug` **bằng** `channelId`. Khi mission có channel thì `ledger.md` nằm cạnh `channel.json`, `messages/`, `mission.json` — một folder, một nơi để tham chiếu và reflect.
- **Mission folder tồn tại kể cả khi không mở channel**; khi đó nó chỉ chứa `ledger.md`. Không cần channel, không cần `mission.json`.
- **Ai tạo folder:** Code Vương, lúc dispatch, bằng `mkdir -p`. Không cần command mới — `node channel.mjs path --channel-id <missionSlug> --workspace-id <workspaceId>` in ra đúng đường dẫn đó và **không** đòi channel phải tồn tại (`channel.mjs:662-665`).
- **Mở channel sau đó là phép cộng thêm, không phải di chuyển.** `channel.mjs init` vào đúng folder đó ghi thêm `channel.json`, `mission.json`, `rules.md`, `messages/`, `receipts/`, `supervisor/` và **giữ nguyên `ledger.md`**. Chuyển từ “chưa có channel” sang “có channel” không làm ledger đổi chỗ.
- **Không bao giờ di chuyển channel folder.** `supervisorJobId = sha256(path.resolve(channelDir) + NUL + channelId)` (`channel.mjs:288-294`), và cron marker nhúng chính id đó (`channel.mjs:318`). Di chuyển folder ⇒ id đổi ⇒ entry cron cũ mồ côi và có thể cài watchdog thứ hai cho cùng một channel. Ledger là file nằm trong folder; nó không phải lý do để move gì cả.
- **Ledger không nằm trên read path nào.** `sync` chỉ đọc `channel.json`, `messages/`, `receipts/<agentId>.json`, `mission.json` (`channel.mjs:860-893`); hai chỗ duy nhất enumerate thư mục đều nhắm `<dir>/messages` (`channel.mjs:448`, `supervisor.mjs:79`). Đã đo thật: ledger nằm ở channel root thì `sync`, `mission`, `status`, `threads`, `rounds`, `pending`, `inbox`, `unread`, `wake`, `help` đều **không** đọc nó, và độ dài `sync` không đổi.
- **Va chạm slug:** nếu folder đã có `ledger.md`, Code Vương đặt slug kèm hậu tố `-2`, `-3`, … **Không bao giờ ghi đè ledger đang có**.
- **Migration:** `cp -n` ledger cũ vào folder đích theo slug — **copy, không move**. Workspace lấy từ chính header của ledger (`workspace: wks_…`) nên migration xác định được, không đoán. Ledger không xác định được workspace thì để nguyên và đánh dấu legacy.
- Nếu mission có channel, header ghi thêm `mission.json id` + `leaseEpoch` để cross-reference; **Code Vương** cập nhật hai field đó khi channel được mở sau — đây là lần ghi header duy nhất ngoài lúc tạo.

## Ai ghi, khi nào

| Ai | Ghi gì | Khi nào |
|---|---|---|
| **Code Vương** | Tạo file ledger: `missionSlug`, `mission.json id`, mission intent verbatim, scope/non-goals/acceptance. Entry gốc của chính nó (`parent: none`). Và entry của **General Lead** — vì General Lead là seat con trực tiếp của nó. | Khi dispatch General Lead; cập nhật entry General Lead khi nhận handback hoặc khi mission finish |
| **General Lead** | Entry của các seat **mà nó là parent** (INTENT + MISSION đầy đủ); cập nhật progress/plan/decisions/blockers **của các entry đó** | Khi spawn seat, khi nhận handback, trước khi handoff/finish |

**Luật ghi (bất biến):** writer của một entry = **parent của seat đó**. Một seat không tự ghi entry của mình, kể cả entry của General Lead — entry đó do Code Vương ghi.

**Trường hợp gốc (không phải ngoại lệ):** entry gốc của Code Vương có `parent: none`, nên Code Vương tự ghi entry của mình. Đây là trường hợp gốc duy nhất và entry gốc **không bao giờ** bị đánh dấu `provisional`.

Mọi entry mang field `recordedBy` = agentId của người ghi. Nếu `recordedBy` của một entry **không phải** parent của seat — và entry đó không phải entry gốc — thì entry **phải** được đánh dấu `provisional`, và entry chính thức do parent ghi sẽ thay thế nó. Luật không có ngoại lệ nào khác; chỗ lệch luật phải tự khai ra.

Mỗi seat có đúng một entry "sống" và được cập nhật tại chỗ; chỉ `runtime`/`observedAt` là append.

- Seat chưa có entry thì ghi `(chưa ghi)` thay vì suy đoán, và **entry thiếu không chặn công việc**.
- **Cách rule này tới được người ghi:** brief là canonical cho luồng thường lệ và role **không** đọc trước `role-contracts.md`, nên nghĩa vụ ghi sổ được nhúng vào block `brief:role-routing` — block này có mặt trong mọi brief `lead/init`, tức mọi Lead lúc launch. Code Vương không được spawn nên nhận nghĩa vụ từ `SKILL.md`. Đây là lý do không cần bắt mọi role đọc `role-contracts.md` trước khi hành động.
- **Không ghi mỗi turn.** Chỉ ghi khi có thay đổi material — cùng nhịp với luật checkpoint trong [channel-operations.md](channel-operations.md).
- Ledger nằm trong `$PASEO_HOME`, **ngoài target codebase**. Vì vậy việc Code Vương tạo và cập nhật ledger là hành vi hành chính; nó không vi phạm luật read-only của Code Vương đối với codebase (`role-contracts.md`). Ledger không bao giờ là source, config hay plan kỹ thuật.

## Template

````markdown
# Mission ledger — <missionSlug>
updatedAt: <ISO> · workspace: wks_… · mission.json id: <missionId|none> · leaseEpoch: <n|none> · recordedBy: <agentId>

## Mission intent (verbatim)
<nguyên văn yêu cầu của user — không paraphrase>

## Mission (scope)
- scope: <1–2 dòng>
- non-goals: <…>
- acceptance: <…>

## Members

### <seatId> · <role> · <persona>
- parent: <seatId|none> · recordedBy: <agentId> [- provisional]
- profile: <profileId> · runtime: <provider/model>, mode <modeId>, thinking <thinking> · observedAt: <ISO>
  (lặp dòng `profile` khi seat được relaunch — append, không sửa dòng cũ)
- INTENT (nguyên văn từ packet): <vì sao seat này tồn tại>
- MISSION (nguyên văn từ packet): <giao gì — owned files, acceptance, handback>
- progress: <status> — 1 dòng
- plan: <tối đa 3 mục, mỗi mục 1 dòng>
- decisions: <tối đa 3 mục, mỗi mục 1 dòng>
- blockers: <tối đa 3 mục, mỗi mục 1 dòng>
````

## Ưu tiên và ngân sách

- `INTENT` / `MISSION`: viết **đủ chi tiết để người khác làm tiếp được** — không viết tắt, không ghi "xem brief", không tham chiếu "packet ở trên". Đây là phần được ưu tiên ngân sách.
- `profile` / `runtime`: ghi **đúng giá trị đã dùng tại thời điểm spawn**, kèm `observedAt`. Đây là **bằng chứng lịch sử để reflect**, không phải input để launch lại.
- `progress`: **1 dòng**. `plan` / `decisions` / `blockers`: **tối đa 3 mục, mỗi mục 1 dòng**. Không copy handback vào ledger.
- Seat phù du (Reviewer, Decision Peer) ghi gọn hơn: `INTENT` một dòng ("review candidate X"), `MISSION` là phạm vi lens + verdict. Không cần restore-grade detail cho seat vốn được tạo lại mới mỗi lần.
- Ngân sách: **guidance đo được, không phải cap** — trung bình **khoảng 1.5 KB mỗi seat**. Đo thực tế: 7.3 KB cho mission 4 seat · 8.1 KB cho mission 6 seat · 17 KB cho mission 6 seat **có review history**. Khối `Mission intent (verbatim)` không tính vào con số đó.
- Nếu một entry seat vượt ~3 KB, phần lớn là do review history: hãy **tóm tắt** review history thay vì ghi từng vòng. **Độ trung thực của `INTENT`/`MISSION` thắng ngân sách byte** — không cắt hai phần đó để giữ con số.
- Ledger 5–17 KB vẫn đọc một lần là đủ để restore thủ công; đừng đọc nó mỗi exchange.

## Restore thủ công khi provider limit

1. Đọc `ledger.md`: lấy `INTENT`, `MISSION`, `parent`, `role` của seat chết, và `profile`/`runtime` đã ghi.
2. Gọi **`list_profiles` mới**; chọn profile theo `role` và notes; materialize đúng `provider/model` + `modeId` + `thinkingOptionId` + `featureValues`.
   - **Không** dùng `runtime` trong ledger làm giá trị launch. Bản `main` của skill từng hardcode một bảng fallback profile (`git show main:references/profiles.md`, commit b378eb2); bảng đó không còn ở bản `slim`. Vì vậy provider/model của một seat phải được chọn lại từ `list_profiles` tại thời điểm restore, và notes phải được đọc từ output `list_profiles` lúc chạy — không đọc từ repo.
   - Không có profile khớp → `BLOCKED_NO_PROFILE`; không đoán provider/model.
3. Dựng prompt cho seat mới bằng `node assets/brief/brief.mjs`, điền `--goal/--owned-files/--non-goals/--acceptance/--checks/--handback` **nguyên văn từ `INTENT`/`MISSION`**.
4. Append `runtime` mới + `observedAt` vào entry. Không sửa entry cũ.
5. Đặt `progress: unverified` cho tới khi seat mới tự đối chiếu lại với repo/worktree. Ledger là **claim**, không phải sự thật đã kiểm chứng.

## Nghĩa vụ ghi sổ và enforcement

Task nhỏ/ngắn giữ **tự giác**. Từ ngưỡng trở lên, code **buộc thật**:

- **Ngưỡng:** `obligated = (seats >= 6) || (substantive >= 20)`, trong đó `seats = channel.members.length` và `substantive` đếm message có `kind` là `question`/`answer`/`info`. Dùng **OR** vì hai trục hỏng độc lập: một channel 5 seat nhưng 45 post vẫn nặng, và một channel 10 seat nhưng 8 post cũng nặng. Calibrate từ 5 channel thật: seats `[4,5,8,10,23]`, substantive `[6,8,25,45,112]` — ngưỡng tách 4 channel nặng khỏi `import-mvp` (4 seat, 6 post).
- **`MISSING`** = `ledger.md` không tồn tại **hoặc** nhỏ hơn 512 B (ledger thật nhỏ nhất quan sát được là 7.3 KB, nên file rỗng bị coi là thiếu).
- **`STALE`** = `obligated` **và** ledger tồn tại **và** có ≥15 post substantive với `ts` muộn hơn `mtimeMs` của `ledger.md`.
- **Ma trận:** `init` tạo **channel mới** có `ledgerPolicy`, seats ≥ 6, `MISSING` → **BLOCK** (phải viết `ledger.md` trước). `checkpoint` khi `obligated` + `MISSING` → **BLOCK**; khi `STALE` → **WARN**. `lease` và `close` → **WARN** cho cả `MISSING` và `STALE`, **không bao giờ block** (không chặn đường phục hồi và dọn dẹp). `sync` **hoàn toàn không đổi** và không đọc ledger.
- **Grandfathering:** `channel.json` chỉ nhận `ledgerPolicy: 1` khi channel được **tạo mới**, và giữ nguyên giá trị đó khi re-init. Channel cũ không có field này → **chỉ WARN, không bao giờ block**, và `channel.json`/`jobId`/`marker`/cron của chúng giữ nguyên byte-for-byte. Cảnh báo này là cố ý: đó là cách các channel nặng đã tồn tại được nhắc.
- **Khi vượt ngưỡng mà chưa có ledger thì chưa ghi được gì cả** — ledger vẫn là file viết tay. Cơ chế chỉ chặn/gọi ý, nó **không tự viết** ledger.
- **Mission không có channel: không enforce được gì.** Không `channel.json`, không `init`, không watchdog ⇒ chỉ còn luật trong [role-contracts.md](role-contracts.md) và file này. Đây là khoảng trống thật, không phải đã được xử lý.
- Chi phí: kiểm tra cần **1 `statSync`**; phần `STALE` phải đọc messages — đo thực tế **~5 ms cho 176 message, 0 token model**.

## Non-goals

Không tự phát hiện agent chết · không tự relaunch · không `MEMBER_RESTORE_PROPOSAL` · không theo dõi `sessions[]`/`predecessor` · không tự viết ledger · không đưa ledger vào hot path (`sync` không đọc ledger).

`init`, `checkpoint`, `lease` và `close` **có** mang kiểm tra ledger theo ma trận ở trên; `sync` và `supervisor.mjs` thì không đổi. Không có subcommand mới, không thêm cron/daemon.

## Liên quan

- [channel-operations.md](channel-operations.md) — `mission.json` là mission lease của channel; ledger là bản ghi song song, độc lập channel, không thay thế lease.
- [briefing-contracts.md](briefing-contracts.md) — dựng prompt cho seat mới; `INTENT`/`MISSION` trong ledger là nguyên liệu của packet.
- [failure-handling.md](failure-handling.md) — xử lý khi thiếu profile hoặc khi không hội tụ.
