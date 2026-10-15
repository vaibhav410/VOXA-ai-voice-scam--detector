import http from 'node:http';
import {networkInterfaces} from 'node:os';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {detect,extractText,transcribe,liveness,intelligence,missing} from './server/providers.mjs';
import {detectRD,RD_EXT} from './server/realitydefender.mjs';
import {PROVIDERS,freeModeOn,blockReason} from './server/free-mode.mjs';
import {sniff,KIND,probe,extractAudio,ffmpegPath} from './server/media.mjs';
import {analyzeNoise,NoiseError} from './server/noise.mjs';
import {AUDO_DISCLOSURE} from './server/audo.mjs';
export const audoEnabled = (env = process.env) => /^(1|true|on|yes)$/i.test(String(env.AUDO_ENABLED || '').trim());
import './js/meeting-links.js';
const MeetingLinks = globalThis.VoxaMeetingLinks;
import {attachLive} from './server/live.mjs';
import {loadConfig, publicConfig} from './server/config.mjs';
import {createApi} from './server/api.mjs';
import {createAuth} from './server/auth.mjs';
import {openDb, migrate} from './server/db.mjs';
import {correlationId, safeLogger} from './server/audit.mjs';
import {purgeExpired} from './server/repo.mjs';
import {cleanupStaleTemp} from './server/media.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
// Existing local setup is supported; these files are never served.
export function loadEnv() { for (const name of ['.env.local','css/.env.local']) if (existsSync(path.join(root,name))) process.loadEnvFile(path.join(root,name)); }
export function loadKeys() {
  loadEnv();
  return {sealedrose:process.env.SEALEDROSE_API_KEY || process.env.sealedrose_api,realitydefender:process.env.REALITY_DEFENDER_API_KEY || process.env.reality_defender_api,luxand:process.env.LUXAND_API_KEY || process.env.luxand_api,gemini:process.env.GEMINI_API_KEY || process.env.gemini_api_key,deepgram:process.env.DEEPGRAM_API_KEY || process.env.deepgram_api || process.env.deepgram_api_key};
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff2':'font/woff2'};

// Health checks use only calls that cost nothing (account metadata). Sealed Rose and Luxand have no free probe, so they are never probed.
let healthCache = {at: 0, data: {}};
async function healthCheck(details, keys, fetcher) {
  if (Date.now() - healthCache.at > 60000) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const ping = async (name, url, headers) => {
      try {
        const r = await fetcher(url, {headers, redirect: 'error', signal: AbortSignal.timeout(8000)});
        return r.ok ? 'ok' : r.status === 401 || r.status === 403 || r.status === 400 ? 'invalid-key' : r.status === 429 ? 'rate-limited' : 'error';
      } catch { return 'unreachable'; }
    };
    const out = {};
    await Promise.all([
      details.deepgram.configured && details.deepgram.allowed && ping('deepgram', 'https://api.deepgram.com/v1/projects', {Authorization: `Token ${keys.deepgram}`}).then(h => (out.deepgram = h)),
      details.realitydefender.configured && details.realitydefender.allowed && ping('realitydefender', 'https://api.prd.realitydefender.xyz/api/v2/media/users/pages/0?size=1', {'X-API-KEY': keys.realitydefender}).then(h => (out.realitydefender = h)),
      details.gemini.configured && details.gemini.allowed && ping('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {'x-goog-api-key': keys.gemini}).then(h => (out.gemini = h))
    ]);
    healthCache = {at: Date.now(), data: out};
  }
  for (const [k, h] of Object.entries(healthCache.data)) if (details[k]?.allowed && details[k]?.configured) details[k].health = h;
  for (const k of ['sealedrose', 'luxand']) if (details[k].health === 'not-probed') details[k].healthNote = 'Not probed: any real call would use credits. Health shows after the first analysis.';
}
// Chosen by configuration, never by failure: no silent fallback to a different detector.
export function pickAuth(modality, requested, keys, env = process.env) {
  const pref = String(requested && requested !== 'auto' ? requested : env.AUTH_PROVIDER || 'auto').toLowerCase();
  if (['realitydefender', 'sealedrose'].includes(pref)) return pref;
  return modality !== 'video' && keys.realitydefender ? 'realitydefender' : 'sealedrose';
}
// Only the one extension ID you configure may call the analyze route from outside the VOXA page.
export const extensionId = (env = process.env) => /^[a-p]{32}$/.test(env.VOXA_EXTENSION_ID || '') ? env.VOXA_EXTENSION_ID : null;
const extOrigin = () => extensionId() ? `chrome-extension://${extensionId()}` : null;
// Routes that existed before accounts: in Clerk mode they need a signed-in user; provider routes also need consent.
const GATED={'/api/analyze':{providers:true,group:'analyze'},'/api/transcribe':{providers:true,group:'analyze'},'/api/intelligence':{providers:true,group:'analyze'},'/api/noise':{providers:false,group:'analyze'},'/api/meeting-link/validate':{providers:false,group:'api'}};
export function createServer(keys={}, fetcher=fetch, opts={}) {
 let busy=false;
 const cfg=opts.cfg || loadConfig({AUTH_MODE:'demo'});
 const api=createApi({cfg, db:opts.db || null, auth:opts.auth || createAuth(cfg), logger:opts.logger});
 const hostOk=h=>cfg.hosts.includes(String(h || '').replace(/:\d+$/,'').toLowerCase());
 const server=http.createServer(async(req,res)=>{
  const cid=correlationId();
  const json=(status,data,extra={})=>{if(!req.complete)req.resume();res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':cid,...extra});res.end(JSON.stringify(data));};
  const fail=(status,code,message)=>json(status,{error:message,code});
  try {
   if (!hostOk(req.headers.host)) return json(403,{error:'Local access only.'});
   const url=new URL(req.url,'http://'+req.headers.host);
   if (url.pathname.startsWith('/api/')) {
    const h={json,fail,cid};
    if (await api.handle(req,res,url,h)) return;
    const gate=GATED[url.pathname];
    if (gate && req.method==='POST' && !(await api.guard(req,url,h,gate))) return;
   }
   if (url.pathname === '/api/status' && req.method === 'GET') {
    const details={};
    for(const [name,meta] of Object.entries(PROVIDERS)) {
     const blocked=blockReason(name),configured=Boolean(keys[name]);
     details[name]={label:meta.label,class:meta.cls,configured,allowed:!blocked,blockedReason:blocked,note:meta.note,docs:meta.docs,health:!configured?'not-configured':blocked?'blocked':'not-probed'};
    }
    if(url.searchParams.get('probe')==='1') await healthCheck(details,keys,fetcher);
    const ff=await ffmpegPath();
    return json(200,{freeMode:freeModeOn(),providers:Object.fromEntries(Object.entries(details).map(([k,d])=>[k,d.configured&&d.allowed])),details,tools:{ffmpeg:Boolean(ff),extension:Boolean(extensionId()),audo:audoEnabled(),audoDisclosure:audoEnabled()?AUDO_DISCLOSURE:null},auth:publicConfig(cfg),database:await api.health().then(d=>({configured:d.configured,reachable:d.reachable??null,schemaCurrent:d.schemaCurrent??null})).catch(()=>({configured:true,reachable:false})),limits:{voiceMB:20,imageMB:10,videoMB:32},authProvider:{voice:pickAuth('voice','auto',keys),image:pickAuth('image','auto',keys),video:pickAuth('video','auto',keys)}});
   }
   if(url.pathname === '/api/meeting-link/validate' && req.method === 'POST') {
    if(req.headers.origin !== url.origin || req.headers['x-voxa-request'] !== '1') return fail(403,'FORBIDDEN','Open VOXA on this server to validate links.');
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>8192)return fail(413,'TOO_LARGE','That request is too large.');chunks.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return fail(400,'INVALID_JSON','Send JSON with a platform and a url.');}
    if(!body || typeof body.platform!=='string' || typeof body.url!=='string') return fail(400,'INVALID_REQUEST','Send JSON with a platform and a url.');
    const v=MeetingLinks.validate(body.platform,body.url);
    // Only the validation verdict is returned. Links are never logged or stored on the server.
    return v.ok ? json(200,{ok:true,platform:v.platform,url:v.url,display:v.display}) : json(422,{ok:false,error:v.error,code:'INVALID_LINK'});
   }
   if(url.pathname === '/api/intelligence' && req.method === 'POST') {
    if(req.headers.origin !== url.origin || req.headers['x-voxa-request'] !== '1') return json(403,{error:'Open VOXA on this server to analyze.'});
    if(busy) return json(429,{error:'Another analysis is running. Try again when it finishes.'});
    busy=true;
    try {
     const chunks=[];let size=0;
     for await(const chunk of req){size+=chunk.length;if(size>100000)return json(413,{error:'Transcript is too long for intelligence analysis.'});chunks.push(chunk);}
     let text;try{text=JSON.parse(Buffer.concat(chunks).toString('utf8')).text;}catch{return json(400,{error:'Invalid request.'});}
     if(typeof text!=='string' || text.trim().length<20) return json(400,{error:'A transcript of at least a few words is required.'});
     return json(200,{intelligence:await intelligence({text:text.trim(),keys,model:process.env.GEMINI_MODEL || 'gemini-2.5-flash'},fetcher)});
    } finally {busy=false;}
   }
   // Noise analysis: separate from authenticity/scam analysis. Local only (FFmpeg + JS DSP), no provider keys, no network.
   if(url.pathname === '/api/noise' && req.method === 'POST') {
    if(!(req.headers.origin === url.origin || (extOrigin() && req.headers.origin === extOrigin())) || req.headers['x-voxa-request'] !== '1') return fail(403,'FORBIDDEN','Open VOXA on this server to analyze.');
    if(busy) return fail(429,'BUSY','Another analysis is running. Try again when it finishes.');
    const declared=(req.headers['content-type'] || '').split(';')[0];
    if(!['audio/wav','audio/x-wav','audio/mpeg','audio/flac','audio/ogg','audio/mp4','audio/webm'].includes(declared)) return fail(415,'UNSUPPORTED_TYPE','Noise analysis accepts audio files only (wav, mp3, flac, ogg, m4a, webm).');
    const max=20*1048576;
    if(Number(req.headers['content-length'])>max) return fail(413,'TOO_LARGE',`File exceeds the ${max/1048576} MB limit for audio.`);
    const denoise=url.searchParams.get('denoise')==='1', enhancer=url.searchParams.get('enhancer')==='audo' ? 'audo' : 'local';
    // Cloud enhancement only when the operator enabled it AND the user consented for this request; never a silent fallback.
    if(denoise && enhancer==='audo') {
     if(!audoEnabled()) return fail(403,'PROVIDER_DISABLED','Audo noise removal is turned off on this server (AUDO_ENABLED is not set).');
     if(req.headers['x-voxa-external-consent']!=='audo') return fail(428,'CONSENT_REQUIRED','Consent is required before audio is sent to Audo AI.');
    }
    busy=true;
    try {
     const chunks=[];let size=0;
     for await(const chunk of req){size+=chunk.length;if(size>max)return fail(413,'TOO_LARGE',`File exceeds the ${max/1048576} MB limit for audio.`);chunks.push(chunk);}
     if(!size) return fail(400,'EMPTY_FILE','The file is empty. Select a non-empty audio file.');
     const bytes=Buffer.concat(chunks),sn=sniff(bytes);
     if(!sn) return fail(415,'UNRECOGNIZED_MEDIA','This is not a recognizable audio file. It may be corrupted or the wrong format.');
     if(!sn.kinds.includes('audio')) return fail(415,'TYPE_MISMATCH',`The file content is ${sn.kinds[0]}, not audio.`);
     const mime=['video/mp4','video/webm','video/quicktime'].includes(sn.type) ? declared : sn.type;
     let info;try {info=await probe(bytes,mime);} catch {info={available:true,readable:false};}
     if(!info.available) return fail(503,'FFMPEG_MISSING','Noise analysis needs FFmpeg, which is not available on this server. No result was produced.');
     if(!info.readable) return fail(422,'UNREADABLE_MEDIA','This file could not be decoded. It may be corrupted or use an unsupported codec.');
     if(!info.audio) return fail(422,'NO_AUDIO','This file has no audio track.');
     if(info.duration!==null && info.duration<1) return fail(422,'TOO_SHORT','The audio is shorter than 1 second.');
     if(info.duration!==null && info.duration>300) return fail(422,'TOO_LONG','Noise analysis accepts audio up to 5 minutes.');
     const ac=new AbortController();res.on('close',()=>{if(!res.writableEnded)ac.abort();});
     const {report,enhanced}=await analyzeNoise({bytes,mime,info,denoise,enhancer,fetcher,signal:ac.signal});
     return json(200,{noise:report,enhancedAudio:enhanced ? {mime:enhanced.mime,sampleRate:enhanced.sampleRate,channels:enhanced.channels,sizeBytes:enhanced.sizeBytes,base64:enhanced.bytes.toString('base64')} : null});
    } catch(e) {
     if(e instanceof NoiseError) return fail(e.status,e.code,e.message);
     throw e;
    } finally {busy=false;}
   }
   if(['/api/analyze','/api/transcribe'].includes(url.pathname) && req.method === 'POST') {
    if(!(req.headers.origin === url.origin || (extOrigin() && req.headers.origin === extOrigin())) || req.headers['x-voxa-request'] !== '1') return fail(403,'FORBIDDEN','Open VOXA on this server to analyze.');
    if(busy) return fail(429,'BUSY','Another analysis is running. Try again when it finishes.');
    const transcriptionOnly=url.pathname === '/api/transcribe';
    const modality=url.searchParams.get('modality'),provider=url.searchParams.get('provider');
    const textProvider=url.searchParams.get('textProvider') || 'gemini';
    if (!['gemini','deepgram'].includes(textProvider) || (url.searchParams.get('extract')==='1' && textProvider==='deepgram' && modality==='image')) return fail(400,'UNSUPPORTED_PROVIDER','That transcription service does not support this media type.');
    const declared=(req.headers['content-type'] || '').split(';')[0];
    const allowed={voice:['audio/wav','audio/x-wav','audio/mpeg','audio/flac','audio/ogg','audio/mp4','audio/webm'],image:['image/jpeg','image/png','image/webp'],video:['video/mp4','video/webm','video/quicktime']};
    if(!allowed[modality]) return fail(400,'UNSUPPORTED_MODALITY','Choose voice, image or video.');
    if(!allowed[modality].includes(declared) || (!transcriptionOnly && !['auto','realitydefender','sealedrose'].includes(provider))) return fail(415,'UNSUPPORTED_TYPE','Unsupported media type or provider.');
    const max=(modality==='image' ? 10 : modality==='voice' ? 20 : 32)*1048576;
    if(Number(req.headers['content-length'])>max) return fail(413,'TOO_LARGE',`File exceeds the ${max/1048576} MB limit for ${modality}.`);
    busy=true;
    try {
     // Cancel upstream provider calls if the browser disconnects, so no credits are spent on abandoned requests.
     const ac=new AbortController();res.on('close',()=>{if(!res.writableEnded)ac.abort();});
     const chunks=[];let size=0;
     for await(const chunk of req){size+=chunk.length;if(size>max)return fail(413,'TOO_LARGE',`File exceeds the ${max/1048576} MB limit for ${modality}.`);chunks.push(chunk);}
     if(!size) return fail(400,'EMPTY_FILE','The file is empty. Select a non-empty media file.');
     const bytes=Buffer.concat(chunks);
     // Trust the bytes, not the file name or declared type.
     const sn=sniff(bytes);
     if(!sn) return fail(415,'UNRECOGNIZED_MEDIA','This is not a recognizable audio, image or video file. It may be corrupted or the wrong format.');
     if(!sn.kinds.includes(KIND[modality])) return fail(415,'TYPE_MISMATCH',`The file content is ${sn.kinds[0]}, not ${KIND[modality]}. Use the matching tab.`);
     const container=['video/mp4','video/webm','video/quicktime'].includes(sn.type);
     const mime=container ? declared : sn.type;
     let info=null;
     if(modality!=='image') {
      try {info=await probe(bytes,mime);} catch {info={available:true,readable:false};}
      if(info.available && !info.readable) return fail(422,'UNREADABLE_MEDIA','This file could not be decoded. It may be corrupted or use an unsupported codec.');
      if(modality==='video' && info.available && !info.video) return fail(422,'NO_VIDEO_STREAM','This file has no video track. Use the Voice tab for audio.');
      if(info.available && info.duration!==null && info.duration<1) return fail(422,'TOO_SHORT','The media is shorter than 1 second.');
     }
     const model=process.env.GEMINI_MODEL || 'gemini-2.5-flash';
     const authProvider=pickAuth(modality,provider,keys);
     const args={provider:authProvider,modality,bytes,mime,keys,model,signal:ac.signal};
     // Reality Defender rejects WebM; convert microphone recordings locally with FFmpeg first.
     const authenticate=async(a)=>{
      if(a.provider!=='realitydefender') return detect(a,fetcher);
      if(a.modality!=='image' && !RD_EXT[a.mime]) {
       let wav=null;try {wav=await extractAudio(a.bytes,a.mime);} catch {}
       if(!wav?.length) return missing('realitydefender','This audio format needs FFmpeg conversion, which is not available.','UNSUPPORTED_MEDIA');
       a={...a,bytes:wav,mime:'audio/wav'};
      }
      return detectRD(a,fetcher);
     };
     const speech=async()=>{
      let a=args;
      if(modality==='video' && info?.available) {
       if(!info.audio) return missing(textProvider,'This video has no audio track, so there is nothing to transcribe.','NO_AUDIO');
       try {const wav=await extractAudio(bytes,mime);if(wav?.length)a={...args,bytes:wav,mime:'audio/wav'};} catch {}
      }
      return textProvider==='deepgram' ? transcribe(a,fetcher) : extractText(a,fetcher);
     };
     const media={detectedType:sn.type,...(info?.available ? {duration:info.duration,audio:info.audio,video:info.video} : {inspected:false})};
     if(transcriptionOnly) return json(200,{extraction:await speech(),media});
     const soundtrack=async()=>{
      if(modality!=='video' || url.searchParams.get('soundtrack')!=='1') return null;
      if(!info?.available) return missing(pickAuth('voice',provider,keys),'Soundtrack check needs FFmpeg, which is not available.','FFMPEG_MISSING');
      if(!info.audio) return missing(pickAuth('voice',provider,keys),'This video has no audio track.','NO_AUDIO');
      try {const wav=await extractAudio(bytes,mime);return await authenticate({...args,provider:pickAuth('voice',provider,keys),modality:'voice',bytes:wav,mime:'audio/wav'});} catch {return missing(pickAuth('voice',provider,keys),'The soundtrack could not be extracted from this video.','EXTRACT_FAILED');}
     };
     const [authenticity,audioAuthenticity,extraction,context]=await Promise.all([
      authenticate(args),
      soundtrack(),
      url.searchParams.get('extract')==='1' ? speech() : null,
      url.searchParams.get('liveness')==='1' && modality==='image' && ['image/jpeg','image/png'].includes(mime) ? liveness(args,fetcher) : null
     ]);
     return json(200,{authenticity,audioAuthenticity,extraction,context,media});
    } finally {busy=false;}
   }
   if(req.method!=='GET' && req.method!=='HEAD') return json(405,{error:'Method not allowed.'});
   const p=decodeURIComponent(url.pathname);
   // Explicit public asset allowlist prevents accidental publication of keys, sources, or archives.
   if(!/^\/(?:index\.html|login\.html|app\.html|design-tokens\.css|css\/[a-zA-Z0-9_-]+\.css|js\/[a-zA-Z0-9_-]+\.js|assets\/fonts\/[a-zA-Z0-9_-]+\.woff2)?$/.test(p)) return json(404,{error:'Not found.'});
   const target=path.join(root,p==='/' ? 'index.html' : p.slice(1));
   const data=await readFile(target);
   res.writeHead(200,{'Content-Type':types[path.extname(target)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(req.method==='HEAD' ? undefined : data);
  } catch(e) {if(!res.headersSent)json(e.code==='ENOENT'?404:500,{error:e.code==='ENOENT'?'Not found.':'Request could not be completed.'});else res.end();}
 });
 server.voxa={cfg,api,hostOk};
 return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const keys=loadKeys();
 const portArg=process.argv.find(arg=>/^--port=\d+$/.test(arg));
 const cfg=loadConfig(portArg ? {...process.env,PORT:portArg.slice(7)} : process.env), log=safeLogger();
 const lan=process.argv.includes('--lan');
 const lanAddresses=lan ? Object.values(networkInterfaces()).flat().filter(ip=>ip.family==='IPv4'&&!ip.internal&&!ip.address.startsWith('169.254.')).map(ip=>ip.address) : [];
 if(lan && cfg.prod) { console.error('Use the production host and TLS configuration for public hosting; --lan is for local network previews.'); process.exit(1); }
 if(lan) {
  cfg.hosts=[...new Set([...cfg.hosts,...lanAddresses])];
  cfg.origins=[...new Set([...cfg.origins,...lanAddresses.map(ip=>`http://${ip}:${cfg.port}`)])];
 }
 for (const w of cfg.warnings) console.warn('[config] ' + w);
 for (const e of cfg.errors) console.error('[config] ERROR ' + e);
 if (cfg.prod && cfg.errors.length) { console.error('Refusing to start in production with unsafe configuration. Fix the errors above (see PRIVACY_SETUP.md).'); process.exit(1); }
 let db=null;
 try {
  db=await openDb(cfg.db);
  if (db && db.kind!=='postgres') await migrate(db); // local development database migrates itself
 } catch(e) { console.error('[db] not available: ' + (e.code || 'connection failed') + '. Server-side history is off until this is fixed (npm run db:check).'); db=null; }
 const auth=createAuth(cfg);
 const server=createServer(keys,fetch,{cfg,db,auth,logger:log});server.requestTimeout=300000;
 attachLive(server,keys,undefined,{hostOk:server.voxa.hostOk,authorize:async req=>{const id=await auth.identifyWs(req);return Boolean(id && !id.invalid);}});
 const housekeeping=async()=>{ try { if (db && await server.voxa.api.ready()) { const r=await purgeExpired(db); if (r.analyses||r.transcripts||r.invitations||r.auditEvents) log('retention_purge',{count:r.analyses+r.transcripts+r.invitations+r.auditEvents}); } } catch {} try { await cleanupStaleTemp(); } catch {} };
 housekeeping(); setInterval(housekeeping,3600000).unref();
 server.listen(cfg.port,lan?'0.0.0.0':'127.0.0.1',()=>{
  console.log(`VOXA running at http://127.0.0.1:${cfg.port} (auth: ${cfg.auth.mode}, database: ${db ? db.kind : 'none'})`);
  for(const ip of lanAddresses)console.log(`Same-network access: http://${ip}:${cfg.port}`);
 });
}
