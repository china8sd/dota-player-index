/* Dota Player Index 7.0 — разбор героя, дуэль, что изменилось, тема, язык, PWA */
(function(){
  const LANG=localStorage.getItem('dpi-lang')||'ru',THEME=localStorage.getItem('dpi-theme')||'dark';
  document.documentElement.dataset.theme=THEME;document.documentElement.lang=LANG;
  const EN={'Разбор твоей игры в Dota 2':'Your Dota 2 game, analyzed','Вставь Steam ID или ссылку на профиль — сервис покажет реальные показатели, игровой стиль и точки роста.':'Paste a Steam ID or profile link to see real stats, your play style and where to improve.','Анализировать':'Analyze','Анализирую…':'Analyzing…','Индекс игры 0–1000':'Game index 0–1000','Роль и стиль':'Role and style','План на 10 игр':'10-game plan','Поддержать проект можно подпиской на Telegram':'You can support the project by subscribing on Telegram','Вставь ссылку':'Paste the link','Разберём 50 игр':'We analyze 50 games','Получи карточку и план':'Get your card and plan','Где взять Steam ID?':'Where to find Steam ID?','Пример':'Example','Недавние':'Recent','Персональный тренер':'Personal coach','Почему назначено.':'Why assigned.','Герой.':'Hero.','Условия.':'Conditions.','Ограничения.':'Restrictions.','Критерий успеха.':'Success criterion.','Записать попытку':'Log attempt','Экспорт истории':'Export history','Импорт':'Import','Сделать экспорт':'Export now','Прошлый':'Last','Рекорд':'Best','Попыток':'Attempts','Основное':'Main','Дополнительное':'Extra','Ranked-матчи не найдены':'No ranked matches found','Открыть профиль в Dotabuff':'Open profile on Dotabuff','Ищу игрока…':'Searching…','Выбери себя':'Pick yourself','Не удалось найти Steam ID':'Steam ID not found','Загляни в профиль на Dotabuff: там видно, есть ли игры и открыта ли история.':'Check the profile on Dotabuff to see whether games exist and history is public.','OpenDota не вернул ranked-матчи для этого аккаунта. Частые причины: закрыта публичная история матчей в настройках Dota 2 или аккаунт давно не играл ranked.':'OpenDota returned no ranked matches for this account. Common reasons: match history is private in Dota 2 settings, or the account has not played ranked recently.','Другое задание':'Another task','Вариант.':'Variant.','Обзор':'Overview','Форма':'Form','Цифры':'Numbers','Ход матча':'Match flow','Причины':'Causes','Ошибка':'Mistake','План':'Plan','Прогресс':'Progress','Как считается':'How it works','Другой игрок':'Another player','Класс игры · бета':'Game class · beta','Поделиться итогом':'Share result','Сохранить картинку':'Save image','Скопировать ссылку':'Copy link','Сделай сегодня':'Do this today','Индекс по окнам из 15 игр':'Index by 15-game windows','Что изменилось':'What changed','Новичок':'Rookie','Подающий надежды':'Rising','Крепкий середняк':'Solid mid','Сильный игрок':'Strong player','Мастер игры':'Game master','Элита':'Elite','Фарм':'Farm','Драки':'Fights','Выживание':'Survival','Карта':'Map','Объекты':'Objectives','Темп':'Tempo','Стабильность':'Consistency','Дуэль':'Duel','ТВОЯ ИГРА В ЧЕТЫРЁХ ЦИФРАХ':'Your game in four numbers','КАК ТЫ ИГРАЕШЬ ПО ХОДУ МАТЧА':'How you play through a match','ПОЧЕМУ ТЫ ТЕРЯЕШЬ':'Why you lose','ТВОЯ САМАЯ ДОРОГАЯ ОШИБКА':'Your costliest mistake','ПЛАН НА СЛЕДУЮЩИЕ 10 ИГР':'Plan for the next 10 games','ТЫ СТАЛ ЛУЧШЕ?':'Are you improving?','Смерти':'Deaths','Урон по героям/мин':'Hero damage/min','Урон по башням/мин':'Tower damage/min','Драки %':'Teamfight %','Все герои':'All heroes'};
  const tr=n=>{const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t;while((t=w.nextNode())){const k=t.nodeValue.trim();if(EN[k])t.nodeValue=t.nodeValue.replace(k,EN[k])}};
  const M=[['Player Index',c=>c.index,0],['WR %',c=>c.wr,0],['GPM',c=>c.gpm,0],['XPM',c=>c.xpm,0],['K+A',c=>c.kda,1],['Смерти',c=>c.deaths,1,1],['Урон по героям/мин',c=>c.hdm,0],['Урон по башням/мин',c=>c.tdm,0],['Драки %',c=>c.tf==null?null:c.tf*100,0]];
  const f1=(v,d)=>Number.isFinite(v)?v.toFixed(d):'—';
  function rows(a,b,hd){let wa=0,wb=0;const r=M.map(([l,f,d,low])=>{const x=f(a),y=f(b);let k='';if(Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)>1e-9){const aw=low?x<y:x>y;k=aw?'a':'b';aw?wa++:wb++}return `<tr class="${k}"><td>${f1(x,d)}</td><th>${l}</th><td>${f1(y,d)}</td></tr>`}).join('');
    return {wa,wb,html:`<table class="duel">${hd?`<thead><tr><td>${esc(hd[0])}</td><th></th><td>${esc(hd[1])}</td></tr></thead>`:''}${r}</table>`}}
  const modal=h=>{$('#modalContent').innerHTML=h;$('#modal').classList.add('open')};
  // 1. разбор героя по клику на плашку героя
  document.addEventListener('click',e=>{const pill=e.target.closest&&e.target.closest('.v4heroPill');if(!pill)return;
    const h=(window.__dpiHeroes||[]).filter(h=>pill.textContent.includes(h.name)).sort((a,b)=>b.name.length-a.name.length)[0];if(!h)return;
    const sub=(window.__dpiMatches||[]).filter(m=>Number(m.hero_id)===Number(h.id));
    if(sub.length<3)return modal(`<h2>${esc(h.name)}</h2><p class="sub">В последних 50 играх здесь только ${sub.length} матч(а) — для разбора мало.</p>`);
    const r=rows(calc(sub),window.__dpiCurrent,[h.name,'Все герои']);
    modal(`<h2>${esc(h.name)}</h2><p class="sub">${sub.length} игр из последних 50. Зелёным выделено лучшее значение в строке.</p>${r.html}`)});
  // 2. дуэль в две колонки
  window.runCompare=async function(){
    const id=accountFrom(($('#compareSteam')||{}).value||'');
    if(!id)return modal('<h2>Не удалось найти Steam ID</h2><button class="btn secondary" onclick="openCompare()">Назад</button>');
    modal('<h2>Сравниваю…</h2><div id="compareProgress">0 / 50</div>');
    try{
      const [p,ms]=await Promise.all([get('/players/'+id),get('/players/'+id+'/matches?limit=50&offset=0&lobby_type=7&significant=1')]);
      const hs=window.__dpiHeroStats&&window.__dpiHeroStats.length?window.__dpiHeroStats:await get('/heroStats');
      const base=(Array.isArray(ms)?ms:[]).filter(x=>x&&x.match_id);if(!base.length)throw new Error('У второго игрока нет ranked-матчей');
      const full=await hydrateCompare50(id,base,(i,t)=>{const e=$('#compareProgress');if(e)e.textContent=i+' / '+t});
      const rm=new Map(hs.map(h=>[Number(h.id),h.roles||[]]));full.forEach(m=>m.__heroRoles=rm.get(Number(m.hero_id))||[]);
      const r0=DPI_ROLE;DPI_ROLE=roleKeyFrom(full);const o=calc(full);DPI_ROLE=r0;
      const mn=(window.__dpiProfile||{}).personaname||'Ты',on=(p&&p.profile&&p.profile.personaname)||'Игрок',r=rows(window.__dpiCurrent,o,[mn,on]);
      modal(`<h2>Дуэль</h2><div class="duelHead"><b>${esc(mn)}</b><span>${r.wa} : ${r.wb}</span><b>${esc(on)}</b></div><p class="sub">${esc(window.__dpiRole)} против ${esc(roleFrom(full))}. Индекс каждого считается по порогам его роли.</p>${r.html}<button class="btn secondary" onclick="openCompare()">Другой игрок</button>`);
    }catch(e){modal(`<h2>Не удалось сравнить</h2><p class="sub">${esc(e.message)}</p><button class="btn secondary" onclick="openCompare()">Назад</button>`)}
  };
  // 8. что изменилось: последние N игр против предыдущих N
  function self(){
    const ms=window.__dpiMatches||[],feed=document.querySelector('.pcFeed');if(!feed||ms.length<20)return;
    const s=document.createElement('section');s.className='card pcSelf';
    const opts=[10,15,20,25].filter(n=>n*2<=ms.length);
    s.innerHTML=`<h3>Что изменилось</h3><label>Период: <select>${opts.map(n=>`<option value="${n}"${n===opts[opts.length-1]?' selected':''}>${n} игр</option>`).join('')}</select></label><div></div>`;
    const go=()=>{const n=+s.querySelector('select').value;s.querySelector('div').innerHTML=rows(calc(ms.slice(0,n)),calc(ms.slice(n,2*n)),['Последние '+n,'Предыдущие '+n]).html;if(LANG==='en')tr(s)};
    s.querySelector('select').onchange=go;go();feed.appendChild(s);
  }
  const prev=window.dpiEnhance;window.dpiEnhance=function(){prev&&prev();try{self()}catch(e){console.warn(e)}};
  // 3 и 7. тема и язык
  addEventListener('DOMContentLoaded',()=>{
    const top=document.querySelector('.top'),d=document.createElement('div');d.className='dpiTools';
    d.innerHTML=`<button type="button" id="thm" aria-label="Тема">${THEME==='light'?'🌙':'☀'}</button><button type="button" id="lng">${LANG==='ru'?'EN':'RU'}</button>`;top&&top.appendChild(d);
    d.querySelector('#thm').onclick=()=>{localStorage.setItem('dpi-theme',THEME==='light'?'dark':'light');location.reload()};
    d.querySelector('#lng').onclick=()=>{localStorage.setItem('dpi-lang',LANG==='ru'?'en':'ru');location.reload()};
    if(LANG==='en'){const i=document.querySelector('#steam');if(i)i.placeholder='Steam ID or Steam profile link';tr(document.body);
      new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)tr(n)}))).observe(document.body,{childList:true,subtree:true})}
    // 6. PWA
    if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
})();
