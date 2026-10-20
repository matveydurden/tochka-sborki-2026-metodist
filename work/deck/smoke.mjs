import fs from 'node:fs/promises';
import {Presentation} from '@oai/artifact-tool';
const p=Presentation.create({slideSize:{width:1600,height:900}});const s=p.slides.add();s.background.fill='#F5F7F4';const t=s.shapes.add({geometry:'textbox',position:{left:64,top:64,width:1400,height:200}});t.text='Методист — подготовка курса';t.text.style={typeface:'Arial',fontSize:60,color:'#14241C',insets:0};await fs.writeFile('work/deck/smoke.png',new Uint8Array(await(await p.export({slide:s,format:'png'})).arrayBuffer()));console.log('ok');
