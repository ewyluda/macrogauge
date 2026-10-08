/* Offline PR 95 reconciliation. No application/data files are modified.
 * Usage: node <this-file> <snapshot-root> <JSON-from-companion-Python-probe>
 * Original failing probes remain unchanged as the historical record.
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const Module = require('node:module');
const root = fs.realpathSync(path.resolve(process.argv[2] || path.join(__dirname, '../..')));
const py = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const site = path.join(root, 'site');
const req = Module.createRequire(path.join(site, 'package.json'));
const ts = req('typescript'), React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('@/')) name = path.join(site, 'src', name.slice(2));
  return resolve.call(this, name, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, file) => {
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText, file);
};
const lib = n => require(path.join(site, 'src/lib', n));
const comp = n => require(path.join(site, 'src/components', n));
const json = n => JSON.parse(fs.readFileSync(path.join(site, 'public/data', n + '.json')));
const out = { reviewed_head: 'c655fc772af78dd2c4b09f756e1c78f4519d1c10', controls: {}, remaining: {} };

// F3: the end-date fix works, but independently produced baselines can differ.
const rates = lib('ratesHeadline.ts');
const ten = { value: 5, chg_1y_pp: 1 };
const lagged = rates.ratesHeadline(ten, { value: 6.19, chg_1y: 1.19, as_of: '2026-10-06' },
  { as_of: '2026-09-30', base_date: '2025-09-30', yield_chg_1y: -1.1, oas_chg_1y: -1 });
assert.equal(lagged.title, 'BBB corporate debt yields 6.19%, up 119bp on the year');
out.controls.F3_lagged_end = lagged;
const r = py.F3_shared_end_different_baselines;
const mismatch = rates.ratesHeadline(ten, r.yield, r.move);
assert.match(mismatch.title, /up 10bp.*mostly from the credit spread/);
assert.match(mismatch.detail, /spread moved −12bp.*yield's −12bp/);
out.remaining.F3_baseline_mismatch = { producer: r, headline: mismatch };

// F4: calculate each comparison from the same actual rows, not the own-sample stats.
function board(errorRows) {
  const names = [...new Set(errorRows.flatMap(x => Object.keys(x)))];
  return { min_n_for_weights: 6, window: 12, weights_earned: false, basis: 'SA',
    rows: errorRows.map((v,i) => ({ reference_period: `2026-${String(i+1).padStart(2,'0')}`,
      forecasts: Object.fromEntries(Object.entries(v).map(([k,error])=>[k,{error}])) })),
    stats: Object.fromEntries(names.map(k => { const a=errorRows.filter(v=>k in v).map(v=>v[k]);
      return [k,{n:a.length,mae_pp:a.reduce((s,x)=>s+Math.abs(x),0)/a.length,bias_pp:0}]; })) };
}
const score = lib('scoreboardHeadline.ts').headToHeadTakeaway;
const unequal = score(board([{macrogauge:0},{macrogauge:1,cleveland:0.6}]));
assert.match(unequal, /^Cleveland Fed.*1 graded print every forecaster called.*0.600pp.*1.000pp/);
const differentMissing = score(board([{macrogauge:0.1},{macrogauge:0.5,cleveland:0.2},{cleveland:0.9}]));
assert.match(differentMissing, /^Cleveland Fed.*1 graded print/);
assert.equal(score(board([{macrogauge:0.1},{cleveland:0.2}])),null);
out.controls.F4_common_samples = {unequal,differentMissing,noOverlap:null};

// F5: original multiword places and a same-place rewrite.
const news = lib('newsTape.ts');
const post = (id,place) => ({id,ts:'2026-10-08T15:00:00Z',headline:`Microsoft opens a 500 MW data center in ${place}`,
  points:[],tickers:[{ticker:'MSFT',layer:'hyperscalers'}]});
out.controls.F5_places = [];
for(const [a,b] of [['New York','New Jersey'],['North Carolina','North Dakota'],['San Jose','San Antonio']]) {
  const count = news.clusterStories([post('a',a),post('b',b)]).length;
  assert.equal(count,2); out.controls.F5_places.push({a,b,count});
}
assert.equal(news.clusterStories([post('a','New York'),post('b','New York State')]).length,1);

// F6/F7: consumer math and SVG geometry over both negative and ordinary domains.
const changes = lib('changesHeadline.ts');
out.controls.F6_headlines = py.F6_price_cases.map(m=>changes.changesHeadline([m]));
assert.match(out.controls.F6_headlines[0], /rose \$20.00\/MWh/);
assert.match(out.controls.F6_headlines[2], /fell \$5.00\/MWh/);
const {HubMap} = comp('HubMap.tsx');
out.controls.F7_geometry = [[20,-5],[0,0],[-10,-5],[null,10]].map(values=>{
  const html=renderToStaticMarkup(React.createElement(HubMap,{hubs:values.map((avg30,i)=>({
    code:i?'caiso_sp15_da':'ice_pjm_west',label:'Fixture',avg30,avg30_yoy_pct:null}))}));
  const numbers=[...html.matchAll(/\b(?:r|cx|cy|x|y)="([^"]*)"/g)].map(m=>Number(m[1]));
  assert.ok(numbers.length); assert.ok(numbers.every(Number.isFinite));
  return {values,finite:true,circles:(html.match(/<circle/g)||[]).length};
});

// F8: independently compute the denominator-only contribution by holding the
// leg-end numerator constant. The original flat-denominator case must be neutral.
const outlook=lib('outlookHeadline.ts').outlookShape;
const forecast=[{month:'2026-10',central_yoy_pct:3},{month:'2026-11',central_yoy_pct:2}];
out.controls.F8_base_effects=[];
for(const [a0,a1,a2,expected] of [[100,100,100,false],[100,101,100,false],[100,99.8,100,false],[100,99,100,true]]) {
  const monthly={'2025-09':a0,'2025-10':a1,'2025-11':a2};
  const result=outlook('2026-09',2,forecast,monthly);
  const numerator1=1.03*a1, numerator2=1.02*a2;
  const up=(numerator1/a1-numerator1/a0)*100;
  const down=(numerator2/a2-numerator2/a1)*100;
  assert.equal(result.baseNote.startsWith('Much of the hump'),expected);
  out.controls.F8_base_effects.push({monthly,up,down,note:result.baseNote});
}

// F9/F10: neutral annotation and same-month arithmetic.
const colPage=fs.readFileSync(path.join(site,'src/app/cost-of-living/page.tsx'),'utf8');
assert.match(colPage,/label: "cost-of-living jump"/);
assert.doesNotMatch(colPage,/label: "rate-driven jump"/);
out.controls.F9_marker='cost-of-living jump';
const since=lib('escalationSince.ts');
const monthly={key:'fixture',label:'Fixture',group:'test',source:'test',months:['2026-08','2026-09'],values:[100,102]};
const same=since.sinceRow(monthly,'2026-09',1000000);
assert.equal(same.changePct,0);assert.equal(same.escalated,1000000);assert.equal(same.annualizedPct,null);
assert.equal(since.sinceRow(monthly,'2026-10',1000000),null);
out.controls.F10_same_month=same;

// F12: single-target weighted legend is fixed; two simultaneous modes share one legend.
const {ForecasterDots,ensembleLabel}=comp('ForecasterDots.tsx');
const modes=py.F12_real_producer_modes;
const calls=[{name:'Macrogauge',value:0.1},{name:'Cleveland',value:0.4}];
const rows=[{label:'CPI',...modes.headline},{label:'Core CPI',...modes.core}].map(x=>({
  label:x.label,ensemble:x.value,weights:x.weights,forecasters:calls}));
const mixed=renderToStaticMarkup(React.createElement(ForecasterDots,{rows}));
assert.equal(ensembleLabel([modes.headline.weights]),'ensemble, weighted by past accuracy');
assert.equal(ensembleLabel([modes.core.weights]),'equal-weight ensemble');
assert.equal((mixed.match(/ensemble, weighted by past accuracy/g)||[]).length,1);
assert.ok(!mixed.includes('equal-weight'));
out.controls.F12_single_target_labels={weighted:ensembleLabel([modes.headline.weights]),equal:ensembleLabel([modes.core.weights])};
out.remaining.F12_mixed_legend={rows,shared_legend:ensembleLabel(rows.map(x=>x.weights)),
  core_value:0.25,core_if_accuracy_weighted:0.16};

// Inspect the actual calculator server component's props; no imitation roster.
const Calculator=require(path.join(site,'src/app/calculator/page.tsx')).default;
function findNode(node,predicate) {
  if(!node || typeof node!=='object')return null;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const hit=findNode(child,predicate);if(hit)return hit;}
  return null;
}
const picker=findNode(Calculator(),n=>n.props?.series&&n.props?.defaultPicks);
assert.ok(picker);
const dc=json('datacenter');
out.controls.F2_hardware=dc.indexes.hardware.components.map(c=>{
  const offered=picker.props.series.find(s=>s.key===c.code);assert.ok(offered);
  const row=since.sinceRow(offered,picker.props.defaultSince,1000000);assert.ok(row);
  assert.ok(offered.months.at(-1)<=c.last_obs.slice(0,7));
  return {code:c.code,last_month:offered.months.at(-1),last_obs:c.last_obs,changePct:row.changePct};
});

// F13: capture the rendered chart option with recorded replay data, stubbing
// only transport and the canvas boundary; the component and arithmetic run.
let captured=[];
const replay=json('replay'), originalLoad=Module._load;
Module._load=function(name,parent,...rest){
  const resolved=Module._resolveFilename(name,parent);
  if(resolved===path.join(site,'src/lib/useJson.ts'))return {useJson:()=>({data:replay,failed:false})};
  if(resolved===path.join(site,'src/components/EChart.tsx'))return {EChart:p=>{captured.push(p);return null;}};
  return originalLoad.call(this,name,parent,...rest);
};
const {MyInflationClient}=comp('MyInflationClient.tsx');
renderToStaticMarkup(React.createElement(MyInflationClient,{compareMonths:replay.dates.slice(-2),compareGauge:[2,2],
  gaugeYoy:2,gaugeAsOf:replay.dates.at(-1),states:[]}));
const gap=captured.find(p=>p.ariaTitle?.includes('percentage points'));
assert.ok(gap);assert.equal(gap.option.yAxis.axisLabel.formatter,'{value}pp');
assert.match(gap.option.tooltip.valueFormatter(1.2),/pp$/);
out.controls.F13_gap_units={axis:gap.option.yAxis.axisLabel.formatter,tooltip:gap.option.tooltip.valueFormatter(1.2)};
console.log(JSON.stringify(out,null,2));
