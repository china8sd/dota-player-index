/* 12.0: сигнатурные герои на карточке, подробный блок «самая дорогая ошибка», вкладка тренера */
(function(){
  const INFO={
    'Deaths':{n:'Смерти за матч',what:'Среднее число смертей за матч.',why:'Каждая смерть отнимает фарм и опыт, даёт противнику золото и открывает пространство для целей. В проигранных играх именно лишние смерти чаще всего ломают темп.',zone:'Выживание'},
    'GPM':{n:'Золото в минуту (GPM)',what:'Как быстро растёт твоя экономика.',why:'Золото превращается в предметы, а от них зависит сила героя в драках. Когда экономика отстаёт, ты приходишь к ключевым моментам слабее, чем мог бы.',zone:'Фарм'},
    'XPM':{n:'Опыт в минуту (XPM)',what:'Как быстро растут уровни героя.',why:'Уровни дают способности и характеристики. Отставание по опыту обычно значит, что ты редко бываешь там, где идёт опыт, или долго простаиваешь.',zone:'Карта'},
    'Hero Damage/min':{n:'Урон по героям в минуту',what:'Твой вклад в драки: сколько урона по героям ты наносишь за минуту матча.',why:'Если в проигранных матчах урон ниже, ты реже участвуешь в драках или не доживаешь до применения способностей.',zone:'Драки'},
    'Tower Damage/min':{n:'Урон по строениям в минуту',what:'Насколько ты превращаешь выигранные ситуации в башни и другие объекты.',why:'Преимущество без объектов быстро сгорает. Низкий урон по строениям в поражениях говорит о том, что выигранные драки не закрепляются.',zone:'Объекты'},
    'K+A':{n:'Убийства и помощь (K+A)',what:'Сколько убийств и ассистов ты набираешь за матч.',why:'Это участие в результативных действиях. Падение в поражениях показывает, что в ключевых моментах команда играет без твоего вклада.',zone:'Драки'},
    'Teamfight':{n:'Участие в командных драках',what:'Доля командных драк, в которых ты участвуешь.',why:'Драки решают исход матча. Если в поражениях ты участвуешь реже, ты приходишь поздно или занят другим, пока команда сражается.',zone:'Карта'}};
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
  const val=(m,k)=>k==='GPM'?n(m.gold_per_min):k==='XPM'?n(m.xp_per_min):k==='Hero Damage/min'?rate([m],'hero_damage'):k==='Tower Damage/min'?rate([m],'tower_damage'):k==='K+A'?n(m.kills)+n(m.assists):k==='Teamfight'?n(m.teamfight_participation):n(m.deaths);
  const disp=(k,v)=>!Number.isFinite(v)?'—':k==='Teamfight'?fmt(v*100,0)+'%':fmt(v,(k==='K+A'||k==='Deaths')?1:0);
  const heroName=m=>{const h=(window.__dpiHeroes||[]).find(h=>Number(h.id)===Number(m.hero_id));return h?h.name:'герой'};
  function metricCard(k,w,l){
    const i=INFO[k],wv=w.map(m=>val(m,k)).filter(Number.isFinite),lv=l.map(m=>[m,val(m,k)]).filter(x=>Number.isFinite(x[1])),bw=avg(wv),bl=avg(lv.map(x=>x[1])),lowBad=k!=='Deaths';
    const worse=lv.filter(x=>lowBad?x[1]<bw:x[1]>bw),ex=worse.sort((a,b)=>lowBad?a[1]-b[1]:b[1]-a[1]).slice(0,3).map(([m,v])=>`${m.start_time?new Date(m.start_time*1000).toLocaleDateString('ru-RU')+', ':''}${esc(heroName(m))}: ${disp(k,v)}`);
    return `<div class="errCard"><h3>${i.n}</h3><div class="errNums"><span>В победах<b>${disp(k,bw)}</b></span><span>В поражениях<b>${disp(k,bl)}</b></span></div>
    <p><b>Что это.</b> ${i.what}</p>
    <p><b>Как проявляется.</b> Хуже среднего твоих побед в ${worse.length} из ${lv.length} поражений.${ex.length?` Самые тяжёлые матчи: ${ex.join('; ')}.`:''}</p>
    <p><b>Почему это важно.</b> ${i.why}</p>
    <p><b>Что делать.</b> Открой «Персональный тренер»: там есть задания на зону «${i.zone}».</p></div>`}
  function errorDetails(){
    const sec=[...document.querySelectorAll('#app section.section')].find(s=>/ДОРОГАЯ/.test((s.querySelector('h2')||{}).textContent||''));
    if(!sec||sec.querySelector('.errDet'))return;
    const ms=window.__dpiMatches||[],pr=lossProblemCard(ms),w=ms.filter(win),l=ms.filter(x=>!win(x));
    const names=(pr.evidence||[]).map(e=>e.split(' · ')[0]).filter(k=>INFO[k]).slice(0,3);
    const meta=`<h3 class="errSub">Чем проигранные матчи отличаются от выигранных</h3><p class="errMeta">«Главный риск» выше показывает самую слабую зону профиля в целом, а ниже разбор именно поражений. База: ${w.length} побед и ${l.length} поражений из последних ${ms.length} ranked-игр. ${Math.min(w.length,l.length)<5?'В меньшей группе меньше 5 игр, поэтому вывод осторожный. ':''}Это сравнение побед и поражений: оно показывает, чем проигранные матчи отличаются, но не доказывает причину.</p>`;
    sec.insertAdjacentHTML('beforeend',`<div class="errDet">${meta}${names.length?names.map(k=>metricCard(k,w,l)).join(''):`<p>${esc(pr.text||'')}</p>`}</div>`)}
  function heroIcons(){
    const top=document.querySelector('#app .pcard .pcTop');if(!top||top.querySelector('.pcHeroes'))return;
    const hs=(window.__dpiHeroes||[]).slice().sort((a,b)=>(b.games||0)-(a.games||0)).slice(0,5).filter(h=>heroImage(h));if(!hs.length)return;
    const d=document.createElement('div');d.className='pcHeroes';d.setAttribute('role','img');d.setAttribute('aria-label','Сигнатурные герои');
    d.innerHTML=hs.map(h=>`<img src="${esc(heroImage(h))}" alt="" loading="lazy" onerror="this.remove()">`).join('');
    top.insertBefore(d,top.querySelector('.pcIdx'))}
  function navTab(){
    const nav=document.querySelector('.dpiNav'),tr=document.querySelector('#train');if(!nav||!tr||nav.querySelector('.dpiCoach'))return;
    const b=document.createElement('button');b.type='button';b.className='dpiCoach';b.textContent='Тренер';b.onclick=()=>tr.scrollIntoView({behavior:'smooth',block:'start'});nav.insertBefore(b,nav.children[2]||null)}
  const prev=window.dpiEnhance;window.dpiEnhance=function(){prev&&prev();for(const f of [heroIcons,errorDetails,navTab]){try{f()}catch(e){console.warn('v12',e)}}};
})();
