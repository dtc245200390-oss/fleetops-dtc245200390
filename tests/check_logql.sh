#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
BASE=${1:-https://localhost}
echo '[LogQL smoke] Sinh các sự kiện đăng nhập thất bại trên host demo'
./scripts/attack-sim.sh "$BASE"
echo '[LogQL smoke] Kiểm tra Promtail chuyển log Nginx và webapp đến Loki'
docker compose exec -T webapp node - <<'JS'
const queries = [
  {name:'Đăng nhập sai trong log ứng dụng', q:'{job="webapp"} |= "LOGIN_FAILED"'},
  {name:'POST /api/login trong log Nginx', q:'{job="nginx"} |= "POST /api/login"'}
];
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function queryRange(q) {
  const begin=(BigInt(Date.now()-10*60*1000)*1000000n).toString();
  const end=(BigInt(Date.now())*1000000n).toString();
  const url='http://loki:3100/loki/api/v1/query_range?query='+encodeURIComponent(q)
    +'&start='+begin+'&end='+end+'&limit=200';
  const r=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw new Error('Loki HTTP '+r.status);
  const j=await r.json();
  if(j.status!=='success')throw new Error('Loki query error');
  return (j.data?.result||[]).flatMap(x=>(x.values||[]).map(v=>v[1]));
}
(async()=>{
  for (const query of queries) {
    let count=0, err='';
    for(let i=0;i<30;i++){
      try {count=(await queryRange(query.q)).length;if(count>0)break;}
      catch(e){err=e.message;}
      await wait(3000);
    }
    if(count===0)throw new Error('Không tìm thấy '+query.name+(err?' / '+err:''));
    console.log('PASS: '+query.name+' ('+count+' log)');
  }
  let received=false;
  for (let i=0;i<40;i++){
    try {
      const lines=await queryRange('{job="webapp"} |= "ALERT_RECEIVED"');
      if(lines.some(l=>l.includes('status=firing')&&l.includes('Brute-force'))){
        received=true;
        console.log('PASS: Grafana Alerting -> webhook -> webapp ALERT_RECEIVED');
        break;
      }
    }catch(e){console.error('Đợi webhook: '+e.message);}
    await wait(3000);
  }
  if(!received)throw new Error('Không thấy webhook Firing brute-force sau 120 giây');
})().catch(e=>{console.error(e);process.exit(1)});
JS
