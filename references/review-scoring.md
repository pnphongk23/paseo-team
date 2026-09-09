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
| ≤3 | 1 lightweight | correctness/evidence, output ngắn |
| 4–8 | 1 | correctness/evidence |
| 9–12 | 2 | correctness/evidence + architecture/risk |
| 13–15 | 3 | 3 lens riêng + ghi reason |

**Overrides:** Mọi frozen candidate → tối thiểu 1 reviewer độc lập. `I ≥ 4` → tối thiểu 2 reviewer. `I = 5` + (`U ≥ 4` hoặc irreversible) → 3 reviewer. Handoff không tính là reviewer, không đổi R.

Lens cho 3 reviewer: correctness/evidence · architecture/risk · security/migration/release/specialist. Quân sư là 1 trong các lens đó (không tự thêm lane).

## Review rules

- Review là **budget, không pipeline**: lượng hóa S/I/U trước launch; default 1 lightweight reviewer; quy mô theo bảng trên. Chỉ mở thêm lens khi có câu hỏi độc lập cụ thể.
- **Cheap-first launch:** trước khi tạo reviewer, đọc mọi `list_profiles().notes` và chọn profile chi phí thấp nhất được cấu hình cho review/read-only. Materialize `provider/model/settings`; không giả định có tham số `profile`. Chỉ nâng lên model/lens mạnh hơn khi `I≥4`, `U≥4`, security/migration/release, hoặc reviewer nhẹ trả `BLOCKED` vì thiếu năng lực suy luận. Nếu không có profile phù hợp, dùng provider discovery thay vì đoán model và ghi rõ fallback.
- Reviewer chỉ review **đúng stable candidate identity** (commit/diff hash, worktree snapshot, hoặc WIP branch head — ghi rõ trong handback; không bắt buộc là commit); target đang đổi → từ chối, yêu cầu freeze. Review bản đang sửa = false confidence, tệ hơn không review.
- Reviewer mặc định read-only. Nếu được giao bounded fix với write-set rõ, reviewer phải ghi `editedSurface`, phát hành candidate identity mới và không được tính là independent reviewer duy nhất trên surface vừa sửa; review cycle mới chỉ mở theo materiality/risk, không tự động nhân đôi reviewer cho mọi nit.
- **Commit discipline: 1 task = 1 commit cuối.** Vòng fix không sinh commit: Lính sửa trong cùng worktree/WIP branch, đưa identity mới. Khi review pass, Tướng quân squash/consolidate thành 1 commit ở acceptance. Không squash khi review còn mở trên identity cũ. Evidence giữ ở handback/report, không nhét vào lịch sử commit.
- `R` cuối cùng do **Code Vương xác nhận lại từ diff thật** trước khi launch; implementer không tự ấn định ngân sách review cho chính mình (chống self-benchmark).
- `BLOCKER` phải chứng minh: sai intent, không đạt acceptance, design unimplementable, data loss, authorization/security failure, irreversible unsafe action. Sở thích đặt tên, speculative extensibility, pseudocode signature, debt không liên quan ≠ blocker.
- Reviewers độc lập song song: 1 lane đầu cho correctness/evidence trước. First-pass packet chỉ chứa Task Contract, frozen candidate, raw diff/artifacts và checks; không chứa verdict, suspected bug hay proposed fix của implementer. Mỗi lane phải ghi rõ `owns` (câu hỏi mình chịu trách nhiệm), `excludes` (không review), và `evidence` (artifact/check cần đọc). Nếu không có câu hỏi riêng thì không mở lane; giữ dissent thay vì gộp thành đồng thuận.
- Sau mỗi handback, **Tướng quân freeze candidate identity** và ghi vào report trước khi launch/relaunch review. Review cycle sau chỉ xét: fixes, unresolved findings, contradictions do fixes tạo ra. Dimension audit mới = `SCOPE_CHANGE_PROPOSAL` (trừ khi lộ blocker).
- Tối đa **2 full review cycles**; cycle 2 chỉ cho `BLOCKER`/`REQUIRED` từ cycle 1. Cùng blocker lặp lại / blocker mới > blocker đã solve / scope phình → `BLOCKED_NON_CONVERGING`: nếu reversible và trong scope, chain tự quyết continue / đổi hướng / dừng theo evidence + cost; chỉ leo C3 nếu material/irreversible.
- Planning Reviewer chỉ đánh giá delta sau `PLAN_FINAL`; không mở lại cùng architecture question nếu candidate không có evidence mới. Reviewer edit không phải quyền mặc định và không được làm mất candidate identity/independence contract.
- Không role nào cho formal approval. Khi review budget hoàn tất, không còn `BLOCKER`/`REQUIRED`, final commit đã tạo và Code Vương đã kiểm tra artifact, ghi lifecycle `ACCEPTED`; đây là trạng thái hoàn tất workflow, không phải formal approval.

## Báo cáo review (Tướng quân → Code Vương)

`S`, `I`, `U`, tổng `R`, số reviewer budgeted, từng reviewer (ID, workspace, lens, verdict), lý do chọn budget, mọi cycle phụ kèm trigger. Code Vương verify qua Paseo rằng agents hoàn thành (không `error`/`closed`/blocked/canceled; lane failed/superseded được ghi, replacement thành công thỏa budget), kiểm tra artifact/evidence tồn tại và lifecycle; không tự phán architecture hay chấp nhận test-pass/review claim trần.

**Anti duplicate proof**: Reviewer inspect evidence của owner (đọc report + diff + artifacts), **không rerun ceremonial** cùng validation để xác nhận cho có — rerun chỉ khi doubt cụ thể không resolve được từ evidence. Code Vương chỉ được re-verify lifecycle/evidence presence; technical key checks thuộc Lead/reviewer lens.
