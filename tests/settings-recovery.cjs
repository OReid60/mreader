const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{for(const width of [320,393,768,1440]){
  const page=await browser.newPage({viewport:{width,height:850},...(width<=768?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'}:{})}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   const progress=[{bookId:'saved',chapterId:'chapter',page:7,completed:false,updated:123}];
   window.recoveryCalls=[];window.resetCalls=[];window.rejectReset=true;
   window.__TAURI__={app:{getVersion:async()=>'0.3.42'},core:{invoke:async(name,args)=>{
    if(name==='snapshot')return{books:[],progress:structuredClone(progress),settings:{theme:'dark',language:'en',startPage:'Library'},categories:['Default'],dataDir:'recovery-fixture'};
    if(name==='extension_list'||name==='download_queue')return[];
    if(name==='apk_state')return{installed:[],repositories:[]};
    if(name==='cloud_status')return{configured:true,signedIn:false};
    if(name==='verification_plan')return{enabled:false};
    if(name==='cloud_password_recovery'){window.recoveryCalls.push(args);return;}
    if(name==='cloud_password_reset'){window.resetCalls.push(args);if(window.rejectReset)throw Error('The reset link is invalid or expired.');return;}
    throw Error('Unexpected command '+name);
   }},event:{listen:async()=>{}},webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>{}})}};
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href);await page.waitForFunction(()=>state.dataDir==='recovery-fixture');
  for(const section of ['general','sources','storage','account']){
   await page.evaluate(section=>{featureState.settingsTab=section;state.page='Settings';render();window.scrollTo(0,0)},section);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width<=768){
    assert.equal(await page.locator('.mobile-settings-shortcuts,.mobile-actions,[data-page=Downloads]').count(),0);
    if(section==='sources')assert.equal(await page.locator('.custom-source-panel [data-action=import]').count(),1);
   }
   if(width===393||width===1440)await page.screenshot({path:`test-artifacts/settings-refined-${section}-${width}.png`,fullPage:true});
  }
  await page.getByLabel('Account email',{exact:true}).fill('reader@example.test');
  await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
  assert.equal(await page.getByLabel('Recovery email').inputValue(),'reader@example.test');
  await page.getByRole('button',{name:'Send reset email',exact:true}).click();
  await page.waitForFunction(()=>recoveryCalls.length===1);
  assert.deepEqual(await page.evaluate(()=>recoveryCalls),[{email:'reader@example.test'}]);
  assert(await page.getByText(/If an account exists/).isVisible());
  const token='a'.repeat(64),password='Fixture-password-123';
  await page.getByLabel('Password reset link',{exact:true}).fill('https://account.example.test/auth/v1/verify?token='+token+'&type=recovery');
  await page.getByLabel('New password',{exact:true}).fill(password);await page.getByLabel('Confirm new password',{exact:true}).fill('Different-password-123');
  await page.getByRole('button',{name:'Update password',exact:true}).click();assert.equal(await page.evaluate(()=>resetCalls.length),0);assert(await page.getByText('The passwords do not match.',{exact:true}).isVisible());
  await page.getByLabel('Confirm new password',{exact:true}).fill(password);await page.getByRole('button',{name:'Update password',exact:true}).click();await page.waitForFunction(()=>resetCalls.length===1);assert(await page.getByText('The reset link is invalid or expired.',{exact:true}).isVisible());
  await page.evaluate(()=>window.rejectReset=false);await page.getByRole('button',{name:'Update password',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#password-recovery-complete').hidden);
  assert.equal(await page.getByLabel('New password',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Password reset link',{exact:true}).inputValue(),'');
  assert(await page.evaluate(()=>!JSON.stringify(Object.values(localStorage)).includes('Fixture-password-123')));
  await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('#password-recovery').count(),0);
  await page.getByRole('button',{name:'Forgot password?',exact:true}).click();assert.equal(await page.evaluate(()=>handleAppBack()),true);assert.equal(await page.locator('#password-recovery').count(),0);assert.equal(await page.evaluate(()=>state.page),'Settings');
  assert.equal(await page.evaluate(()=>state.progress[0].page),7);assert.deepEqual(errors,[]);await page.close();
 }console.log('PASS settings alignment, import placement, hidden shortcuts and recovery request/validation/error/success; no real emails sent or progress changed');}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
