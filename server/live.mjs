import {WebSocketServer,WebSocket} from 'ws';

// Deepgram key and provider connection remain on the local server.
export function attachLive(server, keys, connect = (url,opts) => new WebSocket(url,opts), opts = {}) {
  // In Clerk mode the browser offers subprotocols ['voxa-auth', <session token>]; the server answers 'voxa-auth'.
  const wss = new WebSocketServer({noServer:true,maxPayload:256*1024,handleProtocols:protocols=>protocols.has('voxa-auth') ? 'voxa-auth' : false});
  // A few concurrent sessions (each one is a separate Deepgram stream). Other upgrade paths are left to other handlers.
  const MAX_LIVE = Math.max(1, Number(process.env.VOXA_MAX_LIVE_SESSIONS) || 4);
  const active = new Set();
  server.on('upgrade',(req,socket,head)=>{
    const host=req.headers.host || '';
    const hostAllowed = opts.hostOk ? opts.hostOk(host) : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    if(req.url!=='/api/live') return;
    if(!hostAllowed || ![`http://${host}`,`https://${host}`].includes(req.headers.origin) || !keys.deepgram || active.size>=MAX_LIVE) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
    }
    const go=()=>wss.handleUpgrade(req,socket,head,client=>{active.add(client);wss.emit('connection',client);});
    if(!opts.authorize) return go();
    opts.authorize(req).then(ok=>{ if(ok && active.size<MAX_LIVE) go(); else socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }).catch(()=>socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'));
  });
  wss.on('connection',client=>{
    const url='wss://api.deepgram.com/v1/listen?model=nova-3&language=multi&interim_results=true&smart_format=true&endpointing=300&mip_opt_out=true';
    const upstream=connect(url,{headers:{Authorization:`Token ${keys.deepgram}`},handshakeTimeout:15000,maxPayload:1024*1024});
    const send=d=>{if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify(d));};
    const fail=()=>{send({type:'error',message:'Live transcription disconnected. Stop and analyze the recording or reconnect.'});client.close(1011);};
    const lifetime=setTimeout(()=>{send({type:'error',message:'10-minute live limit reached. Start a new consented session.'});client.close(1000);},600000);
    const keep=setInterval(()=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(JSON.stringify({type:'KeepAlive'}));},5000);
    upstream.on('open',()=>send({type:'ready'}));
    upstream.on('message',raw=>{
      try {const d=JSON.parse(raw.toString());
        if(d.type==='Results') {
          const alt=d.channel?.alternatives?.[0];
          if(typeof alt?.transcript==='string')send({type:'transcript',text:alt.transcript.slice(0,12000),final:Boolean(d.is_final),start:d.start,duration:d.duration,confidence:typeof alt.confidence==='number'&&Number.isFinite(alt.confidence)?alt.confidence:null});
        } else if(d.type==='Error')fail();
      } catch {fail();}
    });
    upstream.on('error',fail);
    upstream.on('close',()=>{if(client.readyState===WebSocket.OPEN){send({type:'ended'});client.close();}});
    client.on('message',(data,binary)=>{
      if(upstream.readyState!==WebSocket.OPEN)return;
      if(upstream.bufferedAmount>1024*1024){fail();return;}
      if(binary)upstream.send(data,{binary:true});
      else {try {if(JSON.parse(data.toString()).type==='stop')upstream.send(JSON.stringify({type:'CloseStream'}));}catch {client.close(1008);}}
    });
    const cleanup=()=>{active.delete(client);clearTimeout(lifetime);clearInterval(keep);if(upstream.readyState===WebSocket.CONNECTING)upstream.terminate();else if(upstream.readyState===WebSocket.OPEN)upstream.close();};
    client.on('close',cleanup);client.on('error',cleanup);
  });
  return wss;
}
