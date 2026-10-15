(() => {
 const q=new URLSearchParams(location.search),$=id=>document.getElementById(id);
 const allowed=new Set(['dashboard','call-safety','analyze','live','incidents','evaluation','settings','meetings','reports','chrome-extension','integrations','intelligence','signal','watermarking','team','api-keys','profile']);
 const next=allowed.has(q.get('next'))?q.get('next'):'dashboard';
 try {if(localStorage.getItem('voxa:session')&&!q.has('out')){location.replace(next==='dashboard'?'app.html':'app.html#/'+next);return;}}catch{}
 if(q.has('out'))$('out').hidden=false;
 const enter=name=>{
  try {localStorage.setItem('voxa:session',JSON.stringify({name:name||'Demo User',email:'Local workspace'}));}
  catch{$('err').textContent='Browser storage is blocked. Enable storage for this local site to open the workspace.';return;}
  location.href=next==='dashboard'?'app.html':'app.html#/'+next;
 };
 $('f').onsubmit=e=>{e.preventDefault();enter($('name').value.trim());};
 $('demo').onclick=()=>enter('Demo User');
})();
