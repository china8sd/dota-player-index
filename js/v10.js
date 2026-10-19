/* 10.0: поиск игрока по нику, если ссылка вида steamcommunity.com/id/имя или введён ник */
(function(){
  window.dpiNameSearch=async function(raw){
    const m=raw.match(/steamcommunity\.com\/id\/([^\/?#\s]+)/i),q=(m?m[1]:raw).trim(),app=$('#app');
    const fail=()=>{app.innerHTML=`<div class="card section"><h2>Не удалось найти Steam ID</h2><p>Вставь числовой Steam ID или ссылку вида steamcommunity.com/profiles/число.</p>${q?`<p class="notice">Числовой ID по имени «${esc(q)}» можно узнать на <a href="https://steamid.io/lookup/${encodeURIComponent(q)}" target="_blank" rel="noopener">steamid.io</a>.</p>`:''}</div>`};
    if(!q||q.length<2)return fail();
    app.innerHTML='<div class="card section"><h2>Ищу игрока…</h2><p>Ссылка с именем не содержит числового ID, поэтому ищем по нику в OpenDota.</p></div>';
    try{
      const r=await get('/search?q='+encodeURIComponent(q)),list=(Array.isArray(r)?r:[]).filter(x=>x&&x.account_id).slice(0,8);
      if(!list.length)return fail();
      app.innerHTML=`<div class="card section"><h2>Выбери себя</h2><p>Найдено по нику «${esc(q)}». Нажми на свой профиль:</p>${list.map(x=>`<button type="button" class="dpiCand" data-id="${esc(x.account_id)}">${x.avatarfull?`<img src="${esc(x.avatarfull)}" alt="">`:''}<span>${esc(x.personaname||'Игрок')}<small>ID ${esc(x.account_id)}${x.last_match_time?' · последняя игра '+new Date(x.last_match_time).toLocaleDateString('ru-RU'):''}</small></span></button>`).join('')}</div>`;
    }catch(e){fail()}
  };
  document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('.dpiCand');if(!b)return;$('#steam').value=b.dataset.id;$('#load').click()});
})();
