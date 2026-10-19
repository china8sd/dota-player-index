/* Dota Player Index 6.0 — карточка игрока, «Сделай сегодня», тренд, история, ссылка, методика */
(function(){
  const TC=['#8a93a3','#6fa8dc','#62d6a4','#d8b26a','#f0a04b','#c9a7ff'],TN=['Новичок','Подающий надежды','Крепкий середняк','Сильный игрок','Мастер игры','Элита'],B=[0,300,450,600,750,900];
  const AX=[['farm','Фарм'],['fight','Драки'],['survival','Выживание'],['map','Карта'],['objectives','Объекты'],['tempo','Темп'],['consistency','Стабильность']];
  const val=v=>Number.isFinite(v)?Math.max(0,Math.min(100,v)):0;
  const toast=t=>{const e=document.createElement('div');e.className='dpiToast';e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2200)};
  function draw(d){return new Promise(res=>{
    const W=900,H=1200,cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
    const done=img=>{
      const g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,'#161c26');g.addColorStop(1,'#0b0e13');x.fillStyle=g;x.fillRect(0,0,W,H);
      x.strokeStyle=d.tc;x.lineWidth=8;x.strokeRect(28,28,W-56,H-56);
      if(img){x.save();x.beginPath();x.arc(150,170,80,0,7);x.clip();x.drawImage(img,70,90,160,160);x.restore()}
      x.fillStyle='#eef1f5';x.font='700 56px "Big Shoulders Display",Arial Narrow,sans-serif';x.fillText(d.name.slice(0,22),260,160);
      x.fillStyle='#9aa3b2';x.font='500 30px Archivo,sans-serif';x.fillText(d.role+' · '+d.tier,260,208);
      x.fillStyle=d.tc;x.font='800 230px "Big Shoulders Display",Arial Narrow,sans-serif';x.fillText(String(d.idx),70,470);
      x.fillStyle='#9aa3b2';x.font='500 34px Archivo,sans-serif';x.fillText('Player Index / 1000',80,520);
      d.axes.forEach(([l,v],i)=>{const y=600+i*70;x.fillStyle='#c9d0db';x.font='600 28px Archivo,sans-serif';x.fillText(l,80,y);
        x.fillStyle='rgba(255,255,255,.1)';x.fillRect(330,y-24,440,22);x.fillStyle=d.tc;x.fillRect(330,y-24,440*v/100,22);x.fillStyle='#eef1f5';x.fillText(Math.round(v),790,y)});
      x.fillStyle='#6f7888';x.font='500 26px Archivo,sans-serif';x.fillText('Dota Player Index · данные OpenDota · '+d.games+' игр',80,1120);
      res(cv)};
    if(!d.avatar)return done(null);
    const im=new Image();im.crossOrigin='anonymous';im.onload=()=>done(im);im.onerror=()=>done(null);im.src=d.avatar;
  })}
  function methodology(){
    $('#modalContent').innerHTML=`<h2>Как считается Player Index</h2><p class="sub">Индекс — среднее семи зон (0–100), умноженное на 10. Считается по последним 50 ranked-матчам OpenDota прямо в браузере.</p>
    <p><b>Зоны:</b> фарм (GPM, LH/min), драки (урон по героям, K+A), выживаемость (смерти), карта (XPM, участие в драках), объекты (урон по башням), темп (GPM, K+A), стабильность (разброс смертей и GPM).</p>
    <p><b>Роль:</b> пороги зависят от роли. Для керри GPM оценивается в диапазоне 350–750, для хард-саппорта 200–400, для оффлейнера 300–600, для мида 350–750, для софт-саппорта 250–480. Так саппорта не штрафуют за «низкий фарм».</p>
    <p><b>Роль определяется</b> для каждой игры по линии и месту игрока в команде по золоту, опыту и ластхитам, затем берётся распределение по 50 играм.</p>
    <p><b>Надёжность:</b> чем меньше игр и чем меньше матчей разобрано OpenDota, тем осторожнее выводы. Это ориентир, а не приговор.</p>`;
    $('#modal').classList.add('open')}
  function v6(){
    const app=$('#app'),c=window.__dpiCurrent,ms=window.__dpiMatches||[],pr=window.__dpiProfile||{},role=window.__dpiRole||'—',verdict=app.querySelector('.dpiVerdict');
    if(!c||!verdict||!Number.isFinite(c.index))return;
    let k=0;B.forEach((b,j)=>{if(c.index>=b)k=j});const tc=TC[k],tier=TN[k],name=pr.personaname||pr.name||'Игрок',avatar=pr.avatarfull||pr.avatarmedium||'';
    // история визитов
    const aid=pr.account_id,hk='dpi-hist-'+aid;let hist=[];try{hist=JSON.parse(localStorage.getItem(hk)||'[]')}catch(e){}
    const last=hist[hist.length-1];let visit='';
    if(last){const dd=c.index-last.i,days=Math.max(0,Math.round((Date.now()-last.t)/864e5));visit=` · с прошлого визита (${days?days+' дн. назад':'сегодня'}) ${dd>=0?'+':''}${dd}`}
    if(!last||Date.now()-last.t>36e5){hist.push({t:Date.now(),i:c.index});try{localStorage.setItem(hk,JSON.stringify(hist.slice(-30)))}catch(e){}}
    if(aid)try{history.replaceState(null,'','?id='+aid)}catch(e){}
    const axes=AX.map(([a,l])=>[l,val(c.axes[a])]);
    const card=document.createElement('section');card.className='pcard';card.style.setProperty('--tc',tc);
    card.innerHTML=`<div class="pcTop">${avatar?`<img src="${esc(avatar)}" alt="">`:''}<div class="pcWho"><b>${esc(name)}</b><span>${esc(role)} · ${tier}</span></div><div class="pcIdx">${c.index}<small>/1000</small></div></div>
    <div class="pcAxes">${axes.map(([l,v])=>`<div><span>${l}</span><i><u style="width:${v}%"></u></i><em>${Math.round(v)}</em></div>`).join('')}</div>
    <div class="pcNote">Выборка: ${c.games} игр · ${confidence(c.games)[0]}${esc(visit)}</div>
    <div class="pcBtns"><button class="btn" data-a="img">Сохранить картинку</button><button class="btn secondary" data-a="link">Скопировать ссылку</button></div>`;
    card.onclick=async e=>{const a=e.target.dataset?.a;if(a==='link'){try{await navigator.clipboard.writeText(location.href);toast('Ссылка скопирована')}catch(_){prompt('Ссылка:',location.href)}}
      if(a==='img'){const cv=await draw({name,idx:c.index,tier,role,tc,axes,avatar,games:c.games});cv.toBlob(b=>{if(!b)return toast('Не удалось собрать картинку');const u=document.createElement('a');u.href=URL.createObjectURL(b);u.download='player-index.png';u.click();toast('Картинка сохранена')})}};
    verdict.after(card);
    // «Сделай сегодня»
    const m=(typeof experimentMissions==='function'?experimentMissions(c,ms)[0]:null),feed=document.createElement('div');feed.className='pcFeed';
    if(m)feed.innerHTML=`<section class="card pcToday"><h3>Сделай сегодня</h3><b>${esc(m[0])}</b><p>${esc(m[1])}</p><p><em>${esc(m[2])}</em></p><p>${esc(m[3])}</p></section>`;
    // тренд по окнам из 15 игр
    if(ms.length>=25&&typeof calc==='function'){
      const pts=[];for(let i=ms.length-15;i>=0;i-=5){const x=calc(ms.slice(i,i+15)).index;if(Number.isFinite(x))pts.push(x)}
      if(pts.length>=3){const lo=Math.min(...pts)-30,hi=Math.max(...pts)+30,X=i=>10+i*(280/(pts.length-1)),Y=v=>70-(v-lo)/(hi-lo)*60,d=pts[pts.length-1]-pts[0];
        feed.insertAdjacentHTML('beforeend',`<section class="card pcTrend"><h3>Индекс по окнам из 15 игр</h3><svg viewBox="0 0 300 80" role="img" aria-label="Динамика индекса"><polyline fill="none" stroke="${tc}" stroke-width="2.5" points="${pts.map((v,i)=>X(i)+','+Y(v)).join(' ')}"/>${pts.map((v,i)=>`<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${tc}"/>`).join('')}</svg><p>${pts[0]} → ${pts[pts.length-1]}: ${d>=0?'рост':'спад'} на ${Math.abs(d)} за период. Окна шагают по 5 игр, поэтому мелкие колебания — это шум.</p></section>`)}}
    card.after(feed);
    // сворачиваемые разделы (на телефоне свёрнуты, кроме плана)
    app.querySelectorAll('section.section').forEach(s=>{const h=s.querySelector('h2');if(!h)return;h.tabIndex=0;h.setAttribute('role','button');
      const set=o=>{s.classList.toggle('col',!o);h.setAttribute('aria-expanded',o)};set(!(innerWidth<700&&s.id!=='mission'));
      h.onclick=()=>set(s.classList.contains('col'));h.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();h.click()}}});
    const mb=document.createElement('button');mb.type='button';mb.textContent='Как считается';mb.onclick=methodology;app.querySelector('.dpiNav .dpiNew')?.before(mb);
  }
  const prev=window.dpiEnhance;window.dpiEnhance=function(){prev&&prev();try{v6()}catch(e){console.warn(e)}};
  addEventListener('DOMContentLoaded',()=>{const id=new URLSearchParams(location.search).get('id');if(id&&/^\d+$/.test(id)){$('#steam').value=id;$('#load').click()}});
})();
