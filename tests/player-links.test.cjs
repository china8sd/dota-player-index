const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('js/app.js','utf8');
const fallback=fs.readFileSync('404.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const origin='https://china8sd.github.io';

function redirect(path){
  const location=new URL(path,origin);
  let target;
  location.replace=url=>{target=String(url)};
  vm.runInNewContext(fallback,{window:{location},URL});
  return target;
}

async function runApp(path,input,fail=false){
  const nodes=new Map();
  let pending;
  const document={
    baseURI:origin+'/dota-player-index/',
    querySelector(selector){
      if(!nodes.has(selector))nodes.set(selector,{
        value:'',style:{},addEventListener(){},
        click(){pending=this.onclick()}
      });
      return nodes.get(selector);
    }
  };
  const requests=[],urls=[];
  const context={document,URL,console,setTimeout,requests,fail,
    window:{location:{href:new URL(path,origin).href},history:{replaceState(_state,_title,url){urls.push(String(url))}}}};
  vm.runInNewContext(app+'\nasync function loadProfile(id){requests.push(id);if(fail)throw new Error("Test failure")}',context);
  if(input!==undefined){document.querySelector('#steam').value=input;document.querySelector('#load').click()}
  await pending;
  return {requests,urls,nodes};
}

(async()=>{
  for(const id of ['123456789','76561198083722517']){
    for(const suffix of ['', '/']){
      const target=redirect('/dota-player-index/'+id+suffix+'?from=friend#stats');
      assert.equal(new URL(target).searchParams.get('steamID'),id);
      const result=await runApp(target);
      assert.deepEqual(result.requests,['123456789']);
      assert.equal(result.urls[0],origin+'/dota-player-index/123456789?from=friend#stats');
      assert.equal(result.nodes.get('#steam').value,id);
      assert.equal(result.nodes.get('#load').disabled,false);
    }
  }
  for(const path of ['/dota-player-index/','/dota-player-index/nope','/dota-player-index/123/extra','/other/123']){
    assert.equal(redirect(path),undefined);
  }
  for(const path of ['/dota-player-index/','/dota-player-index/?steamID=nope','/dota-player-index/?steamID=0']){
    assert.deepEqual((await runApp(path)).requests,[]);
  }
  const manual=await runApp('/dota-player-index/','https://steamcommunity.com/profiles/76561198083722517');
  assert.deepEqual(manual.requests,['123456789']);
  assert.equal(manual.urls[0],origin+'/dota-player-index/123456789');
  const failed=await runApp('/dota-player-index/?steamID=123456789',undefined,true);
  assert.deepEqual(failed.urls,[]);
  assert.equal(failed.nodes.get('#load').disabled,false);
  assert.match(failed.nodes.get('#app').innerHTML,/Test failure/);
  assert.match(fs.readFileSync('index.html','utf8'),/<base href="\/dota-player-index\/">/);
  console.log('Player link checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
