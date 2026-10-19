/* 8.0: серийный номер, штамп и линейка классов на карточке */
(function(){const prev=window.dpiEnhance;window.dpiEnhance=function(){prev&&prev();try{
  const card=document.querySelector('#app .pcard'),c=window.__dpiCurrent,pr=window.__dpiProfile||{};if(!card||!c)return;
  const no=String((Number(pr.account_id)||0)%1000000).padStart(6,'0'),d=new Date().toLocaleDateString('ru-RU');
  const mk=(cls,h)=>{const e=document.createElement('div');e.className=cls;e.innerHTML=h;return e};
  const pct=Math.max(0,Math.min(100,c.index/10));
  card.querySelector('.pcNote').before(mk('pcRuler',`<b style="left:${pct}%"></b>`+[30,45,60,75,90].map(l=>`<span style="left:${l}%">${l*10}</span>`).join('')));
  card.appendChild(mk('pcSerial','№ '+no));card.appendChild(mk('pcStamp',d));
}catch(e){console.warn(e)}}})();
/* 8.1: класс body.results включает сильное размытие фона, когда лендинг скрыт */
(function(){addEventListener('DOMContentLoaded',()=>{const l=document.querySelector('#landing');if(!l)return;
  const sync=()=>document.body.classList.toggle('results',l.style.display==='none');
  new MutationObserver(sync).observe(l,{attributes:true,attributeFilter:['style']});sync()})})();
/* 8.2: пример карточки и недавние профили на главной */
(function(){
  const KEY='dpi-recent';const rd=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(e){return []}};
  const prev=window.dpiEnhance;window.dpiEnhance=function(){prev&&prev();try{
    const c=window.__dpiCurrent,p=window.__dpiProfile||{};if(!c||!p.account_id)return;
    const l=rd().filter(x=>x.id!==String(p.account_id));l.unshift({id:String(p.account_id),name:p.personaname||'Игрок',idx:c.index});
    localStorage.setItem(KEY,JSON.stringify(l.slice(0,5)))}catch(e){}};
  addEventListener('DOMContentLoaded',()=>{
    const s=document.querySelector('#sample');
    if(s){const ax=[['Фарм',74],['Драки',68],['Выживание',55],['Карта',71],['Объекты',49],['Темп',66],['Стабильность',62]];
      s.className='landingSample pcard';s.style.setProperty('--tc','#D8B26A');
      s.innerHTML=`<div class="pcSerial">Пример</div><div class="pcTop"><div class="pcWho"><b>Твой ник</b><span>Керри · Сильный игрок</span></div><div class="pcIdx">684<small>/1000</small></div></div><div class="pcAxes">${ax.map(([l,v])=>`<div><span>${l}</span><i><u style="width:${v}%"></u></i><em>${v}</em></div>`).join('')}</div><div class="pcRuler"><b style="left:68.4%"></b>${[30,45,60,75,90].map(x=>`<span style="left:${x}%">${x*10}</span>`).join('')}</div>`}
    const r=document.querySelector('#recent'),l=rd();
    if(r&&l.length){r.innerHTML=l.map(x=>`<button type="button" data-id="${x.id}">${String(x.name).replace(/[<>&"]/g,'')}<b>${x.idx}</b></button>`).join('');
      r.onclick=e=>{const b=e.target.closest('button');if(!b)return;document.querySelector('#steam').value=b.dataset.id;document.querySelector('#load').click()}}
  });
})();
