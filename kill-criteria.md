# kill-criteria.md — Mission Control (Personal OS)

The OS is not exempt from its own rules. If it stops delivering value, this document surfaces that.

---

## Kill Criteria

Evaluated against four dimensions. Each dimension is scored: **pass / warning / fail**.

A single **fail** triggers an operator review within 24 hours. Two or more **warnings** trigger a review within 72 hours.

---

### 1. Functionality

**Question:** Does the OS actually reduce operator cognitive load?

| Status | Condition |
|--------|-----------|
| pass | Operator uses the dashboard daily; brain dump inbox is primary capture point; context loading for agent handoffs is measurably faster than before |
| warning | Operator uses some surfaces but falls back to notebooks/chat for key workflows |
| fail | Operator has stopped using the OS for more than 2 weeks in favor of prior methods |

---

### 2. Efficiency

**Question:** Is the OS worth its own operational cost (time + money)?

| Status | Condition |
|--------|-----------|
| pass | Model costs per month < $20; OS maintenance time < 1 hr/week; faster to use than the alternative |
| warning | Model costs $20–$50/month OR maintenance time 1–3 hrs/week |
| fail | Model costs > $50/month OR maintenance time > 3 hrs/week OR operator spends more time fixing the OS than using it |

---

### 3. Scalability

**Question:** Can the OS grow with the portfolio without breaking?

| Status | Condition |
|--------|-----------|
| pass | Adding a new project to the OS takes < 5 minutes; OS handles 10+ projects without performance degradation |
| warning | Adding a project requires manual DB work or file manipulation beyond the UI |
| fail | OS becomes a bottleneck — projects are being tracked outside it because onboarding is too painful |

---

### 4. Time to Revenue

**Question:** Is the OS accelerating the things that generate revenue?

| Status | Condition |
|--------|-----------|
| pass | VZT and College Climb milestones are visibly tracked and unblocked; OS surfaces what to do next with enough context to act immediately |
| warning | OS tracks status but doesn't surface blockers; operator still has to manually reconcile project state |
| fail | OS has become a reporting tool with no action leverage; projects would move at the same pace without it |

---

## Check Schedule

- **Weekly:** operator eyeballs functionality + efficiency (informal, no logging required)
- **Monthly:** formal check logged to `kill_criteria_checks` table in Supabase

## Kill Trigger

If the OS reaches two consecutive monthly **fail** verdicts on any dimension, or three months of mixed warnings with no improvement trend, shut it down and migrate project tracking to a simpler tool (Notion, Linear, or plain markdown in repos).

---

## Last Checked

Never — this is the initial file. First formal check due: 2026-06-06.
