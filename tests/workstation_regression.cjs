const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const post = async (p, body) => { const r = await fetch(base + p, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); if (!r.ok) throw new Error(`${p}: ${d.error}`); return d; };
(async()=>{
 const original = await (await fetch(base+'/api/session')).json();
 const browser = await chromium.launch({headless:true});
 const page = await browser.newPage({viewport:{width:1150,height:770}});
 page.setDefaultTimeout(20000);
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 try {
  await post('/api/session',{action:'reset'});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'А · Исходный'}).waitFor({timeout:90000});
  await page.getByRole('button',{name:'А · Исходный'}).click();
  await page.waitForFunction(()=>document.querySelector('.transport')?.dataset.playing==='true');
  const srcA=await page.locator('.transport').getAttribute('data-source');
  await page.waitForTimeout(300);
  await page.getByRole('button',{name:'Б · После'}).click();
  await page.waitForFunction(src=>document.querySelector('.transport')?.dataset.source!==src && document.querySelector('.transport')?.dataset.playing==='true',srcA);
  assert.notEqual(await page.locator('.transport').getAttribute('data-source'),srcA);
  await page.getByRole('button',{name:'Стоп',exact:true}).click();
  await page.locator('.channel-name',{hasText:'Lead Synth'}).dblclick();
  const svg=page.locator('.instructor-plot svg'); await svg.waitFor();
  await page.getByRole('button',{name:'Play · цикл'}).click();
  await page.waitForFunction(()=>document.querySelector('.instructor-position')?.dataset.playing==='true');
  const b=await svg.boundingBox();
  await page.mouse.click(b.x+b.width*.62,b.y+b.height*.27);
  const node=page.locator('.instructor-node.prefer').first();
  assert.equal(await node.count(),1);
  const before=await node.getAttribute('transform');
  for(let i=0;i<3;i++){
   const n=await node.boundingBox();
   await page.mouse.move(n.x+n.width/2,n.y+n.height/2); await page.mouse.down();
   await page.mouse.move(n.x+n.width/2+(i+1)*24,n.y+n.height/2-12,{steps:6}); await page.mouse.up();
   assert.notEqual(await node.getAttribute('transform'),i===0?before:'');
  }
  assert.equal(await page.locator('.instructor-position').getAttribute('data-playing'),'true');
  await page.locator('.instructor-footer').getByRole('button',{name:'Закрыть'}).click();
  await page.locator('.discard-banner').getByRole('button',{name:'Закрыть'}).click();
  for(let i=0;i<4;i++){
    const current = await page.locator('.channel').count();
    assert.equal(current, 4-i);
    await page.locator('.channel-delete').first().click();
    await page.getByRole('button',{name:'Удалить дорожку',exact:true}).click();
    let removed=false;
    for(let retry=0;retry<35;retry++){
      if(await page.locator('.channel').count()===current-1){removed=true;break;}
      await page.waitForTimeout(500);
    }
    assert(removed,`delete ${i} did not update DOM; error=${errors.join(' | ')}; toast=${(await page.locator('.toast').allTextContents()).join(' | ')}`);
  }
  assert.equal((await (await fetch(base+'/api/session')).json()).report.channels.length,0);
  assert(await page.getByText('Микс пуст').isVisible());
  await page.getByRole('button',{name:'Отпечатки'}).click();
  const presetName = 'QA empty ' + Date.now();
  await page.getByPlaceholder('Например, Вокал впереди / тёплый бас').fill(presetName);
  await page.getByRole('button',{name:'Сохранить отпечаток текущего микса'}).click();
  const presetItem = page.locator('.preset-item',{hasText:presetName});
  await presetItem.waitFor();
  await presetItem.getByRole('button',{name:'Восстановить и измерить'}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'),{timeout:180000});
  assert.equal((await (await fetch(base+'/api/session')).json()).report.channels.length,0);
  const saved = await (await fetch(base+'/api/presets')).json();
  const record = saved.presets.find(p=>p.name===presetName);
  if(record) await post('/api/presets',{action:'delete',id:record.id});
  assert.deepEqual(errors,[]);
  console.log('PASS: deploy page / raw vs processed A-B / EQ drag x3 with audio / remove all / preset roundtrip');
 } finally { await post('/api/session',{action:'restore',key:original.report.key}); await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
