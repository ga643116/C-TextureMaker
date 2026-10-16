/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({entryPoints:[path.join(root,'app/main.mjs')],bundle:true,minify:true,target:'chrome110',format:'iife',outfile:path.join(root,'app/bundle.js'),legalComments:'eof'});
await build({entryPoints:[path.join(root,'app/redraw-worker.mjs')],bundle:true,minify:true,target:'chrome110',format:'iife',outfile:path.join(root,'app/redraw-worker.js'),legalComments:'eof'});
const dest=path.join(root,'dist/C-TextureMaker/app');await fs.mkdir(path.join(dest,'vendor'),{recursive:true});
for(const name of ['index.html','bundle.js','redraw-worker.js','style.css','icon.svg'])await fs.copyFile(path.join(root,'app',name),path.join(dest,name));
for(const name of ['ui-generation.css','LICENSE.txt'])await fs.copyFile(path.join(root,'app/vendor',name),path.join(dest,'vendor',name));
console.log('Built offline app in dist/C-TextureMaker/app');
