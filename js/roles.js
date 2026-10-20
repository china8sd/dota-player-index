/* Таблица ролей героев (задана вручную) и сверка с поведением игрока.
   Формат строки: название героя:буквы ролей. c = керри (поз.1), m = мид (поз.2), o = оффлейн (поз.3), s = саппорт (поз.4 или 5).
   Правь таблицу прямо здесь: название можно писать по-английски как в игре, регистр и знаки не важны. */
(function(){
const TXT=`alchemist:c
axe:o
bristleback:o
centaur warrunner:o
chaos knight:c
clockwerk:s
dawnbreaker:o
doom:o
dragon knight:mo
earth spirit:ms
earthshaker:m
elder titan:s
huskar:om
kunkka:om
largo:o
legion commander:o
lifestealer:c
lycan:o
mars:o
night stalker:o
ogre magi:s
omniknight:so
phoenix:smo
primal beast:om
pudge:sm
slardar:o
spirit breaker:s
sven:c
tidehunter:o
timbersaw:o
tiny:c
treant protector:s
tusk:s
underlord:o
undying:so
wraith king:c
anti-mage:c
bloodseeker:c
bounty hunter:s
broodmother:mco
clinkz:c
drow ranger:c
ember spirit:m
faceless void:c
gyrocopter:c
hoodwink:s
juggernaut:c
kez:cm
lone druid:cm
luna:c
medusa:c
meepo:m
mirana:s
monkey king:mc
morphling:c
naga siren:c
phantom assassin:c
phantom lancer:c
razor:com
riki:c
shadow fiend:cm
slark:cm
sniper:m
spectre:c
templar assassin:c
terrorblade:c
troll warlord:c
ursa:c
vengeful spirit:s
viper:mo
weaver:cs
ancient apparition:s
chen:s
crystal maiden:s
dark seer:o
dark willow:s
disruptor:s
enchantress:s
grimstroke:s
invoker:m
jakiro:s
keeper of the light:sm
leshrac:m
lich:s
lina:m
lion:s
muerta:c
necrophos:om
oracle:s
outworld destroyer:m
puck:m
pugna:s
queen of pain:m
ringmaster:s
rubick:sm
shadow demon:s
shadow shaman:s
silencer:s
skywrath mage:s
storm spirit:m
tinker:m
warlock:s
winter wyvern:s
witch doctor:s
zeus:ms
abaddon:sco
arc warden:m
bane:s
batrider:ms
beastmaster:om
brewmaster:o
dazzle:s
death prophet:m
enigma:o
io:sm
magnus:om
marci:s
natures prophet:cm
nyx assassin:s
pangolier:m
sand king:mo
snapfire:ms
techies:s
venomancer:s
visage:om
void spirit:m
windranger:c`;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');
const POS={c:[1],m:[2],o:[3],s:[4,5]};
const MAP=new Map();
TXT.split('\n').forEach(l=>{const [n,r]=l.split(':');if(!n||!r)return;const set=new Set();[...r.trim()].forEach(ch=>(POS[ch]||[]).forEach(p=>set.add(p)));MAP.set(norm(n),[...set].sort())});
function lookup(name){
  const n=norm(name);if(!n)return null;if(MAP.has(n))return MAP.get(n);
  for(const [k,v] of MAP)if(Math.min(k.length,n.length)>=6&&(n.startsWith(k)||k.startsWith(n)))return v; // «centaur» ~ «centaurwarrunner»
  return null}
let cache=null,src=null;
window.DPI_HERO_ROLES={size:MAP.size,lookup};
// допустимые позиции героя по id (или null, если героя нет в таблице)
window.dpiHeroPrior=id=>{const hs=window.__dpiHeroStats;if(!Array.isArray(hs)||!hs.length)return null;
  if(src!==hs){cache=new Map(hs.map(h=>[Number(h.id),lookup(h.localized_name||String(h.name||'').replace('npc_dota_hero_',''))]));src=hs}
  return cache.get(Number(id))||null};
})();
