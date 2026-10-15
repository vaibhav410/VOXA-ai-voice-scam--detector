import {WebSocketServer,WebSocket} from 'ws';

// Deepgram key and provider connection remain on the local server.
export function attachLive(server, keys, connect = (url,opts) => new WebSocket(url,opts)) {
  const wss = new WebSocketServer({noServer:true,maxPayload:256*1024});
  let active = null;
  server.on('upgrade',(req,socket,head)=>{
    const host=req.headers.host || '';
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || req.url!=='/api/live' || req.headers.origin!==`http://${host}` || !keys.deepgram || active) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
    }
    wss.handleUpgrade(req,socket,head,client=>{active=client;wss.emit('connection',client);});
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
          if(typeof alt?.transcript==='string')send({type:'transcript',text:alt.transcript.slice(0,12000),final:Boolean(d.is_final),start:d.start,duration:d.duration});
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
    const cleanup=()=>{if(active===client)active=null;clearTimeout(lifetime);clearInterval(keep);if(upstream.readyState===WebSocket.CONNECTING)upstream.terminate();else if(upstream.readyState===WebSocket.OPEN)upstream.close();};
    client.on('close',cleanup);client.on('error',cleanup);
  });
  return wss;
}
