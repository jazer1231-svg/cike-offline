/* 词刻：零依赖、离线优先、本机 IndexedDB 版。不开通账户、无服务器请求。 */
(() => {
  'use strict';
  const DB_NAME = 'cike-offline-v1';
  const DB_VERSION = 1;
  const DAY_INTERVALS = [1, 3, 7, 14, 30, 60];
  const main = document.querySelector('#main');
  const importInput = document.querySelector('#import-file');
  const restoreInput = document.querySelector('#restore-file');
  const toastEl = document.querySelector('#toast');
  let db;
  let page = 'today';
  let words = [];
  let progress = new Map();
  let settings = { dailyNew: 15 };
  let revealed = false;
  let currentId = '';
  let searchTerm = '';
  let listLimit = 35;
  let toastTimeout = 0;
  const h = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  function addDays(day, n) { const [y,m,d] = day.split('-').map(Number); const dt = new Date(y, m-1, d + n, 12); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; }
  const txDone = tx => new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error || Error('写入事务失败'));tx.onabort=()=>reject(tx.error || Error('写入已取消'));});
  const reqResult = req => new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error || Error('读取失败'));});
  function openDB() {
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('words')) d.createObjectStore('words', {keyPath:'id'});
        if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress', {keyPath:'id'});
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', {keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || Error('本地存储无法打开'));
      req.onblocked=()=>reject(Error('数据库被其他页面占用，请关闭其他词刻页面后再打开'));
    });
  }
  async function readAll() {
    const tx = db.transaction(['words','progress','settings'],'readonly');
    const [w,p,s] = await Promise.all([reqResult(tx.objectStore('words').getAll()),reqResult(tx.objectStore('progress').getAll()),reqResult(tx.objectStore('settings').get('main'))]);
    words = w.sort((a,b) => a.source_row - b.source_row);
    progress = new Map(p.map(x => [x.id,x]));
    settings = {dailyNew: [10,15,20].includes(Number(s?.dailyNew)) ? Number(s.dailyNew) : 15};
  }
  function toast(message) { toastEl.textContent=message;toastEl.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>toastEl.classList.remove('show'),3500); }
  function stat() {
    const date = todayKey();
    const due = []; const fresh = []; let seen = 0; let completedToday = 0; let newToday = 0; let mature = 0; let totalCorrect=0;let totalWrong=0;
    for (const w of words) {
      const p = progress.get(w.id);
      if (!p) {fresh.push(w);continue;}
      seen++;
      totalCorrect += Number(p.correct)||0; totalWrong += Number(p.wrong)||0;
      if ((p.stage||0)>=3) mature++;
      if (p.firstSeenDay===date) newToday++;
      if (p.lastSeenDay===date) completedToday++;
      if (p.dueOn <= date && p.lastSeenDay!==date) due.push(w);
    }
    const room = Math.max(0, settings.dailyNew-newToday);
    const queue = due.concat(fresh.slice(0,room));
    return { date, due, fresh, queue, room, seen, mature, completedToday, newToday, totalCorrect, totalWrong };
  }
  function render() {
    document.querySelectorAll('.nav-item').forEach(el=>{const active=el.dataset.nav===page;el.classList.toggle('active',active);el.setAttribute('aria-current',active?'page':'false');});
    try {
      if(page==='today') renderToday();
      if(page==='library') renderLibrary();
      if(page==='progress') renderProgress();
      if(page==='backup') renderBackup();
    } catch(e){main.innerHTML=`<section class="card"><h2>页面显示失败</h2><p>${h(e.message)}</p></section>`;}
  }
  function noWordsView() {
    return `<div class="kicker">START HERE</div><h1 class="page-title">先导入你的私人词表</h1><p class="page-sub">词刻的程序和词库分开保存。这样可以免费使用，也不会把购买的课程词表放到公开网站。</p>
      <section class="card"><div class="empty-state"><div class="empty-icon">✧</div><h2>1110 条单词，准备开始</h2><p>下载包内找到 <b>私人词库/曹胖1100词_私人导入.json</b>，在手机“文件”App中保存，然后点下方按钮导入。</p><button class="btn btn-main btn-full" data-action="import">选择词表文件</button></div></section>
      <p class="hint-box">首次需要导入一次词库。数据只保存在当前设备；它不会被上传到任何服务器。添加到 iPhone 主屏幕后，请在主屏幕版本里导入。</p>`;
  }
  function renderToday() {
    if(!words.length) {main.innerHTML = noWordsView();return;}
    const s = stat();
    const desired = s.queue.find(w=>w.id===currentId) || s.queue[0];
    if(!desired){currentId='';revealed=false;} else if(currentId!==desired.id){currentId=desired.id;revealed=false;}
    const totalToday = s.completedToday + s.queue.length;
    const percentage = totalToday? Math.round(s.completedToday/totalToday*100) : 100;
    let card = '';
    if(!desired){card=`<section class="card"><div class="empty-state"><div class="empty-icon">✓</div><h2>今天的计划完成了</h2><p>新词和到期复习都已处理。明天再来，系统会自动安排下一组。</p><button class="btn btn-light" data-nav="progress">看看学习进度</button></div></section>`;}
    else {
      const p = progress.get(desired.id);
      const isReview=Boolean(p);
      card = `<div class="section-head"><h2>${isReview?'到期复习':'学习新词'}</h2><span class="chip">剩余 ${s.queue.length} 词</span></div>
        <section class="flashcard" aria-label="单词记忆卡片"><div class="flash-top">${isReview?'REVIEW · 复习':'NEW WORD · 新词'}</div>
        <div class="word">${h(desired.word)}</div><div class="phonetic">${h(desired.phonetic||'')}</div>
        <button class="sound" data-action="speak" data-id="${h(desired.id)}" aria-label="朗读 ${h(desired.word)}">◖)) 点击朗读</button>
        ${revealed?`<div class="divider" style="width:70%;margin-top:26px;margin-bottom:0"></div><div class="meaning">${h(desired.meaning)}</div>${desired.note_1?`<div class="note">${h(desired.note_1)}</div>`:''}`:`<div class="answer-hint">先回忆中文含义，再查看答案</div>`}
        </section>
        ${revealed?`<div class="button-grid"><button class="btn btn-warm" data-action="rate" data-rating="again">还不熟 · 明天再练</button><button class="btn btn-main" data-action="rate" data-rating="good">记住了 · 下次复习</button></div>`:`<button class="btn btn-main btn-full" style="margin-top:13px" data-action="reveal">显示中文答案</button>`}
        <div class="hint-box">“记住了”会逐步延长复习间隔（1、3、7、14、30、60天）。“还不熟”明天继续练。你自己判断是否记住，不需要额外的错题本。</div>`;
    }
    main.innerHTML = `<div class="kicker">DAILY PRACTICE · ${h(s.date)}</div><h1 class="page-title">今天，也记住一点</h1><p class="page-sub">先复习，再学新词。每天${settings.dailyNew}个新词，不求一次全会。</p>
      <div class="stat-grid"><div class="mini-card"><div class="caption">今日已练</div><div class="big-stat">${s.completedToday}</div></div><div class="mini-card"><div class="caption">今日新词</div><div class="big-stat">${s.newToday}<span class="muted small"> / ${settings.dailyNew}</span></div></div><div class="mini-card"><div class="caption">累计学习</div><div class="big-stat">${s.seen}</div></div></div>
      <div class="progress-line"><div class="progress-fill" style="width:${percentage}%"></div></div>${card}`;
  }
  function renderLibrary() {
    if(!words.length){main.innerHTML=noWordsView();return;}
    const q=searchTerm.trim().toLocaleLowerCase();
    const matches=q ? words.filter(w=>`${w.word} ${w.meaning} ${w.phonetic}`.toLocaleLowerCase().includes(q)) : words;
    const visible=matches.slice(0,listLimit);
    main.innerHTML=`<div class="kicker">VOCABULARY</div><h1 class="page-title">你的词库</h1><p class="page-sub">共 ${words.length} 条词汇记录，${new Set(words.map(x=>x.word.toLocaleLowerCase())).size} 个不同英文单词。</p>
      <input id="search" class="searchbox" placeholder="搜索英文或中文…" value="${h(searchTerm)}" aria-label="搜索词库"/>
      <div class="word-list">${visible.map(w=>`<div class="word-row"><div><div class="en">${h(w.word)}</div><div class="ipa">${h(w.phonetic)}</div><div class="zh">${h(w.meaning)}</div></div><button class="tiny-btn" data-action="speak" data-id="${h(w.id)}">朗读</button></div>`).join('')}</div>
      ${matches.length>visible.length?`<button class="btn btn-outline btn-full" style="margin-top:15px" data-action="more">再显示35个（还有${matches.length-visible.length}个）</button>`:''}
      ${matches.length===0?`<section class="card"><p class="muted">没有找到匹配的单词。</p></section>`:''}`;
  }
  function renderProgress() {
    if(!words.length){main.innerHTML=noWordsView();return;}
    const s=stat();
    const pct= Math.round(s.seen/words.length*100);
    const known= s.totalCorrect+s.totalWrong;
    const goodpct= known? Math.round(s.totalCorrect/known*100):0;
    main.innerHTML = `<div class="kicker">YOUR PROGRESS</div><h1 class="page-title">积累会看得见</h1><p class="page-sub">这里记录当前设备上的实际学习情况，不依赖登录。</p>
      <section class="card"><div class="setting-row"><div><div class="small muted">已接触词条</div><div class="big-stat">${s.seen} <span class="small muted">/ ${words.length}</span></div></div><div class="chip">${pct}%</div></div><div class="progress-line"><div class="progress-fill" style="width:${pct}%"></div></div></section>
      <section class="card"><div class="stat-row"><span>当前待复习</span><b>${s.due.length} 词</b></div><div class="stat-row"><span>今日已学习/复习</span><b>${s.completedToday} 词</b></div><div class="stat-row"><span>已达到第3阶段及以上</span><b>${s.mature} 词</b></div><div class="stat-row"><span>累计“记住了”次数</span><b>${s.totalCorrect}</b></div><div class="stat-row"><span>累计“还不熟”次数</span><b>${s.totalWrong}</b></div><div class="stat-row"><span>自评“记住了”比例</span><b>${goodpct}%</b></div></section><div class="hint-box">这里的正确率是你的主观记忆自评，不等于学位英语考试分数。重复词条也按原始词表分别计数。</div>`;
  }
  function renderBackup() {
    main.innerHTML = `<div class="kicker">SETTINGS & BACKUP</div><h1 class="page-title">设置与备份</h1><p class="page-sub">本应用完全在设备本地保存记录。换设备时请手动导出、导入备份。</p>
      <section class="card"><div class="setting-row"><div><b>每日新学单词</b><div class="small muted" style="margin-top:5px">到期复习不计入新词上限</div></div><select id="daily-setting" aria-label="每天新词数">${[10,15,20].map(n=>`<option value="${n}" ${settings.dailyNew===n?'selected':''}>${n} 个</option>`).join('')}</select></div></section>
      <div class="section-head"><h2>词表管理</h2></div><section class="card"><div class="stat-row"><span>本地词库</span><b>${words.length} 词条</b></div><button class="btn btn-outline btn-full" style="margin-top:15px" data-action="import">${words.length?'重新导入同一词表':'导入私人词表'}</button><div class="route-note" style="margin-top:9px">支持本项目提供的 JSON 词表，也支持原备份内 Sheet1 CSV（UTF-8）。为保护记忆记录，不允许带着历史进度切换成不同词表。</div></section>
      <div class="section-head"><h2>学习数据安全</h2></div><section class="card"><p class="small muted" style="line-height:1.7">备份包含词库、记忆记录及每日新词设置。文件只下载到当前设备，不上传服务器。</p>
      <button class="btn btn-main btn-full" data-action="export">导出完整备份（JSON）</button><button class="btn btn-outline btn-full" style="margin-top:10px" data-action="restore">从备份恢复到此设备</button></section>
      <div class="warning"><b>重要：</b>手机清理网站数据、删除网页应用或长期不使用，都可能导致本地记录丢失。建议每周导出一次完整备份并保存到 iCloud 云盘或你自己的文件夹。<br/>Safari 与添加到主屏幕的网页应用可能使用不同存储空间；请在常用的主屏幕版本中导入词表和学习。</div>
      <div class="section-head"><h2>离线使用</h2></div><section class="card"><div class="stat-row"><span>网页应用缓存</span><b id="offline-status">检查中…</b></div><div class="stat-row"><span>当前网络</span><b>${navigator.onLine?'在线':'离线'}</b></div><div class="route-note" style="margin-top:12px">首次通过 HTTPS 打开并完成页面缓存后，可从主屏幕离线打开。英文朗读是否能离线播放取决于设备是否具备可用的本地英文语音。</div></section>`;
    if(document.querySelector('#offline-status')) document.querySelector('#offline-status').textContent = ('serviceWorker' in navigator && navigator.serviceWorker.controller) ? '已受离线缓存保护' : (location.protocol==='file:'?'文件模式：未缓存':'尚未确认缓存');
  }
  function speak(id) {
    const w = words.find(x=>x.id===id);
    if(!w) {toast('没有找到该单词');return;}
    if(!('speechSynthesis' in window)){toast('当前浏览器不支持朗读，请使用 Safari / Chrome');return;}
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(w.word);
      u.lang='en-US';u.rate=.84;u.pitch=1;
      const vs=window.speechSynthesis.getVoices();
      u.voice=vs.find(v=>v.lang.toLowerCase().startsWith('en') && v.localService) || vs.find(v=>v.lang.toLowerCase().startsWith('en-us')) || null;
      u.onerror=()=>toast('朗读失败：请检查系统英文语音和音量');
      window.speechSynthesis.speak(u);
    } catch(err){ toast(`朗读不可用：${err.message}`); }
  }
  async function rate(rating) {
    const w = words.find(x=>x.id===currentId);
    if(!w || !revealed) return;
    const day=todayKey(), old=progress.get(w.id), good=rating==='good';
    const stage=good?Math.min(6,(old?.stage || 0)+1):0;
    const dueOn=addDays(day, good?DAY_INTERVALS[stage-1]:1);
    const p={ id:w.id, stage, seen:(old?.seen||0)+1, correct:(old?.correct||0)+(good?1:0), wrong:(old?.wrong||0)+(good?0:1), firstSeenDay:old?.firstSeenDay||day,lastSeenDay:day,dueOn,updatedAt:new Date().toISOString()};
    const tx=db.transaction('progress','readwrite');tx.objectStore('progress').put(p);await txDone(tx);
    progress.set(w.id,p);currentId='';revealed=false;render();
    toast(good?`已保存 · ${DAY_INTERVALS[stage-1]}天后复习`:'已保存 · 明天再练');
  }
  function parseCSV(text) {
    const out=[];let row=[],cell='',quoted=false;
    text=text.replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))out.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(quoted)throw Error('CSV 引号不匹配');
    row.push(cell);if(row.some(x=>x!==''))out.push(row);
    if(!out.length)throw Error('空的 CSV 文件');
    const head=out.shift();const index=n=>head.indexOf(n);
    const rowI=index('原表行号'), wordI=index('单词'), phoneticI=index('音标'), meaningI=index('汉语意思');
    if(rowI<0 || wordI<0 || meaningI<0)throw Error('CSV 列名不符合要求（需要原表行号、单词、汉语意思）');
    return out.map(r=>({source_row:Number(r[rowI]),word:r[wordI],phonetic:phoneticI>=0?r[phoneticI]:'',meaning:r[meaningI],note_1:r[index('备注1')]||null,note_2:r[index('备注2')]||null}));
  }
  function normalizeWords(data) {
    if (!Array.isArray(data)) throw Error('词表格式不正确：缺少 records 数组');
    if (!data.length || data.length>20000)throw Error('词表记录数量不正确');
    const ids=new Set();
    return data.map((r,i)=>{
      const n=Number(r.source_row ?? r.row ?? (i+2));
      const word=String(r.word||'').trim();const meaning=String(r.meaning||'').trim();
      if(!Number.isSafeInteger(n)||n<1||!word||!meaning||word.length>100||meaning.length>500)throw Error(`第${i+1}条词表记录无效`);
      const id='r'+n;
      if(ids.has(id))throw Error(`词表有重复的原始行号 ${n}`);
      ids.add(id);
      return {id,source_row:n,word,phonetic:String(r.phonetic||'').slice(0,160),meaning,note_1:String(r.note_1||'').slice(0,500),note_2:String(r.note_2||'').slice(0,500)};
    });
  }
  async function importDeck(file) {
    if(!file) return;
    if(file.size>10_000_000)throw Error('词库文件超过10MB');
    const text=await file.text();
    const rows=file.name.toLowerCase().endsWith('.csv')?parseCSV(text):JSON.parse(text).records;
    const next=normalizeWords(rows);
    if(progress.size){
      if(next.length!==words.length || next.some((x,i)=>x.id!==words[i].id || x.word!==words[i].word))throw Error('当前已有学习记录，禁止切换成不同词表。请先导出备份，或到新设备导入。');
    }
    const tx=db.transaction('words','readwrite');
    const st=tx.objectStore('words');st.clear();next.forEach(w=>st.put(w));await txDone(tx);
    words=next.sort((a,b)=>a.source_row-b.source_row);currentId='';revealed=false;page='today';render();toast(`词表已保存在本机：${words.length}条`);
  }
  function downloadJson(data, name) {
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),45000);
  }
  async function exportBackup() {
    await readAll();
    const result={format:'cike-backup-v1',createdAt:new Date().toISOString(),wordCount:words.length,words,progress:Array.from(progress.values()),settings};
    downloadJson(result,`词刻_完整备份_${todayKey()}.json`);
    toast(`备份已生成：${words.length}词条、${progress.size}条学习记录`);
  }
  async function restoreBackup(file) {
    if(!file)return;if(file.size>20_000_000)throw Error('备份文件过大');
    const data=JSON.parse(await file.text());
    if(data.format!=='cike-backup-v1')throw Error('不是词刻本地版的备份文件。旧站点云端数据不能直接导入。');
    const next=normalizeWords(data.words);
    if(!Array.isArray(data.progress))throw Error('备份缺少学习记录数组');
    const idset=new Set(next.map(w=>w.id));
    const prog=data.progress.map(p=>{
      if(!p || typeof p.id!=='string' || !idset.has(p.id))throw Error('学习记录含有无效单词编号');
      if(!Number.isInteger(p.stage)||p.stage<0||p.stage>6)throw Error('学习记录阶段有误');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(p.dueOn)||!/^\d{4}-\d{2}-\d{2}$/.test(p.lastSeenDay))throw Error('学习记录日期有误');
      return {id:p.id,stage:p.stage,seen:Number(p.seen)||0,correct:Number(p.correct)||0,wrong:Number(p.wrong)||0,firstSeenDay:String(p.firstSeenDay||''),lastSeenDay:p.lastSeenDay,dueOn:p.dueOn,updatedAt:String(p.updatedAt||'')};
    });
    if(new Set(prog.map(p=>p.id)).size!==prog.length)throw Error('备份中存在重复的学习记录编号');
    const dailyNew=[10,15,20].includes(Number(data.settings?.dailyNew))?Number(data.settings.dailyNew):15;
    if(!confirm(`即将恢复${next.length}词条和${prog.length}条学习记录。这会覆盖此设备当前的本地词库和学习数据，不能撤销。\n\n建议先导出当前备份。确定恢复吗？`))return;
    const tx=db.transaction(['words','progress','settings'],'readwrite');
    const ws=tx.objectStore('words'),ps=tx.objectStore('progress'),ss=tx.objectStore('settings');
    ws.clear();ps.clear();ss.clear();next.forEach(w=>ws.put(w));prog.forEach(p=>ps.put(p));ss.put({key:'main',dailyNew});
    await txDone(tx);await readAll();currentId='';revealed=false;page='today';render();toast(`恢复成功：${words.length}词条、${progress.size}条学习记录`);
  }
  document.addEventListener('click',async e=>{
    const target=e.target.closest('button[data-action],button[data-nav]');if(!target)return;
    if(target.dataset.nav){page=target.dataset.nav;searchTerm='';listLimit=35;currentId='';revealed=false;render();scrollTo({top:0,behavior:'instant'});return;}
    const action=target.dataset.action;
    try {
      if(action==='import')importInput.click();
      else if(action==='restore')restoreInput.click();
      else if(action==='export')await exportBackup();
      else if(action==='speak')speak(target.dataset.id);
      else if(action==='reveal'){revealed=true;render();}
      else if(action==='rate') {target.disabled=true;await rate(target.dataset.rating);}
      else if(action==='more'){listLimit+=35;render();}
    }catch(err){toast(`操作未完成：${err.message}`);target.disabled=false;}
  });
  document.addEventListener('input',e=>{
    if(e.target.id==='search'){
      const at=e.target.selectionStart;searchTerm=e.target.value;listLimit=35;render();
      const input=document.querySelector('#search');if(input){input.focus();input.setSelectionRange(at,at);}
    }
  });
  document.addEventListener('change',async e=>{
    try {
      if(e.target.id==='daily-setting'){
        const dailyNew=Number(e.target.value);
        const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({key:'main',dailyNew});await txDone(tx);settings.dailyNew=dailyNew;render();toast(`每天新词已设为${dailyNew}个`);
      }
    }catch(err){toast(`设置保存失败：${err.message}`);}
  });
  importInput.addEventListener('change',async()=>{try{await importDeck(importInput.files?.[0]);}catch(err){toast(`导入失败：${err.message}`);}importInput.value='';});
  restoreInput.addEventListener('change',async()=>{try{await restoreBackup(restoreInput.files?.[0]);}catch(err){toast(`恢复失败：${err.message}`);}restoreInput.value='';});
  window.addEventListener('online',()=>{if(page==='backup')render();});window.addEventListener('offline',()=>{if(page==='backup')render();});
  async function init(){
    try { if(!('indexedDB' in window))throw Error('当前浏览器没有本地数据库，建议用 Safari 或 Chrome'); db=await openDB();await readAll();render(); }
    catch(err){main.innerHTML=`<section class="card"><h2>无法启动本地词库</h2><p class="muted">${h(err.message)}</p><p>请勿在无备份的情况下清除浏览器数据。请尝试在 Safari 或 Chrome 中打开。</p></section>`;}
    if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }
  init();
})();
