/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PATTERNS,SHAPE_PATTERNS,createDocument,createLayer,normalizeDocument,renderSVG,validateDataImage} from '../app/engine.mjs';
import {fitPeriodicBasis,periodicCells} from '../app/periodic.mjs';
import {renderSeamlessField} from '../app/seamless-fields.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+xOQAAAABJRU5ErkJggg==';
const svg='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#c41e3a" fill-opacity=".5"/></svg>').toString('base64');

function documentFor(type,seamless=false) {
  const doc=createDocument();doc.width=256;doc.height=192;doc.seamless=seamless;
  doc.layers=[createLayer(type,`shape-${type}`)];
  return doc;
}

function cellElements(markup,tag) {
  return [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*data-cell="([^"]+)"[^>]*>`, 'g'))];
}

function centerOf(element) {
  const cx=Number(element.match(/data-cx="([\d.-]+)"/)?.[1]),cy=Number(element.match(/data-cy="([\d.-]+)"/)?.[1]);
  assert.ok(Number.isFinite(cx)&&Number.isFinite(cy),'preview cell should expose finite local center metadata');
  return [cx,cy];
}

function polygonPoints(element) {
  const value=element.match(/points="([^"]+)"/)?.[1];
  assert.ok(value,'polygon should expose its vertices');
  return value.split(' ').map(pair=>pair.split(',').map(Number));
}

function polygonInradius(element) {
  const points=polygonPoints(element),[cx,cy]=centerOf(element);
  return Math.min(...points.map(([x,y],index)=>{
    const [nx,ny]=points[(index+1)%points.length];
    return Math.abs((nx-x)*(cy-y)-(ny-y)*(cx-x))/Math.hypot(nx-x,ny-y);
  }));
}

function shapeRadius(element,shape) {
  const dataCx=element.match(/data-cx="([\d.-]+)"/)?.[1],dataCy=element.match(/data-cy="([\d.-]+)"/)?.[1];
  let cx=Number(dataCx),cy=Number(dataCy);
  if(shape==='square'){
    const x=Number(element.match(/x="([\d.-]+)"/)?.[1]),y=Number(element.match(/y="([\d.-]+)"/)?.[1]);
    const width=Number(element.match(/width="([\d.-]+)"/)?.[1]);
    const height=Number(element.match(/height="([\d.-]+)"/)?.[1]);
    if(!Number.isFinite(cx)||!Number.isFinite(cy)){cx=x+width/2;cy=y+height/2;}
    return Math.max(...[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([px,py])=>Math.hypot(px-cx,py-cy)));
  }
  const points=polygonPoints(element);
  if(!Number.isFinite(cx)||!Number.isFinite(cy)) [cx,cy]=points.reduce((sum,point)=>[sum[0]+point[0]/points.length,sum[1]+point[1]/points.length],[0,0]);
  return Math.max(...points.map(([x,y])=>Math.hypot(x-cx,y-cy)));
}

function sourceContent(markup,id) {
  const start=markup.indexOf(`<g id="${id}"`);
  if(start<0)return null;
  const contentStart=markup.indexOf('>',start)+1,tags=/<\/?g\b[^>]*>/g;tags.lastIndex=contentStart;
  let depth=1,match;
  while((match=tags.exec(markup))){if(match[0].startsWith('</'))depth--;else depth++;if(depth===0)return markup.slice(contentStart,match.index);}
  return null;
}

test('public shape families retain the expected built-in glyph choices',()=>{
  assert.deepEqual(SHAPE_PATTERNS,['halftone','dots','polygons','symbols']);
  const controls=type=>PATTERNS.find(pattern=>pattern.id===type).controls.find(control=>control.key==='shape').options.map(option=>option.value);
  const shared=['circle','square','diamond','triangle','star','hexagon','plus','ring','heart'];
  assert.deepEqual(controls('halftone'),shared);
  assert.deepEqual(controls('dots'),shared);
  assert.deepEqual(controls('symbols'),['arrow','slashes','chevron','bracket','cross','star','circle','square','diamond','triangle','hexagon','ring','heart']);
  for(const [type,shapes] of [['halftone',shared],['dots',shared],['symbols',controls('symbols')]]){
    const doc=documentFor(type),outputs=shapes.map(shape=>{doc.layers[0].params.shape=shape;return renderSVG(doc);});
    assert.equal(new Set(outputs).size,shapes.length,`${type} should render every advertised built-in as distinct geometry`);
  }
  assert.equal(typeof validateDataImage,'function');
  assert.equal(validateDataImage(png,'shape'),png);
});

test('PNG and SVG motifs render in all four shape families for regular and seamless exports',()=>{
  for(const type of SHAPE_PATTERNS)for(const source of [png,svg])for(const seamless of [false,true]){
    const doc=documentFor(type,seamless),layer=doc.layers[0];layer.customMotif=source;
    const output=renderSVG(doc),asset=[...output.matchAll(new RegExp(`<symbol id="motif-${layer.id}"[^>]*>[\\s\\S]*?<\\/symbol>`,'g'))],uses=[...output.matchAll(new RegExp(`<use\\b[^>]*href="#motif-${layer.id}"[^>]*>`,'g'))];
    assert.equal(asset.length,1,`${type}/${source.startsWith('data:image/png')?'png':'svg'}/${seamless?'seamless':'regular'} should embed one image asset`);
    assert.ok(uses.length>0,'shape cells should reference the shared asset');
    assert.ok(asset[0][0].includes(`href="${source}"`),'the imported data image should retain its original href');
    assert.doesNotMatch(asset[0][0],/\b(?:fill|opacity|filter)="/,'the shared image asset should not tint or override source alpha');
    assert.equal(output.split(source).length-1,1,'the data URL should appear only once regardless of the number of instances');
  }
});

test('large embedded motifs add asset bytes once while cell references remain compact',()=>{
  const largeSvg='data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#c41e3a"/>${' '.repeat(48*1024)}</svg>`).toString('base64');
  for(const seamless of [false,true]){
    const makeOutput=motif=>{const doc=documentFor('dots',seamless);doc.layers[0].customMotif=motif;return renderSVG(doc,{preview:true,repeat:3});};
    const small=makeOutput(svg),large=makeOutput(largeSvg),smallUses=[...small.matchAll(/<use\b[^>]*href="#motif-shape-dots"[^>]*>/g)],largeUses=[...large.matchAll(/<use\b[^>]*href="#motif-shape-dots"[^>]*>/g)];
    assert.ok(smallUses.length>1);
    assert.equal(largeUses.length,smallUses.length,'asset size should not change the number of cell references');
    assert.equal(large.split(largeSvg).length-1,1,'the large data URL should be embedded once');
    assert.equal(large.length-small.length,largeSvg.length-svg.length,'output growth should be proportional to one asset, not the cell count');
  }
});

test('preview cells expose exact local centers, including hidden ghosts, without leaking edit metadata into exports',()=>{
  for(const type of ['dots','polygons'])for(const seamless of [false,true]){
    const doc=documentFor(type,seamless),layer=doc.layers[0],tag=type==='dots'?'circle':'polygon';
    let preview=renderSVG(doc,{preview:true}),elements=cellElements(preview,tag);
    assert.ok(elements.length>0,`${type}/${seamless?'seamless':'regular'} should expose editable cells`);
    const first=elements[0][0],id=elements[0][1],[cx,cy]=centerOf(first);
    if(type==='dots'){
      assert.equal(cx,Number(first.match(/cx="([\d.-]+)"/)?.[1]));
      assert.equal(cy,Number(first.match(/cy="([\d.-]+)"/)?.[1]));
    }else{
      const points=[...first.matchAll(/points="([^"]+)"/g)][0][1].split(' ').map(pair=>pair.split(',').map(Number));
      const centroid=points.reduce((sum,point)=>[sum[0]+point[0]/points.length,sum[1]+point[1]/points.length],[0,0]);
      assert.ok(Math.abs(cx-centroid[0])<.002&&Math.abs(cy-centroid[1])<.002,'polygon metadata should match the polygon vertex-average center');
    }
    layer.hiddenCells=[id];preview=renderSVG(doc,{preview:true});
    const ghost=cellElements(preview,tag).find(match=>match[1]===id)?.[0];
    assert.ok(ghost?.includes('data-hidden="true"'),'the hidden cell should remain as a preview ghost');
    assert.deepEqual(centerOf(ghost),[cx,cy],'hiding a cell should keep its exact center and stable ID');
    const exported=renderSVG(doc);
    assert.doesNotMatch(exported,/data-cell=|data-layer=|data-cx=|data-cy=|data-hidden=/,'regular exports must omit editing metadata');
  }
});

test('polygon images fit each actual inner triangle or hexagon and follow shapeScale after layer transforms',()=>{
  const side=84,scale=1.7,width=256,height=240;
  for(const shape of ['triangle','hexagon'])for(const seamless of [false,true]){
    let wideImage;
    for(const shapeScale of [.4,1]){
      const doc=documentFor('polygons',seamless),layer=doc.layers[0];doc.width=width;doc.height=height;
      Object.assign(layer,{rotation:31,scale,offsetX:73,offsetY:-41});
      Object.assign(layer.params,{shape,cellSize:side,shapeScale,strokeWidth:.25,showGrid:false});
      const renderSource=current=>{
        const output=renderSVG(current,{preview:true,repeat:seamless?3:1});
        return seamless?sourceContent(output,`source-${current.layers[0].id}`):output;
      };
      const baseline=renderSource(doc);
      layer.customMotif=svg;
      const source=renderSource(doc);
      assert.ok(source,`${shape}/${seamless?'seamless':'regular'} should retain a canonical source`);
      const polygons=new Map(cellElements(baseline,'polygon').map(match=>[match[1],match[0]]));
      const images=[...source.matchAll(/<use\b[^>]*data-cell="([^"]+)"[^>]*>/g)];
      assert.ok(images.length>0);
      for(const image of images){
        const imageWidth=Number(image[0].match(/width="([\d.]+)"/)?.[1]),inner=polygons.get(image[1]);
        assert.ok(inner,`${shape}/${seamless?'seamless':'regular'} image should match its inner polygon`);
        const squareCornerRadius=imageWidth/Math.SQRT2,innerRadius=polygonInradius(inner);
        assert.ok(Math.abs(squareCornerRadius-innerRadius)<.02,`${shape}/${seamless?'seamless':'regular'} image square should use the actual inner radius (${squareCornerRadius} vs ${innerRadius})`);
        centerOf(image[0]);
        if(image===images[0])wideImage=imageWidth;
      }
    }
    assert.ok(wideImage>0);
    const smallDoc=documentFor('polygons',seamless),smallLayer=smallDoc.layers[0];
    smallDoc.width=width;smallDoc.height=height;Object.assign(smallLayer,{rotation:31,scale,offsetX:73,offsetY:-41,customMotif:svg});
    Object.assign(smallLayer.params,{shape,cellSize:side,shapeScale:.4,strokeWidth:.25,showGrid:false});
    const smallOutput=renderSVG(smallDoc,{preview:true,repeat:seamless?3:1}),smallSource=seamless?sourceContent(smallOutput,`source-${smallLayer.id}`):smallOutput;
    const smallWidth=Number(smallSource.match(/<use\b[^>]*width="([\d.]+)"/)?.[1]);
    assert.ok(wideImage>smallWidth*1.5,`${shape}/${seamless?'seamless':'regular'} motif image should grow with shapeScale`);
  }
});

test('seamless square motif images retain periodic spacing at oversized sizes and transforms',()=>{
  for(const type of ['halftone','dots','symbols']){
    const doc=documentFor(type,true),layer=doc.layers[0];
    Object.assign(layer,{rotation:37,scale:1.8,offsetX:81,offsetY:-57,customMotif:svg});
    Object.assign(layer.params,{spacing:type==='halftone'?8:16});
    if(type==='halftone')Object.assign(layer.params,{maxDot:512,minDot:512,wave:'linear'});
    else layer.params.size=512;
    const output=renderSVG(doc,{preview:true,repeat:3}),source=sourceContent(output,`source-${layer.id}`);
    assert.ok(source);
    const images=[...source.matchAll(/<use\b[^>]*>/g)].map(match=>{
      const attr=(name)=>Number(match[0].match(new RegExp(`${name}="([\\d.-]+)"`))?.[1]);
      return {x:attr('x'),y:attr('y'),size:attr('width')};
    });
    assert.ok(images.length>1);
    const centers=images.map(image=>[image.x+image.size/2,image.y+image.size/2]);
    let nearest=Infinity;
    for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++){
      const dx=Math.abs(centers[i][0]-centers[j][0]),dy=Math.abs(centers[i][1]-centers[j][1]);
      nearest=Math.min(nearest,Math.hypot(Math.min(dx,doc.width-dx),Math.min(dy,doc.height-dy)));
    }
    const imageRadius=Math.SQRT2*Math.max(...images.map(image=>image.size))/2;
    assert.ok(imageRadius<nearest/2,`${type} motif bounding squares should stay apart across tile boundaries (${imageRadius} < ${nearest/2})`);
  }
});

test('ordinary custom motifs keep their requested halftone, dot and symbol sizes',()=>{
  for(const [type,size] of [['halftone',20],['dots',40],['symbols',40]]){
    const doc=documentFor(type),layer=doc.layers[0];layer.customMotif=svg;
    if(type==='halftone')Object.assign(layer.params,{spacing:8,maxDot:size,minDot:size,wave:'linear'});
    else if(type==='dots')Object.assign(layer.params,{spacing:8,size});
    else Object.assign(layer.params,{spacing:8,size,shorten:0});
    const image=renderSVG(doc).match(/<use\b[^>]*>/)?.[0];
    assert.ok(image,`${type} should render its custom motif`);
    assert.equal(Number(image.match(/width="([\d.]+)"/)?.[1]),type==='halftone'?size*2:size,`${type} should not cap ordinary motif size by spacing`);
  }
});

test('seamless square and diamond glyphs fit their actual circumradii for halftone and dots',()=>{
  for(const type of ['halftone','dots'])for(const shape of ['square','diamond']){
    const doc=documentFor(type,true),layer=doc.layers[0],p=layer.params;
    Object.assign(layer,{rotation:31,scale:1.8});
    Object.assign(p,{shape,spacing:16});
    if(type==='halftone')Object.assign(p,{maxDot:512,minDot:512,wave:'linear'});
    else p.size=512;
    const output=renderSVG(doc,{preview:true,repeat:3}),source=sourceContent(output,`source-${layer.id}`),period=periodicCells({width:doc.width,height:doc.height,u:[p.spacing,0],v:[0,p.spacing],angle:layer.rotation*Math.PI/180,scale:layer.scale});
    const limit=period.spacing/2-Math.min(period.spacing*.1,Math.max(1.5,period.spacing*.02)),tag=shape==='square'?'rect':'polygon',element=cellElements(source,tag)[0]?.[0];
    assert.ok(element,`${type}/${shape} should render a preview cell`);
    const radius=shapeRadius(element,shape);
    assert.ok(Math.abs(radius-limit)<.02,`${type}/${shape} should use its exact reach (${radius} ~= ${limit})`);
  }
});

test('seamless symbol squares and triangles include their shape reach and stroke when fitting',()=>{
  for(const shape of ['square','triangle']){
    const doc=documentFor('symbols',true),layer=doc.layers[0],p=layer.params;
    Object.assign(layer,{rotation:31,scale:1.8});
    Object.assign(p,{shape,spacing:16,size:512,strokeWidth:24,roundness:.2,shorten:0});
    const output=renderSVG(doc,{preview:true,repeat:3}),source=sourceContent(output,`source-${layer.id}`),period=periodicCells({width:doc.width,height:doc.height,u:[p.spacing,0],v:[0,p.spacing],angle:layer.rotation*Math.PI/180,scale:layer.scale}),limit=period.spacing/2-Math.min(period.spacing*.1,Math.max(1.5,period.spacing*.02));
    const tag=shape==='square'?'rect':'polygon',element=source.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
    assert.ok(element,`symbols/${shape} should render`);
    const radius=shapeRadius(element,shape),stroke=Number(element.match(/stroke-width="([\d.-]+)"/)?.[1]),miter=Number(element.match(/stroke-miterlimit="([\d.-]+)"/)?.[1]),strokeReach=stroke/2*Math.max(Math.SQRT2,miter),reach=shape==='square'?Math.SQRT2:Math.hypot(.88,.7),outer=radius+strokeReach;
    assert.ok(Number.isFinite(stroke)&&Number.isFinite(miter));
    assert.ok(outer<=limit+.1&&Math.abs(outer-limit)<.1,`symbols/${shape} glyph plus its miter stroke should fit the clearance (${outer} ~= ${limit})`);
    assert.ok((p.size/2*reach+p.strokeWidth/2*Math.max(Math.SQRT2,11-10*p.roundness))*layer.scale>limit*10,'test request should materially exceed the available seamless radius');
  }
});

test('grid diagonal dashes stay independent from the main grid in regular and seamless renders',()=>{
  const doc=documentFor('grid'),layer=doc.layers[0],p=layer.params;
  Object.assign(p,{diagonals:1,lineStyle:'dashed',dashLength:3,dashGap:4,diagonalStyle:'dashed',diagonalDashLength:11,diagonalDashGap:9});
  const paths=markup=>[...markup.matchAll(/<path\b[^>]*stroke="([^"]+)"[^>]*>/g)].map(match=>({tag:match[0],stroke:match[1]}));
  const assertDashSeparation=markup=>{
    const found=paths(markup),main=found.find(path=>path.stroke==='#e9e6df'),diagonal=found.find(path=>path.stroke==='#77736d'&&path.tag.includes('stroke-dasharray'));
    assert.ok(main?.tag.includes('stroke-dasharray="3 4"'),'main grid should use its own dash settings');
    assert.ok(diagonal?.tag.includes('stroke-dasharray="11 9"'),'diagonal should use independent dash settings');
    const oldDiagonal=diagonal.tag,oldMain=main.tag;
    p.dashLength=5;p.dashGap=6;
    const changedMain=paths(markup.includes('data-preview')?renderSVG(doc,{preview:true}):renderSVG(doc)).find(path=>path.stroke==='#e9e6df').tag;
    assert.ok(changedMain.includes('stroke-dasharray="5 6"'));
    assert.equal(paths(markup.includes('data-preview')?renderSVG(doc,{preview:true}):renderSVG(doc)).find(path=>path.stroke==='#77736d'&&path.tag.includes('stroke-dasharray')).tag,oldDiagonal,'changing main dashes should leave diagonal dashes unchanged');
    p.diagonalDashLength=13;p.diagonalDashGap=7;
    const changedPaths=paths(markup.includes('data-preview')?renderSVG(doc,{preview:true}):renderSVG(doc));
    assert.equal(changedPaths.find(path=>path.stroke==='#e9e6df').tag,changedMain,'changing diagonal dashes should leave the main grid unchanged');
    assert.ok(changedPaths.find(path=>path.stroke==='#77736d'&&path.tag.includes('stroke-dasharray')).tag.includes('stroke-dasharray="13 7"'));
    Object.assign(p,{dashLength:3,dashGap:4,diagonalDashLength:11,diagonalDashGap:9});
    assert.ok(oldMain.includes('stroke-dasharray="3 4"'));
  };
  assertDashSeparation(renderSVG(doc));
  doc.seamless=true;
  const field=renderSeamlessField(layer,doc);
  assert.ok(field);
  const seamlessPaths=paths(field.content),main=seamlessPaths.find(path=>path.stroke==='#e9e6df'),diagonal=seamlessPaths.find(path=>path.stroke==='#77736d'&&path.tag.includes('stroke-dasharray'));
  assert.ok(main?.tag.includes('stroke-dasharray="3 4"'));
  assert.ok(diagonal?.tag.includes('stroke-dasharray="11 9"'));
});

test('version 1 grid documents with junction plus or without diagonal settings still normalize',()=>{
  const doc=documentFor('grid'),layer=doc.layers[0];layer.params.junction='plus';
  delete layer.params.diagonalStyle;delete layer.params.diagonalDashLength;delete layer.params.diagonalDashGap;
  const normalized=normalizeDocument(doc);
  assert.equal(normalized.version,1);
  assert.equal(normalized.layers[0].params.junction,'cross');
  assert.equal(normalized.layers[0].params.diagonalStyle,'solid');
  assert.equal(normalized.layers[0].params.diagonalDashLength,10);
  assert.equal(normalized.layers[0].params.diagonalDashGap,8);
});
