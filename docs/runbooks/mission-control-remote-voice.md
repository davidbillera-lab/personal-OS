# Mission Control Remote Voice Runbook

## Purpose

Use an iPhone to speak with ChatGPT Voice while the Windows headquarters runs Mission Control, Codex, Claude Code, Hermes, and the dispatcher.

This uses ChatGPT's native paired Remote connection. It does not expose the desktop directly to the internet and does not require a custom voice application.

Official references:

- [ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice)
- [Remote connections](https://learn.chatgpt.com/docs/remote-connections)

## One-time desktop setup

1. Update and open the ChatGPT desktop app on the Windows headquarters.
2. Sign in with the same ChatGPT account and workspace used on the iPhone.
3. Confirm the Mission Control connector is installed, enabled, and authenticated in that workspace.
4. In the desktop app sidebar, select **Set up Remote**.
5. Leave the QR code visible.
6. Keep the host awake and online. The ChatGPT desktop app must remain running.
7. If desktop Computer Use will be used, keep the Windows session unlocked. Mission Control MCP and the background dispatcher do not require foreground Computer Use.

## Pair the iPhone

1. Update and open the ChatGPT iOS app.
2. Open **Remote** and scan the QR code from the desktop host.
3. Confirm the same ChatGPT account and workspace.
4. Complete any requested MFA, SSO, or passkey step.
5. Confirm the Windows host appears under **Remote**.

If **Remote** is missing, update the mobile app and confirm the feature is enabled for the account/workspace. If the host is missing, confirm **Allow other devices to connect** is enabled on the desktop and pair again.

## Start a real voice conversation

Open the paired Windows host from **Remote**, create a new empty Chat or Codex task, and select **Start new voice chat** before sending a message. A task started by typing first offers voice dictation instead of a live Voice conversation.

Only one Voice conversation can be active across the desktop app at a time. End any other active Voice chat before troubleshooting the microphone.

## Normal operating phrases

### Start work

> “Using Mission Control, resolve the College Climb project without guessing. Start a Jarvis workflow to have Hermes draft a build spec for the scholarship matching change, Claude validate and build it, and Codex review it. Do not merge or deploy. Alert me through Telegram when you need me.”

Expected response:

- The exact Mission Control project is named.
- One workflow ID is returned.
- The state is reported as `submitted`.
- ChatGPT says it is awaiting Hermes planning and does not claim that a build has started.

Until Claude deploys the planner-capable backend, `submitted` is the intentional stopping point. The existing Claude-only dispatcher cannot claim it.

### Check progress

> “Check Mission Control for that workflow. Tell me the current stage, who owns it, what changed, and whether I need to do anything.”

ChatGPT must read `mc_get_workflow_status` before answering. It must not infer progress from conversation history.

### Find approvals

> “List anything in Mission Control waiting for my approval. Recommend what I should do, but don't approve anything.”

### Approve

> “Check the current workflow state again. If it is still the same reviewed attempt and the action is only pushing that exact SHA to the working branch, approve it.”

ChatGPT must retrieve the current `attempt_id`, action context, and reviewed SHA immediately before calling `mc_respond_approval`. A stale, missing, or changed attempt must fail closed.

### Reject

> “Reject that approval. Do not push it. Record that Claude must address the Codex findings first.”

### Get the result

> “Read the completed result from Mission Control and tell me what was built, what Codex verified, and where the branch is. Do not say it was merged or deployed unless Mission Control explicitly proves that.”

## Acceptance test

Run these in order against a sandbox or explicitly approved low-risk project:

1. **Project resolution** — speak a unique project name; verify ChatGPT uses `mc_list_projects` and returns the correct Mission Control ID.
2. **Ambiguity** — speak an ambiguous or incomplete project name; verify ChatGPT asks rather than guessing.
3. **Idempotency** — repeat the exact start request with the same client request ID; verify Mission Control returns one workflow.
4. **Safe intake** — verify the workflow enters `submitted`, not `queued`, and the old dispatcher does not claim it.
5. **Status evidence** — ask for progress; verify the spoken answer matches the current Mission Control row.
6. **Asynchronous reconnect** — end Voice, allow work to progress, reopen the same Remote conversation, and request status.
7. **Approval binding** — approve the current exact attempt; verify a wrong or stale attempt ID is rejected.
8. **Branch boundary** — verify only the approved reviewed SHA reaches the working branch; verify no merge or deploy occurs.
9. **Offline host** — close or disconnect the desktop app; verify Remote reports the host unavailable rather than claiming work continues through ChatGPT.
10. **Telegram failure** — disable the notifier in a sandbox; verify approval remains discoverable through `mc_list_pending_approvals`.

## Troubleshooting

### Voice input spins or acts like dictation

- Start with a new, empty chat/task and select **Start new voice chat** before sending text.
- Confirm no other Voice chat is active.
- Confirm microphone permission is granted to ChatGPT on the iPhone.
- End and reopen the Remote conversation.

### Mission Control tools are missing

- Confirm the connector/plugin is installed and enabled in the same workspace.
- Re-authenticate the Mission Control OAuth connection if prompted.
- Restart the desktop app or start a new task after connector changes.
- Do not replace the authenticated connector with a public no-auth endpoint.

### The phone cannot see the host

- Confirm both devices use the same account and workspace.
- Confirm the desktop app is running, online, awake, and allows connections.
- Restart Remote setup and scan a new QR code.
- Signing out turns Remote Control off; turn it back on after signing in.

### Work appears stuck

Ask Voice to read `mc_get_workflow_status` and `mc_list_pending_approvals`. If the workflow remains `submitted`, the Claude planner backend has not promoted it yet. If the dispatcher heartbeat is offline, restore the desktop service before retrying.

## Non-negotiable language

ChatGPT may say:

- “The workflow was submitted.”
- “Mission Control reports Claude is building.”
- “The exact reviewed SHA is waiting for branch-push approval.”

ChatGPT may not say “it is running,” “it was pushed,” “it was merged,” or “it was deployed” unless the current Mission Control evidence establishes that exact state.
