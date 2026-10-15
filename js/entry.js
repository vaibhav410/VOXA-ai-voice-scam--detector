(() => {
 const q=new URLSearchParams(location.search),$=id=>document.getElementById(id);
 const allowed=new Set(['dashboard','call-safety','analyze','live','incidents','evaluation','settings','meetings','reports','chrome-extension','integrations','intelligence','signal','watermarking','team','api-keys','profile','history','noise','privacy','audit','invite']);
 const nextRaw=q.get('next')||'', next=allowed.has(nextRaw.split('/')[0])?nextRaw:'dashboard';
 const target=next==='dashboard'?'app.html':'app.html#/'+next;
 const show=on=>{const el=$('f');if(el)el.style.visibility=on?'':'hidden';};
 show(false);
 const demoEntry=()=>{
  try {if(localStorage.getItem('voxa:session')&&!q.has('out')){location.replace(target);return;}}catch{}
  show(true);
  if(q.has('out'))$('out').hidden=false;
  const enter=name=>{
   try {localStorage.setItem('voxa:session',JSON.stringify({name:name||'Demo User',email:'Local workspace'}));}
   catch{$('err').textContent='Browser storage is blocked. Enable storage for this local site to open the workspace.';return;}
   location.href=target;
  };
  $('f').onsubmit=e=>{e.preventDefault();enter($('name').value.trim());};
  $('demo').onclick=()=>enter('Demo User');
 };
 // Clerk mode: real sign-in. After signing in, Clerk returns here; auth.js records the session label, then we enter.
 const clerkEntry=clerk=>{
  if(clerk.user && !q.has('out')){location.replace(target);return;}
  $('f').hidden=true;
  const box=$('clerk-box');box.hidden=false;
  if(q.has('out'))$('clerk-out').hidden=false;
  clerk.mountSignIn($('clerk-signin'),{fallbackRedirectUrl:location.pathname+'?next='+encodeURIComponent(next),signUpFallbackRedirectUrl:location.pathname+'?next='+encodeURIComponent(next)});
  clerk.addListener(({user})=>{if(user)location.replace(target);});
 };
 window.VoxaAuth.ready.then(s=>{if(s.mode==='clerk'&&s.clerk)clerkEntry(s.clerk);else demoEntry();}).catch(e=>{
  show(true);$('f').innerHTML='<p class="eyebrow-v2">Sign-in unavailable</p><h1>Could not start sign-in.</h1><p class="hint"></p>';$('f').querySelector('.hint').textContent=e.message||'Check your connection and try again.';
 });
})();
