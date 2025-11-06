// app.js
async function loadJSON(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(url+' '+r.status); return r.json(); }
const $ = s => document.querySelector(s);

function fmtMoney(n, cur='usd'){
  const code=(cur||'usd').toUpperCase();
  try{ return new Intl.NumberFormat('en-US',{style:'currency',currency:code}).format(n); }
  catch{ return `$${Number(n).toFixed(2)}`; }
}

function applyBrand(brand, name){
  if (brand?.accent) document.documentElement.style.setProperty('--accent', brand.accent);
  if (brand?.logo)   $('#brandLogo').src = brand.logo;
  if (name){ $('#brandName').textContent=name; $('#brandNameFoot').textContent=name; document.title=name; }
  if (brand?.hero)   $('#heroStrip').style.backgroundImage = `url("${brand.hero}")`;
}

// filtering: allowlist OR prefixes
function byClient({allow, prefixes}){
  return row=>{
    if(!row?.sku) return false;
    if(Array.isArray(allow) && allow.length && allow.includes(row.sku)) return true;
    if(Array.isArray(prefixes) && prefixes.length && prefixes.some(p=>row.sku.startsWith(p))) return true;
    return false;
  };
}

function makeCard(row){
  const card = document.createElement('article'); card.className='card';

  const media = document.createElement('div'); media.className='card-media';
  const img   = document.createElement('img'); img.className='main'; img.alt=row.name||row.sku;

  const imgs  = Array.isArray(row.images) && row.images.length ? row.images : [];
  let idx = 0;

  function renderImg(){
    if (imgs.length){ img.src = imgs[idx]; }
    else { img.removeAttribute('src'); }
  }

  const left = document.createElement('button'); left.className='nav-arrow nav-left'; left.innerHTML='‹';
  const right= document.createElement('button'); right.className='nav-arrow nav-right'; right.innerHTML='›';
  left.onclick = ()=>{ if(!imgs.length) return; idx=(idx-1+imgs.length)%imgs.length; renderImg(); highlight(); };
  right.onclick= ()=>{ if(!imgs.length) return; idx=(idx+1)%imgs.length; renderImg(); highlight(); };

  const thumbs = document.createElement('div'); thumbs.className='thumbs';
  function highlight(){
    [...thumbs.children].forEach((t,i)=> t.classList.toggle('active', i===idx));
  }
  imgs.forEach((u,i)=>{
    const t=document.createElement('img'); t.src=u; t.alt='variant';
    t.onclick=()=>{ idx=i; renderImg(); highlight(); };
    thumbs.appendChild(t);
  });

  renderImg(); highlight();

  media.appendChild(img);
  if (imgs.length>1){ media.appendChild(left); media.appendChild(right); }
  if (imgs.length){ media.appendChild(thumbs); }

  const body  = document.createElement('div'); body.className='card-body';
  const name  = document.createElement('p'); name.className='name';  name.textContent=row.name||row.sku;
  const price = document.createElement('p'); price.className='price'; price.textContent=fmtMoney(row.price,row.currency);
  const buy   = document.createElement('button'); buy.className='buy'; buy.textContent='Buy';
  buy.onclick = ()=> window.open(row.link,'_blank','noopener');

  body.appendChild(name); body.appendChild(price); body.appendChild(buy);

  card.appendChild(media); card.appendChild(body);
  return card;
}

(async ()=>{
  const client   = await loadJSON('data/client.json');
  const products = await loadJSON('data/products.json');

  applyBrand(client.brand, client.name);

  const filter = byClient({
    allow: client.sku_allowlist || [],
    prefixes: client.sku_prefixes || []
  });

  const rows = products.filter(filter).sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  const grid = $('#grid'); grid.innerHTML='';
  rows.forEach(r=> grid.appendChild(makeCard(r)));
})().catch(err=>{
  console.error(err);
  $('#grid').innerHTML='<p style="color:#f88">Failed to load storefront.</p>';
});