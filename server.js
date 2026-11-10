const http=require('http'),fs=require('fs'),path=require('path');
const {GEMINI_API_KEY:GK,GROQ_API_KEY:QK,GEMINI_MODEL='gemini-2.5-flash',GROQ_MODEL='openai/gpt-oss-120b',PORT=3000}=process.env;
const R=p=>path.join(__dirname,p);
const MAP={'/':'public/index.html','/vendor/react.js':'node_modules/react/umd/react.production.min.js','/vendor/react-dom.js':'node_modules/react-dom/umd/react-dom.production.min.js','/vendor/htm.js':'node_modules/htm/dist/htm.umd.js'};
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff'};
const SYS='Sei un tutor che spiega alla lavagna, in italiano, a studenti. Rispondi SOLO con JSON: {"title":"titolo breve","steps":[{"say":"1-2 frasi da pronunciare","draw":[{"t":"title|text|small|box|hl","text":"...","note":"etichetta breve opzionale, solo per text","c":"pu|gr opzionale","arrow":true}]}],"followups":["3 proposte brevi per approfondire"]}. '+
'Regole: 5-9 passi. Il primo passo scrive il titolo (t:title). "say" deve essere pronunciabile: scrivi numeri e formule a parole (es. "tre x al quadrato"), mai simboli come ^ o *. "text" e cio che si scrive: formule brevi con ^ per gli esponenti (3x^2), massimo 30 caratteri per blocco, spezza in piu blocchi. Usa box per definizioni e schemi (arrow:true se segue un altro box), hl per il risultato finale, c:"pu" per titoletti come "Somma i simili:". Niente markdown, niente LaTeX.';
function parse(t){const L=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1));if(!Array.isArray(L.steps)||!L.steps.length)throw Error('Risposta AI non valida');return L}
async function gemini(p,img){
  const parts=[{text:p}];
  if(img){const[m,d]=img.split(',');parts.push({inline_data:{mime_type:m.slice(5,m.indexOf(';')),data:d}})}
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':GK},body:JSON.stringify({systemInstruction:{parts:[{text:SYS}]},contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json'}})});
  if(!r.ok)throw Error('Gemini '+r.status);
  return (await r.json()).candidates[0].content.parts.map(x=>x.text||'').join('');
}
async function groq(p){
  const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+QK},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:'system',content:SYS},{role:'user',content:p}]})});
  if(!r.ok)throw Error('Groq '+r.status);
  return (await r.json()).choices[0].message.content;
}
http.createServer(async(q,s)=>{
  try{
    const url=q.url.split('?')[0];
    if(q.method==='POST'&&url==='/api/lesson'){
      let b='';for await(const c of q){b+=c;if(b.length>8e6)throw Error('Immagine troppo grande')}
      const {q:text,image,ctx}=JSON.parse(b);
      const p=(ctx?'Argomento precedente: '+ctx+'\n':'')+(image?'Lo studente allega la foto di un esercizio: spiegane la risoluzione passo passo.\n':'')+'Richiesta: '+(text||'');
      let out,err;
      for(const f of [GK&&(()=>gemini(p,image)),QK&&!image&&(()=>groq(p))].filter(Boolean)){try{out=parse(await f());break}catch(e){err=e}}
      if(!out)throw err||Error('Nessuna chiave API configurata');
      s.writeHead(200,{'content-type':'application/json'});return s.end(JSON.stringify(out));
    }
    let f=MAP[url];const u=decodeURIComponent(url);
    if(!f&&u.startsWith('/fonts/'))f='node_modules/@fontsource/'+u.slice(7);
    f=f&&path.resolve(R(f));
    if(!f||(!f.startsWith(R('node_modules'))&&!f.startsWith(R('public')))||!fs.existsSync(f)){s.writeHead(404);return s.end()}
    s.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream','cache-control':'public,max-age=86400'});fs.createReadStream(f).pipe(s);
  }catch(e){s.writeHead(500,{'content-type':'application/json'});s.end(JSON.stringify({error:e.message}))}
}).listen(PORT,()=>console.log('Lavagna AI su http://localhost:'+PORT));
