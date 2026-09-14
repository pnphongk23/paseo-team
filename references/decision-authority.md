# Decision Authority — Ladder & Escalation

Use this file only when a role must choose, ask upward, or decide whether it is over-asking. It is the canonical source for C1/C2/C3; lifecycle and review rules live elsewhere.

## Bậc thang 3 cấp

| Cấp | Hành vi | Ai sở hữu |
|---|---|---|
| **C1 — Tự quyết** | Chọn và làm ngay; ghi rationale ngắn nếu quyết định ảnh hưởng cách thực thi. | General/Specialist Lead trong boundary; Worker trong packet của mình |
| **C2 — Tự quyết + announce** | Làm ngay rồi thông báo khi đụng artifact chính nhưng vẫn đảo ngược được. | General/Specialist Lead; Worker chỉ trong write-set được cấp |
| **C3 — Human-only** | Dừng và hỏi user một lần, luôn kèm recommended default. | Mọi role khi đổi intent/scope vật chất, cần secret/authority của user, hoặc có rủi ro không đảo ngược ngoài contract |

Code Vương chỉ route User I/O, lease và event; không biến C1/C2 technical thành quyết định của mình. Reviewer báo cáo finding, không quyết định thay Lead.

## Self-answerable test

Trước khi hỏi role cấp cao hơn, trả lời ba câu:

1. **Đủ thông tin?** Có thể trả lời từ task contract, repo, convention hoặc check không?
2. **Đảo ngược được?** Quyết định có thể hoàn tác với chi phí thấp không?
3. **Trong scope?** Có nằm trong owner/write-set/non-goals hiện tại không?

Ba câu YES → tự quyết C1/C2. Bất kỳ NO nào → phân loại nguyên nhân: blocker factual/contract route cho Lead; C3 hỏi user. Không hỏi chỉ để xin reassurance.

## One-question budget

- Mỗi vấn đề hỏi user tối đa một lần; luôn kèm default.
- Nếu user không trả lời: dùng default khi việc reversible và trong scope; nếu cần evidence/authority của user hoặc không reversible, ghi `Unresolved`/`Pending-human` và không tự claim hoàn tất.
- Không hỏi lặp cùng một câu. Xác nhận intent lần hai chỉ cần khi intent thực sự mơ hồ hoặc thay đổi material.

## Pathway

```text
Có lựa chọn → Self-answerable test
  ├─ 3×YES → C1/C2 → proceed (announce khi cần)
  └─ có NO →
       ├─ factual/contract blocker → Lead
       ├─ scope/intent, secret/authority, irreversible → C3 → user
       └─ evidence chưa đủ nhưng có lane độc lập → ghi Unresolved và kiểm chứng lane đó
```

Tự tin quyết định không thay thế bằng chứng. Chưa verify runtime/code thực tế phải ghi `Unresolved` hoặc `Pending-validation`.
