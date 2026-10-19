/* Dota Player Index 5.0 — навигация, «Класс игры», поделиться итогом (бета) */
(function(){
  const TIERS=[[0,'Новичок'],[300,'Подающий надежды'],[450,'Крепкий середняк'],[600,'Сильный игрок'],[750,'Мастер игры'],[900,'Элита']];
  const NAMES=[['ЧЕТЫРЁХ','Цифры'],['ХОДУ МАТЧА','Ход матча'],['ПОЧЕМУ ТЫ ТЕРЯЕШЬ','Причины'],['ДОРОГАЯ','Ошибка'],['СЛЕДУЮЩИЕ','План'],['ЛУЧШЕ','Прогресс']];
  const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  const tierOf=i=>{let k=0;TIERS.forEach((t,j)=>{if(i>=t[0])k=j});return k};
  function toast(t){const e=document.createElement('div');e.className='dpiToast';e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2200)}
  function share(c,role,tier){
    const txt=`Мой Player Index: ${c.index}/1000 · ${tier} · роль: ${role} · WR ${c.wr==null?'—':c.wr.toFixed(0)}% за ${c.games} игр (Dota Player Index)`;
    (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>toast('Итог скопирован'),()=>{prompt('Скопируй итог:',txt)});
  }
  function countUp(){
    const num=document.querySelector('#app .index'),ring=document.querySelector('#app .indexRing');
    if(!num||!ring||reduce)return;const to=Number(num.textContent);if(!Number.isFinite(to))return;
    const t0=performance.now(),D=1000;
    (function f(t){const k=Math.min(1,(t-t0)/D),e=1-Math.pow(1-k,3);num.textContent=Math.round(to*e);ring.style.setProperty('--index-pct',(to/10*e)+'%');if(k<1)requestAnimationFrame(f)})(t0);
  }
  window.dpiEnhance=function(){
    const app=document.querySelector('#app'),c=window.__dpiCurrent;if(!app||!c||!Number.isFinite(c.index))return;
    const role=window.__dpiRole||'—',k=tierOf(c.index),nx=TIERS[k+1];
    const from=TIERS[k][0],to=nx?nx[0]:1000,pct=Math.max(4,Math.min(100,(c.index-from)/(to-from)*100));
    const bar=document.createElement('div');bar.className='dpiVerdict';
    bar.innerHTML=`<div><span class="dpiTierName">${TIERS[k][1]}</span><span class="dpiTierSub">Класс игры · бета</span></div><div class="dpiNext"><div class="dpiBar"><i style="width:${pct}%"></i></div><small>${nx?`До класса «${nx[1]}» осталось ${nx[0]-c.index}`:'Максимальный класс — держи уровень'}</small></div><button class="btn secondary" type="button">Поделиться итогом</button>`;
    bar.querySelector('button').onclick=()=>share(c,role,TIERS[k][1]);
    // навигация по разделам
    const targets=[['Обзор',app.querySelector('.v4hero')],['Форма',app.querySelector('.g5overview')]];
    app.querySelectorAll('section.section').forEach(s=>{const h=(s.querySelector('h2')||{}).textContent||'';const m=NAMES.find(n=>h.includes(n[0]));targets.push([m?m[1]:h.slice(0,14),s])});
    const nav=document.createElement('nav');nav.className='dpiNav';nav.setAttribute('aria-label','Разделы');
    const btns=targets.filter(t=>t[1]).map(([name,el])=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=()=>el.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});nav.appendChild(b);return [b,el]});
    const nw=document.createElement('button');nw.type='button';nw.className='dpiNew';nw.textContent='Другой игрок';
    nw.onclick=()=>{app.innerHTML='';document.querySelector('#landing').style.display='';scrollTo({top:0});document.querySelector('#steam').focus()};
    nav.appendChild(nw);
    app.prepend(nav);nav.after(bar);
    if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting)btns.forEach(([b,el])=>b.classList.toggle('on',el===e.target))})},{rootMargin:'-20% 0px -65% 0px'});btns.forEach(([,el])=>io.observe(el))}
    scrollTo({top:0});countUp();
  };
})();
