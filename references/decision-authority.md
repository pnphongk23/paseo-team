# Decision Authority — Ladder & Self-Answerable Test

Chi tiết hoá Decision Authority Ladder trong SKILL.md. Mọi role (Code Vương, Tướng quân, Lính, Decision Peer, Quân sư, Reviewer) áp dụng cùng bậc thang này khi đứng trước một lựa chọn.

## Bậc thang 3 cấp

| Cấp | Hành vi | Ví dụ thực tế |
|---|---|---|
| **C1 — Tự quyết** | Quyết định và làm ngay; ghi `rationale` ngắn trong báo cáo. | Chọn phương thức lưu trữ (Keychain expect/actual), thứ tự/parallel hoá lane, provider fallback khi hạ tầng lỗi (codex → cursor → pi), review budget, chọn config key theo convention. |
| **C2 — Tự quyết + announce** | Quyết định, làm, và thông báo ngay (post channel / mention trong report). Quyết định đảo ngược được, đụng artifact chính. | Ghi approval theo mandate đã cấp, mở rộng packet 1 file, đóng WI, thay đổi file ownership nhỏ. |
| **C3 — Hỏi (human-only)** | Dừng và hỏi user. | Evidence/secret chỉ user có · material scope/intent change · irreversible/risky ngoài contract · non-convergence. |

Lưu ý: **tự tin quyết ≠ bịa evidence.** Kỷ luật fail-closed giữ nguyên: không bao giờ claim `verified/shipped` cho thứ chưa verify runtime; ghi `Unresolved`/`Pending-validation` khi chưa có bằng chứng.

## Self-answerable test (chạy trước mỗi ý định hỏi)

Trước khi đặt câu hỏi cho người ở cấp cao hơn (Lính → Tướng quân, Tướng quân → Code Vương, Code Vương → user), chạy 3 câu:

1. **Đủ thông tin?** — Trả lời được từ spec/repo/convention/standard engineering/my knowledge?
2. **Đảo ngược được?** — Chi phí đảo ngược thấp, không gây mất dữ liệu/không đổi contract?
3. **Trong scope?** — Nằm trong Task Contract / scope đã cấp / non-goals không bị vi phạm?

Cả 3 **YES** → tự quyết theo bậc C1/C2, **không hỏi**. Bất kỳ NO nào → xác định reason thuộc C3 hay cần làm rõ trong chain trước.

## One-question budget

- Mỗi vấn đề hỏi người dùng **tối đa 1 lần**, luôn kèm **recommended default**.
- Không trả lời ở lượt tiếp theo → **thực thi default + announce**, trừ khi là mục evidence-only (secret/credential/URL chỉ user có) thì ghi `Unresolved` và chờ, không chặn các lane độc lập.
- Không hỏi lặp cùng một câu (hỏi lặp = lãng phí attention).
- Gate 1 (intent confirmation) là **intent gate duy nhất**; sau xác nhận, mọi lựa chọn trong scope đã cấp là thẩm quyền của chain.

## Anti-over-ask (đối chiếu nhanh)

| Ý nghĩ | Hành vi đúng |
|---|---|
| "Hỏi user cho chắc" | Chạy self-answerable test; self-answerable thì tự quyết |
| "Đây là quyết định Maintainer, phải hỏi" | Trong scope đã cấp thì không — chỉ C3 mới hỏi |
| "Hỏi lại lần nữa cho chắc" | One-question budget: đã hỏi → thực thi default |

## Quyết định pathway chuẩn

```
Có lựa chọn → Self-answerable test
  ├─ 3×YES → C1 (im lặng + rationale) hoặc C2 (announce) → proceed
  └─ NO nào đó →
        ├─ Evidence-only → hỏi user 1 lần kèm default; nếu im lặng → Unresolved + tiếp lane độc lập
        ├─ Scope/intent change → C3 hỏi user
        ├─ Irreversible → C3 hỏi user
        └─ Không rõ trong chain → route tới role sở hữu (Lính → Tướng quân → Code Vương)
```