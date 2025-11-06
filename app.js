/* CYS Storefront – single-file functional build
   Features:
   • Renders Notion→Stripe products.json
   • Brand + hero from data/client.json
   • Category chips + sort menu
   • Variant thumbnails + modal viewer
*/

const $  = (s,c=document)=>c.querySelector(s);
const $$ = (s,c=document)=>Array.from(c.querySelectorAll(s,c));

async function loadJSON(p){
  const r=await fetch(p,{cache:"no-store"});
  if(!r.ok)throw new Error(p+" "+r.status);
  return r.json();
}

/* ---------- brand ---------- */
function applyBrand(b){
  const r=document.documentElement;
  if(b.accent)r.style.setProperty("--accent",b.accent);
  if(b.text)r.style.setProperty("--text",b.text);
  if(b.bg1)r.style.setProperty("--bg1",b.bg1);
  if(b.bg2)r.style.setProperty("--bg2",b.bg2);

  const logo=$("#brandLogo"),hero=$("#brandHero");
  if(logo&&b.logo)logo.src=b.logo;
  if(hero&&b.hero)hero.style.backgroundImage=`url("${b.hero}")`;
}

/* ---------- helpers ---------- */
const money=n=>`$${Number(n||0).toFixed(2)}`;
const BUCKETS=[
  {key:"tops", label:"Tops", test:p=>/Sleeve|Zip|Sweater/i.test(p.name)},
  {key:"table",label:"Table",test:p=>/Tablecloth/i.test(p.name)},
  {key:"tents",label:"Tents",test:p=>/Tent/i.test(p.name)},
  {key:"all",  label:"All",  test:_=>true}
];
const bucketOf=p=>BUCKETS.find(b=>b.test(p))?.key||"all";

/* ---------- render grid ---------- */
function render(list){
  const g=$("#grid"); g.innerHTML="";
  list.forEach(p=>{
    const c=document.createElement("article");
    c.className="card";
    const m=document.createElement("div");
    m.className="card-media";

    const img=document.createElement("img");
    img.src=p.images?.[0]?.url||"";
    img.alt=p.name; m.appendChild(img);
    m.addEventListener("click",()=>openModal(p));

    if(p.variants?.length){
      const t=document.createElement("div");
      t.className="thumbs";
      p.variants.slice(0,5).forEach(v=>{
        const ti=document.createElement("img");
        ti.src=v.url; ti.alt=v.label;
        ti.addEventListener("click",e=>{
          e.stopPropagation(); openModal(p,v.url);
        });
        t.appendChild(ti);
      });
      m.appendChild(t);
    }

    const b=document.createElement("div");
    b.className="card-body";
    b.innerHTML=`<h3>${p.name}</h3><div class="price">${money(p.price)}</div>`;
    const btn=document.createElement("button");
    btn.className="btn"; btn.textContent="Buy";
    btn.onclick=()=>window.open(p.link||"#","_blank");
    b.appendChild(btn);

    c.append(m,b); g.appendChild(c);
  });
}

/* ---------- modal ---------- */
function openModal(p,start){
  const mod=$("#modal"),img=$("#modalImg"),rail=$("#rail"),cap=$("#cap");
  const deck=[...(p.images||[]).map(i=>i.url),...(p.variants||[]).map(v=>v.url)].filter(Boolean);
  if(!deck.length)return;
  let cur=deck.indexOf(start); if(cur<0)cur=0;
  function show(i){
    cur=i; img.src=deck[i]; cap.textContent=p.name;
    rail.innerHTML=""; deck.forEach((u,ix)=>{
      const t=document.createElement("img"); t.src=u;
      if(ix===i)t.className="active";
      t.onclick=()=>show(ix); rail.appendChild(t);
    });
  }
  $("#close").onclick=()=>mod.close();
  show(cur); mod.showModal();
}

/* ---------- main ---------- */
(async()=>{
  const [client,prods]=await Promise.all([
    loadJSON("data/client.json"), loadJSON("data/products.json")
  ]);
  applyBrand(client.brand||{});
  $("#siteTitle").textContent=client.name||"Storefront";

  // Filter products
  const allow=new Set(client.sku_allowlist||[]);
  const prefix=client.sku_prefixes||[];
  const products=prods.filter(p=>{
    if(!p.active)return false;
    if(allow.size)return allow.has(p.sku);
    if(prefix.length)return prefix.some(pre=>p.sku?.startsWith(pre));
    return true;
  });

  // Toolbar
  const bar=$("#toolbar");
  bar.innerHTML=`<div class="chips">
    ${BUCKETS.map(b=>`<button class="chip" data-b="${b.key}">${b.label}</button>`).join("")}
  </div>
  <div class="sort"><label>Sort</label>
    <select id="sortSel"><option value="name">A–Z</option><option value="price">Price</option></select>
  </div>`;
  let active="all", sort="name";
  const draw=()=>{
    let v=products.filter(p=>active==="all"?true:bucketOf(p)===active);
    v.sort((a,b)=>sort==="price"?(a.price||0)-(b.price||0):a.name.localeCompare(b.name));
    render(v);
  };
  bar.onclick=e=>{const b=e.target.dataset?.b;if(b){active=b;draw();}};
  $("#sortSel").onchange=e=>{sort=e.target.value;draw();};
  draw();
})();