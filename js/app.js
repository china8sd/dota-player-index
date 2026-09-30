const API='https://api.opendota.com/api';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const avg=(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const fmt=(x,d=0)=>x==null||!Number.isFinite(x)?'—':x.toFixed(d);
function accountFrom(v){
  const s=String(v||'').trim();
  // Steam profile URL: Steam64 must be handled as BigInt because it exceeds JS safe integer range.
  let m=s.match(/steamcommunity\.com\/profiles\/(\d+)/i);
  if(m) return steam64ToAccount(m[1]);
  // Direct numeric Steam64 or OpenDota account_id.
  if(/^\d+$/.test(s)) return steam64ToAccount(s);
  return null;
}
function steam64ToAccount(v){
  try{
    const x=BigInt(String(v));
    const base=76561197960265728n;
    if(x<=0n) return null;
    // Steam64 IDs are above the Steam base; smaller numeric values are already OpenDota account IDs.
    return x>base ? String(x-base) : String(x);
  }catch(e){
    return null;
  }
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
const DPI_CACHE_TTL=5*60*1000;
const DPI_MEM_CACHE=new Map();
function cacheKey(path){return 'dpi-api-cache-'+path}
function readApiCache(path){
  const now=Date.now();
  const mem=DPI_MEM_CACHE.get(path);
  if(mem && now-mem.t<DPI_CACHE_TTL) return mem.v;
  try{
    const raw=sessionStorage.getItem(cacheKey(path));
    if(raw){const x=JSON.parse(raw);if(x&&x.t&&now-x.t<DPI_CACHE_TTL){DPI_MEM_CACHE.set(path,{t:x.t,v:x.v});return x.v}}
  }catch(e){}
  return null;
}
function writeApiCache(path,v){
  const x={t:Date.now(),v}; DPI_MEM_CACHE.set(path,{t:x.t,v});
  try{sessionStorage.setItem(cacheKey(path),JSON.stringify(x))}catch(e){}
}
async function get(path, attempt=0, opts={}){
  const useCache=opts.cache!==false;
  if(useCache){const cached=readApiCache(path);if(cached!==null)return cached;}
  const maxAttempts=5;
  try{
    const r=await fetch(API+path,{cache:'no-store'});
    if(r.ok){const v=await r.json();if(useCache)writeApiCache(path,v);return v;}
    if((r.status===429 || r.status>=500) && attempt<maxAttempts-1){
      const retryHeader=Number(r.headers.get('Retry-After'));
      const wait=Number.isFinite(retryHeader)&&retryHeader>0?Math.min(15000,retryHeader*1000):Math.min(15000,1800*Math.pow(2,attempt));
      await sleep(wait);
      return get(path,attempt+1,opts);
    }
    throw new Error('OpenDota HTTP '+r.status);
  }catch(e){
    if(attempt<maxAttempts-1 && /Failed to fetch|NetworkError|Load failed/i.test(String(e?.message||e))){
      await sleep(Math.min(10000,1800*Math.pow(2,attempt)));
      return get(path,attempt+1,opts);
    }
    throw e;
  }
}
async function getCompareMatch(matchId){
  const path='/matches/'+matchId;
  const cached=readApiCache(path);
  if(cached!==null)return cached;
  return get(path,0,{cache:true});
}
function win(m,id){if(m?.radiant_win==null||m?.player_slot==null)return false;return m.player_slot<128 ? !!m.radiant_win : !m.radiant_win}
function metric(arr,key){
  const vals=arr.map(x=>Number(x?.[key])).filter(Number.isFinite);
  return avg(vals);
}
function rate(arr,key){
  let total=0,mins=0,count=0;
  arr.forEach(x=>{
    const v=Number(x?.[key]), sec=Number(x?.duration);
    if(Number.isFinite(v)&&v>=0&&Number.isFinite(sec)&&sec>0){total+=v;mins+=sec/60;count++}
  });
  return mins>0?total/mins:null;
}
function countValid(arr,key){return arr.filter(x=>Number.isFinite(Number(x?.[key]))).length}
function perMin(x,mins){return mins>0?x/mins:null}
function roleInfoFrom(ms){
  // Role Detector v6 — последние 50 игр, позиционная классификация.
  // Здесь нет отдельной системы "сигналов" для пользователя: каждая игра
  // получает одну из пяти позиций, после чего берётся распределение по 50 играм.
  const labels={1:'Керри',2:'Мид',3:'Оффлейн',4:'Софт-саппорт',5:'Хард-саппорт'};
  const keys=[1,2,3,4,5];
  const counts={1:0,2:0,3:0,4:0,5:0};
  const laneCounts={safe:0,mid:0,off:0,jungle:0,unknown:0};
  const valid=(ms||[]).filter(Boolean).slice(0,50);
  if(!valid.length) return {primary:'Смешанная роль',secondary:'',counts,laneCounts,sorted:[],total:0,confidence:0,confidenceLabel:'нет данных',rawScores:{}};

  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const finite=v=>Number.isFinite(Number(v))?Number(v):0;
  const teamRank=(m,key)=>{
    const v=finite(m?.[key]);
    const r=finite(m?.['_teamRank_'+key]);
    return r>0?r:.5;
  };

  const classify=(m)=>{
    const lane=Number(m?.lane_role);
    const roam=!!m?.is_roaming;
    const g=teamRank(m,'gold_per_min');
    const x=teamRank(m,'xp_per_min');
    const lh=teamRank(m,'last_hits');
    const wards=clamp((finite(m?.obs_placed)+finite(m?.sen_placed))/3);
    const a=finite(m?.assists);
    const heroRoles=Array.isArray(m?.__heroRoles)?m.__heroRoles:[];
    const heroSupport=heroRoles.includes('Support');
    const heroCarry=heroRoles.includes('Carry');

    // Относительное место игрока среди своей команды важнее абсолютного GPM/XPM.
    // Это позволяет отличать pos1 от pos5 даже на одной Safe Lane.
    const coreRank=clamp(g*.45+x*.25+lh*.30);
    const supportRank=clamp((1-g)*.38+(1-lh)*.30+wards*.20+Math.min(1,a/12)*.12);

    let role=0;
    if(lane===2){
      // Mid lane сама по себе уже задаёт позицию: статистика лишь отсеивает
      // редкие случаи, когда игрок фактически выполнял support/roaming роль.
      role=(roam || (supportRank>.72 && coreRank<.42))?4:2;
      laneCounts.mid++;
    }else if(lane===1){
      // Safe lane: высокий относительный фарм -> pos1, низкий -> pos5.
      // Герой используется только как небольшой tie-breaker.
      if(coreRank>=.56 || (coreRank>=.48 && heroCarry && !heroSupport)) role=1;
      else role=5;
      laneCounts.safe++;
    }else if(lane===3){
      // Off lane: core -> pos3, support/roaming -> pos4.
      if(roam || (supportRank>=.60 && coreRank<.52)) role=4;
      else role=3;
      laneCounts.off++;
    }else if(roam){
      role=4;
      laneCounts.jungle++;
    }else if(lane===4){
      // Jungle/unknown lane: используем фактическое место в команде.
      role=coreRank>=.55?3:4;
      laneCounts.jungle++;
    }else{
      laneCounts.unknown++;
      if(coreRank>=.70 || (coreRank>=.55 && heroCarry && !heroSupport)) role=1;
      else if(coreRank>=.52) role=3;
      else role=5;
    }
    return {role,coreRank,supportRank,lane};
  };

  const rows=valid.map(classify);
  rows.forEach(r=>{if(r.role)counts[r.role]++});
  const total=valid.length;
  const sorted=keys.slice().sort((a,b)=>counts[b]-counts[a]||a-b);
  const top=sorted[0], second=sorted[1];
  const gap=counts[top]-counts[second];
  const close=counts[second]>=Math.max(5,Math.round(total*.20)) && gap<=Math.max(3,Math.round(total*.12));
  const secondary=close?labels[second]:'';
  const topRatio=counts[top]/Math.max(1,total);
  const confidence=Math.max(0,Math.min(96,Math.round(52+topRatio*35+(gap/Math.max(1,total))*20-(secondary?12:0))));
  const confidenceLabel=confidence>=78?'высокая':confidence>=62?'средняя':'низкая';
  const rawScores={}; keys.forEach(k=>rawScores[k]=counts[k]);

  return {primary:labels[top],secondary,counts,laneCounts,sorted,total,confidence,confidenceLabel,rawScores};
}
function roleKeyFrom(ms){
  const info=roleInfoFrom(ms);
  const map={'Керри':1,'Мид':2,'Оффлейн':3,'Софт-саппорт':4,'Хард-саппорт':5};
  return map[info.primary]||0;
}
function roleFrom(ms){ return roleInfoFrom(ms).primary; }
function roleAsset(label){
  const map={'Керри':'role-carry.png','Мид':'role-mid.png','Оффлейн':'role-offlane.png','Софт-саппорт':'role-soft.png','Хард-саппорт':'role-hard.png'};
  return map[label]||'';
}
function roleBreakdownHtml(ms){
  const info=roleInfoFrom(ms);
  if(!info.total)return '';
  const icon=roleAsset(info.primary);
  return `<div class="roleMain"><div class="roleMainText">${icon?`<img class="roleMainIcon" src="assets/${icon}" alt="">`:''}<b>${esc(info.primary)}</b></div><button class="roleOtherBtn" onclick="openRoleList()">Остальные роли</button></div><div class="sub roleConfidence">Определение: ${esc(info.confidenceLabel)} · ${Math.round(info.confidence)}%</div>`;
}
function confidence(count){
  if(count<1)return ['нет данных',''];
  if(count<5)return ['очень маленькая выборка',''];
  if(count<20)return ['предварительный анализ',''];
  if(count<50)return ['нормальная выборка',''];
  return ['уверенный анализ',''];
}
function stdev(vals){
  const a=vals.filter(Number.isFinite); if(a.length<2)return null;
  const m=avg(a); return Math.sqrt(avg(a.map(v=>(v-m)*(v-m))));
}
function calc(ms){
  const games=ms.length;
  const gpm=metric(ms,'gold_per_min'),xpm=metric(ms,'xp_per_min');
  const deaths=metric(ms,'deaths'), kills=metric(ms,'kills'), assists=metric(ms,'assists');
  const lhmin=rate(ms,'last_hits'), hdm=rate(ms,'hero_damage'), tdm=rate(ms,'tower_damage');
  const tf=metric(ms,'teamfight_participation');
  const ka=avg(ms.map(x=>n(x.kills)+n(x.assists)));
  const wr=games?ms.filter(x=>win(x)).length/games*100:null;
  const deathStd=stdev(ms.map(x=>Number(x?.deaths)).filter(Number.isFinite));
  const clamp=v=>Math.max(0,Math.min(100,Number.isFinite(v)?v:50));
  const score=(value,low,high)=>Number.isFinite(value)?clamp((value-low)/(high-low)*100):null;
  const mix=(parts)=>{const a=parts.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
  const farm=mix([score(gpm,300,700),score(lhmin,2,8),score(xpm,300,700)]);
  const fight=mix([score(hdm,150,650),score(ka,2,12),score(tf,0.20,0.70)]);
  const survival=score(deaths,10,2);
  const map=mix([score(xpm,300,700),score(lhmin,2,8)]);
  const objectives=score(tdm,0,180);
  const tempo=mix([score(gpm,300,700),score(ka,2,12),score(tf,0.20,0.70)]);
  const consistency=mix([score(wr,35,65),score(deathStd,4,1)]);
  const axes={farm,fight,survival,map,objectives,tempo,consistency};
  const axisValues=Object.values(axes).filter(Number.isFinite);
  // Never turn missing data into a fake zero. If some zones are unavailable, average the zones we actually have.
  const index=axisValues.length?Math.round(avg(axisValues)*10):null;
  return {games,w:ms.filter(x=>win(x)).length,wr,gpm,xpm,deaths,kills,assists,kda:ka,lhmin,hdm,tdm,tf,axes,index,
    valid:{gpm:countValid(ms,'gold_per_min'),xpm:countValid(ms,'xp_per_min'),hero:countValid(ms,'hero_damage'),tower:countValid(ms,'tower_damage'),lh:countValid(ms,'last_hits')}};
}
function dna(c,roleLabel){
  const a=c.axes;
  const role=roleLabel||'Смешанная роль';
  const templates={
    'Керри':[[a.farm>=78&&a.survival>=65,'RESOURCE CARRY','Сильная экономика и хорошее сохранение ресурсов. Ты раскрываешься через фарм и поздние тайминги.'],[a.tempo>=72&&a.fight>=72,'TEMPO CARRY','Ты не ждёшь лейта: быстро набираешь ресурсы и стараешься конвертировать их в драки.'],[a.fight>=75&&a.objectives>=65,'FIGHTING CARRY','Твой керри-стиль строится вокруг раннего участия и давления после полученного преимущества.'],[a.survival>=78&&a.consistency>=75,'SAFE CARRY','Ты играешь через сохранение жизни и стабильное наращивание преимущества.'],[a.farm>=70,'SCALING CARRY','Главный ресурс твоей игры — экономика. Тебе важно не терять темп фарма между ключевыми действиями.'],[true,'BALANCED CARRY','Смешанный керри-профиль: ты распределяешь внимание между экономикой, драками и безопасностью.']],
    'Мид':[[a.tempo>=78&&a.fight>=75,'TEMPO MID','Ты создаёшь преимущество через ранний темп, драки и постоянное давление на карту.'],[a.farm>=78&&a.tempo>=68,'FARMING MID','Сильная экономика позволяет тебе играть через быстрые ключевые предметы и тайминги.'],[a.fight>=80,'DUELIST MID','Твоя главная сила — участие в драках и создание преимущества через индивидуальную активность.'],[a.objectives>=72&&a.map>=70,'MAP CONTROL MID','Ты хорошо переводишь своё преимущество в давление по карте и объекты.'],[a.survival>=78&&a.consistency>=75,'STABLE MID','Ты сохраняешь жизнь и результативность, предпочитая надёжное развитие вместо постоянного риска.'],[true,'FLEX MID','Мид-профиль смешанный: у тебя нет одной доминирующей модели игры.']],
    'Оффлейн':[[a.objectives>=76&&a.fight>=72,'SPACE CREATOR','Ты хорошо превращаешь присутствие на карте в драки и давление на объекты.'],[a.fight>=78&&a.survival>=68,'FRONTLINE INITIATOR','Твой стиль — начинать важные драки и создавать пространство для команды.'],[a.tempo>=76&&a.map>=70,'TEMPO OFFLANER','Ты силён, когда быстро двигаешь игру вперёд и не позволяешь сопернику спокойно фармить.'],[a.survival>=78&&a.objectives>=70,'ANCHOR OFFLANER','Ты стабильно держишь пространство и сохраняешь ценность после начала драки.'],[a.fight>=72&&a.objectives>=72,'TEAMFIGHT OFFLANER','Твоя основная ценность раскрывается через командные сражения и последующие объекты.'],[true,'UTILITY OFFLANER','Ты играешь от пользы для команды: создаёшь пространство, участвуешь в драках и помогаешь закрывать карту.']],
    'Софт-саппорт':[[a.fight>=78&&a.tempo>=72,'TEMPO SUPPORT','Ты создаёшь раннее давление через активность, ганги и участие в драках.'],[a.map>=78&&a.tempo>=70,'ROAMING SUPPORT','Твоя сила — движение по карте и создание ситуаций для союзников.'],[a.objectives>=75&&a.consistency>=70,'MAP SUPPORT','Ты хорошо превращаешь выигранные ситуации в контроль карты и объекты.'],[a.fight>=75,'FIGHTING SUPPORT','Ты максимально полезен в командных сражениях и часто влияешь на их исход.'],[a.survival>=78&&a.consistency>=75,'STABLE SUPPORT','Ты редко отдаёшь лишние смерти и сохраняешь полезность на протяжении игры.'],[true,'PLAYMAKER SUPPORT','Твой стиль строится вокруг создания возможностей для команды и своевременного участия.']],
    'Хард-саппорт':[[a.map>=78&&a.consistency>=72,'VISION SUPPORT','Ты создаёшь ценность через карту, информацию и стабильное присутствие рядом с командой.'],[a.fight>=78&&a.survival>=72,'TEAMFIGHT SUPPORT','Твоя главная сила — правильное участие в командных сражениях и сохранение полезности.'],[a.tempo>=76&&a.map>=70,'TEMPO SUPPORT','Ты влияешь на игру через раннее движение, помощь линиям и давление на карту.'],[a.objectives>=72&&a.consistency>=75,'OBJECTIVE SUPPORT','Ты хорошо поддерживаешь переход от выигранной ситуации к контролю карты и объектам.'],[a.survival>=80,'STABLE HARD SUPPORT','Ты хорошо сохраняешь жизнь и продолжаешь приносить пользу даже в сложных играх.'],[true,'UTILITY SUPPORT','Твой профиль строится вокруг стабильной помощи команде, карты и своевременных действий.']]
  };
  const list=templates[role]||[[a.fight>=78&&a.farm>=75,'FIGHTING CORE','Сильная комбинация экономики и боевой активности.'],[a.survival>=78&&a.consistency>=75,'STABLE PLAYER','Ты играешь стабильно и редко отдаёшь результат через лишние смерти.'],[a.tempo>=75,'TEMPO PLAYER','Ты предпочитаешь быстро переводить преимущество в следующие действия.'],[true,'FLEXIBLE PLAYER','Профиль смешанный: нет одной модели, которая полностью описывает твою игру.']];
  const hit=list.find(x=>x[0])||list[list.length-1];
  return [hit[1],`${role}: ${hit[2]}`];
}
function stage(ms,lo,hi){
  const x=ms.filter(m=>{const t=n(m.duration)/60;return t>=lo&&(hi==null||t<hi)});
  if(!x.length)return null;
  return calc(x);
}
function whyIndex(c){
  const entries=[
    ['Фарм',c.axes.farm,`GPM ${fmt(c.gpm,0)}, LH/min ${fmt(c.lhmin,1)}`],
    ['Драки',c.axes.fight,`Hero Damage/min ${fmt(c.hdm,0)}, K+A ${fmt(c.kda,1)}`],
    ['Выживаемость',c.axes.survival,`смерти ${fmt(c.deaths,1)} за игру`],
    ['Карта',c.axes.map,`LH/min ${fmt(c.lhmin,1)}, XPM ${fmt(c.xpm,0)}`],
    ['Объекты',c.axes.objectives,`Tower Damage/min ${fmt(c.tdm,0)}`],
    ['Темп',c.axes.tempo,`K+A ${fmt(c.kda,1)}, teamfight ${fmt(c.tf*100,0)}%`],
    ['Стабильность',c.axes.consistency,`смерти ${fmt(c.deaths,1)} за игру`]
  ];
  return entries.sort((a,b)=>b[1]-a[1]);
}
function mainProblem(c){
  const entries=whyIndex(c);
  const low=entries[entries.length-1];
  if(low[0]==='Объекты')return ['Конвертация преимущества',`Tower Damage/min ${fmt(c.tdm,0)}. После выигранных действий стоит чаще переводить давление в башни и другие цели.`];
  if(low[0]==='Выживаемость')return ['Выживаемость',`${fmt(c.deaths,1)} смертей за игру. Смерти сильнее всего уменьшают твой индекс в текущей выборке.`];
  if(low[0]==='Карта')return ['Экономика карты',`LH/min ${fmt(c.lhmin,1)} и XPM ${fmt(c.xpm,0)}. Есть пространство для более стабильного получения ресурсов.`];
  return [low[0],`Текущий показатель ${Math.round(low[1]??0)}/100 — это самая слабая зона среди семи осей.`];
}
function rankLabel(tier){
  const raw=String(tier??'').trim();
  const x=Number(raw.replace(/[^0-9.-]/g,''));
  if(!Number.isFinite(x)||x<10)return 'Ранг не определён';
  const medals={1:'Herald',2:'Guardian',3:'Crusader',4:'Archon',5:'Legend',6:'Ancient',7:'Divine',8:'Immortal'};
  const medal=Math.floor(x/10),star=x%10;
  return medal===8?'Immortal':`${medals[medal]||'Ранг'} ${star||''}`.trim();
}
function rankAsset(tier){
  const raw=String(tier??'').trim();
  const x=Number(raw.replace(/[^0-9.-]/g,''));
  if(!Number.isFinite(x)||x<10)return '';
  const names=['','herald','guardian','crusader','archon','legend','ancient','divine','immortal'];
  const medal=Math.floor(x/10);
  return names[medal]?`assets/rank-${names[medal]}.png?v=413`:'';
}
function heroImage(h){
  const raw=h?.img||h?.icon||'';
  if(!raw)return '';
  if(/^https?:\/\//i.test(raw))return raw;
  return 'https://cdn.cloudflare.steamstatic.com'+raw;
}
function dnaHeroCard(h){
  const positive=Number(h.winrate)>=50;
  const wins=Math.round((h.games||0)*(Number(h.winrate||0)/100));
  const losses=Math.max(0,(h.games||0)-wins);
  const img=heroImage(h);
  return `<div class="dnaHero ${positive?'positive':'negative'}">
    ${img?`<img src="${esc(img)}" alt="${esc(h.name)}" loading="lazy" onerror="this.style.visibility='hidden'">`:`<div class="heroVisual">⚔️</div>`}
    <div>
      <div class="dnaHeroName">${esc(h.name)}</div>
      <div class="dnaHeroMeta">${wins} побед · ${losses} поражений · ${fmt(h.winrate,1)}% WR</div>
    </div>
  </div>`;
}
function heroCard(h){
  const img=heroImage(h);
  return `<div class="heroCard">
    <div class="heroVisual">${img?`<img src="${esc(img)}" alt="${esc(h.name)}" loading="lazy" onerror="this.parentElement.innerHTML='⚔️'">`:'⚔️'}</div>
    <div class="heroBody">
      <div class="heroTitle">${esc(h.name)}</div>
      <div class="heroMeta">${h.games} игр · ${fmt(h.winrate,1)}% WR</div>
      <div class="stageStat"><span>${fmt(h.gpm,0)} GPM</span><span>${fmt(h.dmg,0)} DMG/min</span></div>
    </div>
  </div>`;
}
function experimentMissions(c,ms){
  const wins=ms.filter(win), losses=ms.filter(x=>!win(x));
  const metricPair=(key)=>{const w=metric(wins,key),l=metric(losses,key);return [w,l,Number.isFinite(w)&&Number.isFinite(l)?w-l:null]};
  const ratePair=(key)=>{const w=rate(wins,key),l=rate(losses,key);return [w,l,Number.isFinite(w)&&Number.isFinite(l)?w-l:null]};
  const tf=metricPair('teamfight_participation'), deaths=metricPair('deaths'), gpm=metricPair('gold_per_min'), xpm=metricPair('xp_per_min');
  const heroD=ratePair('hero_damage'), towerD=ratePair('tower_damage');
  const pool=[];
  const targetDown=(cur,w)=>Number.isFinite(w)?Math.max(0,w+0.3):Math.max(2,(cur||7)-1);
  const targetUp=(cur,w)=>Number.isFinite(w)?Math.round(w):Math.round((cur||500)*1.05);
  if(Number.isFinite(deaths[2])&&deaths[2]>0.6) pool.push({title:'Снизить смерти',stat:`Сейчас ${deaths[0]?.toFixed(1)??'—'} в победах против ${deaths[1]?.toFixed(1)??'—'} в поражениях`,goal:`Ориентир: ≤ ${targetDown(c.deaths,deaths[0]).toFixed(1)} смертей за игру`,advice:'После 15-й минуты не бери драку ради одной цели: сначала проверь союзников, вижен и ключевые cooldown.'});
  if(Number.isFinite(gpm[2])&&gpm[2]<-20) pool.push({title:'Не терять экономику',stat:`Сейчас GPM ${fmt(c.gpm,0)}; в победах ${fmt(gpm[0],0)}`,goal:`Ориентир: ${targetUp(c.gpm,gpm[0])}+ GPM`,advice:'После каждой драки заранее выбери следующую безопасную волну или лагерь — не оставляй 1–2 минуты пустого времени.'});
  if(Number.isFinite(xpm[2])&&xpm[2]<-20) pool.push({title:'Держать XP-темп',stat:`Сейчас XPM ${fmt(c.xpm,0)}; в победах ${fmt(xpm[0],0)}`,goal:`Ориентир: ${targetUp(c.xpm,xpm[0])}+ XPM`,advice:'После перемещения по карте ищи ближайший гарантированный источник XP вместо долгого ожидания следующей драки.'});
  if(Number.isFinite(heroD[2])&&heroD[2]<-25) pool.push({title:'Давать больше урона в решающих драках',stat:`Hero Damage/min ${fmt(heroD[0],0)} в победах против ${fmt(heroD[1],0)} в поражениях`,goal:`Ориентир: приблизиться к ${fmt(heroD[0],0)} DMG/min`,advice:'Перед дракой выбери одну приоритетную цель и не трать первые секунды на случайный урон по ближайшему герою.'});
  if(Number.isFinite(tf[2])&&tf[2]<-0.06) pool.push({title:'Приходить вовремя в драки',stat:`Участие ${fmt(tf[0]*100,0)}% в победах против ${fmt(tf[1]*100,0)}% в поражениях`,goal:`Ориентир: ${fmt(tf[0]*100-3,0)}%+ участия`,advice:'После ключевого предмета или ультимейта двигайся к следующей точке конфликта заранее, а не реагируй на уже начавшуюся драку.'});
  if(Number.isFinite(towerD[2])&&towerD[2]<-10) pool.push({title:'Конвертировать преимущество в объекты',stat:`Tower Damage/min ${fmt(towerD[0],0)} в победах против ${fmt(towerD[1],0)} в поражениях`,goal:`Ориентир: приблизиться к ${fmt(towerD[0],0)}+`,advice:'После выигранной драки сначала проверь башню, Рошана или контроль территории — и только потом возвращайся за дополнительным фармом.'});
  if(c.axes.farm<50) pool.push({title:'Поднять ресурсную базу',stat:`Фарм-зона ${Math.round(c.axes.farm)}/100 · GPM ${fmt(c.gpm,0)} · LH/min ${fmt(c.lhmin,1)}`,goal:`Ориентир: +5–10% к GPM без роста смертей`,advice:'Сократи пустые перемещения между линиями и лесом: каждое перемещение должно давать волну, лагерь, kill или объект.'});
  if(c.axes.survival<50) pool.push({title:'Сохранить уже заработанное',stat:`Выживаемость ${Math.round(c.axes.survival)}/100 · ${fmt(c.deaths,1)} смертей`,goal:`Ориентир: хотя бы на 1 смерть меньше`,advice:'Если у команды уже есть преимущество, не обменивай жизнь на сомнительный kill или лишнюю пачку крипов.'});
  if(c.axes.objectives<50) pool.push({title:'Закрывать карту объектами',stat:`Объекты ${Math.round(c.axes.objectives)}/100 · Tower Damage/min ${fmt(c.tdm,0)}`,goal:`Ориентир: поднять Tower Damage/min на 10–15%`,advice:'После каждого выигранного teamfight задавай один вопрос: какой объект мы забираем прямо сейчас?' });
  if(c.axes.tempo<50) pool.push({title:'Всегда иметь следующее действие',stat:`Темп ${Math.round(c.axes.tempo)}/100 · K+A ${fmt(c.kda,1)}`,goal:'Ориентир: меньше пустых минут между действиями',advice:'После каждого крупного события заранее выбирай одно из четырёх: фарм, smoke, tower или Roshan.'});
  const fallback=[
    {title:'Закрепить сильную сторону',stat:`Твой Player Index ${fmt(c.index,0)}/1000`,goal:'Не просесть по ключевым метрикам за 10 игр',advice:'Не меняй стиль полностью. Сохрани то, что уже работает, и убери один повторяющийся провал.'},
    {title:'Проверять следующий шаг после преимущества',stat:`WR последних ${c.games} игр ${fmt(c.wr,1)}%`,goal:'После выигранной ситуации чаще получать следующий объект или ресурс',advice:'После каждой победной драки мысленно назови следующий конкретный объект, прежде чем возвращаться фармить.'},
    {title:'Собрать новую базу',stat:`Сейчас: GPM ${fmt(c.gpm,0)} · XPM ${fmt(c.xpm,0)} · deaths ${fmt(c.deaths,1)}`,goal:'10 игр без резкого провала по одной из трёх метрик',advice:'После десятой игры сравним новые цифры с этой базой, а не с ощущениями.'}
  ];
  const chosen=[],used=new Set();
  for(const item of pool){if(chosen.length>=3)break;if(!used.has(item.title)){chosen.push(item);used.add(item.title)}}
  for(const item of fallback){if(chosen.length>=3)break;if(!used.has(item.title)){chosen.push(item);used.add(item.title)}}
  return chosen.map(x=>[x.title,x.stat,x.goal,x.advice]);
}

function renderIndexTriangle(c){
  const A=Number.isFinite(c.axes.farm)?c.axes.farm:50;
  const B=Number.isFinite(c.axes.fight)?c.axes.fight:50;
  const C=Number.isFinite(c.axes.survival)?c.axes.survival:50;
  const R=100, cx=150, topY=38, leftX=30, rightX=270, bottomY=205;
  const point=(v,tx,ty)=>{const k=Math.max(0,Math.min(1,v/100));return [cx+(tx-cx)*k,topY+(ty-topY)*k]};
  const pA=point(A,cx,topY),pB=point(B,leftX,bottomY),pC=point(C,rightX,bottomY);
  const poly=[pA,pB,pC].map(p=>p.join(',')).join(' ');
  const resource=Math.round(avg([c.axes.farm,c.axes.map,c.axes.tempo].filter(Number.isFinite))||50);
  const battle=Math.round(avg([c.axes.fight,c.axes.objectives,c.axes.tempo].filter(Number.isFinite))||50);
  const safe=Math.round(avg([c.axes.survival,c.axes.consistency].filter(Number.isFinite))||50);

  return `<div class="indexTriangleWrap">
    <div class="triangleVisual">
      <svg class="indexTriangle" viewBox="0 0 300 230" aria-label="Профиль игрока в виде треугольника">
        <polygon class="grid" points="150,38 30,205 270,205"></polygon>
        <polygon class="grid" points="150,83 90,174 210,174"></polygon>
        <polygon class="grid" points="150,144 130,174 170,174"></polygon>
        <polygon class="playerShape" points="${poly}"></polygon>
      </svg>
      <div class="triLabel triTop">ФАРМ<small>${Math.round(A)}/100</small></div>
      <div class="triLabel triLeft">ДРАКИ<small>${Math.round(B)}/100</small></div>
      <div class="triLabel triRight">ВЫЖИВАЕМОСТЬ<small>${Math.round(C)}/100</small></div>
    </div>

  </div>`;
}

function lossProblemCard(ms){
  const a=lossAnalysis(ms), drivers=a.drivers||[];
  const wins=a.wins||[], losses=a.losses||[];
  const allSignals=(a.rows||[]).filter(r=>Number.isFinite(r[1])&&Number.isFinite(r[2])).map(r=>{
    const d=r[1]-r[2], bad=r[0]==='Deaths'?d>0:d<0;
    const gap=Math.abs(d)/Math.max(Math.abs(r[1]),Math.abs(r[2]),1);
    const winVals=wins.map(m=>r[0]==='GPM'?n(m.gold_per_min):r[0]==='XPM'?n(m.xp_per_min):r[0]==='Hero Damage/min'?rate([m],'hero_damage'):r[0]==='Tower Damage/min'?rate([m],'tower_damage'):r[0]==='K+A'?(n(m.kills)+n(m.assists)):r[0]==='Teamfight'?n(m.teamfight_participation):n(m.deaths)).filter(Number.isFinite);
    const lossVals=losses.map(m=>r[0]==='GPM'?n(m.gold_per_min):r[0]==='XPM'?n(m.xp_per_min):r[0]==='Hero Damage/min'?rate([m],'hero_damage'):r[0]==='Tower Damage/min'?rate([m],'tower_damage'):r[0]==='K+A'?(n(m.kills)+n(m.assists)):r[0]==='Teamfight'?n(m.teamfight_participation):n(m.deaths)).filter(Number.isFinite);
    const benchmark=winVals.length?winVals.reduce((x,y)=>x+y,0)/winVals.length:null;
    const repeated=benchmark!=null&&lossVals.length?lossVals.filter(v=>r[0]==='Deaths'?v>benchmark:v<benchmark).length/lossVals.length:0;
    // Не обнуляем сигнал только потому, что побед и поражений не по 10+.
    // Надёжность растёт с размером меньшей группы, но даже 1–2 поражения
    // дают небольшой, честный сигнал, если разница действительно заметна.
    const minSample=Math.min(wins.length,losses.length);
    const sampleFactor=minSample<=0?0:Math.min(1,Math.sqrt(minSample/5));
    const rawStrength=(gap*100*0.55+repeated*100*0.45)*sampleFactor;
    const strength=Math.round(Math.min(100,Math.max(0,rawStrength)));
    return {...r,d,bad,gap,repeated,strength};
  }).filter(r=>r.bad).sort((x,y)=>y.strength-x.strength||y.impact-x.impact);

  const top=allSignals.slice(0,3);
  const strongest=top[0];
  const overallStrength=Math.round(top.length?Math.max(...top.map(x=>x.strength*([1,.72,.5][top.indexOf(x)]||.5))):0);
  const bar=(v)=>'█'.repeat(Math.round(v/10))+'░'.repeat(10-Math.round(v/10));
  const label=(v)=>v>=75?'сильный сигнал':v>=50?'заметный сигнал':v>=30?'слабый сигнал':'очень слабый сигнал';

  if(!top.length){
    return {title:'Нет устойчивого сигнала',state:'Нет устойчивого сигнала',text:'Победы и поражения сейчас слишком близки по доступным метрикам. Не будем придумывать виноватую цифру — лучше проверить следующую выборку.',evidence:[],strength:0,strengthBar:bar(0),strengthLabel:'нет сигнала',repeatability:0};
  }

  if(top.length===1 || top[0].strength>=75){
    const r=strongest,w=r[1],l=r[2];
    const map={
      'Deaths':`В поражениях ты умираешь чаще: ${fmt(l,1)} против ${fmt(w,1)} в победах. Это самый устойчивый сигнал в выборке — сначала ищи повторяющиеся смерти, после которых команда теряет темп.`,
      'GPM':`В поражениях GPM ниже: ${fmt(l,0)} против ${fmt(w,0)}. Сигнал указывает на потерю ресурсного темпа: проверь, где после действий остаёшься без безопасного фарма.`,
      'XPM':`В поражениях XPM ниже: ${fmt(l,0)} против ${fmt(w,0)}. Проверь моменты, когда после перемещений или драк слишком долго остаёшься без гарантированного опыта.`,
      'Hero Damage/min':`В поражениях Hero Damage/min ниже: ${fmt(l,0)} против ${fmt(w,0)}. Это повод проверить своевременность участия и качество ключевых драк.`,
      'Tower Damage/min':`В поражениях Tower Damage/min ниже: ${fmt(l,0)} против ${fmt(w,0)}. Проверь конвертацию выигранных ситуаций в башни и другие объекты.`,
      'K+A':`В поражениях K+A ниже: ${fmt(l,1)} против ${fmt(w,1)}. Проверь, не теряешь ли ты моменты, где после преимущества можно было принять более результативное участие.`,
      'Teamfight':`В поражениях участие в драках ниже: ${fmt(l,0)}% против ${fmt(w,0)}%. Проверь, не подключаешься ли ты к ключевым сражениям слишком поздно.`
    };
    return {title:`${r[0]} — ${label(r.strength)}`,state:'Один сильный сигнал',text:map[r[0]]||`Самое заметное отличие — ${r[0]}. В победах ${fmt(w,r[3])}, в поражениях ${fmt(l,r[3])}.`,evidence:[`${r[0]} · WIN ${fmt(w,r[3])} · LOSS ${fmt(l,r[3])}`,`В ${Math.round(r.repeated*100)}% поражений показатель хуже среднего побед`],strength:r.strength,strengthBar:bar(r.strength),strengthLabel:label(r.strength),repeatability:Math.round(r.repeated*100)};
  }

  return {title:'Несколько заметных сигналов',state:'Несколько заметных сигналов',text:'Одной цифры, которая объясняет поражения, сейчас нет. Зато есть несколько повторяющихся отличий — их стоит проверять вместе, а не назначать одну из них единственной причиной.',evidence:top.map(r=>`${r[0]} · WIN ${fmt(r[1],r[3])} · LOSS ${fmt(r[2],r[3])} · ${Math.round(r.repeated*100)}% поражений`),strength:overallStrength,strengthBar:bar(overallStrength),strengthLabel:label(overallStrength),repeatability:Math.round((top.reduce((s,r)=>s+r.repeated,0)/top.length)*100)};
}
function stageSignal(ms){
  const overall=calc(ms);
  const rows=[[0,10],[10,20],[20,30],[30,null]].map(([lo,hi])=>{
    const games=ms.filter(m=>{const t=n(m.duration)/60;return t>=lo&&(hi==null||t<hi)});
    const wins=games.filter(win);
    return {label:`${lo}–${hi??'+'} мин`,games:games.length,wr:games.length?wins.length/games.length*100:null,gpm:metric(games,'gold_per_min')};
  });
  const valid=rows.filter(x=>x.games>=3&&Number.isFinite(x.wr));
  if(!valid.length) return {rows,headline:'Пока мало данных',text:'В каждом отрезке слишком мало матчей для честного вывода. Пока это ориентир, а не точная точка перелома.'};
  const worst=valid.slice().sort((a,b)=>a.wr-b.wr)[0];
  const delta=Number.isFinite(overall.wr)?worst.wr-overall.wr:null;
  return {rows,headline:`Самый слабый отрезок — ${worst.label}`,text:`В играх такой длительности твой WR ${fmt(worst.wr,0)}% (${worst.games} игр)${Number.isFinite(delta)?`, это ${delta>=0?'+':''}${fmt(delta,0)} п.п. к общему WR`:''}. Это ориентир по длительности матчей, а не точная минута события внутри игры.`};
}


function formSummary(ms){
  const games=ms.slice(0,20);
  const wins=games.filter(win).length;
  const total=games.length;
  const recent5=games.slice(0,5);
  const prev5=games.slice(5,10);
  const recent5Wins=recent5.filter(win).length;
  const prev5Wins=prev5.filter(win).length;
  const recent5Wr=recent5.length?recent5Wins/recent5.length*100:null;
  const prev5Wr=prev5.length?prev5Wins/prev5.length*100:null;
  let state='Стабильно';
  let stateClass='stable';
  let text=total?`${wins} побед из ${total} игр`:'Недостаточно данных';
  if(recent5.length>=4 && recent5Wins>=4){
    state='На подъёме'; stateClass='up'; text=`${recent5Wins} победы из последних ${recent5.length}`;
  } else if(recent5.length>=4 && recent5Wins<=1){
    state='Форма просела'; stateClass='down'; text=`${recent5Wins} победа из последних ${recent5.length}`;
  } else if(Number.isFinite(recent5Wr)&&Number.isFinite(prev5Wr)){
    const d=recent5Wr-prev5Wr;
    if(d>=20){state='На подъёме';stateClass='up';text=`последние 5 игр: ${recent5Wins}/${recent5.length} · до этого ${prev5Wins}/${prev5.length}`;}
    else if(d<=-20){state='Форма просела';stateClass='down';text=`последние 5 игр: ${recent5Wins}/${recent5.length} · до этого ${prev5Wins}/${prev5.length}`;}
  }
  return {wins,total,wr:total?wins/total*100:null,recent5Wins,recent5Total:recent5.length,prev5Wins,prev5Total:prev5.length,state,stateClass,text};
}

function renderFormChart(ms){
  const src=ms.slice(0,20).reverse();
  const vals=src.map((_,i)=>{
    const z=calc(src.slice(0,i+1));
    return Number.isFinite(z.index)?z.index:null;
  });
  const valid=vals.filter(Number.isFinite);
  if(!valid.length) return '<div class="g5-empty">Недостаточно данных для графика формы.</div>';
  const min=Math.max(0,Math.min(...valid)-10), max=Math.min(1000,Math.max(...valid)+10), span=Math.max(1,max-min);
  const pts=vals.map((v,i)=>{if(!Number.isFinite(v))return null;const x=18+(i/Math.max(1,vals.length-1))*364;const y=112-((v-min)/span)*88;return [x,y,v]}).filter(Boolean);
  const poly=pts.map(x=>x[0].toFixed(1)+','+x[1].toFixed(1)).join(' ');
  const circles=pts.map(x=>`<circle cx="${x[0].toFixed(1)}" cy="${x[1].toFixed(1)}" r="2.7" class="g5dot"><title>Player Index ${Math.round(x[2])}</title></circle>`).join('');
  return `<div class="g5chartWrap"><svg class="g5chart" viewBox="0 0 400 132" role="img" aria-label="Динамика Player Index за последние 20 игр"><line x1="18" y1="24" x2="382" y2="24" class="g5grid"></line><line x1="18" y1="68" x2="382" y2="68" class="g5grid"></line><line x1="18" y1="112" x2="382" y2="112" class="g5grid"></line><polyline points="${poly}" class="g5line"></polyline>${circles}</svg><div class="g5chartLabels"><span>20 игр назад</span><span>сейчас</span></div></div>`;
}

function renderForm(ms){
  const f=formSummary(ms);
  const wr=Number.isFinite(f.wr)?fmt(f.wr,0):'—';
  const trend=Number.isFinite(f.wr)?`${f.wins} побед · ${f.total-f.wins} поражений · ${wr}% WR`:'Пока мало матчей';
  return `<div class="g5formSummary">
    <div class="g5formMain">
      <div class="g5formStatus ${f.stateClass}"><span class="g5statusDot"></span>${esc(f.state)}</div>
      <div class="g5formRecord">${f.wins} <span>/ ${f.total}</span></div>
      <div class="g5formSub">${esc(f.text)}</div>
    </div>
    <div class="g5formWinrate"><b>${wr}%</b><span>WINRATE</span></div>
  </div>
  <div class="g5formTimeline">
    <div class="g5formTimelineHead"><span>РЕЗУЛЬТАТЫ ПО ИГРАМ</span><span>от старых → к последним</span></div>
    <div class="g5formDots">${ms.slice(0,20).reverse().map((m,i)=>`<button class="g5formDot ${win(m)?'win':'loss'}" title="${win(m)?'Победа':'Поражение'} · игра ${20-i}" aria-label="${win(m)?'Победа':'Поражение'} · игра ${20-i}"></button>`).join('')}</div>
    <div class="g5formLegend"><span><i class="win"></i> Победа</span><span><i class="loss"></i> Поражение</span></div>
  </div>
  <div class="g5formWindows">
    <div><span>ПОСЛЕДНИЕ 5</span><b>${f.recent5Wins} / ${f.recent5Total}</b></div>
    <div><span>ПОСЛЕДНИЕ 10</span><b>${ms.slice(0,10).filter(win).length} / ${Math.min(10,ms.length)}</b></div>
    <div><span>ПОСЛЕДНИЕ 20</span><b>${trend}</b></div>
  </div>
  ${renderFormChart(ms)}
  <div class="g5formHint">Форма показывает текущую динамику результатов. Это не прогноз следующей игры.</div>`;
}

function renderProgressCards(rc,pc){
  const items=[['Player Index',rc.index,pc.index,0],['GPM',rc.gpm,pc.gpm,0],['Hero Damage/min',rc.hdm,pc.hdm,0],['Tower Damage/min',rc.tdm,pc.tdm,0],['Deaths',rc.deaths,pc.deaths,1]];
  return items.map(([name,a,b,dec])=>{
    if(!Number.isFinite(a)||!Number.isFinite(b)) return `<div class="g5progressItem"><span>${name}</span><b>—</b><small>нет данных</small></div>`;
    const d=a-b, good=name==='Deaths'?d<0:d>0, pct=Math.abs(b)>0?(Math.abs(d)/Math.abs(b))*100:0;
    return `<div class="g5progressItem"><span>${name}</span><b class="${good?'up':'down'}">${fmt(a,dec)}</b><small class="${good?'up':'down'}">${d===0?'без изменений':`${good?'↑':'↓'} ${fmt(pct,1)}%`}</small></div>`;
  }).join('');
}

function renderDnaVisual(c,role,d){
  const vals=[['ФАРМ',c.axes.farm],['ДРАКИ',c.axes.fight],['ТЕМП',c.axes.tempo],['ОБЪЕКТЫ',c.axes.objectives],['ВЫЖИВАЕМОСТЬ',c.axes.survival]];
  return `<div class="g5dna"><div class="g5dnaCore"><div class="g5dnaRing"><span>${esc(d[0])}</span></div><div class="g5dnaRole">${esc(role)}</div></div><div class="g5dnaStats">${vals.map(([n,v])=>`<div><span>${n}</span><b>${Number.isFinite(v)?Math.round(v):'—'}</b><i><em style="width:${Math.max(0,Math.min(100,Number(v)||0))}%"></em></i></div>`).join('')}</div></div>`;
}


function analyticsUpgrade(c,ms,rc,pc,role,lossProb){
  const deltas={
    farm: Number.isFinite(rc?.gpm)&&Number.isFinite(pc?.gpm)&&pc.gpm?((rc.gpm-pc.gpm)/pc.gpm*100):null,
    fight: Number.isFinite(rc?.hdm)&&Number.isFinite(pc?.hdm)&&pc.hdm?((rc.hdm-pc.hdm)/pc.hdm*100):null,
    objectives: Number.isFinite(rc?.tdm)&&Number.isFinite(pc?.tdm)&&pc.tdm?((rc.tdm-pc.tdm)/pc.tdm*100):null,
    survival: Number.isFinite(rc?.deaths)&&Number.isFinite(pc?.deaths)&&pc.deaths?((pc.deaths-rc.deaths)/pc.deaths*100):null,
    tempo: Number.isFinite(rc?.kda)&&Number.isFinite(pc?.kda)&&pc.kda?((rc.kda-pc.kda)/pc.kda*100):null
  };
  const axisNames={farm:'Фарм',fight:'Драки',objectives:'Объекты',survival:'Выживаемость',tempo:'Темп',map:'Карта',consistency:'Стабильность'};
  const axes=Object.entries(c.axes||{}).filter(([,v])=>Number.isFinite(v)).sort((a,b)=>a[1]-b[1]);
  const weak=axes[0]||['consistency',50];
  const strong=axes[axes.length-1]||['farm',50];
  const trend=Object.entries(deltas).filter(([,v])=>Number.isFinite(v)).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const bestChange=trend.find(([,v])=>v>2), badChange=trend.find(([,v])=>v<-2);
  let levelTitle=axisNames[weak[0]]||'Стабильность';
  let levelText='Сделай эту зону главным фокусом следующих 10 игр. Не пытайся одновременно исправлять всё.';
  if(weak[0]==='survival') levelText=`Сейчас ${fmt(c.deaths,1)} смерти за игру. Главный резерв — сохранять уже созданное преимущество и реже отдавать темп после выигранных действий.`;
  else if(weak[0]==='objectives') levelText=`Tower Damage/min ${fmt(c.tdm,0)}. Следующий уровень — чаще превращать выигранные драки и свободное время в реальные объекты.`;
  else if(weak[0]==='farm') levelText=`GPM ${fmt(c.gpm,0)} и LH/min ${fmt(c.lhmin,1)}. Следующий уровень — удерживать экономический темп даже после неудачных перемещений.`;
  else if(weak[0]==='fight') levelText=`Hero Damage/min ${fmt(c.hdm,0)} и K+A ${fmt(c.kda,1)}. Следующий уровень — выбирать меньше драк, но с большей ценностью для команды.`;
  else if(weak[0]==='tempo') levelText=`K+A ${fmt(c.kda,1)} и teamfight ${fmt(c.tf*100,0)}%. Следующий уровень — быстрее соединять ресурсы с действиями на карте.`;
  let changeText='Пока нет достаточно устойчивого изменения между двумя двадцатками.';
  if(bestChange&&badChange) changeText=`Сильнее всего выросла зона ${axisNames[bestChange[0]]||bestChange[0]} (${bestChange[1]>=0?'+':''}${fmt(bestChange[1],1)}%), а просела ${axisNames[badChange[0]]||badChange[0]} (${fmt(badChange[1],1)}%).`;
  else if(bestChange) changeText=`Самое заметное улучшение — ${axisNames[bestChange[0]]||bestChange[0]}: ${bestChange[1]>=0?'+':''}${fmt(bestChange[1],1)}% к предыдущим 20 играм.`;
  else if(badChange) changeText=`Самое заметное ухудшение — ${axisNames[badChange[0]]||badChange[0]}: ${fmt(badChange[1],1)}% к предыдущим 20 играм.`;
  let summary='Твои цифры показывают смешанный профиль: одну главную причину поражений сейчас назначать нельзя.';
  if(lossProb?.state==='Один сильный сигнал') summary=`Есть один выраженный сигнал: ${lossProb.title.replace(/ — .*/,'')}. Именно его логичнее всего проверить в следующих играх.`;
  else if(lossProb?.state==='Несколько заметных сигналов') summary='Поражения отличаются сразу по нескольким зонам. Лучше проверить их связку, чем пытаться исправить одну цифру в отрыве от игры.';
  return {weakName:levelTitle,weakValue:Math.round(weak[1]),strongName:axisNames[strong[0]]||strong[0],strongValue:Math.round(strong[1]),levelText,changeText,summary};
}

function render(ms,p,heroes){
  const c=calc(ms), role=roleFrom(ms), roleInfo=roleInfoFrom(ms), d=dna(c,role), conf=confidence(c.games), prob=mainProblem(c), lossProb=lossProblemCard(ms), stageInfo=stageSignal(ms);
  const profile=p?.profile||p||{};
  const rank=rankLabel(p?.rank_tier);
  const recent=ms.slice(0,20), prev=ms.slice(20,40);
  const rc=calc(recent), pc=calc(prev);
  const upgrade=analyticsUpgrade(c,ms,rc,pc,role,lossProb);
  const idxDelta=(Number.isFinite(rc.index)&&Number.isFinite(pc.index))?rc.index-pc.index:null;
  const trendText=Number.isFinite(idxDelta)?`${idxDelta>=0?'↑':'↓'} ${Math.abs(idxDelta)} к прошлым 20 играм`:'новая база';
  const strongest=whyIndex(c)[0];
  const weak=whyIndex(c).at(-1);
  const heroPool=heroes.filter(h=>Number(h.games)>=2);
  const bestPool=heroPool.filter(h=>Number(h.winrate)>=50);
  const worstPool=heroPool.filter(h=>Number(h.winrate)<50);
  const heroSort=(a,b)=>Number(b.games)-Number(a.games)||Number(b.winrate||0)-Number(a.winrate||0);
  const worstSort=(a,b)=>Number(b.games)-Number(a.games)||Number(a.winrate||0)-Number(b.winrate||0);
  const bestHeroes=bestPool.slice().sort(heroSort).slice(0,5);
  const worstHeroes=worstPool.slice().sort(worstSort).slice(0,5);
  const stageRows=[[0,10],[10,20],[20,30],[30,null]].map(r=>{const z=stage(ms,r[0],r[1]);return {label:`${r[0]}–${r[1]??'+'} мин`,z}});
  const lossReason=(()=>{
    const wa=ms.filter(win),la=ms.filter(x=>!win(x));
    const pairs=[];
    const wd=metric(wa,'deaths'),ld=metric(la,'deaths'); if(Number.isFinite(wd)&&Number.isFinite(ld)&&ld-wd>0.6)pairs.push([ld-wd,'смертей в поражениях больше']);
    const wg=metric(wa,'gold_per_min'),lg=metric(la,'gold_per_min'); if(Number.isFinite(wg)&&Number.isFinite(lg)&&wg-lg>20)pairs.push([wg-lg,'GPM теряется в поражениях']);
    const wx=metric(wa,'xp_per_min'),lx=metric(la,'xp_per_min'); if(Number.isFinite(wx)&&Number.isFinite(lx)&&wx-lx>20)pairs.push([wx-lx,'XPM теряется в поражениях']);
    const wt=rate(wa,'tower_damage'),lt=rate(la,'tower_damage'); if(Number.isFinite(wt)&&Number.isFinite(lt)&&wt-lt>10)pairs.push([wt-lt,'меньше урона по башням']);
    const wh=rate(wa,'hero_damage'),lh=rate(la,'hero_damage'); if(Number.isFinite(wh)&&Number.isFinite(lh)&&wh-lh>25)pairs.push([wh-lh,'меньше урона по героям']);
    pairs.sort((a,b)=>b[0]-a[0]);
    return pairs[0]?.[1]||`самая слабая зона — ${weak[0].toLowerCase()}`;
  })();
  window.__dpiCurrent=c;
  window.__dpiProfile=profile;
  window.__dpiRole=role;
  window.__dpiPrevious=pc;
  window.__dpiRecent=rc;
  window.__dpiMatches=ms;
  window.__dpiHeroes=heroes;
  $('#app').innerHTML=`
  <div class="v4hero">
    <section class="card v4profile">
      <div class="v4headline">
        <img class="avatar" src="${esc(profile.avatarfull||profile.avatarmedium||profile.avatar||'')}" onerror="this.style.visibility='hidden'">
        <div><div class="rankIdentity">${rankAsset(p?.rank_tier)?`<img class="rankIcon" src="${rankAsset(p?.rank_tier)}" alt="${esc(rank)}">`:''}<div class="rankText"><div class="v4name">${esc(profile.personaname||profile.name||'Игрок Dota')}</div><div class="rank">${esc(rank)}</div></div></div>${roleBreakdownHtml(ms)}<div class="recent50Box"><div class="recent50Head"><span class="label">ПОСЛЕДНИЕ МАТЧИ</span><span class="value">${c.games} игр · ${fmt(c.wr,1)}% WR</span></div><div class="recent50Track"><div class="recent50Fill ${Number(c.wr)>=50?'good':'bad'}" style="width:${Math.max(0,Math.min(100,Number(c.wr)||0))}%"></div></div><div class="recent50Scale"><span>0%</span><span>50%</span><span>100%</span></div></div></div>
      </div>
      <div class="v4main"><h2>ТВОЙ СТИЛЬ</h2><div class="v4dna" onclick="openStyleInfo()" title="Нажми, чтобы узнать значение стиля">${esc(d[0])}</div><div class="styleHint">Нажми на стиль — покажем, что он означает</div><p class="sub">${esc(d[1])}</p>
        <div class="v4summary"><b>${esc(prob[0])}.</b> ${esc(prob[1])}</div>
        <div class="v4actions"><button class="btn" onclick="openWhy()">Почему такой Index?</button><button class="btn secondary" onclick="openRecent50Summary()">Сводка за последние 50 игр</button><button class="btn secondary" onclick="openWhyLose()">Почему я проигрываю?</button><button class="btn secondary" onclick="openRoleWhy()">Почему эта роль?</button><button class="btn secondary" onclick="document.getElementById('mission').scrollIntoView({behavior:'smooth'})">План на 10 игр</button></div>
        <div class="v4heroGroups">
          <div class="v4heroGroup"><div class="v4heroGroupTitle">ЛУЧШИЕ ГЕРОИ · МНОГО ИГР</div><div class="v4heroPool">${bestHeroes.map(h=>`<div class="v4heroPill">${heroImage(h)?`<img src="${esc(heroImage(h))}" alt="${esc(h.name)}">`:''}<div><b>${esc(h.name)}</b><span>${h.games} игр · ${fmt(h.winrate,1)}% WR${h.games<5?' · малая выборка':''}</span></div></div>`).join('')||'<span class="sub">Пока мало данных.</span>'}</div></div>
          <div class="v4heroGroup"><div class="v4heroGroupTitle bad">ХУДШИЕ ГЕРОИ · &lt;50% WR · МНОГО ИГР</div><div class="v4heroPool">${worstHeroes.map(h=>`<div class="v4heroPill bad">${heroImage(h)?`<img src="${esc(heroImage(h))}" alt="${esc(h.name)}">`:''}<div><b>${esc(h.name)}</b><span>${h.games} игр · ${fmt(h.winrate,1)}% WR${h.games<5?' · малая выборка':''}</span></div></div>`).join('')||'<span class="sub">Нет героев ниже 50% WR при доступной выборке.</span>'}</div></div>
        </div>
        <button class="btn secondary v4styleButton" onclick="document.getElementById('improvement').scrollIntoView({behavior:'smooth',block:'start'})">Ты стал лучше?</button>
      </div>
    </section>
    <section class="card v4index">
      ${bestHeroes[0]?`<div class="v4bestHeroTop">${heroImage(bestHeroes[0])?`<img src="${esc(heroImage(bestHeroes[0]))}" alt="${esc(bestHeroes[0].name)}">`:''}<div><div class="heroTopTitle">ТВОЙ ЛУЧШИЙ ГЕРОЙ ПО ИСТОРИИ RANKED</div><b>${esc(bestHeroes[0].name)}</b><span>${bestHeroes[0].games} игр · ${fmt(bestHeroes[0].winrate,1)}% WR</span></div></div>`:''}
      <div class="eyebrow">PLAYER INDEX</div>${(()=>{const score=Number.isFinite(c.index)?Math.max(0,Math.min(1000,c.index)):null;const pct=score!=null?Math.round(score/10):0;return `<div class="indexRing" style="--index-pct:${pct}%" aria-label="Player Index ${score!=null?score:'нет данных'} из 1000"><div class="indexRingInner"><div class="index">${score!=null?score:'—'}</div><span>/ 1000</span></div></div>`})()}<div class="trend">${esc(trendText)}</div><div class="sub">реальные показатели OpenDota</div>
      <div class="v4triangle">${renderIndexTriangle(c)}</div>
      <div class="v4indexStats v4indexStats6">
        <div class="v4indexStat"><div class="metricRoundIcon"><img class="metricIconImg" src="assets/icon-gpm.png" alt=""></div><b>${fmt(c.gpm,0)}</b><span>GPM · золото/мин</span></div>
        <div class="v4indexStat"><div class="metricRoundIcon"><img class="metricIconImg" src="assets/icon-xpm.png" alt=""></div><b>${fmt(c.xpm,0)}</b><span>XPM · опыт/мин</span></div>
        <div class="v4indexStat"><div class="metricRoundIcon"><img class="metricIconImg" src="assets/icon-lh.png" alt=""></div><b>${fmt(c.lhmin,1)}</b><span>Last Hits / min</span></div>
        <div class="v4indexStat"><div class="metricRoundIcon"><img class="metricIconImg" src="assets/icon-tower.png" alt=""></div><b>${fmt(c.tdm,0)}</b><span>Tower Damage / min</span></div>
        <div class="v4indexStat"><div class="metricRoundIcon"><img class="metricIconImg" src="assets/icon-hero.png" alt=""></div><b>${fmt(c.hdm,0)}</b><span>Hero Damage / min</span></div>
        <div class="v4indexStat"><div class="metricRoundIcon"><div class="metricEmoji">⚔</div></div><b>${fmt(c.kda,1)}</b><span>K+A · убийства + ассисты</span></div>
      </div>
      <div class="v4progress"><div class="v4progressHead"><span>ДИНАМИКА ЗА ПОСЛЕДНИЕ 20 ИГР</span><b>${Number.isFinite(idxDelta)?(idxDelta>=0?'+':'')+idxDelta:'—'}</b></div><div class="v4miniTrack"><i style="width:${Math.max(3,Math.min(100,(rc.index||50)/10))}%"></i></div></div><img class="v4compareImageBtn" src="assets/compare-player.png" alt="Сравнить с игроком" role="button" tabindex="0" onclick="openCompare()" onkeydown="if(event.key==='Enter'||event.key===' ')openCompare()">
    </section>
  </div>

  <section class="g5overview">
    <div class="g5overviewHead"><div><div class="g5kicker">PLAYER OVERVIEW</div><h2>ТВОЯ ИГРА — В ОДНОМ ЭКРАНЕ</h2><p>Сначала главное: форма, стиль и то, что изменилось.</p></div><div class="g5badge">${c.games} игр · ${fmt(c.wr,1)}% WR</div></div>
    <div class="g5overviewGrid">
      <section class="card g5panel g5form"><div class="g5panelHead"><div><span>ФОРМА</span><b>Последние 20 игр</b></div><strong>${Number.isFinite(idxDelta)?(idxDelta>=0?'+':'')+idxDelta:'—'}</strong></div>${renderForm(recent)}</section>
      <section class="card g5panel"><div class="g5panelHead"><div><span>ИГРОВАЯ ДНК</span><b>${esc(d[0])}</b></div><strong>${esc(role)}</strong></div>${renderDnaVisual(c,role,d)}</section>
    </div>
    <section class="card g5panel g5progress"><div class="g5panelHead"><div><span>ПРОГРЕСС</span><b>Сейчас против предыдущих 20</b></div><strong>${Number.isFinite(idxDelta)?(idxDelta>=0?'↑':'↓'):'—'}</strong></div><div class="g5progressGrid">${renderProgressCards(rc,pc)}</div></section>
  </section>

  <div class="v4insights">
    <section class="card v4insightCard">
      <div class="v4insightKicker">ГДЕ ТЕРЯЕТСЯ ИГРА</div>
      <div class="v4insightTitle">${esc(lossProb.title)}</div>
      <div class="v4insightState">${esc(lossProb.state||'')}</div>
      <div class="v4insightText">${esc(lossProb.text)}</div>
      <div class="v4insightEvidence">${lossProb.evidence.map((x,i)=>{const parts=x.split(' · ');return `<div class="v4evidence"><b>${esc(parts[0])}</b><span>${esc(parts.slice(1).join(' · '))}</span></div>`}).join('')}</div>
      <div class="v4signalBox"><div class="v4signalHead"><span>СИЛА СИГНАЛА</span><b>${lossProb.strength}%</b></div><div class="v4signalTrack"><i style="width:${lossProb.strength}%"></i></div><div class="v4signalBar">${lossProb.strengthBar} <span>${esc(lossProb.strengthLabel)}</span></div><div class="v4signalRepeat">Повторяемость: <b>${lossProb.repeatability}%</b> поражений с ухудшением относительно побед.</div></div>
      <div class="v4insightNote">Сигнал строится по разнице побед и поражений за последние ${c.games} игр. Это гипотеза для проверки, а не доказательство единственной причины поражения.</div>
    </section>
    <section class="card v4insightCard">
      <div class="v4insightKicker">ГДЕ НАЧИНАЕТСЯ ПРОБЛЕМА · ПРИБЛИЖЁННО</div>
      <div class="v4insightTitle">${esc(stageInfo.headline)}</div>
      <div class="v4insightText">${esc(stageInfo.text)}</div>
      <div class="v4stageBars">${stageInfo.rows.map(x=>`<div class="v4stageBar"><b>${esc(x.label)}</b><strong>${fmt(x.wr,0)}%</strong><span>${x.games} игр</span></div>`).join('')}</div>
      <div class="v4stageSignal"><b>Как читать этот блок</b><span>Мы группируем матчи по их длительности. OpenDota не даёт нам здесь точной временной точки внутри каждой игры, поэтому не выдаём это за «ты проигрываешь ровно на 24-й минуте».</span></div>
    </section>
  </div>

  <section class="card section"><h2>ТВОЯ ИГРА В ЧЕТЫРЁХ ЦИФРАХ</h2><p>Минимум статистики, максимум контекста.</p>
    <div class="v4cards">
      ${[['assets/icon-gpm.png','GPM',c.gpm,pc.gpm,0],['assets/icon-xpm.png','XPM',c.xpm,pc.xpm,0],['assets/icon-lh.png','LH/min',c.lhmin,pc.lhmin,1],['assets/icon-hero.png','Hero DMG/min',c.hdm,pc.hdm,0],['assets/icon-tower.png','Tower DMG/min',c.tdm,pc.tdm,0],['💀','Deaths',c.deaths,pc.deaths,1],['🤝','K+A',c.kda,pc.kda,1]].map(x=>{const d=Number.isFinite(x[2])&&Number.isFinite(x[3])?x[2]-x[3]:null;const good=x[1]==='Deaths'?(d!=null&&d<0):(d!=null&&d>0);const icon=String(x[0]).endsWith('.png')?`<img class="metricSmallIcon" src="${x[0]}" alt="">`:`<span class="metricSmallEmoji">${x[0]}</span>`;return `<div class="v4card">${icon}<div class="label">${x[1]}</div><div class="big">${fmt(x[2],x[4])}</div><div class="small">${x[1]==='Deaths'?'за игру':'реальный средний показатель'}</div>${d!=null?`<div class="delta ${good?'up':'down'}">${good?'↑':'↓'} ${Math.abs(d).toFixed(x[4])}</div>`:''}</div>`}).join('')}
    </div>
    <div class="v4proof">Сильнее всего сейчас: <strong>${esc(strongest[0])}</strong>. Слабее всего: <strong>${esc(weak[0])}</strong>.</div>
  </section>

  <section class="card section"><h2>КАК ТЫ ИГРАЕШЬ ПО ХОДУ МАТЧА</h2><p>Мы ищем не просто плохой показатель, а момент, когда начинается потеря результата.</p>
    <div class="v4stages">${stageRows.map(x=>`<div class="v4stage"><b>${x.label}</b><div class="wr">${x.z&&x.z.games?fmt(x.z.wr,0)+'%':'—'}</div><div class="sub">${x.z&&x.z.games?`${x.z.games} игр · GPM ${fmt(x.z.gpm,0)}`:'мало данных'}</div></div>`).join('')}</div>
    <div class="insight"><b>Где начинается проблема</b>${esc(prob[1])}</div>
  </section>

  <div class="v4two">
    <section class="card section"><h2>ПОЧЕМУ ТЫ ТЕРЯЕШЬ</h2><p>WIN против LOSS — только показатели, которые реально отличаются.</p>
      <table class="compare"><thead><tr><th>Метрика</th><th>WIN</th><th>LOSS</th></tr></thead><tbody>
      ${[['GPM','gold_per_min',0],['XPM','xp_per_min',0],['Hero DMG/min','hero_damage',0],['Tower DMG/min','tower_damage',0],['Deaths','deaths',1]].map(row=>{const wa=ms.filter(win),la=ms.filter(x=>!win(x));let w,l;if(row[1].includes('damage')){w=rate(wa,row[1]);l=rate(la,row[1])}else{w=metric(wa,row[1]);l=metric(la,row[1])}return `<tr><td>${row[0]}</td><td>${fmt(w,row[2])}</td><td>${fmt(l,row[2])}</td></tr>`}).join('')}</tbody></table>
      <div class="notice">Главная разница сейчас: ${esc(lossReason)}.</div>
    </section>
    <section class="card section"><h2>ТВОЯ САМАЯ ДОРОГАЯ ОШИБКА</h2><div class="v4problem"><div><div class="eyebrow">ГЛАВНЫЙ РИСК</div><div class="v4problemTitle">${esc(prob[0])}</div><div class="v4problemText">${esc(prob[1])}</div></div><div class="v4arrow">→</div></div><div class="actions"><button class="btn secondary" onclick="openWhy()">Посмотреть доказательства</button></div></section>
  </div>

  <section class="card section" id="mission"><h2>ПЛАН НА СЛЕДУЮЩИЕ 10 ИГР</h2><p>Не абстрактные советы: твоя текущая цифра → твой ориентир → конкретное действие.</p>
    <div class="v4experiment">
      <div class="v4goal"><div class="v4goalLabel">ГЛАВНАЯ ЗАДАЧА</div><div class="v4goalTitle">${esc(experimentMissions(c,ms)[0]?.[0]||'Закрепить сильную сторону')}</div><p>${esc(experimentMissions(c,ms)[0]?.[2]||'Собери ещё 10 игр и сравним базу.')}</p><div class="missionAdvice">${esc(experimentMissions(c,ms)[0]?.[3]||'Смотри на одну метрику, а не на всё сразу.')}</div></div>
      <div><div class="v4goalLabel">КОНТРОЛЬ</div><div class="v4goalTitle">10 матчей</div><p class="sub">После 10 игр сравним эти же показатели с текущей базой. Если цифра выросла без роста смертей — это хороший знак.</p></div>
    </div>
    <div class="planTitle">ТВОИ ЗАДАНИЯ</div>
    <div class="v4missions">${experimentMissions(c,ms).map((x,i)=>`<div class="v4mission"><div class="v4num">0${i+1}</div><div><b>${esc(x[0])}</b><div class="missionStat">Сейчас: ${esc(x[1])}</div><div class="missionStat"><span class="targetChip">Цель: ${esc(x[2])}</span></div><div class="missionAdvice">Совет: ${esc(x[3])}</div></div></div>`).join('')}</div>
  </section>

  <section class="card section" id="improvement"><h2>ТЫ СТАЛ ЛУЧШЕ?</h2><p>Последние 20 игр против предыдущих 20.</p>
    <table class="compare"><thead><tr><th>Метрика</th><th>Сейчас</th><th>Раньше</th></tr></thead><tbody>
    ${[['Player Index',rc.index,pc.index,0],['GPM',rc.gpm,pc.gpm,0],['XPM',rc.xpm,pc.xpm,0],['Hero DMG/min',rc.hdm,pc.hdm,0],['Deaths',rc.deaths,pc.deaths,1]].map(x=>`<tr><td>${x[0]}</td><td>${fmt(x[1],x[3])}</td><td>${fmt(x[2],x[3])}</td></tr>`).join('')}</tbody></table>
  </section>

  <section class="g5upgradeGrid">
    <section class="card g5upgradeCard">
      <div class="g5kicker">АНАЛИТИКА 2.0</div>
      <div class="g5upgradeHead"><div><h2>ТВОЙ СЛЕДУЮЩИЙ УРОВЕНЬ</h2><p>${esc(upgrade.levelText)}</p></div><strong>${upgrade.weakValue}<small>/100</small></strong></div>
      <div class="g5upgradeBar"><i style="width:${upgrade.weakValue}%"></i></div>
      <div class="g5upgradeMeta"><span>Зона роста: <b>${esc(upgrade.weakName)}</b></span><span>Сильная зона: <b>${esc(upgrade.strongName)} ${upgrade.strongValue}</b></span></div>
    </section>
    <section class="card g5upgradeCard">
      <div class="g5kicker">ЧТО ИЗМЕНИЛОСЬ</div>
      <h2>ПОСЛЕДНИЕ 20 ИГР</h2>
      <p>${esc(upgrade.changeText)}</p>
      <div class="g5upgradeSummary">${esc(upgrade.summary)}</div>
    </section>
  </section>

  <section class="card g5finalPanel">
    <div><div class="g5kicker">СЛЕДУЮЩИЙ ШАГ</div><h2>НЕ МЕНЯЙ ВСЁ СРАЗУ</h2><p>Фокус следующих 10 игр: <b>${esc(upgrade.weakName)}</b>. После новой выборки сравним результат с этой базой и проверим, исчез ли сигнал.</p></div>
    <button class="btn" onclick="document.getElementById('mission').scrollIntoView({behavior:'smooth',block:'start'})">Открыть план на 10 игр</button>
  </section>

  <div class="notice" style="text-align:center;padding:10px 0 24px">${esc(conf[0])} · анализ основан на реальных матчах OpenDota · отсутствие данных не считается нулём</div>`;
}

async function hydrateRecent50(accountId,baseMatches){
  const target=baseMatches.slice(0,50);
  const cacheKey='dpi-v417-full50-role-speed-'+accountId;
  try{
    const cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');
    if(Array.isArray(cached)&&cached.length) return cached;
  }catch(e){}
  const out=[];
  const progress=document.querySelector('#app');
  const batchSize=8;
  for(let start=0;start<target.length;start+=batchSize){
    const batch=target.slice(start,start+batchSize);
    if(progress){
      if(!document.querySelector('.loadingScreen')) progress.innerHTML=loadingMarkup('Загружаю матчи…','Быстрая загрузка: до 8 матчей одновременно.');
      updateLoading(start,target.length,`Быстрая загрузка · пакет ${Math.floor(start/batchSize)+1}…`);
    }
    const results=await Promise.all(batch.map(async base=>{
      try{
        const full=await get('/matches/'+base.match_id);
        const players=Array.isArray(full?.players)?full.players:[];
        const player=players.find(x=>String(x.account_id)===String(accountId))
          ||players.find(x=>Number(x.player_slot)===Number(base.player_slot));
        if(!player) return base;
        const team=players.filter(x=>(Number(x.player_slot)>=128)===(Number(player.player_slot)>=128));
        const rankOf=(key)=>{
          const vals=team.map(x=>Number(x?.[key])).filter(Number.isFinite).sort((a,b)=>a-b);
          const v=Number(player?.[key]);
          if(!vals.length||!Number.isFinite(v)) return .5;
          const idx=vals.findIndex(x=>x>=v);
          return (idx<0?vals.length-1:idx)/(Math.max(1,vals.length-1));
        };
        return {...base,...player,match_id:base.match_id,radiant_win:full.radiant_win,duration:full.duration||base.duration,
          _teamRank_gold_per_min:rankOf('gold_per_min'),_teamRank_xp_per_min:rankOf('xp_per_min'),_teamRank_last_hits:rankOf('last_hits')};
      }catch(e){return base;}
    }));
    out.push(...results);
    updateLoading(out.length,target.length,`Загружено ${out.length} из ${target.length} матчей`);
    if(start+batchSize<target.length) await sleep(150);
  }
  updateLoading(target.length,target.length,'Матчи загружены · считаю Player Index');
  try{sessionStorage.setItem(cacheKey,JSON.stringify(out));}catch(e){}
  return out;
}
function loadingMarkup(title='Анализирую матчи…',sub='Загружаю реальные данные OpenDota.'){return `<div class="loadingScreen"><div class="loadingPanel"><div class="loadingEyebrow">DOTA PLAYER INDEX</div><div class="loadingTitle">${esc(title)}</div><div class="loadingSub">${esc(sub)}</div><div class="pudgeRunway"><img class="pudgeRunner" src="assets/pudge-walk.gif" alt="Pudge" referrerpolicy="no-referrer" onerror="this.style.display='none'"></div><div class="loadingProgress"><i id="loadProgress"></i></div><div class="loadingStats"><span id="loadStage">Подготовка…</span><b id="loadCount">0 / 50</b></div></div></div>`}
function updateLoading(i,total,stage='Считаю показатели…'){const bar=document.querySelector('#loadProgress'),count=document.querySelector('#loadCount'),label=document.querySelector('#loadStage');if(bar)bar.style.width=Math.round((i/Math.max(1,total))*100)+'%';if(count)count.textContent=`${i} / ${total}`;if(label)label.textContent=stage}
async function loadProfile(id){
  const [p,ms,heroHistory,hstats]=await Promise.all([
    get('/players/'+id),
    get('/players/'+id+'/matches?limit=50&offset=0&lobby_type=7&significant=1'),
    get('/players/'+id+'/heroes?lobby_type=7&significant=1'),
    get('/heroStats')
  ]);
  const base=Array.isArray(ms)?ms.filter(x=>x&&x.match_id):[];
  if(!base.length) throw new Error('OpenDota не вернул ranked-матчи для этого аккаунта');
  const ms2=await hydrateRecent50(id,base);
  window.__dpiHeroStats=Array.isArray(hstats)?hstats:[];
  const heroRoleMap=new Map((Array.isArray(hstats)?hstats:[]).map(h=>[Number(h.id),Array.isArray(h.roles)?h.roles:[]]));
  ms2.forEach(m=>{m.__heroRoles=heroRoleMap.get(Number(m.hero_id))||[];});
  const heroes=Array.isArray(heroHistory)?heroHistory.map(q=>{
    const h=hstats.find(x=>String(x.id)===String(q.hero_id));
    const games=Number(q.games)||0, wins=Number(q.win)||0;
    return {
      id:q.hero_id,
      name:h?.localized_name||('Hero '+q.hero_id),
      img:h?.img||h?.icon||'',
      games,
      winrate:games?wins/games*100:null
    };
  }).filter(h=>h.games>0):[];
  render(ms2,p,heroes); $('#landing').style.display='none';
}
$('#load').onclick=async()=>{
  const id=accountFrom($('#steam').value.trim());
  if(!id){$('#app').innerHTML='<div class="card section"><h2>Не удалось найти Steam ID</h2><p>Вставь числовой Steam ID или ссылку вида steamcommunity.com/profiles/...</p></div>';return}
  $('#load').disabled=true;$('#load').textContent='Анализирую…';
  $('#app').innerHTML=loadingMarkup('Dota Player Index загружает ваш профиль…','Получаем профиль и историю матчей.');
  try{await loadProfile(id)}catch(e){const msg=String(e?.message||e); const rate=/429|Failed to fetch|NetworkError|Load failed/i.test(msg); $('#app').innerHTML=`<div class="card section"><h2>Ошибка загрузки</h2><p>${esc(msg)}.</p><p class="notice">${rate?'OpenDota сейчас ограничивает или не принимает браузерные запросы. Я добавил повторные попытки и более медленную загрузку матчей, но если API перегружен — подожди 30–60 секунд и попробуй снова.':'Проверь Steam ID и попробуй ещё раз.'}</p></div>`}
  finally{$('#load').disabled=false;$('#load').textContent='Анализировать'}
};
$('#steam').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    if(!$('#load').disabled) $('#load').click();
  }
});
function recentHeroSummary(ms,heroes){
  const byId={};
  (heroes||[]).forEach(h=>{byId[String(h.id)]=h});
  const map={};
  ms.forEach(m=>{
    const id=String(m?.hero_id||''); if(!id)return;
    if(!map[id])map[id]={id,name:byId[id]?.name||('Hero '+id),img:byId[id]?.img||'',games:0,wins:0,matches:[]};
    map[id].games++; if(win(m))map[id].wins++; map[id].matches.push(m);
  });
  return Object.values(map).map(h=>({...h,winrate:h.games?h.wins/h.games*100:0}));
}
function heroLossAnalysis(h){
  const w=h.matches.filter(win), l=h.matches.filter(x=>!win(x));
  if(!l.length)return {short:'Все игры на этом герое выиграны в этой выборке.',rows:[],advice:'По последним 50 играм нет поражений на этом герое — искать причину здесь пока не из чего.'};
  const rows=[
    ['GPM',metric(w,'gold_per_min'),metric(l,'gold_per_min'),0,'больше экономики'],
    ['XPM',metric(w,'xp_per_min'),metric(l,'xp_per_min'),0,'больше опыта'],
    ['Hero DMG/min',rate(w,'hero_damage'),rate(l,'hero_damage'),0,'больше урона по героям'],
    ['Tower DMG/min',rate(w,'tower_damage'),rate(l,'tower_damage'),0,'больше давления на объекты'],
    ['K+A',Number.isFinite(metric(w,'kills'))&&Number.isFinite(metric(w,'assists'))?metric(w,'kills')+metric(w,'assists'):null,Number.isFinite(metric(l,'kills'))&&Number.isFinite(metric(l,'assists'))?metric(l,'kills')+metric(l,'assists'):null,1,'больше результативных действий'],
    ['Deaths',metric(w,'deaths'),metric(l,'deaths'),1,'меньше смертей']
  ];
  const scored=rows.filter(r=>Number.isFinite(r[1])&&Number.isFinite(r[2])).map(r=>{const d=r[1]-r[2];const bad=r[0]==='Deaths'?d<0:d>0;return {...r,d,bad,impact:Math.abs(d)/Math.max(Math.abs(r[1]),Math.abs(r[2]),1)}}).filter(r=>r.bad).sort((a,b)=>b.impact-a.impact);
  const top=scored.slice(0,2);
  const short=top.length?top.map(r=>`${r[0]} ${r[0]==='Deaths'?'выше':'ниже'} в поражениях на ${Math.abs(r.d).toFixed(r[3])}`).join(' · '):'доступные показатели побед и поражений близки';
  let advice='Слишком мало одинаковых игр, чтобы уверенно выделить одну причину.';
  if(top[0]){
    const r=top[0];
    if(r[0]==='Deaths')advice=`Главный сигнал — смерти: ${fmt(r[1],1)} в победах против ${fmt(r[2],1)} в поражениях. В следующих играх на этом герое сначала убирай рискованные смерти, а не гонись за дополнительным kill.`;
    else if(r[0]==='GPM')advice=`Главный сигнал — экономика: ${fmt(r[1],0)} GPM в победах против ${fmt(r[2],0)} в поражениях. После неудачной драки быстрее возвращайся к безопасному фарму.`;
    else if(r[0]==='XPM')advice=`Главный сигнал — опыт: ${fmt(r[1],0)} XPM в победах против ${fmt(r[2],0)}. Не оставляй героя без гарантированного XP после перемещений.`;
    else if(r[0]==='Hero DMG/min')advice=`Главный сигнал — боевое влияние: ${fmt(r[1],0)} DMG/min в победах против ${fmt(r[2],0)}. Важнее качество первых секунд драки, чем случайный урон по ближайшей цели.`;
    else if(r[0]==='Tower DMG/min')advice=`Главный сигнал — конвертация: ${fmt(r[1],0)} Tower DMG/min в победах против ${fmt(r[2],0)}. После выигранной драки ищи объект, а не ещё один безопасный круг фарма.`;
    else if(r[0]==='K+A')advice=`Главный сигнал — результативность: K+A ${fmt(r[1],1)} в победах против ${fmt(r[2],1)}. Подключайся к ключевым дракам, где твой герой реально меняет исход.`;
  }
  return {short,rows,advice};
}
function lossAnalysis(ms){
  const wins=ms.filter(win), losses=ms.filter(x=>!win(x));
  const rows=[
    ['GPM',metric(wins,'gold_per_min'),metric(losses,'gold_per_min'),0,'экономический темп'],
    ['XPM',metric(wins,'xp_per_min'),metric(losses,'xp_per_min'),0,'темп уровней'],
    ['Hero Damage/min',rate(wins,'hero_damage'),rate(losses,'hero_damage'),0,'боевое влияние'],
    ['Tower Damage/min',rate(wins,'tower_damage'),rate(losses,'tower_damage'),0,'конвертация в объекты'],
    ['K+A',Number.isFinite(metric(wins,'kills'))&&Number.isFinite(metric(wins,'assists'))?metric(wins,'kills')+metric(wins,'assists'):null,Number.isFinite(metric(losses,'kills'))&&Number.isFinite(metric(losses,'assists'))?metric(losses,'kills')+metric(losses,'assists'):null,1,'результативные действия'],
    ['Teamfight',Number.isFinite(metric(wins,'teamfight_participation'))?metric(wins,'teamfight_participation')*100:null,Number.isFinite(metric(losses,'teamfight_participation'))?metric(losses,'teamfight_participation')*100:null,0,'участие в драках'],
    ['Deaths',metric(wins,'deaths'),metric(losses,'deaths'),1,'отданный темп']
  ];
  const scored=rows.filter(r=>Number.isFinite(r[1])&&Number.isFinite(r[2])).map(r=>{const d=r[1]-r[2],bad=r[0]==='Deaths'?d>0:d<0;return {...r,d,bad,impact:Math.abs(d)/Math.max(Math.abs(r[1]),Math.abs(r[2]),1)}}).filter(r=>r.bad).sort((a,b)=>b.impact-a.impact);
  return {wins,losses,rows,drivers:scored.slice(0,4)};
}
function personalizedAdvice(a){
  const r=a.drivers[0]; if(!r)return {title:'Явного сигнала нет',text:'Показатели побед и поражений близки. Лучше не придумывать причину: собери ещё 10 игр и посмотрим, появится ли устойчивый паттерн.'};
  const w=r[1],l=r[2];
  if(r[0]==='Deaths')return {title:`Смерти: ${fmt(l,1)} → ориентир ${fmt(w+0.3,1)}`,text:`В победах у тебя ${fmt(w,1)} смертей, в поражениях ${fmt(l,1)}. Первое задание — приблизить поражения к твоей собственной цифре побед, а не к абстрактному «идеалу».`};
  if(r[0]==='GPM')return {title:`GPM: ${fmt(l,0)} → ориентир ${fmt(w,0)}`,text:`В поражениях ты теряешь около ${fmt(Math.abs(r.d),0)} GPM относительно своих побед. После плохой драки приоритет — ближайший безопасный ресурс, а не длинный пустой маршрут.`};
  if(r[0]==='XPM')return {title:`XPM: ${fmt(l,0)} → ориентир ${fmt(w,0)}`,text:`В поражениях отрыв составляет ${fmt(Math.abs(r.d),0)} XPM. Старайся не оставлять героя без опыта после перемещений и проигранных драк.`};
  if(r[0]==='Hero Damage/min')return {title:`Hero Damage/min: ${fmt(l,0)} → ориентир ${fmt(w,0)}`,text:`В победах ты наносишь примерно на ${fmt(Math.abs(r.d),0)} больше урона в минуту. Работай над тем, чтобы входить в ключевую драку с понятной целью и готовыми ресурсами.`};
  if(r[0]==='Tower Damage/min')return {title:`Tower Damage/min: ${fmt(l,0)} → ориентир ${fmt(w,0)}`,text:`В победах ты лучше превращаешь игру в строения. После выигранной драки проверяй ближайший объект до возвращения к фарму.`};
  if(r[0]==='K+A')return {title:`K+A: ${fmt(l,1)} → ориентир ${fmt(w,1)}`,text:`Разница около ${fmt(Math.abs(r.d),1)} результативных действий. Подключайся не ко всем дракам подряд, а к тем, где твой герой действительно может получить kill/assist и выйти живым.`};
  return {title:`Teamfight: ${fmt(l,0)}% → ориентир ${fmt(w,0)}%`,text:`В победах участие выше. Твоя задача — приходить к важным дракам раньше, а не пытаться догонять уже начавшуюся.`};
}
function openRecent50Summary(){
  const ms=window.__dpiMatches||[], heroes=window.__dpiHeroes||[], c=window.__dpiCurrent;
  if(!ms.length)return;
  const list=recentHeroSummary(ms,heroes).sort((a,b)=>b.games-a.games||b.winrate-a.winrate);
  const best=list.filter(h=>h.winrate>=50).sort((a,b)=>b.games-a.games||b.winrate-a.winrate);
  const worst=list.filter(h=>h.winrate<50).sort((a,b)=>b.games-a.games||a.winrate-b.winrate);
  const card=h=>{const a=heroLossAnalysis(h);const table=a.rows.slice(0,4).map(r=>`<tr><td>${esc(r[0])}</td><td>${fmt(r[1],r[3])}</td><td>${fmt(r[2],r[3])}</td></tr>`).join('');return `<div class="recent50HeroItem"><div>${heroImage(h)?`<img src="${esc(heroImage(h))}" alt="${esc(h.name)}" loading="lazy" onerror="this.style.visibility='hidden'">`:'<div class="heroVisual">⚔️</div>'}</div><div><div class="recent50HeroName">${esc(h.name)}</div><div class="recent50HeroMeta">${h.games} ${h.games===1?'игра':'игр'} · ${h.wins} побед · ${h.games-h.wins} поражений</div><div class="heroDeep"><b>${esc(a.short)}</b>${a.rows.length?`<table class="heroDeepTable"><tr><td></td><td>WIN</td><td>LOSS</td></tr>${table}</table>`:''}<span>${esc(a.advice)}</span></div></div><div class="recent50HeroWR ${h.winrate>=50?'good':'bad'}">${fmt(h.winrate,1)}%</div></div>`};
  const la=lossAnalysis(ms), adv=personalizedAdvice(la);
  const driverHtml=la.drivers.map(d=>`<div class="lossDriver"><b>${esc(d[0])}: ${d[0]==='Deaths'?fmt(d[2],1):fmt(d[2],d[3])} в поражениях</b><span>Разница с победами: ${Math.abs(d.d).toFixed(d[3])}. Здесь есть устойчивый статистический сигнал, но он не доказывает причинность.</span></div>`).join('');
  $('#modalContent').innerHTML=`<h2>Сводка за последние ${ms.length} игр</h2><p class="sub">Здесь всё считается только по последним ${ms.length} ranked-матчам. Для каждого героя сравниваем его победы и поражения. Если игр мало, вывод осторожнее.</p><div class="lossHeadline"><div class="lossKpi"><div class="big">${fmt(c?.wr,1)}%</div><div class="small">WR за выборку</div></div><div class="lossKpi"><div class="big">${c?.w||0}</div><div class="small">побед</div></div><div class="lossKpi"><div class="big">${Math.max(0,(c?.games||0)-(c?.w||0))}</div><div class="small">поражений</div></div></div><div class="modalSectionTitle">ЧТО ЧАЩЕ ОТЛИЧАЕТ ТВОИ ПОРАЖЕНИЯ</div><div class="lossAdviceGrid"><div class="lossAdvice"><b>${esc(adv.title)}</b><span>${esc(adv.text)}</span></div></div><div class="lossDriverGrid">${driverHtml||'<div class="lossDriver"><b>Явного сигнала нет</b><span>Показатели побед и поражений близки.</span></div>'}</div><div class="modalSectionTitle">ГЕРОИ · ПОЛНЫЙ СПИСОК ПОСЛЕДНИХ ${ms.length}</div><div class="recent50HeroGrid"><div class="recent50HeroSection"><div class="recent50HeroTitle">ЛУЧШИЕ · 50%+ WR</div>${best.map(card).join('')||'<div class="sub">Нет героев в этой группе.</div>'}</div><div class="recent50HeroSection bad"><div class="recent50HeroTitle bad">ХУДШИЕ · НИЖЕ 50% WR</div>${worst.map(card).join('')||'<div class="sub">Нет героев в этой группе.</div>'}</div></div><p class="notice">Важно: «разница» показывает, что статистически связано с победами/поражениями в этой выборке. Это не доказательство того, что именно показатель вызвал поражение.</p>`;
  $('#modal').classList.add('open'); $('#modal').querySelector('.modalBox')?.classList.add('wide');
}
function openWhyLose(){
  const ms=window.__dpiMatches||[], c=window.__dpiCurrent; if(!ms.length||!c)return;
  const a=lossAnalysis(ms), adv=personalizedAdvice(a);
  const table=a.rows.map(r=>{const d=r[1]-r[2],bad=r[0]==='Deaths'?d>0:d<0;const txt=Number.isFinite(d)?`${d>=0?'+':''}${d.toFixed(r[3])} · ${bad?'хуже в LOSS':'лучше в LOSS'}`:'нет данных';return `<tr><td>${esc(r[0])}</td><td>${fmt(r[1],r[3])}${r[0]==='Teamfight'?'%':''}</td><td>${fmt(r[2],r[3])}${r[0]==='Teamfight'?'%':''}</td><td class="${bad?'lossDiffBad':'lossDiffGood'}">${esc(txt)}</td></tr>`}).join('');
  const advice=a.drivers.slice(0,4).map(r=>{const w=r[1],l=r[2];let target='',text='';if(r[0]==='Deaths'){target=`≤ ${fmt(w+0.3,1)} смертей`;text=`В поражениях ${fmt(l,1)}, в победах ${fmt(w,1)}. Убирай рискованные смерти после получения преимущества.`}else{target=`≈ ${fmt(w,r[3])}`;text=`В победах ${fmt(w,r[3])}, в поражениях ${fmt(l,r[3])}. Цель — подтянуть этот показатель к своей собственной цифре побед.`}return `<div class="lossAdvice"><b>${esc(r[0])} → ${esc(target)}</b><span>${esc(text)}</span></div>`}).join('');
  const stageData=[[0,10],[10,20],[20,30],[30,null]].map(([lo,hi])=>{const all=ms.filter(m=>{const t=n(m.duration)/60;return t>=lo&&(hi==null||t<hi)}),w=all.filter(win);return {label:`${lo}–${hi??'+'} мин`,games:all.length,wr:all.length?w.length/all.length*100:null,gpm:metric(all,'gold_per_min'),deaths:metric(all,'deaths')}});
  const stageHtml=stageData.map(x=>`<div class="lossStage"><b>${x.label}</b><strong>${fmt(x.wr,0)}% WR</strong><span>${x.games} игр · GPM ${fmt(x.gpm,0)} · deaths ${fmt(x.deaths,1)}</span></div>`).join('');
  const lossShare=ms.length?a.losses.length/ms.length*100:null;
  $('#modalContent').innerHTML=`<h2>Почему я проигрываю?</h2><p class="sub">Сравниваем твои победы и поражения за последние ${ms.length} игр. Советы строятся от твоих собственных цифр: где победы заметно лучше, туда и направляем цель.</p><div class="lossHeadline"><div class="lossKpi"><div class="big">${a.wins.length}</div><div class="small">побед</div></div><div class="lossKpi"><div class="big">${a.losses.length}</div><div class="small">поражений · ${fmt(lossShare,0)}%</div></div><div class="lossKpi"><div class="big">${fmt(c.wr,1)}%</div><div class="small">общий WR</div></div></div><div class="lossAdvice"><b>${esc(adv.title)}</b><span>${esc(adv.text)}</span></div><div class="modalSectionTitle">РАЗНИЦА · ПОБЕДЫ VS ПОРАЖЕНИЯ</div><table class="lossTable"><thead><tr><th>Метрика</th><th>WIN</th><th>LOSS</th><th>Разница</th></tr></thead><tbody>${table}</tbody></table><div class="modalSectionTitle">ЧТО МЕНЯТЬ ИМЕННО ТЕБЕ</div><div class="lossAdviceGrid">${advice||'<div class="lossAdvice"><b>Не придумываем совет</b><span>Данных недостаточно, чтобы честно выделить конкретный показатель.</span></div>'}</div><div class="modalSectionTitle">ГДЕ ПО ХОДУ МАТЧА</div><div class="lossStageGrid">${stageHtml}</div><p class="notice"><b>Точность:</b> сервис не утверждает «ты проиграл из-за GPM». Он говорит: «в твоих победах GPM в среднем выше на X». Это безопаснее и честнее, особенно на маленькой выборке.</p>`;
  $('#modal').classList.add('open'); $('#modal').querySelector('.modalBox')?.classList.add('wide');
}

function openWhy(){
  const c=window.__dpiCurrent;
  if(!c){return}
  const entries=whyIndex(c);
  $('#modalContent').innerHTML='<h2>Почему такой Player Index?</h2><p>Index строится из семи игровых зон. Для каждой зоны используются реальные показатели твоих матчей. Если OpenDota не дал поле, оно не превращается в искусственный ноль.</p>'+entries.map(x=>`<p><b>${esc(x[0])} — ${Number.isFinite(x[1])?Math.round(x[1]):'—'}/100</b><br><span class="sub">${esc(x[2])}</span></p>`).join('')+'<p class="notice">Это внутренний индекс сервиса, а не percentile и не сравнение с другими игроками.</p>';
  $('#modal').classList.add('open');
}
function openStyleInfo(){
  const role=(window.__dpiRole||'').trim();
  const groups={
    'Керри':[['RESOURCE CARRY','Играешь через сильную экономику и позднее раскрытие героя.'],['TEMPO CARRY','Быстро набираешь ресурсы и стараешься использовать преимущество раньше лейта.'],['FIGHTING CARRY','Часто участвуешь в ранних драках и создаёшь давление после первых предметов.'],['SAFE CARRY','Ставишь на сохранение жизни и стабильное накопление преимущества.'],['SCALING CARRY','Главная сила — экономика и сильные тайминги в середине и конце игры.'],['BALANCED CARRY','Ровно распределяешь внимание между фармом, драками и безопасностью.']],
    'Мид':[['TEMPO MID','Создаёшь преимущество через ранний темп и давление по карте.'],['FARMING MID','Играешь через экономику, быстрые предметы и сильные тайминги.'],['DUELIST MID','Сильнее всего влияешь через индивидуальные драки и убийства.'],['MAP CONTROL MID','Хорошо переводишь преимущество в контроль карты и объекты.'],['STABLE MID','Сохраняешь жизнь и результативность, избегая лишнего риска.'],['FLEX MID','Смешанный мид-профиль без одной доминирующей модели.']],
    'Оффлейн':[['SPACE CREATOR','Создаёшь пространство через присутствие на карте, драки и объекты.'],['FRONTLINE INITIATOR','Часто первым начинаешь важные командные сражения.'],['TEMPO OFFLANER','Ускоряешь игру и мешаешь сопернику спокойно развиваться.'],['ANCHOR OFFLANER','Надёжно держишь пространство и сохраняешь ценность после инициации.'],['TEAMFIGHT OFFLANER','Максимально раскрываешься через командные драки и их продолжение.'],['UTILITY OFFLANER','Ставишь пользу команды выше личной статистики и создаёшь пространство.']],
    'Софт-саппорт':[['TEMPO SUPPORT','Создаёшь раннее давление через движение, ганги и драки.'],['ROAMING SUPPORT','Активно двигаешься по карте и создаёшь ситуации для союзников.'],['MAP SUPPORT','Переводишь выигранные ситуации в контроль карты и объекты.'],['FIGHTING SUPPORT','Сильно влияешь на исход командных сражений.'],['STABLE SUPPORT','Редко отдаёшь лишние смерти и сохраняешь полезность.'],['PLAYMAKER SUPPORT','Создаёшь возможности для команды своевременными активными действиями.']],
    'Хард-саппорт':[['VISION SUPPORT','Создаёшь ценность через карту, информацию и стабильное присутствие.'],['TEAMFIGHT SUPPORT','Главная сила — правильное участие в командных сражениях.'],['TEMPO SUPPORT','Влияешь на игру через раннее движение и помощь линиям.'],['OBJECTIVE SUPPORT','Помогаешь превращать выигранные ситуации в объекты и контроль карты.'],['STABLE HARD SUPPORT','Сохраняешь жизнь и продолжаешь приносить пользу даже в сложных играх.'],['UTILITY SUPPORT','Стабильно помогаешь команде через карту, сейв и своевременные действия.']]
  };
  const list=groups[role]||[];
  $('#modalContent').innerHTML='<h2>Игровые стили'+(role?' · '+esc(role):'')+'</h2><p class="sub">Короткие объяснения всех стилей, которые может определить анализ.</p><div class="styleModalGrid">'+list.map(x=>`<div class="styleMeaning"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join('')+'</div>';
  $('#modal').classList.add('open');
}

function openRoleList(){
  const ms=(window.__dpiMatches||[]).slice(0,50), info=roleInfoFrom(ms), labels={1:'Керри',2:'Мид',3:'Оффлейн',4:'Софт-саппорт',5:'Хард-саппорт'};
  const rows=info.sorted.map(k=>{const label=labels[k], icon=roleAsset(label); return `<div class="roleExplainRow"><div class="roleExplainLabel">${icon?`<img class="compareRoleIcon" src="assets/${icon}" alt="">`:''}<b>${esc(label)}</b></div><span>${info.counts[k]} игр</span></div>`}).join('');
  $('#modalContent').innerHTML=`<h2>Остальные роли</h2><p class="sub">Основная роль показывается сразу. Здесь — остальные роли и их вклад в определение.</p><div class="roleExplainGrid">${rows}</div><p class="notice">Если две роли близки по количеству игр, мы показываем обе.</p>`;
  $('#modal').classList.add('open');
}
function openRoleWhy(){
  const ms=(window.__dpiMatches||[]).slice(0,50), info=roleInfoFrom(ms), labels={1:'Керри',2:'Мид',3:'Оффлейн',4:'Софт-саппорт',5:'Хард-саппорт'};
  const rows=info.sorted.map(k=>`<div class="roleExplainRow"><b>${esc(labels[k])}</b><span>${info.counts[k]} игр</span></div>`).join('');
  $('#modalContent').innerHTML=`<h2>Почему мы определили эту роль?</h2><p class="sub">Роль определяется по последним ${info.total} ranked-играм. Для каждой игры выбирается наиболее вероятная позиция, после чего мы смотрим распределение позиций по всей выборке.</p><div class="roleExplainMain"><b>${esc(info.primary)}${info.secondary?' / '+esc(info.secondary):''}</b><span>уверенность: ${esc(info.confidenceLabel)} · ${Math.round(info.confidence)}%</span></div><div class="roleExplainGrid">${rows}</div><div class="modalSectionTitle">РАСПРЕДЕЛЕНИЕ ПОЗИЦИЙ</div><div class="lossAdviceGrid"><div class="lossAdvice"><b>Последние ${info.total} игр</b><span>Основная роль — та позиция, на которой игрок провёл больше всего матчей в этой выборке.</span></div></div><p class="notice">Если две роли близки, мы показываем обе. Это лучше, чем насильно называть игрока чистым мидером или саппортом.</p>`;
  $('#modal').classList.add('open');
}

function openCompare(){
  const current=window.__dpiCurrent, profile=window.__dpiProfile||{};
  const currentName=profile.personaname||profile.name||'Ты';
  $('#modalContent').innerHTML=`<h2>↔ Сравнить с игроком</h2><p class="sub">Добавь Steam ID или ссылку на профиль. Сравним Player Index, WR, GPM, XPM и основную роль двух игроков.</p><div class="comparePlayerForm"><input id="compareSteam" placeholder="Steam ID или ссылка на профиль Steam"><button class="btn" id="compareGo">Сравнить</button></div><div class="compareHint">Второй профиль анализируется тем же способом: последние 50 ranked-матчей.</div>`;
  $('#modal').classList.add('open');
  $('#compareGo').onclick=()=>runCompare(current?.index,currentName);
  $('#compareSteam').addEventListener('keydown',e=>{if(e.key==='Enter')runCompare(current?.index,currentName)});
  setTimeout(()=>$('#compareSteam')?.focus(),50);
}
async function hydrateCompare50(accountId,baseMatches,onProgress){
  const target=baseMatches.slice(0,50), cacheKey='dpi-v421-compare-role-consistent-'+accountId;
  try{const cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');if(Array.isArray(cached)&&cached.length>=Math.min(50,target.length))return cached}catch(e){}
  const out=[];
  // IMPORTANT: comparison must use exactly the same role detector as the main profile.
  // We therefore enrich all 50 ranked games with team-relative stats. The request
  // scheduler is deliberately conservative to avoid turning several comparisons
  // into an OpenDota 429 burst. Individual /matches responses are also cached by path.
  const batchSize=3;
  for(let start=0;start<target.length;start+=batchSize){
    const batch=target.slice(start,start+batchSize);
    const results=await Promise.all(batch.map(async base=>{
      try{
        const full=await getCompareMatch(base.match_id);
        const players=Array.isArray(full?.players)?full.players:[];
        const player=players.find(x=>String(x.account_id)===String(accountId))||players.find(x=>Number(x.player_slot)===Number(base.player_slot));
        if(!player)return base;
        const team=players.filter(x=>(Number(x.player_slot)>=128)===(Number(player.player_slot)>=128));
        const rankOf=(key)=>{
          const vals=team.map(x=>Number(x?.[key])).filter(Number.isFinite).sort((a,b)=>a-b);
          const v=Number(player?.[key]);
          if(!vals.length||!Number.isFinite(v))return .5;
          const idx=vals.findIndex(x=>x>=v);
          return (idx<0?vals.length-1:idx)/(Math.max(1,vals.length-1));
        };
        return {...base,...player,match_id:base.match_id,radiant_win:full.radiant_win,duration:full.duration||base.duration,
          _teamRank_gold_per_min:rankOf('gold_per_min'),_teamRank_xp_per_min:rankOf('xp_per_min'),_teamRank_last_hits:rankOf('last_hits')};
      }catch(e){return base;}
    }));
    out.push(...results);
    if(onProgress)onProgress(out.length,target.length);
    if(start+batchSize<target.length)await sleep(1050);
  }
  for(let i=0;i<target.length;i++)out[i]=out[i]?{...target[i],...out[i]}:target[i];
  try{sessionStorage.setItem(cacheKey,JSON.stringify(out))}catch(e){}
  return out;
}

async function runCompare(myIndex,myName){
  const input=$('#compareSteam'), go=$('#compareGo'), id=accountFrom(input?.value||'');
  if(!id){$('#modalContent').innerHTML=`<h2>Не удалось найти Steam ID</h2><p class="sub">Вставь числовой Steam ID или ссылку на Steam-профиль.</p><button class="btn secondary" onclick="openCompare()">Назад</button>`;return}
  if(!Number.isFinite(myIndex)){ $('#modalContent').innerHTML='<h2>Сравнение недоступно</h2><p class="sub">Для текущего профиля пока не удалось посчитать Player Index.</p>';return}
  if(go)go.disabled=true;
  $('#modalContent').innerHTML='<div class="compareLoading"><h2>Сравниваю второго игрока…</h2><p>Сначала беру готовую историю матчей, затем точечно уточняю роль. Это снижает число запросов к OpenDota.</p><div id="compareProgress">0 / 50</div></div>';
  try{
    const [p,ms]=await Promise.all([get('/players/'+id),get('/players/'+id+'/matches?limit=50&offset=0&lobby_type=7&significant=1')]);
    const hstats=Array.isArray(window.__dpiHeroStats)&&window.__dpiHeroStats.length?window.__dpiHeroStats:await get('/heroStats');
    const base=Array.isArray(ms)?ms.filter(x=>x&&x.match_id):[];
    if(!base.length)throw new Error('У второго игрока нет доступной истории ranked-матчей');
    const full=await hydrateCompare50(id,base,(i,t)=>{const el=$('#compareProgress');if(el)el.textContent=`${i} / ${t}`});
    const heroRoleMap=new Map((Array.isArray(hstats)?hstats:[]).map(h=>[Number(h.id),Array.isArray(h.roles)?h.roles:[]]));
    full.forEach(m=>{m.__heroRoles=heroRoleMap.get(Number(m.hero_id))||[];});
    const other=calc(full), otherName=p?.profile?.personaname||p?.personaname||p?.name||'Игрок', otherRole=roleFrom(full), otherRoleIcon=roleAsset(otherRole), otherAvatar=p?.profile?.avatarfull||p?.profile?.avatarmedium||p?.profile?.avatar||'', otherTier=p?.rank_tier??p?.profile?.rank_tier??full.find(x=>x?.rank_tier!=null)?.rank_tier??base.find(x=>x?.rank_tier!=null)?.rank_tier, otherRank=rankLabel(otherTier), otherRankIcon=rankAsset(otherTier), myProfile=window.__dpiProfile||{}, myAvatar=myProfile.avatarfull||myProfile.avatarmedium||myProfile.avatar||'', myRole=window.__dpiRole||'Смешанная роль', myRoleIcon=roleAsset(myRole), myTier=myProfile.rank_tier??myProfile?.profile?.rank_tier??window.__dpiMatches?.find(x=>x?.rank_tier!=null)?.rank_tier, myRank=rankLabel(myTier), myRankIcon=rankAsset(myTier), diff=Math.round(myIndex-other.index);
    const relation=diff===0?'Одинаковый Player Index':diff>0?`У тебя выше на ${Math.abs(diff)}`:`У второго игрока выше на ${Math.abs(diff)}`;
    $('#modalContent').innerHTML=`<div class="compareBox"><div class="compareLabel">СРАВНЕНИЕ ИГРОКОВ</div><div class="compareNames"><div class="compareSide">${myAvatar?`<img class="compareAvatar" src="${esc(myAvatar)}" alt="">`:''}<span>ТЫ</span><b>${esc(myName)}</b><div class="compareRankRow">${myRankIcon?`<img class="compareRankIcon" src="${myRankIcon}" alt="${esc(myRank)}">`:''}<span class="compareRankText">${esc(myRank)}</span></div><div class="compareRoleLine">${myRoleIcon?`<img class="compareRoleIcon" src="assets/${myRoleIcon}" alt="">`:''}<b>${esc(myRole)}</b></div><div class="compareIndex">${Math.round(myIndex)}</div><div class="compareStats"><div class="compareStat"><span>WR</span><b>${fmt(window.__dpiCurrent?.wr,1)}%</b></div><div class="compareStat"><span>GPM</span><b>${fmt(window.__dpiCurrent?.gpm,0)}</b></div><div class="compareStat"><span>XPM</span><b>${fmt(window.__dpiCurrent?.xpm,0)}</b></div><div class="compareStat"><span>Роль</span><b>${esc(myRole)}</b></div></div></div><div class="compareVs">VS</div><div class="compareSide">${otherAvatar?`<img class="compareAvatar" src="${esc(otherAvatar)}" alt="">`:''}<span>ИГРОК</span><b>${esc(otherName)}</b><div class="compareRankRow">${otherRankIcon?`<img class="compareRankIcon" src="${otherRankIcon}" alt="${esc(otherRank)}">`:''}<span class="compareRankText">${esc(otherRank)}</span></div><div class="compareRoleLine">${otherRoleIcon?`<img class="compareRoleIcon" src="assets/${otherRoleIcon}" alt="">`:''}<b>${esc(otherRole)}</b></div><div class="compareIndex">${Number.isFinite(other.index)?Math.round(other.index):'—'}</div><div class="compareStats"><div class="compareStat"><span>WR</span><b>${fmt(other.wr,1)}%</b></div><div class="compareStat"><span>GPM</span><b>${fmt(other.gpm,0)}</b></div><div class="compareStat"><span>XPM</span><b>${fmt(other.xpm,0)}</b></div><div class="compareStat"><span>Роль</span><b>${esc(otherRole)}</b></div></div></div></div><div class="compareDiff"><div class="compareLabel">РАЗНИЦА PLAYER INDEX</div><b>${esc(relation)}</b></div><div class="compareHint">Сравнение использует одинаковую методику и последние доступные ranked-матчи обоих игроков.</div></div>`;
  }catch(e){$('#modalContent').innerHTML=`<h2>Не удалось сравнить</h2><p class="sub">${esc(e.message)}</p><button class="btn secondary" onclick="openCompare()">Попробовать снова</button>`}
}

function closeModal(){$('#modal').classList.remove('open');$('#modal').querySelector('.modalBox')?.classList.remove('wide')}
$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};
