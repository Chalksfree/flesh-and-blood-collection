/* Super Cal pure functions: usable in browser and Node/Bun tests. */
(function (root) {
  'use strict';
  const TYPES=['bill','birthday','anniversary','medication','wake_alarm','reminder','event','goal','goal_checkpoint','note'];
  const isoDate=d=>{ const x=d instanceof Date?d:new Date(d+'T12:00:00'); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
  const localDate=s=>{ const [y,m,d]=String(s).slice(0,10).split('-').map(Number); return new Date(y,m-1,d,12); };
  const addDays=(s,n)=>{const d=localDate(s);d.setDate(d.getDate()+n);return isoDate(d)};
  const dayDiff=(a,b)=>Math.round((localDate(b)-localDate(a))/86400000);
  const monthDiff=(a,b)=>{const x=localDate(a),y=localDate(b);return (y.getFullYear()-x.getFullYear())*12+y.getMonth()-x.getMonth()};
  const weekday=s=>localDate(s).getDay();
  const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s))&&!Number.isNaN(localDate(s).valueOf())&&isoDate(localDate(s))===s;
  function nthWeekday(year, month, wd, nth) { // month 0-based, nth 1..5 or -1
    const last=new Date(year,month+1,0).getDate();
    if(nth===-1){for(let d=last;d>0;d--)if(new Date(year,month,d,12).getDay()===wd)return d;}
    let seen=0;for(let d=1;d<=last;d++){if(new Date(year,month,d,12).getDay()===wd&&++seen===nth)return d;}
    return -1;
  }
  function baseMatches(item,date){
    if(!validDate(date)||date<item.date)return false;
    const r=item.recurrence||{frequency:'once'};
    if(r.paused|| (r.endDate&&date>r.endDate))return false;
    const interval=Math.max(1,Number(r.interval)||1), days=dayDiff(item.date,date), months=monthDiff(item.date,date), start=localDate(item.date), d=localDate(date);
    let yes=false;
    switch(r.frequency||'once'){
      case 'once':yes=date===item.date;break;
      case 'daily':yes=days%interval===0;break;
      case 'weekdays': yes=(Math.floor(days/7)%interval===0)&&(r.weekdays||[]).map(Number).includes(weekday(date));break;
      case 'weekly':yes=days%7===0&&(Math.floor(days/7)%interval===0);break;
      case 'biweekly':yes=days%14===0;break;
      case 'monthly_date':yes=d.getDate()===start.getDate()&&months%interval===0;break;
      case 'monthly_pattern':{const n=Number(r.nth||1),wd=Number(r.weekday??weekday(item.date));yes=months%interval===0&&d.getDate()===nthWeekday(d.getFullYear(),d.getMonth(),wd,n);break;}
      case 'yearly':yes=d.getMonth()===start.getMonth()&&d.getDate()===start.getDate()&&(d.getFullYear()-start.getFullYear())%interval===0;break;
      case 'custom':{const unit=r.customUnit||'days'; if(unit==='days')yes=days%interval===0;else if(unit==='weeks')yes=days%(7*interval)===0;else if(unit==='months')yes=d.getDate()===start.getDate()&&months%interval===0;else yes=d.getMonth()===start.getMonth()&&d.getDate()===start.getDate()&&(d.getFullYear()-start.getFullYear())%interval===0;break;}
      default:yes=date===item.date;
    }
    if(!yes)return false;
    if(r.maxOccurrences){let count=0,cur=item.date;while(cur<=date&&count<=Number(r.maxOccurrences)){if(baseMatches({...item,recurrence:{...r,maxOccurrences:null}},cur))count++;cur=addDays(cur,1)}if(count>Number(r.maxOccurrences))return false;}
    return !(r.excludedDates||[]).includes(date);
  }
  function occursOn(item,date){return !item.deletedAt&&!item.archivedAt&&baseMatches(item,date)}
  function datesInRange(item,start,end){let out=[];for(let d=start;d<=end;d=addDays(d,1))if(occursOn(item,d))out.push(d);return out;}
  function permission(actor,view,item){
    if(!actor||!view)return {view:false,create:false,edit:false,delete:false};
    const self=actor.id===view.id; const parent=actor.role==='parent'&&view.parentId===actor.id;
    const canView=self||parent;
    if(!item)return {view:canView,create:canView,edit:false,delete:false};
    const own=item.ownerId===actor.id;
    const sent=item.sentById===actor.id&&item.ownerId===view.id;
    const protectedChildItem=parent&&!sent;
    return {view:canView,create:canView,edit:canView&&(own||sent)&&!protectedChildItem,delete:canView&&(own||sent)&&!protectedChildItem};
  }
  function itemText(item){return [item.title,item.description,item.notes,item.category,item.type,item.person,item.account,item.amount,item.relationship,item.date].filter(Boolean).join(' ').toLowerCase();}
  function searchItems(items,q,filters={},profiles=[]){const term=(q||'').trim().toLowerCase();return items.filter(i=>{
    if(filters.includeDeleted?false:(i.deletedAt||i.archivedAt))return false;
    if(term&&!itemText(i).includes(term))return false;
    if(filters.type&&filters.type!=='all'&&i.type!==filters.type)return false;
    if(filters.status&&filters.status!=='all'&&((i.statusByDate&&Object.values(i.statusByDate).some(x=>x.status===filters.status))?false:i.status!==filters.status))return false;
    if(filters.profile&&filters.profile!=='all'&&i.ownerId!==filters.profile)return false;
    if(filters.from&&i.date<filters.from)return false;if(filters.to&&i.date>filters.to)return false;return true;
  }).sort((a,b)=>a.date.localeCompare(b.date));}
  function validateSnapshot(x){
    if(!x||typeof x!=='object'||x.version!==1||!Array.isArray(x.items)||!Array.isArray(x.profiles)||!Array.isArray(x.history))return {ok:false,error:'Expected Super Cal backup version 1 with items, profiles, and history arrays.'};
    if(x.items.length>50000||x.history.length>250000)return {ok:false,error:'Backup exceeds safe record limits.'};
    const ids=new Set();for(const i of x.items){if(!i||typeof i!=='object'||typeof i.id!=='string'||ids.has(i.id)||!TYPES.includes(i.type)||typeof i.title!=='string'||i.title.length>300||!validDate(i.date)||(['description','notes','category','person','account','amount'].some(k=>i[k]!==undefined&&typeof i[k]!=='string'))||(i.color!==undefined&&i.color!==''&&!/^#[0-9A-Fa-f]{6}$/.test(i.color)))return {ok:false,error:'An item is malformed, duplicated, or has an invalid date/type.'};ids.add(i.id);if(i.recurrence&&typeof i.recurrence!=='object')return {ok:false,error:'An item recurrence is malformed.'};}
    const p=new Set();for(const pr of x.profiles){if(!pr||typeof pr.id!=='string'||!pr.id||p.has(pr.id)||typeof pr.name!=='string')return {ok:false,error:'A profile is malformed.'};p.add(pr.id)}
    return {ok:true};
  }
  const syncTime=x=>{const t=Date.parse(String(x||''));return Number.isFinite(t)?t:0;};
  function dedupePending(pending){const byId=new Map();for(const entry of Array.isArray(pending)?pending:[]){if(!entry||typeof entry.id!=='string'||!entry.id)continue;const prior=byId.get(entry.id);if(!prior||syncTime(entry.at)>=syncTime(prior.at))byId.set(entry.id,{id:entry.id,at:entry.at||new Date().toISOString()});}return [...byId.values()].sort((a,b)=>a.at.localeCompare(b.at));}
  function toCalendarRow(item,ownerProfileId,timeZone){if(!item||typeof item!=='object'||!TYPES.includes(item.type)||typeof item.id!=='string'||!validDate(item.date))throw Error('This local item cannot be synchronized because its type, ID, or date is invalid.');const client={...item,serverId:item.serverId||item.id,ownerId:undefined,createdById:undefined,sentById:undefined};delete client.ownerId;delete client.createdById;delete client.sentById;return {id:item.serverId||item.id,owner_profile_id:ownerProfileId,created_by_profile_id:ownerProfileId,sent_by_profile_id:null,item_type:item.type,title:String(item.title||'').trim(),description:String(item.description||''),notes:String(item.notes||''),category:item.category?String(item.category):null,color:/^#[0-9A-Fa-f]{6}$/.test(item.color||'')?item.color:null,priority:Math.max(0,Math.min(5,Number(item.priority)||0)),start_date:item.date,start_at:null,end_at:null,all_day:!item.time,time_zone:timeZone||'UTC',notification_settings:item.notification&&typeof item.notification==='object'?item.notification:{},type_data:{client_item:client},deleted_at:item.deletedAt||null,archived_at:item.archivedAt||null};}
  function fromCalendarRow(row,localOwnerId){const source=row&&row.type_data&&row.type_data.client_item;if(!source||typeof source!=='object'||typeof source.id!=='string'||!source.id||!TYPES.includes(source.type)||typeof source.title!=='string'||!validDate(source.date))return null;const item={...source,serverId:row.id,ownerId:localOwnerId,createdById:localOwnerId,sentById:null,type:source.type||row.item_type,title:source.title,updatedAt:syncTime(row.updated_at)>syncTime(source.updatedAt)?row.updated_at:(source.updatedAt||row.updated_at||new Date().toISOString())};if(row.deleted_at)item.deletedAt=row.deleted_at;else delete item.deletedAt;if(row.archived_at)item.archivedAt=row.archived_at;else delete item.archivedAt;return item;}
  function mergeSyncItem(local,remote){if(!local)return {item:remote,source:'remote'};if(!remote)return {item:local,source:'local'};const lt=syncTime(local.updatedAt),rt=syncTime(remote.updatedAt);return rt>lt?{item:remote,source:'remote'}:{item:local,source:'local'};}
  function mergeSyncRows(localItems,rows,localOwnerId){const local=new Map((localItems||[]).map(x=>[x.id,x]));const replacedIds=[],remoteIds=new Set();for(const row of rows||[]){const remote=fromCalendarRow(row,localOwnerId);if(!remote)continue;remoteIds.add(remote.id);const result=mergeSyncItem(local.get(remote.id),remote);local.set(remote.id,result.item);if(result.source==='remote')replacedIds.push(remote.id);}return {items:[...local.values()],replacedIds,remoteIds:[...remoteIds]};}
  const api={TYPES,isoDate,localDate,addDays,validDate,occursOn,datesInRange,permission,searchItems,validateSnapshot,dedupePending,toCalendarRow,fromCalendarRow,mergeSyncItem,mergeSyncRows};
  root.SuperCalCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
