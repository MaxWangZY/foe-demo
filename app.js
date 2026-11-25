import {braessLoads, flowView, particleCount, costChartData, replayMediatorCosts} from './view-model.mjs';
import {createSavedReplayLoader, savedCaseKey} from './saved-replays.mjs';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const savedResults = $('saved-results');
const names = ['Top', 'Middle', 'Bottom'];
const colors = ['var(--top)', 'var(--middle)', 'var(--bottom)'];
const format = (x, digits=4) => Number.isFinite(x) ? x.toFixed(digits) : '—';
const routeCards = document.querySelectorAll('[data-route]');
const routeInfo = $('routeInfo');
const routePrompt = routeInfo.textContent;
let result = null, allocation = 'foe', dayIndex = 0, playback = null;
let trafficOn = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let particles = [], phase = 0, previousFrame = 0, highlighted = null;
let lockedRoute = null;
let population = 'all', currentView = null;
let solving = false;
let shownSavedCase = null;

function renderShares() {
  const K = Number($('K').value);
  if (!Number.isInteger(K) || K < 1 || K > 12) return;
  const old = [...document.querySelectorAll('.share')].map(input => input.value);
  $('shares').replaceChildren();
  for (let i=0; i<K; i++) {
    const row = document.createElement('div'); row.className = 'share-row';
    const label = document.createElement('label'); label.htmlFor = `share${i}`; label.textContent = `Mediator ${i+1}`;
    const input = document.createElement('input'); Object.assign(input, {id:`share${i}`,className:'share',type:'number',min:'0.1',step:'0.1',value:old.length===K?old[i]:(100/K).toFixed(2)});
    input.setAttribute('aria-label', `Mediator ${i+1} population weight`);
    row.append(label,input); $('shares').append(row);
  }
}
function dirty() {
  if (result && !solving) { $('status').textContent = 'Inputs changed · displaying previous run'; $('status').className = 'status'; }
}
function stopPlayback() {
  if (playback) clearInterval(playback);
  playback = null; $('play').textContent = '▶'; $('play').setAttribute('aria-label','Play policy days');
}
function setTab(name) {
  for (const tab of ['overview','policies']) {
    const active = tab === name;
    $('tab-'+tab).setAttribute('aria-selected',String(active));
    $('tab-'+tab).tabIndex = active ? 0 : -1; $('panel-'+tab).hidden = !active;
  }
  if (name === 'overview' && result) drawChart();
}
for (const name of ['overview','policies']) {
  $('tab-'+name).onclick = () => setTab(name);
  $('tab-'+name).onkeydown = event => {
    const all = ['overview','policies']; let next;
    if (event.key==='ArrowRight') next=all[(all.indexOf(name)+1)%2];
    if (event.key==='ArrowLeft') next=all[(all.indexOf(name)+1)%2];
    if (event.key==='Home') next=all[0]; if (event.key==='End') next=all[1];
    if (next) {event.preventDefault();setTab(next);$('tab-'+next).focus();}
  };
}
function updateTrafficButton() {
  $('traffic').textContent = trafficOn ? 'Ⅱ' : '▶';
  $('traffic').setAttribute('aria-label',trafficOn ? 'Pause traffic animation' : 'Animate traffic');
  $('traffic').title=trafficOn ? 'Pause traffic animation' : 'Animate traffic';
  $('traffic').setAttribute('aria-pressed',String(trafficOn));
}
$('traffic').onclick = () => { trafficOn=!trafficOn; updateTrafficButton(); };
function rebuildParticles() {
  $('particles').replaceChildren(); particles=[];
  if (!currentView) return;
  const layers=[{flows:currentView.shown,context:false}];
  if(allocation==='foe'&&population!=='all')layers.unshift({flows:currentView.total.map((x,r)=>Math.max(0,x-currentView.shown[r])),context:true});
  for(const layer of layers)layer.flows.forEach((flow,r) => {
    const count=particleCount(flow), path=$('track'+r), length=path.getTotalLength();
    for (let i=0;i<count;i++) {
      const dot=document.createElementNS(NS,'circle'); dot.setAttribute('r',savedResults?'2.4':'3.3'); dot.setAttribute('fill',colors[r]);
      $('particles').append(dot); particles.push({dot,path,length,offset:(i+.5)/count,route:r,context:layer.context});
    }
    path.style.opacity = flow > 1e-10 ? '.22' : '.045';
  });
  paintParticles();
}
function paintParticles() {
  for (const particle of particles) {
    // Equal illustrative speed along every route, never interpreted as latency.
    const position=particle.path.getPointAtLength((phase+particle.offset*particle.length)%particle.length);
    particle.dot.setAttribute('cx',position.x); particle.dot.setAttribute('cy',position.y);
    particle.dot.style.opacity = particle.context ? '.13' : highlighted === null || highlighted === particle.route ? '.9' : '.12';
  }
}
function frame(timestamp) {
  const elapsed = previousFrame ? Math.min(100,timestamp-previousFrame) : 0; previousFrame=timestamp;
  if (trafficOn && !document.hidden) {
    phase += elapsed * (savedResults ? .025 : .045);
    paintParticles();
  }
  requestAnimationFrame(frame);
}
function highlightRoute(r) {
  highlighted=r;
  for (const button of routeCards) {
    const route = Number(button.dataset.route);
    button.classList.toggle('active', route === r);
    button.setAttribute('aria-pressed', String(route === lockedRoute));
  }
  for (let j=0;j<3;j++) {
    $('track'+j).classList.toggle('highlight',r===j);
    $('track'+j).style.opacity = r===j ? '.55' : r!==null ? '.045' : currentView?.shown[j]>1e-10 ? '.22' : '.045';
  }
  if (r === null || !currentView) {
    routeInfo.textContent = routePrompt;
  } else {
    const lockStatus = r === lockedRoute ? ' (locked)' : '';
    routeInfo.textContent = `${names[r]} route${lockStatus} · displayed flow ${format(currentView.shown[r])} · mean-flow route cost ${format(currentView.costs[r])} (all populations)`;
  }
  paintParticles();
}
function previewRoute(r) {
  if (lockedRoute === null) highlightRoute(r);
}
for (const button of routeCards) {
  const r = Number(button.dataset.route);
  const track = $('track'+r);
  button.onmouseenter = () => previewRoute(r);
  button.onmouseleave = () => previewRoute(null);
  button.onfocus = () => previewRoute(r);
  button.onblur = () => previewRoute(null);
  button.onclick = () => {
    lockedRoute = lockedRoute === r ? null : r;
    highlightRoute(lockedRoute);
  };
  track.onmouseenter = () => previewRoute(r);
  track.onmouseleave = () => previewRoute(null);
}
function renderMediatorChips() {
  $('mediatorChips').replaceChildren();
  for (const [key,label] of [['all','All mediators'],...result.parameters.shares.map((s,k)=>[String(k),`Mediator ${k+1} · ${format(100*s,1)}%`])]) {
    const button=document.createElement('button');button.textContent=label;button.dataset.mediator=key;
    button.setAttribute('aria-pressed',String(population===key));button.disabled=allocation!=='foe';
    button.onclick=()=>{population=key;updateView();};$('mediatorChips').append(button);
  }
}
function updateView() {
  if (!result) return;
  const state=result.states[dayIndex],benchmark=allocation!=='foe';
  const groups=benchmark?[result.benchmarks[allocation].flow]:state.means;
  currentView=flowView(groups,benchmark?'all':population,result.parameters.rho);
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===allocation;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  ['T','M','B'].forEach((route,r)=>$('flow'+route).textContent=format(currentView.shown[r]));
  document.querySelectorAll('.route-caption').forEach(node=>node.textContent=benchmark?'Benchmark flow':population==='all'?'Total expected flow':`Mediator ${Number(population)+1} expected flow`);
  const filtered=!benchmark&&population!=='all';
  const selectedLoads=filtered?braessLoads(currentView.shown):null;
  for(const [edge,load] of Object.entries(currentView.loads)){
    $('evaluated'+edge).textContent=`c(${format(load,3)}) = ${format(currentView.edgeCosts[edge],3)}`;
    $('mediatorLoad'+edge).textContent=filtered?`M${Number(population)+1} load ${format(selectedLoads[edge],3)}`:'';
    $('edge'+edge).style.strokeWidth=String(savedResults ? 1.4+4*Math.max(0,load) : 3+8*Math.max(0,load));
  }
  $('day').value=dayIndex;$('dayLabel').textContent=benchmark?'STATIC BENCHMARK':`DAY ${state.day}`;
  $('dayCount').textContent=`${state.day} / ${result.states.at(-1).day}`;
  $('viewBadge').textContent=benchmark?(allocation==='SO'?'SOCIAL OPTIMUM':'WARDROP'):population==='all'?'ALL MEDIATORS · EXPECTED FLOW':`MEDIATOR ${Number(population)+1} · EXPECTED FLOW`;
  for(const id of ['day','play','speed'])$(id).disabled=benchmark;
  if(benchmark)$('viewNote').textContent=`${allocation==='SO'?'Social optimum':'Wardrop'} aggregate flow. No mediator allocation is implied. The cost chart shows the mediator search, not this static benchmark.`;
  else $('viewNote').textContent=`Expected traffic for ${population==='all'?'all mediators':`mediator ${Number(population)+1}`}. ${population==='all'?'':'Other groups are faintly visible. '}Edge loads and costs include all groups. Particle speed is illustrative; intermediate days may fail obedience.`;
  document.querySelectorAll('[data-mediator]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.mediator===population));button.disabled=benchmark;});
  rebuildParticles();highlightRoute(highlighted);renderPolicy();
  drawChart();
}
const allocationTabs=[...document.querySelectorAll('[data-view]')];
for(const [index,button]of allocationTabs.entries()){
  button.onclick=()=>selectAllocation(button.dataset.view);
  button.onkeydown=event=>{
    let next;if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;
    event.preventDefault();allocationTabs[next].click();allocationTabs[next].focus();
  };
}
$('day').oninput=()=>{stopPlayback();dayIndex=Number($('day').value);updateView();};
function playDays() {
  if (!result || allocation!=='foe') return;
  if (playback) {stopPlayback();return;}
  if (dayIndex>=result.states.length-1) dayIndex=0;
  updateView(); $('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Pause policy days');
  playback=setInterval(()=>{
    if(dayIndex>=result.states.length-1){stopPlayback();return;}
    dayIndex++;updateView();
    if(dayIndex>=result.states.length-1)stopPlayback();
  },Number($('speed').value));
}
$('play').onclick=playDays;
$('speed').onchange=()=>{if(playback){stopPlayback();playDays();}};
function renderPolicy() {
  if(!result)return;
  const expanded=new Set([...$('policyContent').querySelectorAll('details[open]')].map(node=>node.dataset.mediator));
  $('policyContent').replaceChildren();
  const indices=population==='all'?result.parameters.shares.map((_,k)=>k):[Number(population)];
  for(const k of indices){
    const card=document.createElement('section');card.className='mediator-summary';
    const title=document.createElement('h3');title.textContent=`Mediator ${k+1}`;card.append(title);
    const note=document.createElement('p');note.className='caption';note.textContent=`Day ${result.states[dayIndex].day} · group mass ${format(result.parameters.shares[k],3)}`;card.append(note);
    const objective=document.createElement('div');objective.className='mediator-objective';
    const cost=result.states[dayIndex].mediator_costs?.[k]??(dayIndex===result.states.length-1?result.validation.mediators?.[k]?.cost:undefined);
    objective.innerHTML=`<span>Expected population cost</span><strong>${Number.isFinite(cost)?format(cost):'Unavailable'}</strong>`;card.append(objective);
    if(!Number.isFinite(cost)){const pending=document.createElement('p');pending.className='caption';pending.textContent='Restart the local server to enable costs for intermediate days.';card.append(pending);}
    const mean=document.createElement('div');mean.className='mean-breakdown';
    result.states[dayIndex].means[k].forEach((flow,r)=>{const row=document.createElement('div');row.innerHTML=`<span>${names[r]}</span><strong>${format(flow)}</strong>`;mean.append(row);});card.append(mean);
    const rec=result.policies[k];
    if(rec?.success&&result.verified){
      const details=document.createElement('details');details.className='policy-details';details.dataset.mediator=String(k);details.open=expanded.has(String(k));
      const summary=document.createElement('summary');summary.textContent=`Policy details · ${rec.flows.length} final allocations`;details.append(summary);
      const finalNote=document.createElement('p');finalNote.className='caption';finalNote.textContent='Final recovered policy: probabilities over group allocations, not route-choice probabilities.';details.append(finalNote);
      const rows=rec.probabilities.map((p,index)=>({p,index,g:rec.flows[index]})).sort((a,b)=>b.p-a.p);
      for(const row of rows){const item=document.createElement('div');item.className='allocation';item.innerHTML=`<div class="allocation-heading"><span>Allocation ${row.index+1}</span><strong>${format(100*row.p,2)}%</strong></div><div class="allocation-flows">T ${format(row.g[0])} · M ${format(row.g[1])} · B ${format(row.g[2])}</div>`;details.append(item);}card.append(details);
    }else{const note=document.createElement('p');note.className='caption';note.textContent='No validated final policy is available.';card.append(note);}
    $('policyContent').append(card);
  }
}
function selectAllocation(choice) {
  if(!result)return;
  stopPlayback();allocation=choice;dayIndex=result.states.length-1;
  updateView();
}
function selectChartDay(index) {
  stopPlayback();allocation='foe';dayIndex=index;updateView();
}
function drawChart() {
  if (!result || $('panel-overview').hidden) return;
  const svg=$('chart'),width=Math.max(250,svg.clientWidth),right=width-14,left=savedResults?53:44,top=18,bottom=188;
  const axisColor=savedResults?'var(--ink)':'#77829a', axisSize=savedResults?12:9;
  const individual=allocation==='foe'&&population!=='all',k=Number(population);
  const states=result.states.map(state=>({...state,social_cost:individual?state.mediator_costs?.[k]:state.social_cost}));
  const data=costChartData(states,individual?undefined:result.benchmarks.SO.social_cost,individual?undefined:result.benchmarks.Wardrop.social_cost);
  const costLabel=individual?`Mediator ${k+1} expected population cost`:'Total expected social cost';
  $('costChartTitle').textContent=individual?`Mediator ${k+1} cost over time`:'Total social cost over time';
  svg.setAttribute('aria-label',`${costLabel} over policy days. Click to select a day or use arrow keys.`);
  $('costChartLegend').innerHTML=`<span><i style="background:var(--accent)"></i>${individual?`Mediator ${k+1}`:'All mediators'}</span>${individual?'':'<span><i style="background:var(--so)"></i>SO</span><span><i style="background:var(--wardrop)"></i>Wardrop</span>'}`;
  $('costChartNote').textContent=individual?'Expected total cost of this mediator’s population, including randomization. Click the curve to select a day.':'SO is a lower bound; Wardrop is a comparison. Search costs need not decrease. Click the curve to select a day.';
  svg.setAttribute('viewBox',`0 0 ${width} ${savedResults?224:240}`);svg.replaceChildren();
  const X=day=>left+(right-left)*day/data.maxDay,Y=value=>bottom-(bottom-top)*(value-data.min)/(data.max-data.min);
  function el(tag,attributes,text){const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;svg.append(node);return node;}
  for(let i=0;i<=4;i++){
    const value=data.min+(data.max-data.min)*i/4,y=Y(value);
    el('line',{x1:left,x2:right,y1:y,y2:y,stroke:'var(--line)'});el('text',{x:left-8,y:y+3,'text-anchor':'end',fill:axisColor,'font-size':axisSize},format(value,2));
  }
  if(savedResults)el('path',{d:`M${left},${top} V${bottom} H${right}`,fill:'none',stroke:axisColor});
  for(const [value,color,label,dash]of [[data.so,'var(--so)','Social optimum','6 4'],[data.wardrop,'var(--wardrop)','Wardrop','2 4']]){
    if(!Number.isFinite(value))continue;
    const line=el('line',{x1:left,x2:right,y1:Y(value),y2:Y(value),stroke:color,'stroke-dasharray':dash,'stroke-width':1.6});const title=document.createElementNS(NS,'title');title.textContent=`${label}: ${format(value)}`;line.append(title);
  }
  const path=data.points.map((point,i)=>`${i?'L':'M'}${X(point.day)},${Y(point.cost)}`).join(' ');
  if(!savedResults&&data.points.length)el('path',{d:`${path} L${X(data.points.at(-1).day)},${bottom} L${X(data.points[0].day)},${bottom} Z`,fill:'var(--accent)',opacity:'.07'});
  el('path',{d:path,fill:'none',stroke:'var(--accent)','stroke-width':2.5,'stroke-linejoin':'round'});
  const selected=states[dayIndex];
  if(Number.isFinite(selected.social_cost)){
    el('line',{x1:X(selected.day),x2:X(selected.day),y1:top,y2:bottom,stroke:savedResults?'var(--muted)':'#aab4d5','stroke-dasharray':'2 4'});
    el('circle',{cx:X(selected.day),cy:Y(selected.social_cost),r:4,fill:'var(--accent)',stroke:'var(--white)','stroke-width':2});
  }
  el('text',{x:left,y:212,fill:axisColor,'font-size':axisSize},'Day 0');el('text',{x:right,y:212,'text-anchor':'end',fill:axisColor,'font-size':axisSize},`Day ${result.states.at(-1).day}`);
  const final=dayIndex===result.states.length-1;
  $('chartReadout').textContent=`Day ${selected.day} · ${format(selected.social_cost)}${final&&result.verified?' · verified FOE candidate':''}`;
  const hit=el('rect',{x:left,y:top,width:right-left,height:bottom-top,fill:'transparent'});hit.style.cursor='crosshair';
  hit.onclick=event=>{
    const matrix=svg.getScreenCTM();if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const day=Math.max(0,Math.min(data.maxDay,(point.x-left)/(right-left)*data.maxDay));
    const closest=result.states.reduce((best,state,i)=>Math.abs(state.day-day)<Math.abs(result.states[best].day-day)?i:best,0);selectChartDay(closest);
  };
  // Hover titles show every stored cost, not a smoothed or resampled series.
  for(const point of data.points){const dot=el('circle',{cx:X(point.day),cy:Y(point.cost),r:4,fill:'transparent'});const title=document.createElementNS(NS,'title');title.textContent=`Day ${point.day}: ${costLabel.toLowerCase()} ${format(point.cost,6)}`;dot.append(title);dot.onclick=()=>selectChartDay(point.index);}
}
$('chart').onkeydown=event=>{
  if(!result)return;
  let next=dayIndex;if(event.key==='ArrowLeft')next=Math.max(0,next-1);else if(event.key==='ArrowRight')next=Math.min(result.states.length-1,next+1);else if(event.key==='Home')next=0;else if(event.key==='End')next=result.states.length-1;else return;
  event.preventDefault();selectChartDay(next);
};
function renderResult() {
  const p=result.parameters;allocation='foe';population='all';dayIndex=result.states.length-1;
  $('caseLabel').textContent=`ρ ${format(p.rho,2)} · ε ${format(p.epsilon,3)} · ${p.shares.length} mediators · ${p.update==='jacobi'?'Jacobi':'Sequential'}`;
  $('status').className='status '+(result.verified?'good':'bad');
  $('status').textContent=result.verified?`✓ Numerical checks passed · day ${result.states.at(-1).day}`:result.moment_verified?'Unverified · policy validation failed':`Unverified · ${result.search_status.replaceAll('_',' ')}`;
  $('export').disabled=false;
  const so=result.benchmarks.SO.social_cost,w=result.benchmarks.Wardrop.social_cost,f=result.validation.social_cost;
  $('foeLabel').textContent=result.verified?'Recovered FOE':'Unverified candidate';
  document.querySelector('[data-view="foe"]').textContent = result.verified ? 'FOE mean flow' : 'Candidate mean flow';
  $('so').textContent=format(so);$('wardrop').textContent=format(w);$('foe').textContent=format(f);
  const maximum=Math.max(so,w,f||0,1e-12)*1.1;
  for(const [id,value]of [['barSO',so],['barW',w],['barFOE',f]])$(id).style.width=`${100*(value||0)/maximum}%`;
  $('comparison').textContent=result.verified?`${w>0?`${format(100*(w-f)/w,1)}% lower cost than Wardrop`:'Wardrop cost is zero'}${so>0?` · ${format(f/so,3)}× social optimum`:''}`:'Terminal cost is shown for diagnosis; this candidate did not pass all checks.';
  $('timing').textContent=`${result.states.at(-1).day} days · ${format(result.search_seconds,2)}s search · ${format(result.recovery_seconds,3)}s recovery`;
  $('day').max=result.states.length-1;renderMediatorChips();updateView();
  if(!shownSavedCase && window.matchMedia('(max-width:650px)').matches)$('gameSettings').open=false;
}
async function run() {
  stopPlayback();$('error').textContent='';solving=true;
  const controls=[...document.querySelectorAll('.settings input,.settings select,.settings button')];controls.forEach(el=>el.disabled=true);
  $('run').textContent='Solving…';$('status').className='status';$('status').textContent='Computing best responses and checking the profile…';
  try {
    const input={rho:Number($('rho').value),epsilon:Number($('epsilon').value),damping:Number($('damping').value),seed:Number($('seed').value),max_iterations:Number($('days').value),update:$('update').value,initialization:$('initialization').value,shares:[...document.querySelectorAll('.share')].map(el=>Number(el.value))};
    const response=await fetch('/api/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Solve failed');
    if(data.states.some(state=>!state.mediator_costs)){
      const costs=replayMediatorCosts(data);data.states.forEach((state,i)=>state.mediator_costs=costs[i]);
    }
    result=data;renderResult();
  } catch(error){$('error').textContent=error.message;$('status').className='status bad';$('status').textContent=result?'Solve failed · showing previous run':'Could not complete this run';}
  finally {solving=false;controls.forEach(el=>el.disabled=false);$('run').innerHTML='Solve & compare <span>→</span>';}
}
function updateSliderLabel(id) {
  $(id+'Value').textContent = format(Number($(id).value), id === 'epsilon' ? 3 : 2);
}

function setupLiveControls() {
  for (const id of ['rho','epsilon','damping']) $(id).oninput = () => updateSliderLabel(id);
  $('K').oninput = renderShares;
  document.querySelector('.settings').addEventListener('input', dirty);
  $('reset').onclick = () => {
    const defaults = {rho:'0.75',epsilon:'0.2',K:'2',update:'jacobi',damping:'0.1',days:'150',initialization:'random',seed:'0'};
    for (const [id,value] of Object.entries(defaults)) $(id).value = value;
    $('shares').replaceChildren();
    renderShares();
    for (const id of ['rho','epsilon','damping']) updateSliderLabel(id);
    run();
  };
  $('run').onclick = run;
  renderShares();
  run();
}

function setupSavedControls(config) {
  $('modeLabel').textContent = 'SAVED REPLAYS';
  $('journalTitle').hidden = false;
  $('networkTitle').hidden = false;
  $('live-populations').hidden = true;
  $('saved-populations').hidden = false;
  $('searchSettings').hidden = true;
  $('run').hidden = true;
  $('export').textContent = 'Export replay';
  $('exportHelp').textContent = 'Replay exports include the displayed data and numerical check status.';
  $('inputNote').textContent = `All scenarios use seed ${config.defaultReplay.parameters.seed}.`;
  $('network').setAttribute('viewBox', '35 52 650 436');
  document.querySelector('.settings-section').append($('reset'));
  document.querySelector('.settings').append($('replayTimeline'));
  $('panel-overview').append($('costSummary'));

  const presets = $('populationPreset');
  for (const [key, weights] of Object.entries(config.presets)) {
    const count = weights.length;
    let label = count === 1 ? '1 mediator' : `${count} mediators · equal shares`;
    if (weights.some(weight => weight !== weights[0])) {
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const split = weights.map(weight => format(100 * weight / total, 0)).join('/');
      label = `${count} mediators · ${split}`;
    }
    presets.add(new Option(label, key));
  }

  const loadReplay = createSavedReplayLoader(config);
  let selection = 0;
  function reflectSavedCase(key, parameters) {
    $('rho').value = parameters.rho;
    $('epsilon').value = parameters.epsilon;
    presets.value = key.split('-').at(-1);
    for (const id of ['rho', 'epsilon']) updateSliderLabel(id);
  }
  function showSavedCase(key, replay) {
    shownSavedCase = key;
    result = replay;
    renderResult();
  }
  function resetSavedCase() {
    selection += 1;
    stopPlayback();
    $('error').textContent = '';
    reflectSavedCase(config.defaultCase, config.defaultReplay.parameters);
    showSavedCase(config.defaultCase, config.defaultReplay);
  }
  async function selectSavedCase() {
    const request = ++selection;
    const key = savedCaseKey($('rho').valueAsNumber, $('epsilon').valueAsNumber, presets.value);
    stopPlayback();
    $('error').textContent = '';
    $('status').className = 'status';
    $('status').textContent = 'Loading saved scenario…';
    try {
      const replay = await loadReplay(key);
      if (request === selection) showSavedCase(key, replay);
    } catch {
      if (request !== selection) return;
      reflectSavedCase(shownSavedCase, result.parameters);
      $('status').className = 'status bad';
      $('status').textContent = 'Showing previous scenario';
      $('error').textContent = 'Could not load that replay. Select the scenario again to retry.';
    }
  }
  for (const id of ['rho', 'epsilon']) {
    $(id).oninput = () => updateSliderLabel(id);
    $(id).onchange = selectSavedCase;
  }
  presets.onchange = selectSavedCase;
  $('reset').onclick = resetSavedCase;
  resetSavedCase();
  if (window.matchMedia('(max-width:650px)').matches) $('gameSettings').open = false;
}

$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
$('export').onclick=()=>{
  if(!result)return;
  const data={...result,visualization:{mode:'mean',allocation,day:result.states[dayIndex].day,population}};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=shownSavedCase?`braess-${shownSavedCase}.json`:`braess-rho${result.parameters.rho}-eps${result.parameters.epsilon}-seed${result.parameters.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('resize',()=>{
  if(!window.matchMedia('(max-width:650px)').matches)$('gameSettings').open=true;
  drawChart();
});
updateTrafficButton();
requestAnimationFrame(frame);
if (savedResults) setupSavedControls(JSON.parse(savedResults.textContent));
else setupLiveControls();
