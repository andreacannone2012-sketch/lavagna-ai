const http=require('http'),fs=require('fs'),path=require('path');
const {GEMINI_API_KEY:GK,GROQ_API_KEY:QK,GEMINI_MODEL='gemini-3.8-flash,gemini-3.5-flash-lite',GROQ_MODEL='openai/gpt-oss-120b',PORT=3000}=process.env;
const R=p=>path.join(__dirname,p);
const MAP={'/':'public/index.html','/vendor/react.js':'node_modules/react/umd/react.production.min.js','/vendor/react-dom.js':'node_modules/react-dom/umd/react-dom.production.min.js','/vendor/htm.js':'node_modules/htm/dist/htm.umd.js'};
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff'};
const SYS=`Sei un tutor che spiega alla lavagna, in italiano, a studenti. Rispondi SOLO con JSON: {"title":"titolo breve","steps":[{"say":"2-3 frasi da pronunciare","draw":[BLOCCHI]}],"followups":["3 proposte brevi per approfondire"]}.
Tipi di blocco (campo t):
- {"t":"title","text":"..."} titolo, solo nel primo passo.
- {"t":"text|small|hl","text":"...","note":"etichetta breve opzionale","c":"pu|gr opzionale"} righe scritte a mano; hl per il risultato finale.
- {"t":"box","text":"...","arrow":true} riquadro breve; arrow se segue un altro box.
- {"t":"def","text":"Termine","body":"definizione completa, 1-3 frasi, max 260 caratteri","ex":"esempio concreto opzionale, max 160 caratteri"} RIQUADRO GRANDE con definizione.
- {"t":"ex","body":"esempio concreto o svolto, max 220 caratteri"} riquadro esempio.
- {"t":"map","text":"concetto centrale","nodes":[{"text":"max 40 caratteri","rel":"legame, max 22 caratteri, es. si divide in","sub":[{"text":"...","rel":"..."}]}]} MAPPA CONCETTUALE ad albero: 3-6 nodi, sub opzionali (max 3 per nodo).
- {"t":"list","text":"Riepilogo","items":["punto breve"]} elenco di 3-6 punti da max 70 caratteri.
Regole: 8-12 passi, ricchi di contenuto, mai risposte scarne. Per argomenti teorici usa def per OGNI termine chiave, ex per esempi concreti, almeno una map che colleghi i concetti, e chiudi con una list di riepilogo. Per esercizi e calcoli svolgi passo passo con text/box/hl e usa def/ex solo se servono. Se lo studente chiede una mappa concettuale, fai una map grande (fino a 6 nodi con sub) e pochi altri blocchi. "say" spiega a voce il contenuto del passo senza rileggerlo parola per parola, ed e pronunciabile: numeri e formule a parole (es. "tre x al quadrato"), mai simboli come ^ o *. Nei campi scritti usa ^ per gli esponenti (3x^2), niente markdown, niente LaTeX. Per text/small/hl max 30 caratteri per blocco: spezza in piu blocchi. Tra i followups includi sempre una proposta tipo "Mappa concettuale su ...".`;
const TESTO=['title','text','small','box','hl'];
function norm(s){s.say=String(s.say||'');s.draw=(Array.isArray(s.draw)?s.draw:[]).filter(d=>d&&typeof d==='object'&&d.t).map(d=>{if(TESTO.includes(d.t))d.text=String(d.text??'');return d});return s}
function parse(t){const L=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1));if(!Array.isArray(L.steps)||!L.steps.length)throw Error('Risposta AI non valida');L.steps.forEach(norm);return L}
const MODELS=GEMINI_MODEL.split(',').map(x=>x.trim()).filter(Boolean);
const TH=process.env.GEMINI_THINKING??'low';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const LOG=[];
function log(...a){const l=new Date().toISOString().slice(11,23)+' '+a.join(' ');console.log(l);LOG.push(l);if(LOG.length>200)LOG.shift()}
const mask=k=>k?k.slice(0,4)+'...'+k.slice(-3)+' ('+k.length+' caratteri)':'ASSENTE';
async function fetchT(u,o,ms=25000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{return await fetch(u,{...o,signal:c.signal})}
  catch(e){throw Error(e.name==='AbortError'?'timeout dopo '+ms/1000+'s':'rete: '+e.message+(e.cause?' ('+(e.cause.code||e.cause.message)+')':''))}
  finally{clearTimeout(t)}
}
async function gemini(p,img,sys=SYS){
  const parts=[{text:p}];
  if(img){const[m,d]=img.split(',');parts.push({inline_data:{mime_type:m.slice(5,m.indexOf(';')),data:d}})}
  let last;
  for(const m of MODELS){
    let th=!!TH;
    for(let t=0;t<3;t++){
      const t0=Date.now(),gc={responseMimeType:'application/json'};
      if(th)gc.thinkingConfig={thinkingLevel:TH};
      const body=JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:[{role:'user',parts}],generationConfig:gc});
      log('Gemini',m,'tentativo',t+1,th?'thinking='+TH:'senza thinking',img?'con foto':'');
      let r;
      try{r=await fetchT('https://generativelanguage.googleapis.com/v1beta/models/'+m+':generateContent',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':GK},body})}
      catch(e){last=Error('Gemini '+m+': '+e.message);log('ERRORE',last.message,'('+(Date.now()-t0)+'ms)');break}
      const txt=await r.text();
      log('Gemini',m,'HTTP',r.status,(Date.now()-t0)+'ms',txt.length+' byte');
      if(r.ok){
        try{return JSON.parse(txt).candidates[0].content.parts.map(x=>x.text||'').join('')}
        catch(e){last=Error('Gemini '+m+': risposta vuota o bloccata: '+txt.slice(0,200));log('ERRORE',last.message);break}
      }
      const msg=(txt.match(/"message":\s*"([^"]*)"/)||[])[1]||txt.slice(0,150);
      last=Error('Gemini '+r.status+' ('+m+') '+msg);log('ERRORE',last.message);
      if(r.status===400&&th){th=false;log('riprovo senza thinkingConfig');continue}
      if((r.status===503||r.status===429)&&t<2){await wait(1500);continue}
      break;
    }
  }
  throw last||Error('Nessun modello configurato in GEMINI_MODEL');
}
async function groq(p,sys=SYS){
  const t0=Date.now();log('Groq',GROQ_MODEL);
  const r=await fetchT('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+QK},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:'system',content:sys},{role:'user',content:p}]})});
  const txt=await r.text();log('Groq HTTP',r.status,(Date.now()-t0)+'ms',txt.length+' byte');
  if(!r.ok)throw Error('Groq '+r.status+' '+txt.slice(0,150));
  return JSON.parse(txt).choices[0].message.content;
}

const SYSQUIZ='Crei quiz di ripasso per studenti. Rispondi SOLO con JSON: {"questions":[{"q":"domanda","options":["A","B","C","D"],"answer":0,"why":"una frase che spiega la risposta giusta"}]}. Scrivi 5 domande in italiano basate SOLO sulla lezione data, di difficolta crescente, con 4 opzioni brevi (max 60 caratteri), una sola risposta giusta (answer e l indice 0-3), mai "tutte le precedenti", e varia la posizione della risposta giusta. Per le potenze usa ^ (x^2).';
/** Legge il testo JSON a pezzi e chiama emit per ogni passo completo di "steps" appena si chiude. */
function Estrattore(emit){
  let buf='',pos=0,dentro=false,prof=0,inStr=false,esc=false,inizio=-1,titolo=false;
  return{push(t){buf+=t;
    for(;pos<buf.length;pos++){const c=buf[pos];
      if(!dentro){
        if(c==='['&&/"steps"\s*:\s*$/.test(buf.slice(Math.max(0,pos-24),pos))){dentro=true;prof=0;
          if(!titolo){const m=buf.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);if(m){titolo=true;try{emit({title:JSON.parse('"'+m[1]+'"')})}catch(e){}}}}
        continue}
      if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue}
      if(c==='"'){inStr=true;continue}
      if(c==='{'){if(prof===0)inizio=pos;prof++}
      else if(c==='}'){prof--;if(prof===0&&inizio>=0){try{emit({step:norm(JSON.parse(buf.slice(inizio,pos+1)))})}catch(e){}inizio=-1}}
      else if(c===']'&&prof===0)dentro=false;
    }},testo(){return buf}}
}
/** Come gemini(), ma con la risposta a flusso: onTesto riceve i pezzi man mano che arrivano. */
async function geminiFlusso(p,img,onTesto){
  const parts=[{text:p}];
  if(img){const[m,d]=img.split(',');parts.push({inline_data:{mime_type:m.slice(5,m.indexOf(';')),data:d}})}
  let last;
  for(const m of MODELS){
    let th=!!TH;
    for(let t=0;t<3;t++){
      const t0=Date.now(),gc={responseMimeType:'application/json'};
      if(th)gc.thinkingConfig={thinkingLevel:TH};
      const body=JSON.stringify({systemInstruction:{parts:[{text:SYS}]},contents:[{role:'user',parts}],generationConfig:gc});
      log('Gemini flusso',m,'tentativo',t+1,th?'thinking='+TH:'senza thinking',img?'con foto':'');
      let r;
      try{r=await fetchT('https://generativelanguage.googleapis.com/v1beta/models/'+m+':streamGenerateContent?alt=sse',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':GK},body})}
      catch(e){last=Error('Gemini '+m+': '+e.message);log('ERRORE',last.message);break}
      if(r.ok){
        log('Gemini flusso',m,'HTTP 200 dopo',(Date.now()-t0)+'ms');
        const dec=new TextDecoder();let resto='',primo=true;
        for await(const pezzo of r.body){
          resto+=dec.decode(pezzo,{stream:true});
          let i;while((i=resto.indexOf('\n'))>=0){
            const riga=resto.slice(0,i).trim();resto=resto.slice(i+1);
            if(!riga.startsWith('data:'))continue;
            try{const j=JSON.parse(riga.slice(5));const x=(j.candidates?.[0]?.content?.parts||[]).map(y=>y.text||'').join('');
              if(x){if(primo){primo=false;log('primo testo dopo',(Date.now()-t0)+'ms')}onTesto(x)}}catch(e){}
          }
        }
        return;
      }
      const txt=await r.text();
      const msg=(txt.match(/"message":\s*"([^"]*)"/)||[])[1]||txt.slice(0,150);
      last=Error('Gemini '+r.status+' ('+m+') '+msg);log('ERRORE',last.message);
      if(r.status===400&&th){th=false;log('riprovo senza thinkingConfig');continue}
      if((r.status===503||r.status===429)&&t<2){await wait(1500);continue}
      break;
    }
  }
  throw last||Error('Nessun modello configurato in GEMINI_MODEL');
}
function promptLezione(b){
  const {q:text,image,ctx,append}=b;
  return (ctx?'Argomento precedente: '+ctx+'\n':'')
    +(append?'Stai AGGIUNGENDO passi a una lezione gia in corso: 2-4 passi, SENZA blocco title e SENZA map, spiega in modo piu semplice partendo da un esempio concreto.\n':'')
    +(image?'Lo studente allega la foto di un esercizio: spiegane la risoluzione passo passo.\n':'')+'Richiesta: '+(text||'');
}
http.createServer(async(q,s)=>{
  try{
    const url=q.url.split('?')[0];
    if(url==='/api/logs'){s.writeHead(200,{'content-type':'text/plain; charset=utf-8'});return s.end(LOG.join('\n')||'(nessun log ancora)')}
    if(url==='/api/health'){
      const out={gemini_key:mask(GK),groq_key:mask(QK),modelli_configurati:MODELS,thinking:TH||'off'};
      try{const t0=Date.now();await require('dns').promises.lookup('generativelanguage.googleapis.com');out.dns='ok '+(Date.now()-t0)+'ms'}catch(e){out.dns='ERRORE '+(e.code||e.message)}
      if(GK)try{
        const t0=Date.now(),r=await fetchT('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',{headers:{'x-goog-api-key':GK}},15000);
        out.http_gemini=r.status+' in '+(Date.now()-t0)+'ms';const j=await r.json();
        if(j.error)out.errore_google=j.error.message;
        out.modelli_disponibili=(j.models||[]).filter(m=>/gemini/.test(m.name)&&(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''));
        out.modelli_configurati_mancanti=MODELS.filter(m=>!out.modelli_disponibili.includes(m));
      }catch(e){out.http_gemini='ERRORE '+e.message}
      s.writeHead(200,{'content-type':'application/json; charset=utf-8'});return s.end(JSON.stringify(out,null,2));
    }
    if(q.method==='POST'&&url==='/api/lesson-stream'){
      let b='';for await(const c of q){b+=c;if(b.length>8e6)throw Error('Immagine troppo grande')}
      const body=JSON.parse(b),T0=Date.now(),p=promptLezione(body);
      log('Richiesta (flusso):',JSON.stringify((body.q||'').slice(0,60)),body.image?'foto '+Math.round(body.image.length/1024)+'KB':'',body.append?'aggiunta':'');
      s.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-cache','x-accel-buffering':'no'});
      const invia=o=>s.write(JSON.stringify(o)+'\n');
      let passi=0;const est=Estrattore(o=>{if(o.step)passi++;invia(o)});
      try{
        if(!GK)throw Error('Nessuna chiave API configurata (GEMINI_API_KEY vuota?)');
        try{await geminiFlusso(p,body.image,t=>est.push(t))}
        catch(e){
          if(passi>0||!QK||body.image)throw e;
          log('Gemini fallito, provo Groq:',e.message);
          const L=parse(await groq(p));if(L.title)invia({title:L.title});L.steps.forEach(x=>{passi++;invia({step:x})});
          invia({done:{title:L.title||'',followups:L.followups||[]}});return s.end();
        }
        let L={};try{L=JSON.parse(est.testo().slice(est.testo().indexOf('{'),est.testo().lastIndexOf('}')+1))}catch(e){log('JSON finale non leggibile:',e.message)}
        if(!passi)throw Error('La risposta non contiene passi: '+est.testo().slice(0,150));
        log('OK (flusso):',passi,'passi in',(Date.now()-T0)+'ms');
        invia({done:{title:L.title||'',followups:Array.isArray(L.followups)?L.followups.slice(0,3):[]}});
      }catch(e){log('FALLITO (flusso):',e.message);invia({error:e.message})}
      return s.end();
    }
    if(q.method==='POST'&&url==='/api/quiz'){
      let b='';for await(const c of q){b+=c;if(b.length>2e6)throw Error('Testo troppo lungo')}
      const {titolo,testo}=JSON.parse(b),p='Lezione: '+(titolo||'')+'\n'+String(testo||'').slice(0,12000),T0=Date.now();
      log('Quiz su:',JSON.stringify(String(titolo||'').slice(0,60)));
      let raw,err;
      for(const [name,f] of [['gemini',GK&&(()=>gemini(p,null,SYSQUIZ))],['groq',QK&&(()=>groq(p,SYSQUIZ))]].filter(x=>x[1])){
        try{raw=await f();const L=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
          const qs=(Array.isArray(L.questions)?L.questions:[]).filter(x=>x&&x.q&&Array.isArray(x.options)&&x.options.length>=2&&Number.isInteger(x.answer)&&x.answer>=0&&x.answer<x.options.length)
            .map(x=>({q:String(x.q),options:x.options.map(String),answer:x.answer,why:String(x.why||'')}));
          if(!qs.length)throw Error('Nessuna domanda valida');
          log('Quiz OK da',name+':',qs.length,'domande in',(Date.now()-T0)+'ms');
          s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify({questions:qs}));
        }catch(e){err=e;log('Quiz FALLITO',name+':',e.message)}
      }
      throw err||Error('Nessuna chiave API configurata');
    }
    if(q.method==='POST'&&url==='/api/lesson'){
      let b='';for await(const c of q){b+=c;if(b.length>8e6)throw Error('Immagine troppo grande')}
      const body=JSON.parse(b),{image}=body,T0=Date.now();
      log('Richiesta:',JSON.stringify((body.q||'').slice(0,60)),image?'foto '+Math.round(image.length/1024)+'KB':'');
      const p=promptLezione(body);
      let out,err;
      for(const [name,f] of [['gemini',GK&&(()=>gemini(p,image))],['groq',QK&&!image&&(()=>groq(p))]].filter(x=>x[1])){
        let raw;
        try{raw=await f();out=parse(raw);log('OK da',name+':',out.steps.length,'passi in',(Date.now()-T0)+'ms');break}
        catch(e){err=e;if(raw)log('Risposta grezza non valida:',raw.slice(0,300));log('FALLITO',name+':',e.message)}
      }
      if(!out)throw err||Error('Nessuna chiave API configurata (GEMINI_API_KEY vuota?)');
      s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify(out));
    }
    let f=MAP[url];const u=decodeURIComponent(url);
    if(!f&&u.startsWith('/fonts/'))f='node_modules/@fontsource/'+u.slice(7);
    f=f&&path.resolve(R(f));
    if(!f||(!f.startsWith(R('node_modules'))&&!f.startsWith(R('public')))||!fs.existsSync(f)){s.writeHead(404);return s.end()}
    s.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream','cache-control':'public,max-age=86400'});fs.createReadStream(f).pipe(s);
  }catch(e){log('ERRORE server:',e.message);s.writeHead(500,{'content-type':'application/json'});s.end(JSON.stringify({error:e.message}))}
}).listen(PORT,()=>{log('Avvio su porta',PORT);log('Gemini key:',mask(GK),'| modelli:',MODELS.join(', '),'| thinking:',TH||'off');log('Groq key:',mask(QK))});
