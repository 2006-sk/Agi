/**
 * Live contract verification: the real gateway's event stream through the real store.
 *
 * `verifyStore.ts` proves the deck against the mock script. This proves it
 * against what the backend actually emits — Pranay's protocol machine, live
 * SambaNova, the gateway's projection layer — with no browser and no renderer.
 * It is the check that catches a backend payload drifting away from what the
 * UI reads, which is exactly the failure the mock cannot see.
 *
 *   npm run verify:live            # against a running stack on :8000
 *   GATEWAY=http://host:8000 npm run verify:live
 */

import { useAuraStore } from '@/state/auraStore';
import type { AuraEvent } from '@/types/events';

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8000';
const SESSION = process.env.AURA_SESSION ?? 'aura-demo-0197';

const S = useAuraStore;
let fails = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    fails++;
    console.log('FAIL  ' + label, extra ?? '');
  } else {
    console.log('ok    ' + label);
  }
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

async function fetchLog(): Promise<AuraEvent[]> {
  const response = await fetch(`${GATEWAY}/api/calls/${SESSION}/events`);
  if (!response.ok) throw new Error(`events -> ${response.status}`);
  const body = (await response.json()) as { events: AuraEvent[] };
  return body.events;
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`--- driving the real backend at ${GATEWAY} ---`);

  try {
    await fetch(`${GATEWAY}/health`);
  } catch {
    console.log('\nFAIL  gateway is not running. Start it with: npm run dev');
    process.exit(1);
  }

  // Run the golden path for real: protocol machine, model, tools, approval gate.
  await post(`/api/calls/${SESSION}/reset`, {}).catch(() => post('/api/calls', { session_id: SESSION }));
  const run = (await post(`/api/calls/${SESSION}/demo`, {
    scenario: 'cardiac',
    await_completion: true,
    fast: true,
  })) as { state: Record<string, unknown>; pending_approvals: { approval_id: string }[] };

  console.log('backend reached:', run.state.priority, '/', run.state.status);

  const preApproval = await fetchLog();
  console.log(`replaying ${preApproval.length} real events through the store\n`);

  console.log('--- ingest ---');
  S.getState().reset();
  S.getState().applyEvents(preApproval);
  let st = S.getState();

  // The gateway broadcasts both vocabularies on one socket: canonical events
  // for the log and the judges, view events for the deck. The deck ignores the
  // canonical ones, so `unknown` is expected to be exactly that set — what
  // must never happen is an event that is neither applied nor a known
  // canonical type, because that is a view event the deck silently dropped.
  const CANONICAL = new Set([
    'call.started',
    'agent.speaking',
    'agent.interrupted',
    'voice.error',
    'incident.updated',
    'protocol.changed',
    'tool.started',
    'tool.completed',
    'dispatch.proposed',
    'approval.resolved',
    'system.degraded',
  ]);
  const ignored = preApproval.filter((e) => CANONICAL.has(e.type));

  check('nothing stalled in the gap buffer', st.stats.buffered === 0, st.stats);
  check('no stale drops', st.stats.stale === 0, st.stats);
  check('no duplicates', st.stats.duplicates === 0, st.stats);
  check('every event either applied or a known canonical type', st.stats.applied + st.stats.unknown === preApproval.length, {
    applied: st.stats.applied,
    unknown: st.stats.unknown,
    sent: preApproval.length,
  });
  check('the ignored events are exactly the canonical ones', st.stats.unknown === ignored.length, {
    unknown: st.stats.unknown,
    canonical: ignored.length,
    types: [...new Set(ignored.map((e) => e.type))],
  });
  // Together the two checks above prove it: if applied + unknown covers every
  // event and unknown is exactly the canonical set, then every view event landed.

  console.log('\n--- the call ---');
  check('a call is in the stack', st.callIds.length >= 1, st.callIds);
  check('a call is active', Boolean(st.activeCallId), st.activeCallId);
  check('call card has the caller number', Boolean(st.calls[st.activeCallId ?? '']?.number), st.calls);

  console.log('\n--- incident ---');
  check('category medical', st.incident?.category === 'medical', st.incident?.category);
  check('priority critical', st.incident?.priority === 'critical', st.incident?.priority);
  check('escalated from a lower priority', Boolean(st.incident?.previousPriority), st.incident?.previousPriority);
  check('critical flash fired', st.signals.critical >= 1, st.signals.critical);

  console.log('\n--- location ---');
  check('location verified', st.location?.verified === true, st.location);
  check('location has city coords', Number.isFinite(st.location?.coords.x) && Number.isFinite(st.location?.coords.z), st.location?.coords);
  check('coords are on the city plane', Math.abs(st.location?.coords.x ?? 999) <= 60 && Math.abs(st.location?.coords.z ?? 999) <= 60, st.location?.coords);
  check('location lock signal fired', st.signals.locationLocked >= 1, st.signals.locationLocked);
  check('camera was aimed at the incident', st.camera.target !== null, st.camera);

  console.log('\n--- protocol ---');
  check('a protocol is active', Boolean(st.protocol), st.protocol?.id);
  check('protocol has steps to draw', (st.protocol?.steps.length ?? 0) > 0, st.protocol?.steps.length);
  check('a step is active or done', Boolean(st.protocol?.steps.some((s) => s.status !== 'idle')), st.protocol?.steps.map((s) => [s.id, s.status]));
  check('the approval step is the live one', st.protocol?.steps.find((s) => s.id === 'human_dispatch_approval')?.status === 'active', st.protocol?.steps.map((s) => [s.id, s.status]));

  console.log('\n--- facts ---');
  check('facts extracted', st.factKeys.length > 0, st.factKeys);
  check('facts have labels and values', st.factKeys.every((k) => Boolean(st.facts[k]?.label)), st.factKeys.map((k) => st.facts[k]));
  const factValues = st.factKeys.map((k) => (st.facts[k]?.value ?? '').toLowerCase());
  check('the breathing fact is on the deck', factValues.some((v) => v.includes('no') || v.includes('breathing')), factValues);
  check('a critical fact is flagged', st.factKeys.some((k) => st.facts[k]?.critical), st.factKeys.map((k) => [k, st.facts[k]?.critical]));

  console.log('\n--- tools ---');
  check('tool calls rendered', st.tools.length > 0, st.tools.length);
  check('every tool resolved ok', st.tools.every((t) => t.status !== 'pending'), st.tools.map((t) => [t.tool, t.status]));
  check('no tool errored', st.tools.every((t) => t.status !== 'error'), st.tools.filter((t) => t.status === 'error'));
  check('locate/verify stages done', st.stages.verify === 'done', st.stages);
  check('human_approval stage is active', st.stages.human_approval === 'active', st.stages);

  console.log('\n--- responders ---');
  check('units on the map', st.units.length > 0, st.units.length);
  check('units have city coords', st.units.every((u) => Number.isFinite(u.coords.x) && Number.isFinite(u.coords.z)), st.units.map((u) => [u.id, u.coords]));
  check('units are on the plane', st.units.every((u) => Math.abs(u.coords.x) <= 60 && Math.abs(u.coords.z) <= 60), st.units.map((u) => [u.id, u.coords]));
  check('a route was proposed', Boolean(st.route), st.route);
  check('route has a drawable path', (st.route?.path.length ?? 0) >= 2, st.route?.path.length);
  check('route points are on the plane', (st.route?.path ?? []).every((p) => Math.abs(p.x) <= 60 && Math.abs(p.z) <= 60), st.route?.path);
  check('selected unit matches the route', Boolean(st.units.find((u) => u.selected)), st.units.map((u) => [u.id, u.selected]));

  console.log('\n--- the gate ---');
  check('approval is pending', st.approval?.state === 'pending', st.approval);
  check('approval has a summary to show', Boolean(st.approval?.summary), st.approval?.summary);
  check('approval gate opened', st.signals.approvalOpen >= 1, st.signals.approvalOpen);
  check('phase is awaiting_approval', st.phase === 'awaiting_approval', st.phase);
  check('NOTHING is moving before approval', st.dispatch === 'proposed' && st.dispatchProgress === 0, {
    dispatch: st.dispatch,
    progress: st.dispatchProgress,
  });

  /* ------------------------------------------------------------------ */

  console.log('\n--- approving for real ---');
  const approvalId = run.pending_approvals[0]?.approval_id;
  check('backend offered an approval id', Boolean(approvalId), run.pending_approvals);

  await post(`/api/calls/${SESSION}/approval`, {
    approval_id: approvalId,
    approved: true,
    reviewer: 'verify:live',
  });
  // Let the simulated responder run to arrival.
  await new Promise((r) => setTimeout(r, 11000));

  const full = await fetchLog();
  console.log(`replaying ${full.length} events (post-approval)\n`);
  S.getState().reset();
  S.getState().applyEvents(full);
  st = S.getState();

  const ignoredAfter = full.filter((e) => CANONICAL.has(e.type));
  check('every post-approval event applied or canonical', st.stats.applied + st.stats.unknown === full.length, {
    applied: st.stats.applied,
    unknown: st.stats.unknown,
    sent: full.length,
  });
  check('post-approval ignores are exactly the canonical ones', st.stats.unknown === ignoredAfter.length, {
    unknown: st.stats.unknown,
    canonical: ignoredAfter.length,
  });
  check('nothing stalled after approval', st.stats.buffered === 0, st.stats);
  check('approval shows granted', st.approval?.state === 'granted', st.approval);
  check('approved signal fired', st.signals.approved >= 1, st.signals.approved);
  check('human_approval stage done', st.stages.human_approval === 'done', st.stages);
  check('dispatch ran to arrival', st.dispatch === 'arrived', st.dispatch);
  check('responder reached the scene', st.dispatchProgress === 1, st.dispatchProgress);

  console.log('\n--- gate invariant ---');
  // The deck must never move a unit on the backend's say-so alone.
  S.getState().reset();
  const withoutApproval = full.filter(
    (e) => e.type !== 'approval.granted' && e.type !== 'approval.resolved',
  );
  S.getState().applyEvents(withoutApproval);
  const ungated = S.getState();
  check('no approval => nothing moves, whatever the backend sent', ungated.dispatch !== 'arrived' && ungated.dispatchProgress === 0, {
    dispatch: ungated.dispatch,
    progress: ungated.dispatchProgress,
  });

  console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'} — ${fails} failing check(s)`);
  process.exit(fails === 0 ? 0 : 1);

}

main().catch((error) => {
  console.error('\nFAIL  verify:live crashed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
