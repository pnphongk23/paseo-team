# Failure Handling & Maintenance Protocols

Tài liệu tham chiếu chuẩn cho xử lý lỗi, khôi phục trạng thái, tự học (self-learning) và bảo trì kỹ năng trong `/paseo-team`.

---

## 1. Failure Handling Matrix

| Sự cố / Lỗi vi phạm | Nguyên tắc xử lý & Khôi phục |
|---|---|
| **Code Vương sửa file hoặc tự quyết technical** | **Protocol Failure nghiêm trọng**: Dừng ngay lập tức, disclose với User và route lại toàn bộ công việc cho General Lead; tuyệt đối không mark complete. |
| **Thiếu profile (`lead`/`peer`) hoặc thiếu công cụ Paseo** | Dừng thực thi, thông báo `BLOCKED_NO_PASEO_TOOLS`; không tự đoán provider/model để tiếp tục. |
| **Lead / Worker sửa file ngoài mission scope / lease epoch** | Gửi corrective prompt (tối đa 2 lần). Nếu tái diễn: fence lease, đề xuất successor hoặc escalate cho Code Vương / Human; không tự kill turn đang chạy dở. |
| **Decision Peer / Review Lens lỗi hoặc trả về kết quả rỗng** | Ghi nhận fail, không chấp nhận verdict mù. Nếu có bounded edit thì bắt buộc tạo candidate identity mới và mở fresh review lens; tối đa 1 lần corrective; thay thế bằng lane thành công; không retry vô hạn. |
| **Review target thay đổi trong lúc review** | Freeze và reopen review với candidate identity mới; reviewer vừa thực hiện sửa đổi không được tính là reviewer độc lập duy nhất của phần vừa sửa. |
| **`BLOCKED_NON_CONVERGING` (lặp blocker, phình scope)** | General Lead tự chọn tiếp tục / đổi hướng / dừng nếu quyết định đảo ngược được và trong scope, ghi rõ evidence + cost + rationale rồi announce; Code Vương chỉ route/escalate. Nếu đổi intent/scope, hoặc rủi ro ngoài contract ➔ đề xuất 1 dòng để Human quyết định. |
| **Compact marker không đủ bằng chứng** | Ghi nhận `COMPACT_EVIDENCE_PARTIAL`, không tự suy đoán counter hay trảm tướng khi thiếu event cursor/ID. |
| **Hết persona khả dụng (trùng tên)** | Kiểm tra `list_agents`, hỏi User hoặc archive các agent cũ đã hoàn thành. |
| **Profile notes bị nhầm là system prompt** | Đưa role contract + persona + owner/task vào initial prompt; các thông số provider/model/mode/features đã materialize thì truyền riêng qua API/CLI, không sao chép lại vào prompt. |

---

## 2. Self-Learning & Retrospective Protocol

Chạy retrospective nhỏ sau mỗi lần có: **user correction, role violation, repeated blocker, false success, hoặc `BLOCKED_NON_CONVERGING`**.

### 2.1. Cấu trúc ghi nhận
Mỗi phát hiện ghi theo công thức:
$$\text{Observed} \longrightarrow \text{Cause} \longrightarrow \text{Smallest Rule} \longrightarrow \text{Check}$$
Kèm theo trạng thái phân loại (**Pattern Status**):
- `one-off`: Sự cố đơn lẻ, chưa đủ điều kiện đóng băng quy tắc.
- `repeated`: Đã tái diễn $\ge 1$ lần trong kịch bản tương đương.
- `durable`: Đã xác thực qua nhiều phiên làm việc; đủ điều kiện chuẩn hóa thành luật.
- `disproved`: Giả thuyết bị bác bỏ sau khi có bằng chứng thực tế.

*Nguyên tắc bất biến:* **Không đóng băng luật mới chỉ sau 1 episode đơn lẻ.**

---

## 3. Skill Maintenance (Better-SLP)

Thực hiện định kỳ hằng tuần hoặc sau khi có retrospective quan trọng:

1. **Rà soát luật cũ:** Giữ / thu hẹp / loại bỏ dựa trên bằng chứng thực tế. Mỗi điều khoản cứng phải kèm **Review Trigger** (khi nào thì loại bỏ/nới lỏng).
   - Watchdog ➔ Loại bỏ khi Paseo CLI có cơ chế `notifyOnFinish` canary pass 100%.
   - `BLOCKED_NO_SAFE_LANE` ➔ Loại bỏ khi Paseo/provider hỗ trợ enforced read-only container/worktree snapshot.
   - Decision Peer "never `peer`" ➔ Bỏ khi advisor profile hoàn toàn ổn định.
2. **Byte Budget Discipline:**
   - [`SKILL.md`](../SKILL.md) duy trì mục tiêu $\le 10\text{ KB}$.
   - Áp dụng nguyên tắc: *One fact in one place*.
   - [`SKILL.md`](../SKILL.md) chỉ giữ Lifecycle Pipeline cốt lõi, toàn bộ chi tiết tham chiếu đặt tại `references/`.
   - Kiểm tra dung lượng thường xuyên: `wc -c SKILL.md` và từng file trong `references/` (nguy cơ truncation nếu file $> 24\text{ KB}$).
3. **Metrics tối thiểu ghi nhận:**
   - Số lần User phải can thiệp thủ công (Human interventions / episode).
   - Số vi phạm lease boundary (sửa file ngoài scope).
   - Tỷ lệ thất lạc notification (`finish event lost`).
4. **Bell Canary:**
   - Mỗi phiên làm việc phải kiểm tra: *"Prompt đánh thức / hiệu chỉnh có gửi đến đúng agent hay không"*. Nếu chuông không reo (supervisor mù), phải xử lý hạ tầng trước khi giao việc tiếp.
