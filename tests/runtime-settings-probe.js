globalThis.runSettingsProbe=async function(phase){
 const assert=(value,message)=>{if(!value)throw Error(message)};
 const progress=async()=>JSON.stringify((await api('snapshot')).progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());
 assert(!state.reader,'Close the reader before this Settings-only test.');
 const before=await progress();
 featureState.cloud=await api('cloud_status');featureState.apk=await api('apk_state');
 state.page='Settings';featureState.settingsTab='sources';render();
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50))}throw Error('Settings control timed out')};
 const legacy=!!document.querySelector('[data-action=apk-layout]'),version=await window.__TAURI__.app.getVersion();
 assert(version!=='0.3.45'||!legacy,'Updated app still has legacy layout switches');
 const persistedClosed=!document.querySelector('.source-manager-skips').open;
 if(phase==='prepare'){
  if(legacy){
   for(const value of ['list','stacked']){
    document.querySelector(`[data-action=apk-layout][data-layout=${value}]`).click();
    await wait(()=>state.settings.apkLayout===value&&!!document.querySelector('.apk-layout-'+value));
   }
  }else{
   assert(!!document.querySelector('.apk-layout-stacked'),'Stacked cards missing');
   assert(document.querySelector('#apk-search')?.placeholder==='Search Extension','Search label mismatch');
  }
  const disclosure=document.querySelector('.source-manager-skips');disclosure.open=false;
  await new Promise(r=>setTimeout(r,120));for(let i=0;i<5;i++)render();
  assert(!document.querySelector('.source-manager-skips').open,'Disclosure reopened during rerender');
  if(!legacy){
   document.querySelector('#source-manager-select').click();
   const dialog=document.querySelector('#source-picker .source-picker-modal');
   assert(!!dialog,'Themed source picker missing');
   assert(dialog.querySelectorAll('[role=radio]').length>0,'Source choices missing');
   const rgb=node=>getComputedStyle(node).backgroundColor.match(/\d+/g).slice(0,3).map(Number),modalColor=rgb(dialog),panelColor=rgb(document.querySelector('.source-availability-panel'));
   assert(modalColor.every((value,index)=>Math.abs(value-panelColor[index])<=20),'Picker theme differs from app');
   assert(handleAppBack()&&!document.querySelector('#source-picker'),'Back did not close source picker');
  }
 }else if(!legacy)assert(persistedClosed,'Disclosure state did not survive app restart');
 const after=await progress();assert(before===after,'Reading progress changed');
 return{version,legacyControls:legacy,stacked:!!document.querySelector('.apk-layout-stacked'),persistedClosed,progress:after,progressUnchanged:true};
};
