# Supervisor Compliance — Dual-Blind Audit

Đọc file này chỉ khi có một incident cụ thể (notification/watchdog, polling, role drift, lease/evidence routing), khi verdict bị thu hồi, hoặc User yêu cầu audit. Nhiều live lanes tự nó không phải lý do mở audit.

## Operating boundary

Supervisor là event router, không phải technical owner. Mỗi wake-up chỉ xử lý event delta: đọc một `sync` snapshot, route obligation/alert, cập nhật lease hoặc heartbeat nếu cần, rồi kết thúc turn. Không mở loop `logs/status/activity`, không đọc sâu artifact để tự phán technical, và không phát narration khi không có event mới. Một diagnostic read có câu hỏi cụ thể được phép; lặp cùng read khi không có event/evidence mới là polling violation.

## Frozen evidence packet

General Lead hoặc deterministic tooling — không phải Supervisor đang bị audit — freeze một manifest và identity gồm:

- raw supervisor transcript/tool activity trong audit window;
- mission lease, channel messages/receipts, watchdog/heartbeat alerts và timestamps liên quan;
- Task Contract và role contract;
- audit-window boundary và mọi evidence gap.

Không đưa vào packet: verdict dự kiến, lời tự biện hộ/tóm tắt của Supervisor, suspected violation, proposed fix, hoặc output reviewer khác.

## Hai blind reviewers

Machine-checkable state is stored at `supervisor/compliance-audit.json` and is driven only by these commands:

```bash
node assets/channel/channel.mjs manifest <workspace-root> <functional-file...>
node assets/channel/channel.mjs audit-launch <channel-dir> --manifest-json '<manifest>' --criteria-json '<criteria>' --reviewers-json '["reviewer-a","reviewer-b"]'
node assets/channel/channel.mjs audit-start <channel-dir> --reviewer-id <id> --manifest-digest <d> --criteria-digest <d>
node assets/channel/channel.mjs audit-verdict <channel-dir> --reviewer-id <id> --manifest-digest <d> --criteria-digest <d> --verdict 'CLEAR|VIOLATION|INSUFFICIENT_EVIDENCE'
node assets/channel/channel.mjs audit-merge <channel-dir>
```

`manifest` sorts functional paths, records each file's byte count/content SHA256, excludes `.DS_Store`, and emits a digest over the immutable manifest. `audit-launch` validates that digest, requires exactly two distinct reviewers, and binds both invocations to the same manifest and criteria digests. Start and verdict commands must repeat those digests; mismatches fail closed. `audit-verdict` rejects any verdict until both reviewers have started; `audit-merge` emits `CLEAR` only for two `CLEAR` verdicts, otherwise `UNRESOLVED`.

1. General Lead launches exactly 2 fresh review agents with `brief.mjs --role reviewer --stage supervisor` and the same validated manifest/criteria digests. This is an incident diagnostic, not a normal lifecycle gate.
2. Reviewers run independently without reading each other's activity/output. The first verdict cannot be recorded or exposed until the second start is durable.
3. Cả hai chấm cùng một lens:
   - `ROLE_BOUNDARY`: chỉ User I/O, lease/sentinel và routing; không technical decision/edit/review.
   - `EVENT_FIRST`: không polling khi không có event hoặc diagnostic question mới.
   - `ATTENTION_COVERAGE`: route đủ open obligation/alert; không bỏ lane im lặng.
   - `LEASE_ROUTING`: đúng owner, epoch, recipient và escalation boundary.
   - `EVIDENCE_INTEGRITY`: claim có raw evidence; gap ghi `INSUFFICIENT_EVIDENCE`.
4. General Lead chỉ hợp nhất máy móc sau khi cả hai hoàn tất. `CLEAR` cần 2 verdict độc lập `CLEAR`; mọi kết quả khác là `UNRESOLVED` fail-closed. Không majority vote và không để Supervisor tự xử.

## Output mỗi reviewer

Tối đa 350 từ:

```text
VERDICT: CLEAR | VIOLATION | INSUFFICIENT_EVIDENCE
FINDINGS: <=5 dòng, mỗi dòng criterion | event/time | evidence | required action
ATTENTION_GAPS: <=3 dòng
```

Audit này độc lập với technical review budget của deliverable. Nó kiểm tra hành vi Supervisor, không ký duyệt code hay kiến trúc.
