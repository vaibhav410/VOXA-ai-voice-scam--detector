(() => {
 const button=document.querySelector('.nav-toggle'),links=document.querySelector('#site-links');
 if(!button||!links)return;
 const close=()=>{button.setAttribute('aria-expanded','false');links.classList.remove('open');};
 button.onclick=()=>{const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));links.classList.toggle('open',open);};
 links.addEventListener('click',e=>{if(e.target.closest('a'))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 document.addEventListener('click',e=>{if(!e.target.closest('.site-nav'))close();});
})();
