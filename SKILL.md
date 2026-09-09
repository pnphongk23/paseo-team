---
name: paseo-team
description: Use when a user wants a lean Paseo team with a user-facing Code Vương, one outcome-owning General Lead, optional bounded specialists/workers, independent review, and evidence-based supervision.
---

# Paseo Team

Workflow contract chuẩn: **User ↔ Code Vương ↔ General Lead**, với specialist lead, worker, advisor và review lens là các disposition mở khi có lợi ích rõ ràng.

```text
User ↔ Code Vương (User I/O, lease/sentinel router; KHÔNG làm technical)
                 ↕
       mission lease / team channel (durable record)
                 ↕
General Lead (Outcome owner duy nhất; decompose, plan, execute/delegate)
        ├─ optional bounded worker (Lính)
        └─ mandatory review lens (độc lập, candidate bất biến)

Independent sentinel/heartbeat ── evidence-only alert ──► Code Vương
```

Đọc reference theo nhu cầu, không load tất cả mặc định:
- [decision-authority.md](references/decision-authority.md) — khi gặp C2/C3 hoặc cần self-answerable test
- [briefing-contracts.md](references/briefing-contracts.md) — khi tạo/cập nhật role brief
- [review-scoring.md](references/review-scoring.md) — khi budget hoặc chạy review
- [channel-operations.md](references/channel-operations.md) — chỉ khi mở Team Channel/watchdog
- [failure-handling.md](references/failure-handling.md) — chỉ khi có failure, recovery hoặc non-convergence

Prompt construction: Bắt buộc dùng `node assets/brief/brief.mjs` để tạo prompt. Brief sinh ra phải đủ cho công việc thường lệ; skill path chỉ là fallback khi contract mơ hồ. Không tự chép role rules thủ công.

---

## Behavioral Roles & Boundaries

| Role | Profile | Trách nhiệm cốt lõi & Ranh giới |
|---|---|---|
| **Code Vương** | `me` | **User-facing operator & Lease/Sentinel Router**. Tiếp nhận yêu cầu, thiết lập lease, đăng ký sentinel/heartbeat, route alerts. **CẤM:** Mọi source edit, plan/architecture decision, code review hay technical audit; không dùng blocking loop (`paseo wait`). |
| **General Lead** | `lead` | **Outcome owner duy nhất mặc định**. Chịu trách nhiệm toàn bộ delivery, planning, architecture, implementation và hội tụ kết quả. Bắt buộc tuân thủ Pre-plan gate và Review gate. |
| **Specialist Lead** | `lead` | Bounded slice lead khi có boundary/evidence riêng; không tự tạo outcome hierarchy mới. |
| **Worker (Lính)** | `peer` | Bounded execution worker. Thực thi theo packet, emit `TASK_TEACH_BACK`, bàn giao candidate identity. |
| **Review Lens** | review profile / `lead` | **Độc lập, fresh context, read-only mặc định**. Chấm và phân loại `BLOCKER`, `REQUIRED`, `NIT`, `FUTURE`. |

---

## The 4 Immutable Lifecycle Gates (Pipeline Bất Biến)

Mọi task trong `/paseo-team` đều phải tuân thủ nghiêm ngặt 4 cổng kiểm soát:

```text
[Gate 1: Intent Brief] ──► [Gate 2: Pre-Plan Gate] ──► [Execution] ──► [Gate 3: Independent Review] ──► [Handoff]
    (Code Vương)             (I≥3 hoặc U≥3)            (Lead / Lính)           (Review Lens)            (User Report)
```

### Gate 1: Intent Brief & Sentinel Setup (Code Vương)
1. **Restate Intent**: Soạn Intent Brief gồm goal, non-goals, constraints, acceptance criteria, và open questions.
2. **Explicit Approval Words**: Bắt buộc nhận từ xác nhận rõ ràng từ User (`đúng`, `ok`, `xác nhận`, `đồng ý`) trước khi tạo General Lead. Không suy đoán im lặng là đồng ý.
3. **External Sentinel Setup**: Bắt buộc đăng ký independent sentinel / heartbeat (`paseo heartbeat create` hoặc cron `supervisor.mjs` tần suất ~10 phút) để giám sát tiến độ ngoài context. Tuyệt đối không dùng blocking CLI `paseo wait`.

### Gate 2: Pre-Implementation Plan Gate (General Lead)
- **Điều kiện kích hoạt**: BẮT BUỘC khi task liên quan đến planning, architecture, contract, hoặc có độ bất định cao ($I \ge 3$ hoặc $U \ge 3$ theo `review-scoring.md`).
- **Trình tự thực thi**:
  1. *Bounded Scouting*: Khảo sát codebase, ghi nhận facts thực tế, đánh dấu `Unresolved` nếu thiếu bằng chứng.
  2. *Publish PLAN_DRAFT*: Nêu rõ goal, approach, non-goals, ownership, acceptance evidence, risks, và simplest alternative.
  3. *Launch Planning Reviewer*: Khởi tạo Planning Reviewer độc lập (`brief.mjs --role planning-reviewer`) để nhận `PLAN_REFLECTION` và $\le 3$ câu hỏi `CHALLENGE`.
  4. *Finalize*: Cập nhật thành `PLAN_FINAL`. Chỉ được bắt đầu triển khai code/docs sau khi nhận được `READY_FOR_WORK`.
- **Nghiêm cấm**: Tuyệt đối không nhảy thẳng vào sửa file / implementation khi chưa vượt qua Pre-plan Gate này.

### Gate 3: Execution & Delegation
- General Lead trực tiếp thi công hoặc giao Worker (Lính) qua `brief.mjs --role worker --stage task`.
- **Khuyến khích delegation**: Khi task có thể tách thành bounded slice với write-set, acceptance và checks rõ ràng, hoặc isolation/parallelism/bounded expertise đem lại lợi ích thực tế, General Lead nên ưu tiên giao ít nhất một slice cho Worker. Đây là preference, không phải ngưỡng cứng theo số file/LOC/R; nếu Lead giữ toàn bộ implementation, phải ghi rationale vì sao coordination cost hoặc thiếu safe lane lớn hơn lợi ích giao việc.
- Lính emit `TASK_TEACH_BACK` trước khi gọi tool, thực hiện task và bàn giao kết quả kèm **Candidate Identity** (SHA256 hoặc commit hash bất biến).
- Giữ kỷ luật commit: `1 task = 1 commit cuối`; không squash khi review đang mở.

### Gate 4: Independent Review Gate (BẮT BUỘC trước Handoff)
- **CẤM TUYỆT ĐỐI SELF-REVIEW**: General Lead tự code hay Lính code đều bắt buộc phải qua Independent Review độc lập. Tự review bằng tool validate (như `harness validate`, `git diff`) không thay thế được Review Gate.
- **Quy trình chuẩn**:
  1. *Freeze Candidate*: Đóng băng toàn bộ candidate surface thành `Candidate Identity` bất biến (SHA256).
  2. *Score Budget*: Chấm điểm $S, I, U \implies R = S + I + U$ theo `review-scoring.md` và gửi xác nhận hành chính cho Code Vương.
  3. *Launch Reviewers*: Khởi tạo Reviewer(s) độc lập với fresh context, quyền read-only, khai báo rõ `owns`, `excludes`, `evidence`. Mọi candidate có tối thiểu một reviewer nhẹ; chọn profile review chi phí thấp theo `review-scoring.md`, chỉ nâng cấp model/lens khi impact hoặc uncertainty đòi hỏi.
  4. *Resolve Findings*: Phân loại `BLOCKER`, `REQUIRED`, `NIT`, `FUTURE`. Bắt buộc fix toàn bộ `BLOCKER` và `REQUIRED`. Nếu có chỉnh sửa file, candidate cũ bị hủy, phải cấp candidate identity mới và re-review.
  5. *Convergence*: Chỉ handoff lên Code Vương khi toàn bộ Review lenses đều pass.

---

## Decision Authority & Fail-Closed Discipline

Mọi quyết định phân cấp theo 3 bậc:
- **C1 — Tự quyết**: Implementation detail, phương thức kỹ thuật, thứ tự công việc. Làm ngay + ghi rationale trong báo cáo.
- **C2 — Tự quyết + Announce**: Quyết định đảo ngược được đụng artifact chính. Làm ngay + thông báo (channel/mention).
- **C3 — Hỏi Human**: Thay đổi scope/intent material, rủi ro không đảo ngược, thiếu secret/auth chỉ user có. Luôn kèm recommended default.

**Fail-closed Discipline**: Không bao giờ bịa bằng chứng. Mọi thứ chưa verify bằng runtime/code thực tế đều phải ghi nhận là `Unresolved` hoặc `Pending-validation`.

---

## Supervision: Event-First + Watchdog

- **Event-first**: Không chạy polling loop (`sleep → status → activity`), không spam narration "still working". Kết thúc lượt với `PENDING` và chờ wake-up notification từ platform.
- **Independent Sentinel (Bắt buộc)**: Cron watchdog ngoài context chạy định kỳ ~10 phút thu thập 5 tín hiệu: `OWNER_LIFECYCLE`, `LEASE_FRESHNESS`, `COMPACT_EVIDENCE`, `SCOPE_OR_TEXT_DRIFT`, `OPEN_BLOCKER`. Phát alert có evidence khi phát hiện bất thường.

---

## Failure & Escalation Pointers

Khi gặp sự cố (Code Vương vượt quyền, thiếu profile/tool, vi phạm lease, reviewer block, non-convergence): Tra cứu và thực thi đúng protocol tại [references/failure-handling.md](references/failure-handling.md).
