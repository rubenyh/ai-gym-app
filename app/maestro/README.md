# Device smoke flows (Maestro)

**Status: prepared, never executed.** They need an installed development build (blocked by O-13 on this
Windows machine), the local Supabase stack reachable from the device (`EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321`
on the Android emulator), and [Maestro](https://maestro.mobile.dev) installed. Selectors use visible labels; adjust
them if a run shows a mismatch, and record device, OS and result in docs/IMPLEMENTATION_PLAN.md.

Accounts: create two confirmed users first (sign up, open the Mailpit link at http://127.0.0.1:54324).

```bash
# from app/
maestro test -e EMAIL=a@example.test -e PASSWORD=... maestro/01-auth.yaml
maestro test -e EMAIL=a@example.test -e PASSWORD=... maestro/02-offline-workout-recovery.yaml
maestro test maestro/03-sync.yaml
maestro test maestro/04-coach-approval.yaml      # needs the coach service + GEMINI key (O-08)
maestro test maestro/05-publication.yaml
```

| Flow | Proves | Manual part |
| --- | --- | --- |
| 01-auth | sign-in reaches Home; sign-out warns when changes are pending | — |
| 02-offline-workout-recovery | committed sets and the rest timer survive force-stop while offline (SESSION-03, AUTH-02) | toggle airplane mode before the flow |
| 03-sync | pending changes upload on reconnect and the status screen clears (SYNC-01) | re-enable network when prompted |
| 04-coach-approval | draft → review → explicit approval → active program pending/synced (COACH-02) | — |
| 05-publication | publish preview shows only public fields; retry does not duplicate (SOCIAL-02) | — |
