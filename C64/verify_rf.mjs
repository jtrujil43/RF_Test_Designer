// Actual C64 ROM RF regression: text reports, bitmap sketches, numeric references.
// Usage: node verify_rf.mjs "C:/path/to/VICE" [--math-only|--variants-only]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ViceTestClient } from './vice-test-client.mjs';
import { captureBitmap } from './bitmap-preview.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const vice=process.argv[2];
if(!vice) throw Error('Supply the VICE tools directory.');
const client=await ViceTestClient.start(vice,6520);
const temporary=client.temporary;
const resume=ms=>client.resume(ms);
const keys=(value,ms)=>client.keys(value,ms);
const screen=()=>client.screen();
const checkScreen=text=>client.assertText(text);
const report=[];
async function textMode(){
  const mode=await client.mode();
  if(mode.bitmap||mode.multicolor||mode.extended||mode.bank!==3)
    throw Error('Expected standard text mode: '+JSON.stringify(mode));
}
try {
  const configs=[
    ['rdlloss',840],['rdxtalk',1060],['rfleak',930],['stubtest',750],
    ['trlset',840],['viamatch',1010],['zcoupon',860],
  ];
  for(const [name,close] of process.argv.includes('--math-only')||process.argv.includes('--variants-only')?[]:configs){
    const source=readFileSync(path.join(root,name+'.bas'),'ascii');
    const waitLine=Number(source.split(/\r?\n/).find(line=>
      parseInt(line)>=close&&parseInt(line)<close+100&&/GET K\$/.test(line))?.match(/^\d+/)[0]);
    const sketchStart=Number(source.split(/\r?\n/).find(line=>
      /REM C64 MULTICOLOR BITMAP SCHEMATIC/.test(line))?.match(/^\d+/)[0]);
    const legendLine=Number(source.split(/\r?\n/).find(line=>
      parseInt(line)>=sketchStart&&parseInt(line)<close&&/GET K\$/.test(line))?.match(/^\d+/)[0]);
    if(!waitLine) throw Error(name+': no bitmap close GET');
    await client.boot(path.join(root,name+'.prg'));
    await client.waitText(/1 example 2 custom/i);
    await textMode();
    await keys('1\r');
    let sketch=false,bitmap=false,legend=false,finished=false,pages=0;
    let previousText='',text='';
    const until=Date.now()+180000;
    while(Date.now()<until){
      const mode=await client.mode();
      if(mode.bitmap){
        if(!mode.multicolor||mode.extended||mode.bank!==0||mode.pointer!==56)
          throw Error(name+': incorrect bitmap mode '+JSON.stringify(mode));
        if(await client.basicLine()===waitLine){
          bitmap=true;
          report.push(name+': multicolor bitmap ready at line '+waitLine);
          await keys('\r');
        }else await resume(250);
        continue;
      }
      await textMode();
      text=await screen();checkScreen(text);
      if(text!==previousText){report.push('--- '+name+' ---\n'+text);previousText=text;}
      const tail=text.split('\n').slice(-5).join('\n');
      if(/done\. run/i.test(text)){finished=true;break;}
      if(/1 sketch 0 finish/i.test(tail)){
        if(!sketch){sketch=true;await keys('1\r');}else await resume(250);
      }
      else if(/press return to view bitmap/i.test(tail)){
        if(!legend){
          await client.waitBasicLine(legendLine);
          legend=true;await keys('\r');pages++;
        }else await resume(250);
      }else if(/press return/i.test(tail)){await keys('\r');pages++;}
      else await resume(250);
    }
    if(!finished||!sketch||!legend||!bitmap)
      throw Error('Incomplete '+name+' '+JSON.stringify({finished,sketch,legend,bitmap})+':\n'+text);
    console.log('PASS '+name+': example, '+pages+' text continuations, bitmap, text completion');
  }
  // Production drawing branches that the default examples do not select.
  const variants=[
    ['short-stub','stubtest',100,'SY=2',970,340,560,750],
    ['via-mt1-negative','viamatch',110,'BR=-1',1230,390,760,1010],
    ['via-mt2-positive','viamatch',110,'RL=100:BR=1',1230,390,760,1010],
    ['via-mt2-negative','viamatch',110,'RL=100:BR=-1',1230,390,760,1010],
    ['trl-six-with-omissions','trlset',110,'NL=6:LM=3',1060,350,620,840],
  ];
  for(const [label,name,initializationEnd,override,validation,calculate,sketch,close]
    of process.argv.includes('--math-only')?[]:variants){
    const source=readFileSync(path.join(root,name+'.bas'),'ascii').trim().split(/\r?\n/);
    const waitLine=Number(source.find(line=>parseInt(line)>=close&&parseInt(line)<close+100
      &&/GET K\$/.test(line))?.match(/^\d+/)[0]);
    const legendLine=Number(source.find(line=>parseInt(line)>=sketch&&parseInt(line)<close
      &&/GET K\$/.test(line))?.match(/^\d+/)[0]);
    source.push(`${initializationEnd+1} GOTO 60000`,
      `60000 ${override}`,`60001 GOSUB ${validation}:GOSUB ${calculate}`,
      `60002 GOSUB ${sketch}:GOSUB ${close}`,
      '60003 PRINT "VARIANT BITMAP DONE":END');
    source.sort((a,b)=>parseInt(a)-parseInt(b));
    const input=path.join(temporary,label+'.bas');
    const program=path.join(temporary,label+'.prg');
    writeFileSync(input,source.join('\n').toLowerCase(),'ascii');
    execFileSync(path.join(vice,'petcat.exe'),['-w2','-f','-o',program,'--',input]);
    await client.boot(program);
    await client.waitText(/press return to view bitmap/i);await textMode();
    await client.waitBasicLine(legendLine);
    await keys('\r');
    const until=Date.now()+120000;
    let ready=false;
    while(Date.now()<until){
      const mode=await client.mode();
      if(mode.bitmap&&mode.multicolor&&!mode.extended&&mode.bank===0
        &&mode.pointer===56&&await client.basicLine()===waitLine){ready=true;break;}
      if(!mode.bitmap)checkScreen(await screen());
      await resume(300);
    }
    if(!ready)throw Error(label+': bitmap did not complete');
    const output=path.join(temporary,label+'.png');
    const frame=await captureBitmap(client,output);
    for(const index of [0,1,2,3])if(!frame.counts[index])
      throw Error(label+': missing color index '+index);
    await keys('\r');await client.waitText(/variant bitmap done/i);await textMode();
    const result='PASS '+label+': bitmap colors '+frame.counts.join('/')+'; restored text';
    report.push(result+'\nPreview '+output);console.log(result);
  }
  // Numeric driver: retain the shipped formulas, skip only interactive reports.
  const drivers = [
    ['zcoupon', 'FW', 44.02696808, '100'],
    ['stubtest', 'SL', 2.366728843, '100'],
    ['stubtest', 'SL', 4.748484533, '100', 'SY=2'],
    ['rfleak', 'CV', .01204169543, '110'],
    ['rfleak', 'CM', .0003979072535, '110'],
    ['rfleak', 'CM', 82.91865920, '110', 'IB=1E-6'],
    ['rfleak', 'CM', 8291.866397, '110', 'IB=1E-10'],
    ['viamatch', 'XS', 22.03148973, '110'],
    ['viamatch', 'XS', -27.96806521, '110', 'BR=-1'],
    ['viamatch', 'XS', 49.55539719, '110', 'RL=100'],
    ['viamatch', 'BS', -.01163980135, '110', 'RL=100:BR=-1'],
    ['trlset', 'DL(1)', 23.11301658, '110'],
    ['trlset', 'BP', -1, '110', 'LM=3', 'F=2:GOSUB 2330'],
    ['trlset', 'BQ', 5, '110', 'LM=3', 'F=21:GOSUB 2330'],
  ];
  for (const [name, variable, expected, initializationEnd, override = '', extra = ''] of
    process.argv.includes('--variants-only')?[]:drivers) {
    let source = readFileSync(path.join(root, name + '.bas'), 'utf8');
    const lines = source.trim().split(/\r?\n/);
    const insert = Number(initializationEnd) + 1;
    lines.push(`${insert} GOTO 60000`);
    const compute = name === 'zcoupon' ? 'GOSUB 1080:GOSUB 330'
      : name === 'stubtest' ? 'GOSUB 970:GOSUB 340'
      : name === 'viamatch' ? 'GOSUB 1230:GOSUB 390'
      : name === 'trlset' ? 'GOSUB 1060:GOSUB 350'
      : 'GOSUB 1150:GOSUB 370';
    lines.push(`60000 ${override || 'REM DEFAULT PARAMETERS'}`);
    lines.push(`60001 ${compute}`);
    if (extra) lines.push(`60002 ${extra}`);
    lines.push(`60010 PRINT CHR$(147);"CHECK=";${variable}:END`);
    lines.sort((a, b) => parseInt(a) - parseInt(b));
    const sourcePath = path.join(temporary, name + '.bas');
    const programPath = path.join(temporary, name + '.prg');
    writeFileSync(sourcePath, lines.join('\n').toLowerCase(), 'ascii');
    execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', programPath, '--', sourcePath]);
    await client.boot(programPath);
    let text = '';
    for (let attempt = 0; attempt < 60; attempt++) {
      text = await screen();
      checkScreen(text);
      if (/check=/i.test(text)) break;
      await resume(250);
    }
    checkScreen(text);
    const value = Number(text.match(/check=\s*([\d.e+-]+)/i)?.[1]);
    if (!Number.isFinite(value) || Math.abs(value - expected) > Math.abs(expected) * 2e-6) {
      throw new Error(`${name} ${variable}: expected ${expected}; screen ${text}`);
    }
    report.push(`${name} ${variable} = ${value}; reference ${expected}`);
    console.log(`PASS ${name} ${variable} = ${value}`);
  }

} finally {
  writeFileSync(path.join(root,'RF-vice-validation.txt'),
    'VICE 3.10 / C64 BASIC V2 ROM / multicolor bitmap + standard text\n\n'+
    report.join('\n\n')+'\n','utf8');
  await client.close();
}
