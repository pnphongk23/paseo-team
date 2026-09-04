# Review Scoring — Five-point Assessment

Score toàn bộ logical task (không phải từng commit). **Ghi R trước khi launch review**, tính lại từ diff thật.

## Ba dimension (0–5)

**Surface (S)** — phạm vi diff
- `0` một file nhỏ · `1` một hai file · `2` 3–5 file/module nhỏ · `3` 6–10 file hoặc cross-module · `4` 11–20 file, multi-package, diff lớn · `5` broad cross-cutting, generated/configured surfaces, >20 file.

**Impact (I)** — tác động
- `0` formatting/docs · `1` isolated local behavior · `2` một bounded feature/module · `3` shared behavior/public contract · `4` persistence/auth/payment/deploy/release · `5` security, destructive migration, data-loss, authorization boundary, production-critical.

**Uncertainty (U)** — độ chắc chắn
- `0` requirement rõ, checks mạnh, dễ revert · `1` minor unknowns, checks tin cậy · `2` partial coverage/coupling vừa · `3` unresolved behavior/contract detail · `4` acceptance mơ hồ hoặc khó verify/rollback · `5` intent mơ hồ, không có check tin cậy, irreversible.

## Ngân sách review: R = S + I + U

| R | Số reviewer | Điều kiện |
|---|---|---|
| ≤3 | 0 | chỉ khi không dimension nào >1 và không override |
| ≤8 | 1 | mọi trường hợp khác |
| 9–12 | 2 | correctness/evidence + architecture/risk |
| 13–15 | 3 | 3 lens riêng + ghi reason |

**Overrides:** `I ≥ 4` → tối thiểu 2 reviewer. `I = 5` + (`U ≥ 4` hoặc irreversible) → 3 reviewer. `S ≥ 4` → tối thiểu 1. Handoff không tính là reviewer, không đổi R.

Lens cho 3 reviewer: correctness/evidence · architecture/risk · security/migration/release/specialist. Quân sư là 1 trong các lens đó (không tự thêm lane).

## Review rules

- Review là **budget, không pipeline**: lượng hóa S/I/U trước launch; R≤3 → 0 reviewer; default 1; quy mô theo bảng trên. Không ép reviewer cho mọi task.
- Reviewer chỉ review **đúng stable candidate identity** (commit/diff hash từ handback; không có commit authority → workspace snapshot); target đang đổi → từ chối, yêu cầu freeze. Review bản đang sửa = false confidence, tệ hơn không review.
- `R` cuối cùng do **Code Vương xác nhận lại từ diff thật** trước khi launch; implementer không tự ấn định ngân sách review cho chính mình (chống self-benchmark).
- `BLOCKER` phải chứng minh: sai intent, không đạt acceptance, design unimplementable, data loss, authorization/security failure, irreversible unsafe action. Sở thích đặt tên, speculative extensibility, pseudocode signature, debt không liên quan ≠ blocker.
- Reviewers độc lập song song: 1 lane đầu cho correctness/evidence trước.
- Review cycle sau chỉ xét: fixes, unresolved findings, contradictions do fixes tạo ra. Dimension audit mới = `SCOPE_CHANGE_PROPOSAL` (trừ khi lộ blocker).
- Tối đa **2 full review cycles**; cycle 2 chỉ cho `BLOCKER`/`REQUIRED` từ cycle 1. Cùng blocker lặp lại / blocker mới > blocker đã solve / scope phình → `BLOCKED_NON_CONVERGING`, trả Code Vương — **Root quyết** (continue / đổi hướng / dừng theo evidence + cost), không auto-dừng báo user; chỉ leo C3 nếu material/irreversible.
- Không role nào cho formal approval. Task Contract thỏa + work cải thiện trạng thái hiện tại = xong; perfection/cleanup không liên quan không cần.

## Báo cáo review (Tướng quân → Code Vương)

`S`, `I`, `U`, tổng `R`, số reviewer budgeted, từng reviewer (ID, workspace, lens, verdict), lý do chọn budget, mọi cycle phụ kèm trigger. Code Vương verify qua Paseo rằng agents hoàn thành (không `error`/`closed`/blocked/canceled; lane failed/superseded được ghi, replacement thành công thỏa budget), inspect diff, tự rerun key checks — không chấp nhận test-pass/review claim trần.

**Anti duplicate proof**: Reviewer inspect evidence của owner (đọc report + diff + artifacts), **không rerun ceremonial** cùng validation để xác nhận cho có — rerun chỉ khi doubt cụ thể không resolve được từ evidence. Code Vương được bounded re-verify key checks trên claim then chốt (đây là guard chống self-deception, không phải duplicate proof).