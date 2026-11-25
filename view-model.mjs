/** Pure flow-view helpers. All route arrays use top, middle, bottom order. */
export function aggregate(means) {
  return means.reduce((sum, m) => sum.map((x, r) => x + m[r]), [0, 0, 0]);
}
export function braessLoads(f) {
  return {SA: f[0] + f[1], AE: f[0], SB: f[2], BE: f[1] + f[2], AB: f[1]};
}
function costsByEdge(loads, rho) {
  return {SA: loads.SA, AE: rho, SB: rho, BE: loads.BE, AB: 0};
}
function costsByRoute({SA, AE, SB, BE, AB}) {
  return [SA + AE, SA + AB + BE, SB + BE];
}
export function braessCosts(f, rho) {
  return costsByRoute(costsByEdge(braessLoads(f), rho));
}
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Draw one support index from each policy; optional preview pins one group. */
export function sampleProfile(policies, random, pin = null) {
  return policies.map((policy, k) => {
    let index = policy.probabilities.length - 1;
    if (pin && pin.mediator === k) index = pin.index;
    else {
      const draw = random();
      let cumulative = 0;
      for (let i = 0; i < policy.probabilities.length; i++) {
        cumulative += policy.probabilities[i];
        if (draw < cumulative) { index = i; break; }
      }
    }
    return {index, flow: [...policy.flows[index]], probability: policy.probabilities[index]};
  });
}
/** Filtering affects display only. All groups still determine costs and loads. */
export function flowView(groupFlows, population, rho) {
  const total = aggregate(groupFlows);
  const shown = population === 'all' ? total : [...groupFlows[Number(population)]];
  const loads = braessLoads(total);
  const edgeCosts = costsByEdge(loads, rho);
  return {total, shown, loads, edgeCosts, costs: costsByRoute(edgeCosts)};
}
/** Particle count scales with absolute group flow; tiny flows may show no dots. */
export function particleCount(flow) { return Math.max(0, Math.round(100 * flow)); }
/** Full expected-cost history with a padded range; Wardrop is not an upper bound. */
export function costChartData(states, so, wardrop) {
  const points=states.map((state,index)=>({day:state.day,cost:state.social_cost,index})).filter(point=>Number.isFinite(point.cost));
  const values=[so,wardrop,...points.map(point=>point.cost)].filter(Number.isFinite);
  const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1,padding=Math.max((high-low)*.12,Math.max(Math.abs(high),1)*.025);
  return {points,so,wardrop,min:low-padding,max:high+padding,maxDay:Math.max(1,...states.map(state=>state.day))};
}
/** Restore Braess replay costs from stored BR updates for older server payloads.
 * Track <H,Q> linearly; never substitute deterministic mean flows for Q.
 */
export function replayMediatorCosts(result) {
  const cross=(m,v)=>m[0]*(v[0]+v[1])+m[1]*(v[0]+2*v[1]+v[2])+m[2]*(v[1]+v[2]);
  const linear=m=>result.parameters.rho*(m[0]+m[2]);
  const initial=result.states[0], total=aggregate(initial.means);
  const own=initial.means.map((m,k)=>result.trace[0].validation.mediators[k].cost-cross(m,total.map((x,r)=>x-m[r]))-linear(m));
  return result.states.map((state,index)=>{
    if(index)for(const br of result.trace[index].best_responses){
      if(!br.success)break;
      const Q=br.Q,quadratic=Q[0][0]+2*Q[1][1]+Q[2][2]+2*Q[0][1]+2*Q[1][2],alpha=result.parameters.damping;
      own[br.mediator]=(1-alpha)*own[br.mediator]+alpha*quadratic;
    }
    const total=aggregate(state.means);
    return state.means.map((m,k)=>own[k]+cross(m,total.map((x,r)=>x-m[r]))+linear(m));
  });
}
