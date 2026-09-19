/**
 * Contract verification for the AURA event pipeline.
 *
 * Runs the full mock scenario through the real store and asserts the demo
 * sequence, the approval invariant and ingestion robustness (duplicates, gaps,
 * stale and jittered delivery). No browser, no renderer.
 *
 *   npm run verify
 */

import { useAuraStore } from '@/state/auraStore';
import { SCRIPT_PRE, SCRIPT_APPROVED, SCRIPT_REJECTED, MOCK_EVENTS } from '@/demo/mockEvents';
import { AURA_EVENT } from '@/types/events';

const S = useAuraStore;
let fails = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (!cond) { fails++; console.log('FAIL  ' + label, extra ?? ''); }
  else console.log('ok    ' + label);
}

console.log('--- script shape ---');
console.log('pre events', SCRIPT_PRE.length, 'approved', SCRIPT_APPROVED.length, 'rejected', SCRIPT_REJECTED.length);
const seqs = MOCK_EVENTS.map(e => e.sequence);
check('sequences strictly increasing', seqs.every((v,i) => i===0 || v > seqs[i-1]));
check('unique event ids', new Set(MOCK_EVENTS.map(e=>e.event_id)).size === MOCK_EVENTS.length);
const preTypes = SCRIPT_PRE.map(s=>s.event.type);
check('last pre event is approval.requested', preTypes[preTypes.length-1] === AURA_EVENT.ApprovalRequested, preTypes.slice(-3));
check('no dispatch events before the gate', !preTypes.some(t => t.startsWith('dispatch.')));
check('pre times monotonic', SCRIPT_PRE.every((s,i)=> i===0 || s.at >= SCRIPT_PRE[i-1].at));

console.log('\n--- feed segment 1 ---');
S.getState().reset();
for (const s of SCRIPT_PRE) S.getState().applyEvent(s.event);
let st = S.getState();
check('stats.applied === pre length', st.stats.applied === SCRIPT_PRE.length, st.stats);
check('no unknown types', st.stats.unknown === 0, st.stats);
check('no stale/buffered', st.stats.stale === 0 && st.stats.buffered === 0, st.stats);
check('3 calls in stack', st.callIds.length === 3, st.callIds);
check('active call is hero', st.activeCallId === 'call-8841', st.activeCallId);
check('incident critical', st.incident?.priority === 'critical', st.incident);
check('incident category medical', st.incident?.category === 'medical');
check('previousPriority high', st.incident?.previousPriority === 'high', st.incident?.previousPriority);
check('phase awaiting_approval', st.phase === 'awaiting_approval', st.phase);
check('location verified 0.97', st.location?.verified === true && st.location?.confidence === 0.97, st.location);
check('protocol is cardiac', st.protocol?.id === 'cardiac-arrest', st.protocol?.id);
check('protocol has 5 steps', st.protocol?.steps.length === 5);
check('compressions step active', st.protocol?.steps.find(s=>s.id==='compressions')?.status === 'active');
check('signals.critical === 1', st.signals.critical === 1, st.signals);
check('signals.interrupt === 1', st.signals.interrupt === 1);
check('signals.locationLocked === 1', st.signals.locationLocked === 1);
check('signals.approvalOpen === 1', st.signals.approvalOpen === 1);
check('route proposed', st.route?.id === 'route-medic12' && (st.route?.path.length ?? 0) >= 3, st.route?.path);
check('dispatch === proposed (nothing moves)', st.dispatch === 'proposed', st.dispatch);
check('dispatchProgress 0', st.dispatchProgress === 0);
check('3 units, MEDIC-12 selected', st.units.length === 3 && st.units.find(u=>u.id==='MEDIC-12')?.selected === true, st.units.map(u=>[u.id,u.selected]));
check('approval pending', st.approval?.state === 'pending', st.approval);
check('stages: locate/classify/verify/prepare_ems done', ['locate','classify','verify','prepare_ems'].every(k => (st.stages as any)[k] === 'done'), st.stages);
check('stage human_approval active', st.stages.human_approval === 'active');
const facts = st.factKeys.map(k => st.facts[k]);
check('6 fact slots', facts.length === 6, facts.map(f=>f.key));
check('all critical facts confirmed at gate', facts.filter(f=>f.critical).every(f=>f.state==='confirmed'), facts.filter(f=>f.critical).map(f=>[f.key,f.state]));
check('breathing reads ABSENT', st.facts.breathing?.value.includes('ABSENT'), st.facts.breathing?.value);
check('hero waveform populated', (st.calls['call-8841']?.waveform.length ?? 0) > 20, st.calls['call-8841']?.waveform.length);
check('background fire call escalated to high', st.calls['call-8837']?.priority === 'high', st.calls['call-8837']?.priority);
check('background call did NOT hijack incident', st.incident?.callId === 'call-8841', st.incident?.callId);
check('camera target is the incident', st.camera.target?.x === 12.5 && st.camera.target?.z === -27, st.camera.target);

console.log('\n--- ordering selector (pure fn form) ---');
const order = [...st.callIds].sort((a,b) => {
  const ca = st.calls[a], cb = st.calls[b];
  const rankOf = (p:string) => ['unknown','low','medium','high','critical'].indexOf(p);
  if (ca.status !== cb.status) return ca.status === 'ended' ? 1 : -1;
  const r = rankOf(cb.priority) - rankOf(ca.priority);
  return r !== 0 ? r : ca.startedAtMs - cb.startedAtMs;
});
check('critical hero call sorts first', order[0] === 'call-8841', order);
check('escalated fire call sorts second', order[1] === 'call-8837', order);

console.log('\n--- approval invariant: dispatch.started is refused while pending ---');
S.getState().applyEvent(SCRIPT_APPROVED[1].event); // dispatch.started, out of band
st = S.getState();
check('dispatch still proposed after illegal dispatch.started', st.dispatch === 'proposed', st.dispatch);

console.log('\n--- operator rejects ---');
S.getState().resolveApproval('rejected', 'operator', 'Insufficient information');
st = S.getState();
check('dispatch rejected', st.dispatch === 'rejected', st.dispatch);
check('stage human_approval blocked', st.stages.human_approval === 'blocked');
check('signals.rejected 1', st.signals.rejected === 1);
for (const s of SCRIPT_REJECTED) S.getState().applyEvent(s.event);
st = S.getState();
check('after rejection nothing moves', st.dispatch === 'rejected' && st.dispatchProgress === 0, [st.dispatch, st.dispatchProgress]);

console.log('\n--- replay, operator approves ---');
S.getState().reset();
for (const s of SCRIPT_PRE) S.getState().applyEvent(s.event);
S.getState().resolveApproval('granted', 'operator');
st = S.getState();
check('dispatch approved', st.dispatch === 'approved', st.dispatch);
check('signals.approved 1', st.signals.approved === 1);
check('stage human_approval done', st.stages.human_approval === 'done');
for (const s of SCRIPT_APPROVED) S.getState().applyEvent(s.event);
st = S.getState();
check('dispatch arrived', st.dispatch === 'arrived', st.dispatch);
check('progress 1', st.dispatchProgress === 1);
check('phase dispatched', st.phase === 'dispatched', st.phase);
check('hero call ended', st.calls['call-8841']?.status === 'ended');
check('ems_handoff step active', st.protocol?.steps.find(s=>s.id==='ems_handoff')?.status === 'active');
check('no unknown events across whole run', st.stats.unknown === 0, st.stats);

console.log('\n--- ingestion robustness ---');
function stats() { return { ...S.getState().stats }; }
const evts = SCRIPT_PRE.map(s=>s.event);

// exact duplicate
S.getState().reset();
S.getState().applyEvent(evts[0]);
let a = stats();
S.getState().applyEvent(evts[0]);
let b = stats();
check('duplicate not re-applied', b.applied === a.applied, [a, b]);

// gap buffering then drain
S.getState().reset();
S.getState().applyEvent(evts[0]);
S.getState().applyEvent(evts[2]);
check('gap buffered, not applied', stats().buffered === 1 && stats().applied === 1, stats());
S.getState().applyEvent(evts[1]);
check('gap drained: applied 3', stats().applied === 3, stats());

// stale
S.getState().reset();
for (const e of evts.slice(0, 4)) S.getState().applyEvent(e);
a = stats();
S.getState().applyEvent({ ...evts[1], event_id: 'x-stale' });
b = stats();
check('stale dropped, nothing applied', b.stale === a.stale + 1 && b.applied === a.applied, [a, b]);

// unknown type
S.getState().reset();
S.getState().applyEvent(evts[0]);
S.getState().applyEvent({ event_id:'u1', session_id:'s', type:'totally.unknown.event', timestamp:new Date().toISOString(), sequence: evts[0].sequence + 1, payload:{} });
check('unknown counted, not thrown', stats().unknown === 1, stats());

// missing sequence still applies
S.getState().reset();
for (const e of evts) S.getState().applyEvent(e);
S.getState().applyEvent({ event_id:'u2', session_id:'s', type:'call.ended', timestamp:new Date().toISOString(), sequence: undefined as unknown as number, payload:{ call_id:'call-8841' } });
check('event without sequence still applied', S.getState().calls['call-8841']?.status === 'ended', S.getState().calls['call-8841']?.status);

// flushGaps releases a permanently lost predecessor
S.getState().reset();
S.getState().applyEvent(evts[0]);
S.getState().applyEvent(evts[5]);
check('held while gap open', stats().applied === 1, stats());
S.getState().flushGaps();
check('flushGaps released buffered event', stats().applied === 2, stats());

console.log('\n--- jittered delivery (realistic out-of-order window) ---');
function jitter<T>(arr: T[], window: number, seed: number): T[] {
  let a2 = seed >>> 0;
  const rand = () => { a2 = (a2 + 0x6d2b79f5) >>> 0; let t = a2; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += window) {
    const chunk = arr.slice(i, i + window);
    for (let j = chunk.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); const tmp = chunk[j]; chunk[j] = chunk[k]; chunk[k] = tmp; }
    out.push(...chunk);
  }
  return out;
}
S.getState().reset();
const jittered = jitter(evts, 6, 0xabcdef);
check('jitter actually reordered', jittered.some((e,i) => e.sequence !== evts[i].sequence));
for (const e of jittered) S.getState().applyEvent(e);
let js = S.getState();
check('jittered: all events applied', js.stats.applied === evts.length, js.stats);
check('jittered: incident critical', js.incident?.priority === 'critical', js.incident?.priority);
check('jittered: cardiac protocol active', js.protocol?.id === 'cardiac-arrest');
check('jittered: awaiting approval', js.approval?.state === 'pending');
check('jittered: nothing dispatched', js.dispatch === 'proposed', js.dispatch);
check('jittered: signals fired exactly once each', js.signals.critical === 1 && js.signals.interrupt === 1 && js.signals.locationLocked === 1 && js.signals.approvalOpen === 1, js.signals);

S.getState().reset();
const withDupes = jittered.flatMap((e, i) => (i % 7 === 0 ? [e, e] : [e]));
for (const e of withDupes) S.getState().applyEvent(e);
js = S.getState();
check('dupes+jitter: applied exactly once each', js.stats.applied === evts.length, js.stats);
check('dupes+jitter: state identical', js.incident?.priority === 'critical' && js.approval?.state === 'pending' && js.dispatch === 'proposed');

console.log('\n--- a reversed stream must not rewind or dispatch ---');
S.getState().reset();
for (const e of [...evts].reverse()) S.getState().applyEvent(e);
js = S.getState();
check('reversed: nothing dispatched', js.dispatch !== 'enroute' && js.dispatch !== 'approved' && js.dispatch !== 'arrived', js.dispatch);
check('reversed: no progress', js.dispatchProgress === 0);
check('reversed: older events rejected as stale', js.stats.stale > 0, js.stats);

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
