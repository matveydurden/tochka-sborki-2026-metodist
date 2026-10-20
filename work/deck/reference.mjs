import fs from 'node:fs/promises';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const p=await PresentationFile.importPptx(await FileBlob.load('/Users/matvey/Downloads/Metodist_Checkpoint (1).pptx'));
await fs.mkdir('work/deck/reference',{recursive:true});
for(let i=0;i<p.slides.items.length;i++)await fs.writeFile(`work/deck/reference/${i+1}.png`,new Uint8Array(await(await p.export({slide:p.slides.items[i],format:'png',scale:1})).arrayBuffer()));
console.log('Rendered',p.slides.items.length);
