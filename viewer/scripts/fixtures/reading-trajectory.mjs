// A small authored test graph, independent of the optional example library.
// It covers routine work, a rejected candidate, a rebased fix and later evidence.
export function readingTrajectory(){
 const ladder=(topic,takeaway,reason)=>({topic,takeaway,...(reason?{reason}:{})});
 const entity=(id,title,events,more={})=>({id,title,summary:title,events,...more});
 const action=(id,title,event,state,branch,more={})=>entity(id,title,[event],{
  state,branch,behavior:'Explore',outcome:'observed',t_min:Number(event.split('E')[1]),
  ladder:ladder(title,`${title} records a distinct step.`),...more,
 });
 const timeline=[
  ['user','Repair the comparator while preserving sorted order.'],
  ['call','{"command":"read comparator"}'],
  ['result','The comparator uses a string conversion.'],
  ['message','Read the input format.'],
  ['message','Read the empty-list behavior.'],
  ['message','Read the duplicate-item behavior.'],
  ['thinking','First measure the existing comparator.'],
  ['result','Comparator profiling identifies repeated string conversion.'],
  ['result','A trial caches converted keys.'],
  ['result','The cached key becomes stale after an item changes.'],
  ['thinking','Use a direct numeric comparator after the failed cache trial.'],
  ['call','{"command":"apply direct numeric comparator"}'],
  ['result','The numeric comparator patch is applied.'],
  ['result','LATER_RESULT: sorted order is preserved on the final check.'],
 ].map(([kind,text],i)=>({id:`main:E${i+1}`,session_id:'main',kind,text,t_min:i,
  ...([1,2].includes(i)?{tool:'read',call_id:'read-1'}:{}),
  ...([11,12].includes(i)?{tool:'edit',call_id:'edit-1'}:{}),
 }));
 return {
  format:'coding-agent-state-trajectory',version:1,title:'Comparator repair fixture',scope:'comparator implementation',notes:[],
  states:[
   entity('s-base','Original comparator',['main:E1'],{snapshot:{code:'original'},ladder:ladder('Original','Original comparator repeats conversion.')}),
   entity('s-trial','Cached comparator',['main:E9'],{snapshot:{code:'cached'},ladder:ladder('Cached','Cached comparator keeps stale values.'),lineage:{parent:'s-base',relation:'derived',reason:'Trial adds a key cache.',events:['main:E9']}}),
   entity('s-final','Numeric comparator',['main:E13'],{snapshot:{code:'numeric'},ladder:ladder('Numeric','Numeric comparator avoids conversion.'),lineage:{parent:'s-base',relation:'derived',reason:'Restart from the original comparator after rejecting the cache.',events:['main:E10','main:E13']}}),
  ],
  branches:[
   entity('b-investigate','Inspect the comparator',['main:E1'],{state:'s-base',status:'attempted',move:'open',ladder:ladder('Inspection','Inspection finds repeated conversions.')}),
   entity('b-reject','Check the cached candidate',['main:E10'],{state:'s-trial',status:'rejected',move:'ruleout',ladder:ladder('Cache check','Cache check exposes stale keys.')}),
   entity('b-fix','Repair the comparison',['main:E11'],{state:'s-trial',status:'retained',ladder:ladder('Repair','Repair uses the original numeric values.')}),
   entity('b-check','Check the final patch',['main:E14'],{state:'s-final',status:'retained',ladder:ladder('Final check','Final check confirms the required order.')}),
  ],
  actions:[
   action('a-read','Read the comparator','main:E2','s-base','b-investigate',{events:['main:E2','main:E3']}),
   ...[4,5,6].map((n,i)=>action(`a-routine-${i}`,`Inspect input case ${i+1}`,`main:E${n}`,'s-base','b-investigate')),
   action('a-plan','Plan a measurement','main:E7','s-base','b-investigate',{behavior:'Plan',move:'decision'}),
   action('a-observe','Locate conversion cost','main:E8','s-base','b-investigate',{behavior:'Verify',move:'insight',ladder:{...ladder('Profile','Profile locates the conversion cost.'),abstract:[{event:'main:E8',quote:'repeated string conversion'}]}}),
   action('a-trial','Try a key cache','main:E9','s-base','b-investigate',{behavior:'Edit',outcome:'success'}),
   action('a-reject','Reject stale keys','main:E10','s-trial','b-reject',{behavior:'Verify',move:'ruleout'}),
   action('a-decide','Choose direct comparison','main:E11','s-trial','b-fix',{behavior:'Plan',move:'decision'}),
   action('a-fix','Apply numeric comparison','main:E12','s-trial','b-fix',{events:['main:E12','main:E13'],behavior:'Edit',outcome:'success'}),
   action('a-check','Check sorted order','main:E14','s-final','b-check',{behavior:'Verify'}),
  ],
  links:[{source:'a-observe',target:'a-decide',kind:'informs',evidence:'Repeated conversion motivates direct comparison.',events:['main:E8','main:E11']}],
  transitions:[
   {source:'s-base',target:'s-trial',action:'a-trial',label:'Add key cache',changes:[{component:'code',before:'original',after:'cached'}]},
   {source:'s-trial',target:'s-final',action:'a-fix',label:'Replace cache with direct comparison',changes:[{component:'code',before:'cached',after:'numeric'}]},
  ],
  journey:{text:'The run rejects a stale key cache and keeps a direct numeric comparator.',cites:['a-reject','a-fix','a-check']},
  timeline:{timeline,sources:[]},
 };
}
