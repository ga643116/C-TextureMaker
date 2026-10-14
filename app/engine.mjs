/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { fitPeriodicBasis, periodicCells, emptyBounds, includeBounds } from './periodic.mjs';
import { renderSeamlessField } from './seamless-fields.mjs';

const tr = (zh, en, ja) => ({ zh, en, ja });
const L = {
  amplitude: tr('振幅','Amplitude','振幅'),
  count: tr('數量','Count','数'), minRadius: tr('最小半徑','Minimum radius','最小半径'), maxRadius: tr('最大半徑','Maximum radius','最大半径'), innerWidth: tr('內線寬','Inner line width','内側線幅'), outerWidth: tr('外線寬','Outer line width','外線幅'), sweep: tr('掃掠角度','Sweep','スイープ角度'), startAngle: tr('起始角度','Start angle','開始角度'), lineStyle: tr('線條樣式','Line style','線のスタイル'), dashLength: tr('虛線長度','Dash length','破線の長さ'), dashGap: tr('虛線間距','Dash gap','破線の間隔'), spacing: tr('間距','Spacing','間隔'), maxDot: tr('最大點徑','Maximum dot','最大ドット径'), minDot: tr('最小點徑','Minimum dot','最小ドット径'), gradient: tr('漸層','Gradient','グラデーション'), wave: tr('波形','Wave','波形'), angle: tr('角度','Angle','角度'), arrangement: tr('排列','Arrangement','配置'), shape: tr('形狀','Shape','形状'), overallShape: tr('整體範圍','Overall shape','全体の形'), radius: tr('半徑','Radius','半径'), stepWidth: tr('步進寬度','Step width','ステップ幅'), stepAngle: tr('步進角度','Step angle','ステップ角度'), stepDepth: tr('步進深度','Step depth','ステップ深さ'), bevel: tr('斜角','Bevel','ベベル'), endStyle: tr('端點樣式','End style','端のスタイル'), endLength: tr('端點長度','End length','端の長さ'), endAngle: tr('端點角度','End angle','端の角度'), strokeWidth: tr('線寬','Stroke width','線幅'), length: tr('長度','Length','長さ'), align: tr('對齊','Alignment','配置'), linecap: tr('端點','Line cap','線端'), majorEvery: tr('主刻度週期','Major tick interval','主目盛の間隔'), majorScale: tr('主刻度倍率','Major tick scale','主目盛倍率'), waveFrequency: tr('波動頻率','Wave frequency','波の周波数'), waveAmplitude: tr('波動幅度','Wave amplitude','波の振幅'), noise: tr('雜訊','Noise','ノイズ'), width: tr('寬度','Width','幅'), variation: tr('變化幅度','Variation','変化量'), height: tr('高度','Height','高さ'), frequency: tr('頻率','Frequency','周波数'), phase: tr('相位','Phase','位相'), style: tr('樣式','Style','スタイル'), direction: tr('方向','Direction','方向'), size: tr('尺寸','Size','サイズ'), finite: tr('固定格數','Fixed cell count','セル数を固定'), rows: tr('列數','Rows','行数'), columns: tr('欄數','Columns','列数'), cellSize: tr('格子尺寸','Cell size','セルサイズ'), shapeScale: tr('形狀倍率','Shape scale','形状倍率'), filled: tr('填滿','Filled','塗りつぶし'), showGrid: tr('顯示格線','Show grid','グリッドを表示'), peaks: tr('山峰數','Peak count','ピーク数'), terrainScale: tr('地形尺度','Terrain scale','地形スケール'), sampling: tr('取樣密度','Sampling density','サンプリング密度'), levels: tr('等高線層數','Contour levels','等高線の数'), octaves: tr('細節層數','Octaves','オクターブ数'), roughness: tr('粗糙度','Roughness','粗さ'), roundness: tr('圓角','Roundness','丸み'), shorten: tr('縮短量','Shortening','短縮量'), sides: tr('邊數','Sides','辺の数'), radiusStep: tr('半徑步進','Radius step','半径ステップ'), twist: tr('旋轉扭曲','Twist','ねじれ'), radiusX: tr('水平半徑','Horizontal radius','水平半径'), radiusY: tr('垂直半徑','Vertical radius','垂直半径'), longitudes: tr('經線數','Longitudes','経線数'), latitudes: tr('緯線數','Latitudes','緯線数'), tilt: tr('傾斜','Tilt','傾き'), diagonals: tr('對角線','Diagonals','対角線'), diagonalWidth: tr('對角線寬','Diagonal width','対角線幅'), diagonalStyle: tr('對角線樣式','Diagonal style','対角線のスタイル'), diagonalDashLength: tr('對角線虛線長度','Diagonal dash length','対角線の破線の長さ'), diagonalDashGap: tr('對角線虛線間距','Diagonal dash gap','対角線の破線の間隔'), cornerTrim: tr('交點留白','Intersection gap','交点の余白'), centerTrim: tr('格邊中央留白','Edge midpoint gap','辺の中央の余白'), junction: tr('交點裝飾','Junction mark','交点マーク'), junctionSize: tr('交點尺寸','Junction size','交点サイズ'), junctionWidth: tr('交點線寬','Junction width','交点線幅'), cornerShape: tr('角落裝飾','Corner mark','角のマーク'), cornerSize: tr('角落尺寸','Corner size','角のサイズ'), cornerInset: tr('角落內縮','Corner inset','角の内側余白'), dots: tr('顯示圓點','Show dots','ドットを表示'), dotSize: tr('圓點尺寸','Dot size','ドットサイズ'), dotSpacing: tr('圓點間距','Dot spacing','ドット間隔'), hatch: tr('顯示斜線','Show hatch','ハッチを表示'), hatchWidth: tr('斜線寬度','Hatch width','ハッチ幅'), hatchSpacing: tr('斜線間距','Hatch spacing','ハッチ間隔'), mode: tr('模式','Mode','モード'), innerRadius: tr('內半徑','Inner radius','内半径'), outerRadius: tr('外半徑','Outer radius','外半径'), randomLength: tr('長度隨機量','Random length','長さのランダム量'), end: tr('端點','End cap','線端'), transparent: tr('透明背景','Transparent background','透明背景'),
};
const O = {
  solid: tr('實線','Solid','実線'), dashed: tr('虛線','Dashed','破線'), dotted: tr('點線','Dotted','点線'), linear: tr('線性','Linear','線形'), radial: tr('放射','Radial','放射状'), exponential: tr('指數','Exponential','指数'), sine: tr('正弦','Sine','正弦'), grid: tr('方格','Grid','グリッド'), staggered: tr('交錯','Staggered','千鳥'), diagonal: tr('斜向','Diagonal','斜め'), circle: tr('圓形','Circle','円'), square: tr('方形','Square','四角'), diamond: tr('菱形','Diamond','ひし形'), triangle: tr('三角形','Triangle','三角形'), star: tr('星形','Star','星形'), full: tr('完整','Full','全体'), roundedRect: tr('圓角矩形','Rounded rectangle','角丸長方形'), hexagon: tr('六角形','Hexagon','六角形'), outward: tr('向外','Outward','外向き'), inward: tr('向內','Inward','内向き'), none: tr('無','None','なし'), center: tr('置中','Center','中央'), inner: tr('內側','Inner','内側'), outer: tr('外側','Outer','外側'), flat: tr('平切','Flat','フラット'), round: tr('圓弧','Round','ラウンド'), horizontal: tr('水平','Horizontal','水平'), vertical: tr('垂直','Vertical','垂直'), diagonal45: tr('對角','Diagonal','対角'), zigzag: tr('鋸齒','Zigzag','ジグザグ'), uniform: tr('均勻','Uniform','均一'), focus: tr('聚焦','Focus','フォーカス'), cycle: tr('循環','Cycle','サイクル'), arrow: tr('箭頭','Arrow','矢印'), slashes: tr('斜線組','Slashes','スラッシュ'), chevron: tr('折角','Chevron','シェブロン'), bracket: tr('括號','Bracket','ブラケット'), cross: tr('十字','Cross','十字'), fixedWidth: tr('固定寬度','Fixed width','幅を固定'), fixedAngle: tr('固定角度','Fixed angle','角度を固定'), random: tr('隨機','Random','ランダム'), pointed: tr('尖端','Pointed','先細り'), ring: tr('圓環','Ring','リング'), plus: tr('加號','Plus','プラス'), heart: tr('愛心','Heart','ハート'),
};
const control = (key, type, min, max, step = 1, values = null, labelKey = key) => ({
  key, label: L[labelKey] ?? tr(labelKey, labelKey, labelKey), type,
  ...(type === 'range' ? { min, max, step } : {}),
  ...(type === 'select' ? { options: values.map(value => ({ value, label: O[value] ?? tr(value, value, value) })) } : {}),
});
const R = (k, min, max, step = 1, label = k) => control(k, 'range', min, max, step, null, label);
const S = (k, vals, label = k) => control(k, 'select', 0, 0, 1, vals, label);
const T = (k, label = k) => control(k, 'toggle', 0, 1, 1, null, label);
const make = (id, category, name, description, defaults, controls) => ({ id, category, name, description, defaults, controls });

export const PATTERNS = [
  make('concentric','radial',tr('同心圓弧','Concentric arcs','同心円弧'),tr('可調角度與線型的同心圓環。','Concentric rings with adjustable sweep and line style.','角度と線種を調整できる同心円。'),{count:12,minRadius:48,maxRadius:440,innerWidth:1,outerWidth:2,sweep:360,startAngle:-90,lineStyle:'solid',dashLength:10,dashGap:8},[R('count',2,512),R('minRadius',0,2048),R('maxRadius',16,2048),R('innerWidth',0.25,256,0.25),R('outerWidth',0.25,256,0.25),R('sweep',1,360),R('startAngle',-360,360),S('lineStyle',['solid','dashed','dotted']),R('dashLength',1,512),R('dashGap',1,512)]),
  make('halftone','pattern',tr('半色調網點','Halftone','網点'),tr('以形狀、排列與漸層控制的網點。','A dot field shaped by glyph, arrangement and gradient.','形状、配置、グラデーションを調整する網点。'),{spacing:24,maxDot:12,minDot:1,gradient:'radial',wave:'sine',angle:0,arrangement:'grid',shape:'circle',overallShape:'full'},[R('spacing',6,512),R('maxDot',1,512),R('minDot',0,512),S('gradient',['linear','radial']),S('wave',['linear','exponential','sine']),R('angle',-180,180),S('arrangement',['grid','staggered','diagonal']),S('shape',['circle','square','diamond','triangle','star','hexagon','plus','ring','heart']),S('overallShape',['full','circle','roundedRect','hexagon'])]),
  make('hud','technical',tr('HUD 量表','HUD gauge','HUD ゲージ'),tr('分段圓弧、步階與端點裝飾。','Segmented arcs with steps and end marks.','分割円弧、ステップ、端点装飾。'),{radius:380,sweep:270,startAngle:-135,stepWidth:24,stepAngle:8,stepDepth:16,bevel:0,endStyle:'outward',endLength:24,endAngle:90,strokeWidth:2,dashGap:4},[R('radius',40,2048),R('sweep',1,360),R('startAngle',-360,360),R('stepWidth',1,512),R('stepAngle',1,45),R('stepDepth',1,512),R('bevel',0,512),S('endStyle',['none','outward','inward']),R('endLength',1,512),R('endAngle',0,180),R('strokeWidth',0.25,256,0.25),R('dashGap',0,512)]),
  make('ticks','radial',tr('環形刻度','Radial ticks','放射目盛'),tr('可加波動與雜訊的環形刻度。','Radial ticks with optional major marks and modulation.','主目盛と変調を備えた放射目盛。'),{count:72,radius:390,length:24,align:'outer',sweep:360,strokeWidth:2,linecap:'flat',dashGap:0,majorEvery:6,majorScale:1.7,waveFrequency:0,waveAmplitude:0,noise:0},[R('count',4,1024),R('radius',20,2048),R('length',1,512),S('align',['center','inner','outer']),R('sweep',1,360),R('strokeWidth',0.25,256,0.25),S('linecap',['flat','round']),R('dashGap',0,512),R('majorEvery',1,128),R('majorScale',1,8,0.1),R('waveFrequency',0,48,0.1),R('waveAmplitude',0,512),R('noise',0,1,0.01)]),
  make('barcode','technical',tr('裝飾條碼','Decorative barcode','装飾バーコード'),tr('由種子決定的裝飾條紋，不供掃描辨識。','Seeded decorative bars, not intended for scanning.','シードで変化する装飾用バー。スキャン用途ではありません。'),{count:96,width:5,variation:0.65,height:0.7,noise:0.3},[R('count',4,1024),R('width',1,512),R('variation',0,1,0.01),R('height',0.1,1,0.01),R('noise',0,1,0.01)]),
  make('waves','organic',tr('波形線','Wave lines','波線'),tr('連續正弦或折線波列。','Continuous sine or zigzag wave rows.','正弦波またはジグザグ波の列。'),{spacing:32,amplitude:16,frequency:2,strokeWidth:2,phase:0,style:'sine'},[R('spacing',8,512),R('amplitude',0,512),R('frequency',0.25,32,0.25),R('strokeWidth',0.25,256,0.25),R('phase',-360,360),S('style',['sine','zigzag'])]),
  make('lines','pattern',tr('平行線','Parallel lines','平行線'),tr('可調方向與虛線節奏的線場。','A line field with adjustable direction and dash rhythm.','方向と破線のリズムを調整する線場。'),{direction:'horizontal',strokeWidth:2,spacing:24,angle:0,dashLength:16,dashGap:10},[S('direction',['horizontal','vertical','diagonal','dotted']),R('strokeWidth',0.25,256,0.25),R('spacing',4,512),R('angle',-180,180),R('dashLength',1,512),R('dashGap',0,512)]),
  make('dots','pattern',tr('格點','Dot grid','ドットグリッド'),tr('可編輯單格顯示的規則點陣。','Regular editable cells in a dot grid.','セル単位で編集できるドット配列。'),{shape:'circle',arrangement:'grid',spacing:32,size:8,finite:false,rows:12,columns:12},[S('shape',['circle','square','diamond','triangle','star','hexagon','plus','ring','heart']),S('arrangement',['grid','staggered','diagonal']),R('size',1,512),R('spacing',6,512),T('finite'),R('rows',1,80),R('columns',1,80)]),
  make('polygons','pattern',tr('多邊形格網','Polygon lattice','多角形グリッド'),tr('三角或六角圖樣，可填色並逐格編輯。','Editable triangular or hexagonal cells with optional fill.','三角形または六角形のセルを個別編集できます。'),{shape:'hexagon',cellSize:56,shapeScale:0.85,filled:false,strokeWidth:2,showGrid:true},[S('shape',['triangle','hexagon']),R('cellSize',12,512),R('shapeScale',0.1,1,0.01),T('filled'),R('strokeWidth',0.25,256,0.25),T('showGrid')]),
  make('contour','organic',tr('等高線','Contour field','等高線'),tr('由種子控制的流動地形與有機等高線。','Seeded flowing terrain and organic contour lines.','シードで変化する流れる地形と有機的な等高線。'),{peaks:3,terrainScale:1.75,sampling:72,levels:18,octaves:4,roughness:0.65,strokeWidth:1.5},[R('peaks',1,32),R('terrainScale',0.25,8,0.05),R('sampling',72,256),R('levels',2,64),R('octaves',1,8),R('roughness',0,1,0.01),R('strokeWidth',0.25,256,0.25)]),
  make('symbols','pattern',tr('符號陣列','Symbol array','シンボル配列'),tr('多種符號與聚焦、循環排列。','Symbol glyphs in uniform, radial or focused layouts.','各種シンボルを均一、放射状、焦点配置。'),{shape:'arrow',arrangement:'uniform',size:20,spacing:72,strokeWidth:2,roundness:0.2,shorten:0.1,filled:false},[S('shape',['arrow','slashes','chevron','bracket','cross','star','circle','square','diamond','triangle','hexagon','ring','heart']),S('arrangement',['uniform','radial','focus','cycle']),R('size',4,512),R('spacing',16,512),R('strokeWidth',0.25,256,0.25),R('roundness',0,1,0.01),R('shorten',0,0.8,0.01),T('filled')]),
  make('nested','radial',tr('巢狀多邊形','Nested polygons','入れ子多角形'),tr('旋轉漸變的同心多邊形。','Nested polygons with twist and optional color gradient.','ねじれと色の変化を備えた多角形の重なり。'),{sides:6,radius:420,radiusStep:28,count:12,twist:0,strokeWidth:2,gradient:true},[R('sides',3,64),R('radius',20,2048),R('radiusStep',2,512),R('count',1,256),R('twist',-180,180),R('strokeWidth',0.25,256,0.25),T('gradient')]),
  make('globe','radial',tr('經緯球體','Globe grid','地球グリッド'),tr('橢圓外框與經緯線。','An elliptical globe outline with longitude and latitude lines.','楕円の外枠と経線、緯線。'),{radiusX:360,radiusY:280,longitudes:12,latitudes:8,strokeWidth:2,tilt:0},[R('radiusX',40,2048),R('radiusY',40,2048),R('longitudes',2,128),R('latitudes',1,128),R('strokeWidth',0.25,256,0.25),R('tilt',-90,90)]),
  make('grid','technical',tr('工程格線','Technical grid','テクニカルグリッド'),tr('含斜線、交點與角落標記的格線。','A grid with optional diagonals, junctions and corner marks.','対角線、交点、角のマークを備えたグリッド。'),{cellSize:64,strokeWidth:1,lineStyle:'solid',dashLength:10,dashGap:8,diagonals:0,diagonalStyle:'solid',diagonalWidth:1,diagonalDashLength:10,diagonalDashGap:8,cornerTrim:0,centerTrim:0,junction:'none',junctionSize:10,junctionWidth:1,cornerShape:'none',cornerSize:24,cornerInset:12,dots:false,dotSize:2,dotSpacing:16,hatch:false,hatchWidth:1,hatchSpacing:8},[R('cellSize',12,512),R('strokeWidth',0.25,256,0.25),S('lineStyle',['solid','dashed']),R('dashLength',1,512),R('dashGap',1,512),R('diagonals',0,2),S('diagonalStyle',['solid','dashed']),R('diagonalDashLength',1,512),R('diagonalDashGap',1,512),R('diagonalWidth',0.25,256,0.25),R('cornerTrim',0,0.45,0.01),R('centerTrim',0,0.45,0.01),S('junction',['none','cross']),R('junctionSize',1,512),R('junctionWidth',0.25,256,0.25),S('cornerShape',['none','triangle','square','circle','ring','bracket']),R('cornerSize',2,512),R('cornerInset',0,512),T('dots'),R('dotSize',0.5,512,0.5),R('dotSpacing',4,512),T('hatch'),R('hatchWidth',0.25,256,0.25),R('hatchSpacing',2,512)]),
  make('rays','radial',tr('放射光束','Radial rays','放射光線'),tr('固定寬度、固定角度或隨機光束。','Rays with fixed widths, angles or seeded variation.','幅、角度、長さを調整できる放射線。'),{mode:'fixedAngle',count:48,innerRadius:60,outerRadius:440,randomLength:0.25,strokeWidth:2,end:'flat'},[S('mode',['fixedWidth','fixedAngle','random']),R('count',2,1024),R('innerRadius',0,2048),R('outerRadius',10,2048),R('randomLength',0,1,0.01),R('strokeWidth',0.25,256,0.25),S('end',['flat','round','pointed'])]),
];

export const SHAPE_PATTERNS = ['halftone','dots','polygons','symbols'];

const patternById = new Map(PATTERNS.map(p => [p.id, p]));
const PATTERN_SETTING_KEYS = ['opacity','color','secondary','rotation','scale','offsetX','offsetY','params','hiddenCells','customMotif','motifTint','cellLinks','linkWidth','mask'];
const patternSettingKeySet = new Set(PATTERN_SETTING_KEYS);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const hex = v => typeof v === 'string' && /^#[\da-fA-F]{6}$/.test(v);
const safeId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(v);
const cellId = v => typeof v === 'string' && /^(0|[1-9]\d{0,4}):(0|[1-9]\d{0,4})$/.test(v);
let layerCounter = 0;
function assert(condition, message) { if (!condition) throw new TypeError(message); }

function normalizeCellLinks(value) {
  assert(Array.isArray(value) && value.length <= 2000, 'Invalid cellLinks');
  const links = [], seen = new Set();
  for (const link of value) {
    assert(isObject(link) && Object.keys(link).length === 2 && Object.hasOwn(link, 'from') && Object.hasOwn(link, 'to'), 'Invalid cell link');
    assert(cellId(link.from) && cellId(link.to), 'Invalid cell link endpoint');
    assert(link.from !== link.to, 'Cell links cannot connect a cell to itself');
    const [from, to] = link.from < link.to ? [link.from, link.to] : [link.to, link.from];
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ from, to });
  }
  return links;
}

export function createLayer(type, id = `layer-${Date.now().toString(36)}-${(++layerCounter).toString(36)}`) {
  const p = patternById.get(type);
  assert(p, `Unknown pattern: ${type}`);
  assert(safeId(id), 'Invalid layer id');
  return { id, type, visible: true, opacity: 1, color: '#e9e6df', secondary: '#77736d', rotation: 0, scale: 1, offsetX: 0, offsetY: 0, params: clone(p.defaults), hiddenCells: [], customMotif: null, motifTint: false, cellLinks: [], linkWidth: 2, mask: null, patternSettings: {} };
}

function clonePatternSettings(value, activeType) {
  assert(isObject(value), 'Invalid patternSettings');
  const settings = {};
  for (const [type, snapshot] of Object.entries(value)) {
    assert(patternById.has(type) && type !== activeType, 'Invalid cached pattern type');
    assert(isObject(snapshot), 'Invalid pattern snapshot');
    for (const key of Object.keys(snapshot)) assert(patternSettingKeySet.has(key), `Unknown pattern snapshot field: ${key}`);
    for (const key of PATTERN_SETTING_KEYS) assert(Object.hasOwn(snapshot, key), `Missing pattern snapshot field: ${key}`);
    settings[type] = clone(snapshot);
  }
  return settings;
}

function snapshotPatternSettings(layer) {
  return Object.fromEntries(PATTERN_SETTING_KEYS.map(key => [key, clone(layer[key])]));
}

function assertPatternLayer(layer) {
  assert(isObject(layer) && patternById.has(layer.type), 'Expected a pattern layer');
  assert(safeId(layer.id), 'Invalid layer id');
  assert(typeof layer.visible === 'boolean', 'Invalid layer visibility');
}

export function switchLayerPattern(layer, type) {
  assertPatternLayer(layer);
  assert(patternById.has(type), `Unknown pattern: ${type}`);
  if (type === layer.type) return layer;

  const patternSettings = clonePatternSettings(layer.patternSettings ?? {}, layer.type);
  const next = createLayer(type, layer.id);
  next.visible = layer.visible;
  if (Object.hasOwn(patternSettings, type)) {
    const restored = patternSettings[type];
    for (const key of PATTERN_SETTING_KEYS) next[key] = restored[key];
    delete patternSettings[type];
  } else {
    next.opacity = layer.opacity;
    next.color = layer.color;
    next.secondary = layer.secondary;
  }
  patternSettings[layer.type] = snapshotPatternSettings(layer);
  next.patternSettings = patternSettings;
  return next;
}

export function resetLayerPattern(layer) {
  assertPatternLayer(layer);
  const next = createLayer(layer.type, layer.id);
  next.visible = layer.visible;
  next.color = layer.color;
  next.secondary = layer.secondary;
  next.patternSettings = clonePatternSettings(layer.patternSettings ?? {}, layer.type);
  return next;
}
const IMAGE_MASK_FIELDS = new Set(['id','type','name','visible','image','imageWidth','imageHeight','threshold','invert','fit','scale','rotation','offsetX','offsetY','flipX','flipY']);
const IMAGE_MASK_REQUIRED = [...IMAGE_MASK_FIELDS];

const IMAGE_MASK_MAX_LENGTH = 22400000;
const IMAGE_MASK_VALIDATION_CACHE_CHARS = 24000000;
const imageMaskValidationCache = new Map();
let imageMaskValidationCacheChars = 0;

function rememberValidatedImageMask(value) {
  if (value.length > IMAGE_MASK_VALIDATION_CACHE_CHARS) return;
  while (imageMaskValidationCache.size >= 6 || imageMaskValidationCacheChars + value.length > IMAGE_MASK_VALIDATION_CACHE_CHARS) {
    const [oldest] = imageMaskValidationCache.keys();
    if (oldest === undefined) break;
    imageMaskValidationCacheChars -= oldest.length;
    imageMaskValidationCache.delete(oldest);
  }
  imageMaskValidationCache.set(value, true);
  imageMaskValidationCacheChars += value.length;
}

function decodeBase64Prefix(base64, byteCount) {
  const encoded = base64.slice(0, Math.ceil(byteCount / 3) * 4);
  let binary;
  try { binary = atob(encoded); } catch { binary = ''; }
  return Uint8Array.from(binary.slice(0, byteCount), char => char.charCodeAt(0));
}

function validateImageMaskDataImage(value) {
  assert(typeof value === 'string' && value.length <= IMAGE_MASK_MAX_LENGTH, 'Invalid image mask');
  const cached = imageMaskValidationCache.get(value);
  if (cached) {
    imageMaskValidationCache.delete(value);
    imageMaskValidationCache.set(value, cached);
    return value;
  }
  const match = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  assert(match && match[2].length % 4 === 0, 'Invalid image mask data URL');
  const mime=match[1],base64=match[2];
  if (mime === 'svg+xml') {
    let decoded;
    try {
      const binary=atob(base64),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
      decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    } catch { decoded=''; }
    assert(decoded && /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(decoded) && !/<!\s*(DOCTYPE|ENTITY)\b|<\s*(script|foreignObject|iframe|object|embed|animate|set)\b|\bon[a-z]+\s*=|javascript:|@import|url\s*\(\s*(?!#)|\b(?:href|xlink:href)\s*=\s*["']\s*(?!#)/i.test(decoded), 'Unsafe SVG in image mask');
  } else if (mime === 'png') {
    const bytes=decodeBase64Prefix(base64,33);
    assert(bytes.length >= 33 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a && bytes[11] === 13 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52, 'Invalid image mask PNG');
  } else if (mime === 'jpeg') {
    const bytes=decodeBase64Prefix(base64,3);
    assert(bytes.length === 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, 'Invalid image mask JPEG');
  } else {
    const bytes=decodeBase64Prefix(base64,12);
    assert(bytes.length === 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50, 'Invalid image mask WebP');
  }
  rememberValidatedImageMask(value);
  return value;
}

function normalizeImageMaskLayer(raw) {
  assert(isObject(raw), 'Image mask layer must be an object');
  for (const key of Object.keys(raw)) assert(IMAGE_MASK_FIELDS.has(key), `Unknown image mask field: ${key}`);
  for (const key of IMAGE_MASK_REQUIRED) assert(Object.hasOwn(raw, key), `Missing image mask field: ${key}`);
  assert(raw.type === 'imageMask', 'Invalid image mask type');
  assert(safeId(raw.id), 'Invalid image mask id');
  assert(typeof raw.name === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(raw.name), 'Invalid image mask name');
  const name = raw.name.trim();
  assert(name.length >= 1 && name.length <= 80, 'Invalid image mask name');
  assert(typeof raw.visible === 'boolean', 'Invalid image mask visibility');
  assert(Number.isInteger(raw.imageWidth) && raw.imageWidth >= 1 && raw.imageWidth <= 8192, 'Invalid image mask width');
  assert(Number.isInteger(raw.imageHeight) && raw.imageHeight >= 1 && raw.imageHeight <= 8192, 'Invalid image mask height');
  assert(Number.isInteger(raw.threshold) && raw.threshold >= 0 && raw.threshold <= 255, 'Invalid image mask threshold');
  assert(typeof raw.invert === 'boolean', 'Invalid image mask invert flag');
  assert(raw.fit === 'contain' || raw.fit === 'cover', 'Invalid image mask fit');
  assert(typeof raw.scale === 'number' && Number.isFinite(raw.scale) && raw.scale >= 0.05 && raw.scale <= 8, 'Invalid image mask scale');
  assert(typeof raw.rotation === 'number' && Number.isFinite(raw.rotation) && raw.rotation >= -180 && raw.rotation <= 180, 'Invalid image mask rotation');
  for (const key of ['offsetX','offsetY']) assert(typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= -32768 && raw[key] <= 32768, `Invalid image mask ${key}`);
  assert(typeof raw.flipX === 'boolean' && typeof raw.flipY === 'boolean', 'Invalid image mask flip flags');
  return { id:raw.id, type:'imageMask', name, visible:raw.visible, image:validateImageMaskDataImage(raw.image), imageWidth:raw.imageWidth, imageHeight:raw.imageHeight, threshold:raw.threshold, invert:raw.invert, fit:raw.fit, scale:raw.scale, rotation:raw.rotation, offsetX:raw.offsetX, offsetY:raw.offsetY, flipX:raw.flipX, flipY:raw.flipY };
}

export function createImageMaskLayer({ id = `image-mask-${Date.now().toString(36)}-${(++layerCounter).toString(36)}`, name = 'Image mask', image, imageWidth, imageHeight }) {
  return normalizeImageMaskLayer({ id, type:'imageMask', name, visible:true, image, imageWidth, imageHeight, threshold:128, invert:false, fit:'contain', scale:1, rotation:0, offsetX:0, offsetY:0, flipX:false, flipY:false });
}

export function isImageMaskLayer(layer) { return layer?.type === 'imageMask'; }

export function imageMaskGeometry(layer, doc) {
  assert(isImageMaskLayer(layer), 'Expected an image mask layer');
  assert(isObject(doc) && Number.isFinite(doc.width) && doc.width > 0 && Number.isFinite(doc.height) && doc.height > 0, 'Invalid image mask document dimensions');
  assert(Number.isInteger(layer.imageWidth) && layer.imageWidth >= 1 && layer.imageWidth <= 8192 && Number.isInteger(layer.imageHeight) && layer.imageHeight >= 1 && layer.imageHeight <= 8192, 'Invalid image mask dimensions');
  assert(layer.fit === 'contain' || layer.fit === 'cover', 'Invalid image mask fit');
  assert(typeof layer.scale === 'number' && Number.isFinite(layer.scale) && layer.scale >= 0.05 && layer.scale <= 8, 'Invalid image mask scale');
  assert(typeof layer.rotation === 'number' && Number.isFinite(layer.rotation) && layer.rotation >= -180 && layer.rotation <= 180, 'Invalid image mask rotation');
  assert(typeof layer.offsetX === 'number' && Number.isFinite(layer.offsetX) && typeof layer.offsetY === 'number' && Number.isFinite(layer.offsetY), 'Invalid image mask offset');
  assert(typeof layer.flipX === 'boolean' && typeof layer.flipY === 'boolean', 'Invalid image mask flip flags');
  const fitScale = layer.fit === 'contain' ? Math.min(doc.width / layer.imageWidth, doc.height / layer.imageHeight) : Math.max(doc.width / layer.imageWidth, doc.height / layer.imageHeight);
  const width = layer.imageWidth * fitScale * layer.scale, height = layer.imageHeight * fitScale * layer.scale;
  const cx = doc.width / 2 + layer.offsetX, cy = doc.height / 2 + layer.offsetY;
  return { width, height, cx, cy, transform:`translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(layer.rotation)}) scale(${layer.flipX?-1:1} ${layer.flipY?-1:1})` };
}

export function createDocument() {
  return { version: 1, name: 'Untitled', width: 1024, height: 1024, transparent: true, background: '#eeeae2', seamless: false, seed: 42, layers: [createLayer('contour', 'layer-1')] };
}

export function validateDataImage(value, label) {
  if (value === null) return null;
  assert(typeof value === 'string' && value.length <= 6000000, `Invalid ${label}`);
  const match = /^data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  assert(match && match[2].length % 4 === 0, `Invalid ${label} data URL`);
  if (match[1] === 'svg+xml') {
    let decoded;
    try { decoded = typeof atob === 'function' ? atob(match[2]) : ''; } catch { decoded = ''; }
  assert(decoded && !/<!\s*(DOCTYPE|ENTITY)\b|<\s*(script|foreignObject|iframe|object|embed|animate|set)\b|\bon[a-z]+\s*=|javascript:|@import|url\s*\(\s*(?!#)|\b(?:href|xlink:href)\s*=\s*["']\s*(?!#)/i.test(decoded), `Unsafe SVG in ${label}`);
  }
  return value;
}
function normalizeParams(type, value) {
  assert(isObject(value), 'Layer params must be an object');
  const p = patternById.get(type), out = clone(p.defaults), allowed = new Set(p.controls.map(c => c.key));
  for (const key of Object.keys(value)) assert(allowed.has(key), `Unknown ${type} parameter: ${key}`);
  for (const c of p.controls) {
    if (!(c.key in value)) continue;
    let v = value[c.key];
    if (type === 'grid' && c.key === 'junction' && v === 'plus') v = 'cross';
    if (c.type === 'range') {
      assert(typeof v === 'number' && Number.isFinite(v), `Invalid parameter ${c.key}`);
      out[c.key] = Math.min(c.max, Math.max(c.min, v));
    } else if (c.type === 'toggle') {
      assert(typeof v === 'boolean', `Invalid parameter ${c.key}`); out[c.key] = v;
    } else {
      assert(c.options.some(o => o.value === v), `Invalid parameter ${c.key}`); out[c.key] = v;
    }
  }
  return out;
}
function normalizePatternState(type, raw, width, height) {
  assert(typeof raw.opacity === 'number' && Number.isFinite(raw.opacity), 'Invalid layer opacity');
  assert(hex(raw.color) && hex(raw.secondary), 'Invalid layer color');
  for (const key of ['rotation','scale','offsetX','offsetY']) assert(typeof raw[key] === 'number' && Number.isFinite(raw[key]), `Invalid layer ${key}`);
  assert(Array.isArray(raw.hiddenCells) && raw.hiddenCells.length <= 10000 && raw.hiddenCells.every(value => typeof value === 'string' && /^(0|[1-9]\d{0,4}):(0|[1-9]\d{0,4})$/.test(value)), 'Invalid hiddenCells');
  const motifTint = Object.hasOwn(raw, 'motifTint') ? raw.motifTint : false;
  assert(typeof motifTint === 'boolean', 'Invalid motifTint');
  const linkWidth = Object.hasOwn(raw, 'linkWidth') ? raw.linkWidth : 2;
  assert(typeof linkWidth === 'number' && Number.isFinite(linkWidth), 'Invalid linkWidth');
  return {
    opacity: Math.min(1, Math.max(0, raw.opacity)),
    color: raw.color,
    secondary: raw.secondary,
    rotation: raw.rotation % 360,
    scale: Math.min(2, Math.max(0.1, raw.scale)),
    offsetX: Math.min(width, Math.max(-width, raw.offsetX)),
    offsetY: Math.min(height, Math.max(-height, raw.offsetY)),
    params: normalizeParams(type, raw.params),
    hiddenCells: [...new Set(raw.hiddenCells)],
    customMotif: validateDataImage(raw.customMotif, 'customMotif'),
    motifTint,
    cellLinks: Object.hasOwn(raw, 'cellLinks') ? normalizeCellLinks(raw.cellLinks) : [],
    linkWidth: Math.min(128, Math.max(0.25, linkWidth)),
    mask: validateDataImage(raw.mask, 'mask'),
  };
}
function normalizePatternSnapshot(type, raw, width, height) {
  assert(isObject(raw), 'Invalid pattern snapshot');
  for (const key of Object.keys(raw)) assert(patternSettingKeySet.has(key), `Unknown pattern snapshot field: ${key}`);
  for (const key of PATTERN_SETTING_KEYS) assert(Object.hasOwn(raw, key), `Missing pattern snapshot field: ${key}`);
  return normalizePatternState(type, raw, width, height);
}
function normalizePatternSettings(activeType, value, width, height) {
  if (value === undefined) return {};
  assert(isObject(value), 'Invalid patternSettings');
  const settings = {};
  for (const [type, snapshot] of Object.entries(value)) {
    assert(patternById.has(type), `Unknown cached pattern type: ${type}`);
    assert(type !== activeType, 'Active pattern cannot be cached');
    settings[type] = normalizePatternSnapshot(type, snapshot, width, height);
  }
  return settings;
}
export function normalizeDocument(input) {
  assert(isObject(input), 'Document must be an object');
  const fields = new Set(['version','name','width','height','transparent','background','seamless','seed','layers']);
  for (const k of Object.keys(input)) assert(fields.has(k), `Unknown document field: ${k}`);
  assert(input.version === 1, `Unsupported document version: ${input.version}`);
  assert(typeof input.name === 'string' && input.name.length > 0 && input.name.length <= 128 && !/[\u0000-\u001f]/.test(input.name), 'Invalid document name');
  assert(Number.isFinite(input.width) && Number.isFinite(input.height), 'Invalid document dimensions');
  assert(typeof input.transparent === 'boolean' && typeof input.seamless === 'boolean', 'Invalid document flags');
  assert(hex(input.background), 'Invalid background color');
  assert(Number.isInteger(input.seed) && input.seed >= 1 && input.seed <= 999999, 'Invalid seed');
  assert(Array.isArray(input.layers) && input.layers.length >= 1 && input.layers.length <= 16, 'Document must have 1 to 16 layers');
  const width=Math.round(Math.min(4096,Math.max(128,input.width))),height=Math.round(Math.min(4096,Math.max(128,input.height)));
  const ids = new Set(); let patternCount = 0;
  const layers = input.layers.map(raw => {
    assert(isObject(raw), 'Layer must be an object');
    assert(safeId(raw.id) && !ids.has(raw.id), 'Invalid or duplicate layer id'); ids.add(raw.id);
    if (raw.type === 'imageMask') return normalizeImageMaskLayer(raw);
    assert(patternById.has(raw.type), `Unknown layer type: ${raw.type}`);
    patternCount++;
    const keys = new Set(['id','type','visible',...PATTERN_SETTING_KEYS,'patternSettings']);
    for (const key of Object.keys(raw)) assert(keys.has(key), `Unknown layer field: ${key}`);
    assert(typeof raw.visible === 'boolean', 'Invalid layer visibility');
    const layer = createLayer(raw.type, raw.id);
    layer.visible = raw.visible;
    Object.assign(layer, normalizePatternState(raw.type, raw, width, height));
    layer.patternSettings = normalizePatternSettings(raw.type, raw.patternSettings, width, height);
    return layer;
  });
  assert(patternCount >= 1, 'Document must have at least one pattern layer');
  return { version:1, name:input.name, width, height, transparent:input.transparent, background:input.background, seamless:input.seamless, seed:input.seed, layers };
}

const fmt = value => {
  const v = Number.isFinite(value) ? Math.max(-1e7, Math.min(1e7, value)) : 0;
  return String(Number(v.toFixed(3)));
};
const transformNumber=value=>String(Number(value.toFixed(8)));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const xy = (x,y) => `${fmt(x)},${fmt(y)}`;
const hiddenSet = layer => new Set(layer.hiddenCells);
function registerCellCenter(metrics, id, x, y, hidden) {
  if (!metrics.cellCenters) metrics.cellCenters = new Map();
  metrics.cellCenters.set(id, { x, y, hidden });
}
function attrs(layer, preview, cell) { return preview && cell !== undefined ? ` data-cell="${esc(cell)}" data-layer="${esc(layer.id)}"` : ''; }
function cellCenter(preview,x,y) { return preview && Number.isFinite(x) && Number.isFinite(y) ? ` data-cx="${fmt(x)}" data-cy="${fmt(y)}"` : ''; }
function line(x1,y1,x2,y2,stroke,width,extra='') { return `<path d="M${xy(x1,y1)}L${xy(x2,y2)}" fill="none" stroke="${stroke}" stroke-width="${fmt(width)}" ${extra}/>`; }
function circle(x,y,r,fill,stroke='none',sw=0,extra='') { return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(Math.max(0,r))}" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(sw)}" ${extra}/>`; }
function polygon(points,fill,stroke='none',sw=0,extra='') { return `<polygon points="${points.map(([x,y])=>xy(x,y)).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(sw)}" ${extra}/>`; }
function renderCellLinks(layer, doc, metrics) {
  if (!['dots','polygons'].includes(layer.type) || !layer.cellLinks.length || !metrics.cellCenters) return '';
  const { width, height } = doc, cx = width / 2, cy = height / 2, angle = layer.rotation * Math.PI / 180;
  const ca = Math.cos(angle), sa = Math.sin(angle), scale = layer.scale;
  const toWorld = ([x,y]) => [cx + scale * (ca * (x - cx) - sa * (y - cy)), cy + scale * (sa * (x - cx) + ca * (y - cy))];
  const toLocal = ([x,y]) => [cx + (ca * (x - cx) + sa * (y - cy)) / scale, cy + (-sa * (x - cx) + ca * (y - cy)) / scale];
  const shortest = (delta, extent) => ((delta + extent / 2) % extent + extent) % extent - extent / 2;
  const out = [];
  for (const { from, to } of layer.cellLinks) {
    const a = metrics.cellCenters.get(from), b = metrics.cellCenters.get(to);
    if (!a || !b || a.hidden || b.hidden) continue;
    let start = [a.x, a.y], end = [b.x, b.y];
    if (doc.seamless) {
      const worldStart = metrics.world ? start : toWorld(start), worldEnd = metrics.world ? end : toWorld(end);
      const target = [worldStart[0] + shortest(worldEnd[0] - worldStart[0], width), worldStart[1] + shortest(worldEnd[1] - worldStart[1], height)];
      start = metrics.world ? worldStart : toLocal(worldStart);
      end = metrics.world ? target : toLocal(target);
    }
    const strokeWidth = layer.linkWidth * (metrics.world ? scale : 1);
    out.push(`<path data-cell-link="${esc(`${from}|${to}`)}" d="M${xy(...start)}L${xy(...end)}" fill="none" stroke="${layer.color}" stroke-width="${fmt(strokeWidth)}" pointer-events="none"/>`);
    if (doc.seamless) {
      const bounds = metrics.bounds ?? emptyBounds();
      includeBounds(bounds, start[0], start[1], strokeWidth / 2);
      includeBounds(bounds, end[0], end[1], strokeWidth / 2);
      metrics.bounds = bounds;
    }
  }
  return out.join('');
}
function dash(p, dotted = false) { return p.lineStyle === 'dashed' ? `stroke-dasharray="${fmt(p.dashLength)} ${fmt(p.dashGap)}"` : p.lineStyle === 'dotted' || dotted ? `stroke-dasharray="1 ${fmt(p.dashGap || p.spacing)}" stroke-linecap="round"` : ''; }
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function hashSeed(seed, id) { let h=seed>>>0; for (const c of id) h=Math.imul(h^c.charCodeAt(0),16777619); return h>>>0; }
function starPoints(cx,cy,r,inner=0.46,n=5) { return Array.from({length:n*2},(_,i)=>{const a=-Math.PI/2+i*Math.PI/n,rr=i%2?r*inner:r;return [cx+Math.cos(a)*rr,cy+Math.sin(a)*rr];}); }
function heartPath(cx,cy,r) { return `M${xy(cx,cy+r*.9)}C${xy(cx-r*.3,cy+r*.62)} ${xy(cx-r,cy+r*.1)} ${xy(cx-r*.78,cy-r*.35)}C${xy(cx-r*.58,cy-r*.83)} ${xy(cx-r*.12,cy-r*.82)} ${xy(cx,cy-r*.48)}C${xy(cx+r*.12,cy-r*.82)} ${xy(cx+r*.58,cy-r*.83)} ${xy(cx+r*.78,cy-r*.35)}C${xy(cx+r,cy+r*.1)} ${xy(cx+r*.3,cy+r*.62)} ${xy(cx,cy+r*.9)}Z`; }
function glyph(shape,cx,cy,r,fill,stroke,sw,extra='') {
  if (shape==='circle') return circle(cx,cy,r,fill,stroke,sw,extra);
  if (shape==='square') return `<rect x="${fmt(cx-r)}" y="${fmt(cy-r)}" width="${fmt(2*r)}" height="${fmt(2*r)}" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(sw)}" ${extra}/>`;
  if (shape==='diamond') return polygon([[cx,cy-r],[cx+r,cy],[cx,cy+r],[cx-r,cy]],fill,stroke,sw,extra);
  if (shape==='triangle') return polygon([[cx,cy-r],[cx+r*.88,cy+r*.7],[cx-r*.88,cy+r*.7]],fill,stroke,sw,extra);
  if (shape==='hexagon') return polygon(Array.from({length:6},(_,i)=>{const a=-Math.PI/2+i*Math.PI/3;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];}),fill,stroke,sw,extra);
  if (shape==='plus') return polygon([[-.28,-1],[.28,-1],[.28,-.28],[1,-.28],[1,.28],[.28,.28],[.28,1],[-.28,1],[-.28,.28],[-1,.28],[-1,-.28],[-.28,-.28]].map(([x,y])=>[cx+x*r,cy+y*r]),fill,stroke,sw,extra);
  if (shape==='ring') return circle(cx,cy,r*.86,'none',stroke==='none'?fill:stroke,Math.max(sw,r*.24),extra);
  if (shape==='heart') return `<path d="${heartPath(cx,cy,r)}" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(sw)}" ${extra}/>`;
  return polygon(starPoints(cx,cy,r),fill,stroke,sw,extra);
}
function cellGhost(preview, hidden) { return preview && hidden ? ' data-hidden="true" opacity="0.18" pointer-events="all"' : ''; }
function cellDraw(layer, preview, hidden, row, col, shape, x,y,r,fill,stroke,sw) {
  const id=`${row}:${col}`, isHidden=hidden.has(id); if (isHidden && !preview) return '';
  return glyph(shape,x,y,r,fill,stroke,sw,attrs(layer,preview,id)+cellGhost(preview,isHidden)+cellCenter(preview,x,y));
}
function motifImageElement(layer,x,y,halfSize) { return `<use href="#motif-${esc(layer.id)}" x="${fmt(x-halfSize)}" y="${fmt(y-halfSize)}" width="${fmt(halfSize*2)}" height="${fmt(halfSize*2)}"/>`; }
function motifImage(layer,preview,id,x,y,halfSize,hidden=false) { return motifImageElement(layer,x,y,halfSize).replace('/>',`${attrs(layer,preview,id)}${cellGhost(preview,hidden)}${cellCenter(preview,x,y)}/>`); }
function capStep(requested, w,h, max) { return Math.max(requested, Math.sqrt(w*h/max)); }
function ringPath(cx,cy,r,a0,a1) {
  const p0=[cx+Math.cos(a0*Math.PI/180)*r,cy+Math.sin(a0*Math.PI/180)*r],p1=[cx+Math.cos(a1*Math.PI/180)*r,cy+Math.sin(a1*Math.PI/180)*r];
  const sweep=a1-a0, large=Math.abs(sweep)>180?1:0, flag=sweep>=0?1:0;
  if (Math.abs(sweep)>=359.999) return `M${xy(cx+r,cy)} A${fmt(r)},${fmt(r)} 0 1 1 ${xy(cx-r,cy)} A${fmt(r)},${fmt(r)} 0 1 1 ${xy(cx+r,cy)}`;
  return `M${xy(...p0)} A${fmt(r)},${fmt(r)} 0 ${large} ${flag} ${xy(...p1)}`;
}
function sectorPath(cx,cy,r0,r1,a0,a1) {
  const point=(r,a)=>[cx+Math.cos(a)*r,cy+Math.sin(a)*r],p0=point(r1,a0),p1=point(r1,a1),inner1=point(r0,a1),inner0=point(r0,a0);
  return `M${xy(...p0)}A${fmt(r1)},${fmt(r1)} 0 0 1 ${xy(...p1)}L${xy(...inner1)}${r0>0?`A${fmt(r0)},${fmt(r0)} 0 0 0 ${xy(...inner0)}`:`L${fmt(cx)} ${fmt(cy)}`}Z`;
}
function patternBounds(layer, doc, contentBounds = null) {
  const p=layer.params,w=doc.width,h=doc.height,stroke=(p.strokeWidth??0)/2;
  if(contentBounds)return [Math.max(w/2-contentBounds.minX,contentBounds.maxX-w/2)+stroke,Math.max(h/2-contentBounds.minY,contentBounds.maxY-h/2)+stroke];
  let x=w/2,y=h/2;
  switch(layer.type){
    case 'concentric': x=y=Math.max(p.maxRadius,p.minRadius)+Math.max(p.innerWidth,p.outerWidth)/2; break;
    case 'hud': x=y=p.radius+Math.max(p.stepDepth*.675+Math.min(p.bevel,p.stepDepth)/2,p.endStyle==='none'?0:p.endLength/Math.cos(Math.min(179,p.endAngle)*Math.PI/360))+stroke; break;
    case 'ticks': x=y=p.radius+p.waveAmplitude+10+p.length*p.majorScale+stroke; break;
    case 'barcode': y=h*p.height/2; break;
    case 'nested': x=y=p.radius+stroke/Math.cos(Math.PI/p.sides);break;
    case 'globe': { const a=p.tilt*Math.PI/180,ca=Math.abs(Math.cos(a)),sa=Math.abs(Math.sin(a)),ry=p.radiusY*Math.hypot(1,.18);x=ca*p.radiusX+sa*ry+stroke;y=sa*p.radiusX+ca*ry+stroke;break; }
    case 'rays': x=y=Math.max(p.innerRadius,p.outerRadius)+p.strokeWidth*2;break;
  }
  return [Math.max(0,x),Math.max(0,y)];
}
function wrappedOffset(value, extent) { return ((value+extent/2)%extent+extent)%extent-extent/2; }
function seamlessCopyRange(layer, doc, contentBounds = null) {
  const [bx,by]=patternBounds(layer,doc,contentBounds),a=layer.rotation*Math.PI/180,s=layer.scale,ca=Math.abs(Math.cos(a)),sa=Math.abs(Math.sin(a));
  const rx=(ca*bx+sa*by)*s,ry=(sa*bx+ca*by)*s,ox=wrappedOffset(layer.offsetX,doc.width),oy=wrappedOffset(layer.offsetY,doc.height),cx=doc.width/2+ox,cy=doc.height/2+oy;
  const x0=Math.ceil((-(cx+rx))/doc.width-1e-10),x1=Math.floor((doc.width-(cx-rx))/doc.width+1e-10),y0=Math.ceil((-(cy+ry))/doc.height-1e-10),y1=Math.floor((doc.height-(cy-ry))/doc.height+1e-10);
  assert((x1-x0+1)*(y1-y0+1)<=4096,'Seamless geometry exceeds safe copy cap');
  return {x0,x1,y0,y1,ox,oy};
}

function fitSeamlessMotif(layer,doc) {
  if(!doc.seamless||!['concentric','hud','ticks','barcode','nested','globe','rays'].includes(layer.type))return layer;
  const [bx,by]=patternBounds(layer,doc),a=layer.rotation*Math.PI/180,ca=Math.abs(Math.cos(a)),sa=Math.abs(Math.sin(a));
  const scale=Math.min(layer.scale,doc.width*.49/(ca*bx+sa*by),doc.height*.49/(sa*bx+ca*by));
  return {...layer,scale};
}

function symbolGlyph(p,x,y,c) {
  const z=p.size/2*(1-p.shorten),fill=p.filled?c:'none',join=p.roundness>=.5?'round':'miter',miter=fmt(11-10*p.roundness);
  if(['circle','square','diamond','triangle','hexagon','ring','heart'].includes(p.shape))return glyph(p.shape,x,y,z,fill,c,p.strokeWidth,`stroke-linejoin="${join}" stroke-miterlimit="${miter}"`);
  if(p.shape==='star')return polygon(starPoints(x,y,z),fill,c,p.strokeWidth,`stroke-linejoin="${join}" stroke-miterlimit="${miter}"`);
  if(p.shape==='cross')return `<path d="M${xy(x-z,y)}H${fmt(x+z)}M${xy(x,y-z)}V${fmt(y+z)}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}" stroke-linecap="${p.roundness>=.5?'round':'square'}" stroke-miterlimit="${miter}"/>`;
  const points=p.shape==='arrow'?[[-.7,-.4],[.1,-.4],[.7,0],[.1,.4],[-.7,.4]]:p.shape==='slashes'?[[-.6,.5],[-.2,-.5],[.2,-.5],[.6,.5]]:p.shape==='chevron'?[[-.6,-.5],[0,0],[-.6,.5],[.1,.5],[.7,0],[.1,-.5]]:[[-.5,-.6],[-.5,.6],[.5,.6],[.5,-.6]];
  const path=points.map(([a,b],n)=>`${n?'L':'M'}${xy(x+a*z,y+b*z)}`).join('')+(p.filled?'Z':'');
  return `<path d="${path}" fill="${fill}" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}" stroke-linejoin="${join}" stroke-miterlimit="${miter}"/>`;
}

function seamlessPoints(layer,doc,preview,metrics) {
  const {params:p,type,color:c}=layer,w=doc.width,h=doc.height,hidden=hiddenSet(layer),angle=(layer.rotation+(type==='halftone'?p.angle:0))*Math.PI/180;
  let gx=p.spacing,gy=p.spacing;
  if(type==='dots'&&p.finite){gx=w/p.columns;gy=h/p.rows;}
  let u=[gx,0],v=[0,gy];
  if(p.arrangement==='staggered')v=[gx*.5,gy];
  if(p.arrangement==='diagonal'){u=[gx*(type==='halftone'?.5:.75),gy*.25];v=[gx*(type==='halftone'?.5:.25),gy*1.25];}
  const period=periodicCells({width:w,height:h,u,v,angle,scale:layer.scale,maxCells:type==='dots'&&p.finite?6400:600}),bounds=emptyBounds(),out=[];
  const radiusLimit=period.spacing*.5-Math.min(period.spacing*.1,Math.max(1.5,period.spacing*.02));
  for(const [i,cell] of period.cells.entries()){
    const {x,y,row,col}=cell,id=`${row}:${col}`,isHidden=hidden.has(id);if(type==='dots')registerCellCenter(metrics,id,x,y,isHidden);if(isHidden&&!preview)continue;
    let content='',radius,rotation=layer.rotation;
    if(type==='symbols'){
      if(p.arrangement==='focus')rotation=Math.atan2(h/2-y,w/2-x)*180/Math.PI;
      if(p.arrangement==='radial')rotation=Math.atan2(y-h/2,x-w/2)*180/Math.PI;
      if(p.arrangement==='cycle')rotation+=i*137.5;
      const z=p.size/2*(1-p.shorten),strokeReach=p.strokeWidth/2*(p.roundness>=.5?Math.SQRT2:Math.max(Math.SQRT2,11-10*p.roundness));
      const shapeReach=p.shape==='square'?Math.SQRT2:p.shape==='triangle'?Math.hypot(.88,.7):1,requestedRadius=layer.customMotif?z*layer.scale*Math.SQRT2:(z*shapeReach+strokeReach)*layer.scale,fit=Math.min(1,radiusLimit/Math.max(.001,requestedRadius));
      radius=requestedRadius*fit;
      if(layer.customMotif)content=motifImageElement(layer,x,y,z*layer.scale*fit);
      else content=symbolGlyph({...p,size:p.size*layer.scale*fit,strokeWidth:p.strokeWidth*layer.scale*fit},x,y,c);
    }else{
      let rad=p.size/2;
      if(type==='halftone'){
        const dx=(x-w/2)/(w*.5),dy=(y-h/2)/(h*.5),qx=Math.abs(dx)-.72,qy=Math.abs(dy)-.72;
        if(p.overallShape==='circle'&&dx*dx+dy*dy>1)continue;
        if(p.overallShape==='hexagon'&&Math.abs(dx)*.866+Math.abs(dy)*.5>.9)continue;
        if(p.overallShape==='roundedRect'&&!(Math.hypot(Math.max(qx,0),Math.max(qy,0))<.21||Math.abs(dx)<.72||Math.abs(dy)<.72))continue;
        let t=p.gradient==='radial'?1-(Math.cos(2*Math.PI*x/w)+Math.cos(2*Math.PI*y/h)+2)/4:.5+.5*Math.sin(2*Math.PI*x/w);
        if(p.wave==='sine')t=t*.65+.35*(.5+.5*Math.sin((dx+dy)*Math.PI*2));else if(p.wave==='exponential')t*=t;
        rad=Math.max(0,p.maxDot*(1-t)+p.minDot*t);
      }
      const square=p.shape==='square'||Boolean(layer.customMotif),reach=square?Math.SQRT2:p.shape==='triangle'?Math.hypot(.88,.7):p.shape==='plus'?1.04:1,maxRadius=(type==='halftone'?Math.max(p.maxDot,p.minDot):p.size/2)*layer.scale*reach;
      const fit=Math.min(1,radiusLimit/Math.max(.001,maxRadius));rad*=layer.scale*fit;radius=rad*reach;
      if(rad<.001)continue;
      if(layer.customMotif)content=motifImage(layer,preview,id,x,y,rad,isHidden);
      else content=cellDraw(layer,preview,hidden,row,col,p.shape,x,y,rad,c,'none',0);
    }
    includeBounds(bounds,x,y,radius);
    out.push(`<g transform="rotate(${fmt(rotation)} ${fmt(x)} ${fmt(y)})">${content}</g>`);
  }
  metrics.world=true;if(Number.isFinite(bounds.minX))metrics.bounds=bounds;
  return out.join('');
}
function stitchContourSegments(segments,w,h,periodic) {
  if(!segments.length)return [];
  const epsX=w*1e-7,epsY=h*1e-7,qx=Math.max(1,Math.round(w/epsX)),qy=Math.max(1,Math.round(h/epsY));
  const key=([x,y])=>{let ix=Math.round(x/epsX),iy=Math.round(y/epsY);if(periodic){ix=((ix%qx)+qx)%qx;iy=((iy%qy)+qy)%qy;}return `${ix}:${iy}`;};
  const links=new Map(),visited=new Uint8Array(segments.length);
  for(let i=0;i<segments.length;i++)for(let end=0;end<2;end++){const k=key(segments[i][end]),list=links.get(k)??[];list.push([i,end]);links.set(k,list);}
  const unwrap=(p,near)=>periodic?[p[0]+Math.round((near[0]-p[0])/w)*w,p[1]+Math.round((near[1]-p[1])/h)*h]:p;
  const chains=[];
  const walk=(firstId,firstEnd)=>{
    let id=firstId,end=firstEnd,start=segments[id][end],current=start,closed=false,used=0;const startKey=key(start),points=[start];
    while(id!==undefined&&!visited[id]&&used<=segments.length){visited[id]=1;used++;const raw=segments[id][1-end],next=unwrap(raw,current);if(Math.hypot(next[0]-current[0],next[1]-current[1])>1e-7)points.push(next);current=next;const k=key(raw);if(k===startKey&&points.length>2){closed=true;break;}const candidate=(links.get(k)??[]).find(([edge])=>!visited[edge]);if(!candidate)break;[id,end]=candidate;}
    if(points.length>1)chains.push({points,closed});
  };
  for(let id=0;id<segments.length;id++)if(!visited[id])for(let end=0;end<2;end++){if((links.get(key(segments[id][end]))??[]).length===1){walk(id,end);break;}}
  for(let id=0;id<segments.length;id++)if(!visited[id])walk(id,0);
  return chains;
}
function contourCurve(chain,bounds) {
  const points=chain.points,closed=chain.closed,unique=closed?points.slice(0,-1):points,n=unique.length;
  if(n<2)return '';
  const delta=closed?[points.at(-1)[0]-points[0][0],points.at(-1)[1]-points[0][1]]:[0,0];
  const at=i=>{
    if(closed){const cycle=Math.floor(i/n),index=i-cycle*n,p=unique[index];return [p[0]+cycle*delta[0],p[1]+cycle*delta[1]];}
    if(i<0)return [unique[0][0]+i*(unique[0][0]-unique[1][0]),unique[0][1]+i*(unique[0][1]-unique[1][1])];
    if(i>=n)return [unique[n-1][0]+(i-n+1)*(unique[n-1][0]-unique[n-2][0]),unique[n-1][1]+(i-n+1)*(unique[n-1][1]-unique[n-2][1])];
    return unique[i];
  };
  const interval=(a,b)=>Math.max(1e-5,Math.sqrt(Math.hypot(b[0]-a[0],b[1]-a[1])));
  const include=p=>{bounds.minX=Math.min(bounds.minX,p[0]);bounds.maxX=Math.max(bounds.maxX,p[0]);bounds.minY=Math.min(bounds.minY,p[1]);bounds.maxY=Math.max(bounds.maxY,p[1]);};
  const count=closed?n:n-1;let d=`M${xy(...unique[0])}`;include(unique[0]);
  for(let i=0;i<count;i++){
    const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2),h1=interval(p0,p1),h2=interval(p1,p2),h3=interval(p2,p3);
    const dx1=(p1[0]-p0[0])/h1,dy1=(p1[1]-p0[1])/h1,dx2=(p2[0]-p1[0])/h2,dy2=(p2[1]-p1[1])/h2,dx3=(p3[0]-p2[0])/h3,dy3=(p3[1]-p2[1])/h3;
    const m1x=(dx1*h2+dx2*h1)/(h1+h2)*h2,m1y=(dy1*h2+dy2*h1)/(h1+h2)*h2,m2x=(dx2*h3+dx3*h2)/(h2+h3)*h2,m2y=(dy2*h3+dy3*h2)/(h2+h3)*h2;
    const c1=[p1[0]+m1x/3,p1[1]+m1y/3],c2=[p2[0]-m2x/3,p2[1]-m2y/3];d+=`C${xy(...c1)} ${xy(...c2)} ${xy(...p2)}`;include(c1);include(c2);include(p2);
  }
  if(closed&&Math.hypot(...delta)<1e-7)d+='Z';
  return d;
}

function renderPattern(layer, doc, preview, metrics = {}) {
  const {type,params:p,color:c,secondary:s}=layer, w=doc.width,h=doc.height,cx=w/2,cy=h/2, hidden=hiddenSet(layer), random=rng(hashSeed(doc.seed,layer.id));
  if(doc.seamless){
    if(['halftone','dots','symbols'].includes(type))return seamlessPoints(layer,doc,preview,metrics);
    const field=renderSeamlessField(layer,doc);
    if(field){metrics.world=true;metrics.bounds=field.bounds;return field.content;}
  }
  const out=[]; let primitives=0; const add=v=>{if(v && primitives<6500){out.push(v);primitives++;}};
  if(type==='concentric') {
    const max=p.maxRadius, min=Math.min(p.minRadius,max), count=p.count;
    for(let i=0;i<count;i++){const r=count===1?min+(max-min)/2:min+(max-min)*i/(count-1),sw=count===1?p.innerWidth:p.innerWidth+(p.outerWidth-p.innerWidth)*i/(count-1);add(`<path d="${ringPath(cx,cy,r,p.startAngle,p.startAngle+p.sweep)}" fill="none" stroke="${c}" stroke-width="${fmt(sw)}" ${dash(p)}/>`);}
  } else if(type==='halftone') {
    const gap=capStep(p.spacing,w,h,3000),cols=Math.max(1,Math.round(w/gap)),rows=Math.max(1,Math.round(h/gap)),dxgap=gap,dygap=gap,a=p.angle*Math.PI/180,first=-1,lastR=rows,lastC=cols;
    for(let r=first;r<=lastR;r++)for(let col=first;col<=lastC;col++){let x=(col+.5)*dxgap,y=(r+.5)*dygap;if(p.arrangement==='staggered')x+=(r&1)*dxgap/2;if(p.arrangement==='diagonal'){x+=(r-col)*dxgap*.5;y+=(r+col)*dygap*.25;}const rx=(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a)+cx,ry=(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)+cy;const dx=(rx-cx)/(w*.5),dy=(ry-cy)/(h*.5);let inside=true;if(p.overallShape==='circle')inside=dx*dx+dy*dy<=1;if(p.overallShape==='hexagon')inside=Math.abs(dx)*.866+Math.abs(dy)*.5<=.9;if(p.overallShape==='roundedRect'){const qx=Math.abs(dx)-.72,qy=Math.abs(dy)-.72;inside=Math.hypot(Math.max(qx,0),Math.max(qy,0))<.21||Math.abs(dx)<.72||Math.abs(dy)<.72;}if(!inside)continue;let t=p.gradient==='radial'?Math.min(1,Math.hypot(dx,dy)):Math.min(1,Math.abs(dx*Math.cos(a)+dy*Math.sin(a)));if(p.wave==='sine')t=(t*.65+.35*(.5+.5*Math.sin((dx+dy)*Math.PI*2)));else if(p.wave==='exponential')t=t*t;let rad=Math.max(0,p.maxDot*(1-t)+p.minDot*t);if(rad<.15)continue;const rr=r+1,cc=col+1;if(layer.customMotif){const id=`${rr}:${cc}`,isHidden=hidden.has(id);if(isHidden&&!preview)continue;add(motifImage(layer,preview,id,rx,ry,rad,isHidden));}else add(cellDraw(layer,preview,hidden,rr,cc,p.shape,rx,ry,rad,c,'none',0));}
  } else if(type==='hud') {
    add(`<path d="${ringPath(cx,cy,p.radius,p.startAngle,p.startAngle+p.sweep)}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}" ${p.dashGap?`stroke-dasharray="${fmt(p.stepWidth)} ${fmt(p.dashGap)}"`:''}/>`);
    const count=Math.min(240,Math.floor(p.sweep/p.stepAngle)),segWidth=Math.min(p.stepAngle,p.stepWidth/Math.max(1,p.radius)*180/Math.PI);for(let i=0;i<=count;i++){const angle=p.startAngle+i*p.stepAngle,a=angle*Math.PI/180,major=i%Math.max(1,Math.round(360/p.stepAngle))===0,d=p.stepDepth*(major?1.35:1),r0=p.radius-d/2,r1=p.radius+d/2,vx=-Math.sin(a),vy=Math.cos(a),skew=Math.min(p.bevel,p.stepDepth)/2;add(`<path d="${ringPath(cx,cy,p.radius,angle,Math.min(p.startAngle+p.sweep,angle+segWidth))}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}"/>`);add(line(cx+Math.cos(a)*r0+vx*skew,cy+Math.sin(a)*r0+vy*skew,cx+Math.cos(a)*r1-vx*skew,cy+Math.sin(a)*r1-vy*skew,c,p.strokeWidth));}
    if(p.endStyle!=='none')for(const a0 of [p.startAngle,p.startAngle+p.sweep]){const a=a0*Math.PI/180,sign=p.endStyle==='outward'?1:-1, ux=Math.cos(a),uy=Math.sin(a),vx=-uy,vy=ux,L0=p.endLength,half=Math.tan((doc.seamless?Math.min(179,p.endAngle):p.endAngle)*Math.PI/360)*L0;add(`<path d="M${xy(cx+ux*p.radius,cy+uy*p.radius)}L${xy(cx+ux*(p.radius+sign*L0)+vx*half,cy+uy*(p.radius+sign*L0)+vy*half)}M${xy(cx+ux*p.radius,cy+uy*p.radius)}L${xy(cx+ux*(p.radius+sign*L0)-vx*half,cy+uy*(p.radius+sign*L0)-vy*half)}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}"/>`);}
  } else if(type==='ticks') {
    for(let i=0;i<p.count;i++){const a=(-90+p.sweep*i/p.count)*Math.PI/180, wave=1+p.waveAmplitude/Math.max(1,p.radius)*Math.sin(i*p.waveFrequency*Math.PI*2/p.count), jitter=(random()-.5)*p.noise*20, rr=p.radius*wave+jitter, major=i%p.majorEvery===0, len=p.length*(major?p.majorScale:1);let r0=rr,r1=rr+len;if(p.align==='inner'){r0=rr-len;r1=rr;}else if(p.align==='center'){r0=rr-len/2;r1=rr+len/2;}const dash=p.dashGap?`stroke-dasharray="${fmt(Math.max(1,len-p.dashGap))} ${fmt(p.dashGap)}"`:'';add(line(cx+Math.cos(a)*r0,cy+Math.sin(a)*r0,cx+Math.cos(a)*r1,cy+Math.sin(a)*r1,c,p.strokeWidth,`stroke-linecap="${p.linecap}" ${dash}`));}
  } else if(type==='barcode') {
    const rand=rng(hashSeed(doc.seed,layer.id)), n=p.count, slot=w/n, base=Math.max(1,p.width), y0=h*(1-p.height)/2, bh=h*p.height;
    for(let i=0;i<n;i++){const variation=1-p.variation+rand()*p.variation*2, ww=Math.min(slot,base*variation), noise=(rand()-.5)*p.noise*.35;const hh=bh*(1-Math.abs(noise));const yy=y0+(bh-hh)/2;add(`<rect x="${fmt(i*slot+(slot-ww)/2)}" y="${fmt(yy)}" width="${fmt(ww)}" height="${fmt(hh)}" fill="${c}"/>`);}
  } else if(type==='waves') {
    const rawGap=capStep(p.spacing,w,h,240),rows=Math.ceil(h/rawGap)+2,gap=rawGap,phase=p.phase*Math.PI/180,freq=p.frequency,samples=Math.max(96,Math.ceil(freq*12)),first=-1;
    for(let r=first;r<rows;r++){const base=(r+.5)*gap, pts=[];for(let j=0;j<=samples;j++){const x=w*j/samples,t=j/samples*freq*Math.PI*2+phase;const q=p.style==='sine'?Math.sin(t):2/Math.PI*Math.asin(Math.sin(t));pts.push(`${j?'L':'M'}${xy(x,base+p.amplitude*q)}`);}add(`<path d="${pts.join('')}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}"/>`);}
  } else if(type==='lines') {
    let target=p.angle*Math.PI/180;if(p.direction==='vertical')target+=Math.PI/2;if(p.direction==='diagonal')target+=Math.PI/4;let a=target,gap=capStep(p.spacing,w,h,180);const ca=Math.cos(a),sa=Math.sin(a),extent=Math.hypot(w,h),count=Math.min(800,Math.ceil(extent/gap)+2);
    for(let i=-count;i<=count;i++){let x=cx+i*gap*(-sa),y=cy+i*gap*ca;const ux=ca,uy=sa,L0=extent*1.5;let extra=p.direction==='dotted'?`stroke-dasharray="1 ${fmt(p.dashGap||gap)}" stroke-linecap="round"`:(p.dashGap>0?`stroke-dasharray="${fmt(p.dashLength)} ${fmt(p.dashGap)}"`:'');add(line(x-ux*L0,y-uy*L0,x+ux*L0,y+uy*L0,c,p.strokeWidth,extra));}
  } else if(type==='dots') {
    let gap=capStep(p.spacing,w,h,3500);let cols=p.finite?p.columns:Math.max(1,Math.round(w/gap)),rows=p.finite?p.rows:Math.max(1,Math.round(h/gap));const xgap=p.finite?w/cols:gap,ygap=p.finite?h/rows:gap;
    for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){let x=(col+.5)*xgap,y=(r+.5)*ygap;if(p.arrangement==='staggered')x+=(r%2)*xgap/2;if(p.arrangement==='diagonal'){x+=(r-col)*xgap*.25;y+=(r+col)*ygap*.25;}const id=`${r}:${col}`,isHidden=hidden.has(id);registerCellCenter(metrics,id,x,y,isHidden);if(layer.customMotif){if(isHidden&&!preview)continue;add(motifImage(layer,preview,id,x,y,p.size/2,isHidden));}else add(cellDraw(layer,preview,hidden,r,col,p.shape,x,y,p.size/2,c,'none',0));}
  } else if(type==='polygons') {
    const size=doc.seamless?Math.max(p.cellSize,Math.sqrt(w*h/350)/layer.scale):capStep(p.cellSize,w,h,2400),hex=p.shape==='hexagon',triHeight=size*Math.sqrt(3)/2,hexX=triHeight,hexY=size*.75;
    const maxCells=p.showGrid?6400:6500,cells=[],edges=new Map();
    const edgeKey=(a,b)=>{const p0=`${fmt(a[0])},${fmt(a[1])}`,p1=`${fmt(b[0])},${fmt(b[1])}`;return p0<p1?`${p0}|${p1}`:`${p1}|${p0}`;};
    if(doc.seamless){
      const angle=layer.rotation*Math.PI/180,ca=Math.cos(angle),sa=Math.sin(angle);
      const idealU=hex?[hexX,0]:[size,0],idealV=hex?[hexX*.5,hexY]:[size*.5,triHeight],period=fitPeriodicBasis(idealU,idealV,w,h,angle,layer.scale),u=period.u,v=period.v,det=u[0]*v[1]-v[0]*u[1];
      const origin=[cx-layer.scale*(ca*cx-sa*cy),cy-layer.scale*(sa*cx+ca*cy)];
      const worldPoint=(i,j)=>[origin[0]+i*u[0]+j*v[0],origin[1]+i*u[1]+j*v[1]];
      const latticePoint=([x,y])=>{const dx=x-origin[0],dy=y-origin[1];return [(v[1]*dx-v[0]*dy)/det,(-u[1]*dx+u[0]*dy)/det];};
      const toLocal=([x,y])=>{const dx=x-cx,dy=y-cy;return [cx+(ca*dx+sa*dy)/layer.scale,cy+(-sa*dx+ca*dy)/layer.scale];};
      const toWorld=([x,y])=>[cx+layer.scale*(ca*(x-cx)-sa*(y-cy)),cy+layer.scale*(sa*(x-cx)+ca*(y-cy))];
      const boundsCorners=[[0,0],[w,0],[w,h],[0,h]].map(latticePoint),minI=Math.floor(Math.min(...boundsCorners.map(point=>point[0])))-2,maxI=Math.ceil(Math.max(...boundsCorners.map(point=>point[0])))+1,minJ=Math.floor(Math.min(...boundsCorners.map(point=>point[1])))-2,maxJ=Math.ceil(Math.max(...boundsCorners.map(point=>point[1])))+1;
      const records=[],polygonBounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
      const includeBounds=points=>{for(const [x,y] of points){polygonBounds.minX=Math.min(polygonBounds.minX,x);polygonBounds.minY=Math.min(polygonBounds.minY,y);polygonBounds.maxX=Math.max(polygonBounds.maxX,x);polygonBounds.maxY=Math.max(polygonBounds.maxY,y);}};
      const addCell=(i,j,coords,centerCoord,rowIndex,colIndex)=>{
        const worldCenter=worldPoint(i+centerCoord[0],j+centerCoord[1]);if(worldCenter[0]<0||worldCenter[0]>=w||worldCenter[1]<0||worldCenter[1]>=h||records.length>=maxCells)return;
        const baseWorld=coords.map(([du,dv])=>worldPoint(i+du,j+dv)),base=baseWorld.map(toLocal);
        const inradius=Math.min(...baseWorld.map(([x,y],index)=>{const [nx,ny]=baseWorld[(index+1)%baseWorld.length];return Math.abs((nx-x)*(worldCenter[1]-y)-(ny-y)*(worldCenter[0]-x))/Math.hypot(nx-x,ny-y);}));
        const strokeWidth=Math.min(p.strokeWidth,inradius*.8/layer.scale),clearance=Math.min(inradius*.15,Math.max(1.5,inradius*.02));
        const shapeScale=Math.min(p.shapeScale,1-(strokeWidth*layer.scale/2+clearance)/inradius);
        const points=baseWorld.map(([x,y])=>[worldCenter[0]+(x-worldCenter[0])*shapeScale,worldCenter[1]+(y-worldCenter[1])*shapeScale]).map(point=>toLocal(point));
        includeBounds(base);includeBounds(points);records.push({rowIndex,colIndex,base,points,center:toLocal(worldCenter),inradius:inradius*shapeScale/layer.scale,strokeWidth});
      };
      cellLoop: for(let j=minJ;j<=maxJ;j++)for(let i=minI;i<=maxI;i++){
        if(hex){
          const centerCoord=[1/6,2/3],coords=Array.from({length:6},(_,index)=>{const angle0=-Math.PI/2+index*Math.PI/3,dx=Math.cos(angle0)*size*.5,dy=Math.sin(angle0)*size*.5,dv=dy/hexY,du=dx/hexX-dv*.5;return [centerCoord[0]+du,centerCoord[1]+dv];});
          addCell(i,j,coords,centerCoord,j,i+Math.floor(j/2));
        }else{
          addCell(i,j,[[0,0],[1,0],[0,1]],[1/3,1/3],j,2*(i+Math.floor(j/2)));
          addCell(i,j,[[1,0],[0,1],[1,1]],[2/3,2/3],j,2*(i+Math.floor(j/2))+1);
        }
        if(records.length>=maxCells)break cellLoop;
      }
      if(records.length){
        const minRow=Math.min(...records.map(cell=>cell.rowIndex)),minCol=Math.min(...records.map(cell=>cell.colIndex)),rowBase=minRow<0?-minRow:1,colBase=minCol<0?-minCol:1;
        for(const record of records){
          record.cellId=`${record.rowIndex+rowBase}:${record.colIndex+colBase}`;record.isHidden=hidden.has(record.cellId);registerCellCenter(metrics,record.cellId,record.center[0],record.center[1],record.isHidden);
          if(p.showGrid)for(let i=0;i<record.base.length;i++){
            const aw=toWorld(record.base[i]),bw=toWorld(record.base[(i+1)%record.base.length]),mx=(aw[0]+bw[0])/2,my=(aw[1]+bw[1])/2,dx=-Math.floor((mx+1e-7)/w)*w,dy=-Math.floor((my+1e-7)/h)*h;
            const a=toLocal([aw[0]+dx,aw[1]+dy]),b=toLocal([bw[0]+dx,bw[1]+dy]),key=edgeKey(a,b);
            if(!edges.has(key)){edges.set(key,`M${xy(...a)}L${xy(...b)}`);includeBounds([a,b]);}
          }
          if(!record.isHidden||preview)cells.push(record);
        }
        metrics.bounds=polygonBounds;
      }
    }else{
      const rows=Math.ceil(h/(hex?hexY:triHeight))+2,cols=Math.ceil(w/(hex?hexX:size/2))+2;
      cellLoop: for(let r=-1;r<rows;r++)for(let col=-1;col<cols;col++){
        const cellId=`${r+1}:${col+1}`,isHidden=hidden.has(cellId);let base;
        if(hex){const x=col*hexX+(r&1)*hexX*.5+hexX*.5,y=r*hexY+size*.5;base=Array.from({length:6},(_,i)=>[x+Math.cos(-Math.PI/2+i*Math.PI/3)*size*.5,y+Math.sin(-Math.PI/2+i*Math.PI/3)*size*.5]);}
        else{const x=col*size*.5+(r&1)*size*.5,y=r*triHeight;base=(col&1)?[[x+size*.5,y],[x,y+triHeight],[x+size,y+triHeight]]:[[x,y],[x+size,y],[x+size*.5,y+triHeight]];}
        const center=base.reduce((sum,point)=>[sum[0]+point[0]/base.length,sum[1]+point[1]/base.length],[0,0]),inradius=Math.min(...base.map(([x,y],i)=>{const [nx,ny]=base[(i+1)%base.length];return Math.abs((nx-x)*(center[1]-y)-(ny-y)*(center[0]-x))/Math.hypot(nx-x,ny-y); })),points=base.map(([x,y])=>[center[0]+(x-center[0])*p.shapeScale,center[1]+(y-center[1])*p.shapeScale]);
        registerCellCenter(metrics,cellId,center[0],center[1],isHidden);
        if(p.showGrid)for(let i=0;i<base.length;i++){const a=base[i],b=base[(i+1)%base.length],key=edgeKey(a,b);if(!edges.has(key))edges.set(key,`M${xy(...a)}L${xy(...b)}`);}
        if(!isHidden||preview)cells.push({cellId,isHidden,points,center,inradius:inradius*p.shapeScale});
        if(cells.length>=maxCells)break cellLoop;
      }
    }
    if(p.showGrid&&edges.size)add(`<path d="${[...edges.values()].join('')}" fill="none" stroke="${s}" stroke-width="${fmt(Math.max(.5,p.strokeWidth*.5))}" opacity=".42"/>`);
    for(const cell of cells){if(layer.customMotif)add(motifImage(layer,preview,cell.cellId,cell.center[0],cell.center[1],cell.inradius/Math.SQRT2,cell.isHidden));else add(polygon(cell.points,p.filled?c:'none',c,cell.strokeWidth??p.strokeWidth,attrs(layer,preview,cell.cellId)+cellGhost(preview,cell.isHidden)+cellCenter(preview,cell.center[0],cell.center[1])));}
  } else if(type==='contour') {
    const angle=layer.rotation*Math.PI/180,period=doc.seamless?fitPeriodicBasis([w,0],[0,h],w,h,angle,layer.scale):null;
    const n=Math.min(256,Math.max(72,p.sampling)*Math.max(1,Math.ceil(Math.sqrt(period?.count??1)))),rand=rng(hashSeed(doc.seed,layer.id)),scale=Math.sqrt(p.terrainScale),peaks=Array.from({length:p.peaks},()=>({x:rand(),y:rand(),sx:(.12+rand()*.08)/scale,sy:(.12+rand()*.08)/scale,amp:(rand()>.35?1:-1)*(.42+rand()*.38)})),detailCount=Math.min(24,p.peaks*Math.max(0,p.octaves-1));
    for(let i=0;i<detailCount;i++)peaks.push({x:rand(),y:rand(),sx:(.025+rand()*.035)/scale,sy:(.025+rand()*.035)/scale,amp:(rand()>.5?1:-1)*(.08+rand()*.12)});
    const terms=[];
    for(let i=0;i<p.octaves;i++){const k=Math.min(10,Math.max(1,Math.round(p.peaks*(.35+i*.35)*scale))),kx=k,ky=Math.max(1,Math.min(10,Math.round(k*(.75+rand()*.5)))),phaseX=rand()*Math.PI*2,phaseY=rand()*Math.PI*2,phase=rand()*Math.PI*2,amp=.26*Math.pow(p.roughness,i);terms.push([kx,ky,phaseX,phaseY,phase,amp]);}
    const field=(u,v)=>{let z=0;for(const peak of peaks){const dx=Math.sin(Math.PI*(u-peak.x))/peak.sx,dy=Math.sin(Math.PI*(v-peak.y))/peak.sy;z+=peak.amp*Math.exp(-.5*(dx*dx+dy*dy));}for(const [kx,ky,px,py,ph,amp] of terms)z+=amp*(Math.sin(2*Math.PI*kx*u+px)*Math.cos(2*Math.PI*ky*v+py)+.35*Math.sin(2*Math.PI*(ky*u-kx*v)+ph));return z;};
    const sample=(u,v)=>{
      if(!period)return field(u,v);
      const ca=Math.cos(angle),sa=Math.sin(angle),ox=cx-layer.scale*(ca*cx-sa*cy),oy=cy-layer.scale*(sa*cx+ca*cy),dx=u*w-ox,dy=v*h-oy,U=period.u,V=period.v,det=U[0]*V[1]-V[0]*U[1];
      return field((V[1]*dx-V[0]*dy)/det,(-U[1]*dx+U[0]*dy)/det);
    };
    const grid=Array.from({length:n+1},(_,j)=>Array.from({length:n+1},(_,i)=>sample(i/n,j/n)));let lo=Infinity,hi=-Infinity;for(const row of grid)for(const v of row){lo=Math.min(lo,v);hi=Math.max(hi,v);}
    const edge=(x1,y1,v1,x2,y2,v2,level)=>{const t=(level-v1)/(v2-v1||1e-9);return [x1+(x2-x1)*t,y1+(y2-y1)*t];};
    const curveBounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(let levelIndex=1;levelIndex<=p.levels;levelIndex++){
      const level=lo+(hi-lo)*levelIndex/(p.levels+1),segments=[];
      for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        const x0=w*i/n,x1=w*(i+1)/n,y0=h*j/n,y1=h*(j+1)/n,v=[grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]],pts=[];
        if((v[0]<level)!==(v[1]<level))pts.push(edge(x0,y0,v[0],x1,y0,v[1],level));
        if((v[1]<level)!==(v[2]<level))pts.push(edge(x1,y0,v[1],x1,y1,v[2],level));
        if((v[2]<level)!==(v[3]<level))pts.push(edge(x1,y1,v[2],x0,y1,v[3],level));
        if((v[3]<level)!==(v[0]<level))pts.push(edge(x0,y1,v[3],x0,y0,v[0],level));
        if(pts.length===2)segments.push(pts);
        else if(pts.length===4){const center=(v[0]+v[1]+v[2]+v[3])/4,high=center>=level,pairs=(v[0]>=level)===high?[[0,1],[2,3]]:[[0,3],[1,2]];for(const [a,b] of pairs)segments.push([pts[a],pts[b]]);}
      }
      const chains=stitchContourSegments(segments,w,h,doc.seamless),paths=chains.map(chain=>contourCurve(chain,curveBounds)).filter(Boolean);
      if(paths.length)add(`<path d="${paths.join('')}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth*(doc.seamless?layer.scale:1))}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    if(Number.isFinite(curveBounds.minX))metrics.bounds=curveBounds;
    if(doc.seamless)metrics.world=true;
  } else if(type==='symbols') {
    let gap=capStep(p.spacing,w,h,600),rows=Math.ceil(h/gap),cols=Math.ceil(w/gap),i=0;
    for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){const x=(col+.5)*gap,y=(r+.5)*gap;let ang=0;if(p.arrangement==='focus')ang=Math.atan2(cy-y,cx-x)*180/Math.PI;if(p.arrangement==='radial')ang=Math.atan2(y-cy,x-cx)*180/Math.PI;if(p.arrangement==='cycle')ang=(i*137.5)%360;const z=p.size/2*(1-p.shorten),shape=layer.customMotif?motifImageElement(layer,x,y,z):symbolGlyph(p,x,y,c);add(`<g transform="rotate(${fmt(ang)} ${fmt(x)} ${fmt(y)})">${shape}</g>`);i++;}
  } else if(type==='nested') {
    const gid=`grad-${esc(layer.id)}`;for(let i=0;i<p.count;i++){const r=Math.max(2,p.radius-i*p.radiusStep),a=p.twist*i*Math.PI/180,pts=Array.from({length:p.sides},(_,j)=>[cx+Math.cos(a+j*2*Math.PI/p.sides)*r,cy+Math.sin(a+j*2*Math.PI/p.sides)*r]);const stroke=p.gradient?`url(#${gid})`:c;add(polygon(pts,'none',stroke,p.strokeWidth));}if(p.gradient)out.unshift(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${s}"/></linearGradient></defs>`);
  } else if(type==='globe') {
    const rot=`rotate(${fmt(p.tilt)} ${fmt(cx)} ${fmt(cy)})`;add(`<g transform="${rot}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}"><ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(p.radiusX)}" ry="${fmt(p.radiusY)}"/>`);for(let i=1;i<p.longitudes;i++){const x=p.radiusX*Math.cos(Math.PI*i/p.longitudes);add(`<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(Math.abs(x))}" ry="${fmt(p.radiusY)}"/>`);}for(let i=1;i<p.latitudes;i++){const lat=-Math.PI/2+Math.PI*i/p.latitudes,cyLat=cy+p.radiusY*Math.sin(lat),rx=p.radiusX*Math.cos(lat),ry=Math.max(0.01,p.radiusY*.18*Math.cos(lat));add(`<ellipse cx="${fmt(cx)}" cy="${fmt(cyLat)}" rx="${fmt(Math.abs(rx))}" ry="${fmt(Math.abs(ry))}"/>`);}add('</g>');
  } else if(type==='grid') {
    let size=capStep(p.cellSize,w,h,900),nx=Math.max(1,Math.ceil(w/size)),ny=Math.max(1,Math.ceil(h/size)),sx=size,sy=size,path=[];
    const segments=(a,b,endGap,midGap)=>{const m=(a+b)/2,left=m-midGap/2,right=m+midGap/2;return [[a+endGap,left],[right,b-endGap]].filter(([u,v])=>v>u);};
    for(let ix=0;ix<=nx;ix++){const x=ix*sx;for(let iy=0;iy<ny;iy++){const y=iy*sy,g=p.cornerTrim*Math.min(sx,sy),m=p.centerTrim*Math.min(sx,sy);for(const [a,b] of segments(y,y+sy,g,m))path.push(`M${fmt(x)} ${fmt(a)}V${fmt(b)}`);}}
    for(let iy=0;iy<=ny;iy++){const y=iy*sy;for(let ix=0;ix<nx;ix++){const x=ix*sx,g=p.cornerTrim*Math.min(sx,sy),m=p.centerTrim*Math.min(sx,sy);for(const [a,b] of segments(x,x+sx,g,m))path.push(`M${fmt(a)} ${fmt(y)}H${fmt(b)}`);}}
    const dashAttr=p.lineStyle==='dashed'?`stroke-dasharray="${fmt(p.dashLength)} ${fmt(p.dashGap)}"`:'';add(`<path d="${path.join('')}" fill="none" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}" ${dashAttr}/>`);
    if(p.diagonals){const dp=[];for(let ix=0;ix<nx;ix++)for(let iy=0;iy<ny;iy++){const x=ix*sx,y=iy*sy;if(p.diagonals>=1)dp.push(`M${xy(x,y)}L${xy(x+sx,y+sy)}`);if(p.diagonals>=2)dp.push(`M${xy(x+sx,y)}L${xy(x,y+sy)}`);}const diagonalDash=p.diagonalStyle==='dashed'?`stroke-dasharray="${fmt(p.diagonalDashLength)} ${fmt(p.diagonalDashGap)}"`:'';add(`<path d="${dp.join('')}" fill="none" stroke="${s}" stroke-width="${fmt(p.diagonalWidth)}" ${diagonalDash}/>`);}
    if(p.junction!=='none'){const marks=[];for(let x=0;x<=w;x+=size)for(let y=0;y<=h;y+=size){if(p.junction==='cross')marks.push(`M${fmt(x-p.junctionSize)} ${fmt(y)}H${fmt(x+p.junctionSize)}M${fmt(x)} ${fmt(y-p.junctionSize)}V${fmt(y+p.junctionSize)}`);else marks.push(`M${fmt(x-p.junctionSize)} ${fmt(y)}h${fmt(2*p.junctionSize)}M${fmt(x)} ${fmt(y-p.junctionSize)}v${fmt(2*p.junctionSize)}`);}add(`<path d="${marks.join('')}" fill="none" stroke="${s}" stroke-width="${fmt(p.junctionWidth)}"/>`);}
    if(p.cornerShape!=='none'){for(const [x,y,sx,sy] of [[p.cornerInset,p.cornerInset,1,1],[w-p.cornerInset,p.cornerInset,-1,1],[p.cornerInset,h-p.cornerInset,1,-1],[w-p.cornerInset,h-p.cornerInset,-1,-1]]){const z=p.cornerSize,fill=p.cornerShape==='ring'?'none':s;if(p.cornerShape==='circle'||p.cornerShape==='ring')add(circle(x,y,z/2,fill,s,p.strokeWidth));else if(p.cornerShape==='square')add(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(z)}" height="${fmt(z)}" fill="${fill}" stroke="${s}" stroke-width="${fmt(p.strokeWidth)}"/>`);else if(p.cornerShape==='triangle')add(polygon([[x,y],[x+sx*z,y],[x,y+sy*z]],fill,s,p.strokeWidth));else add(`<path d="M${xy(x,y+sy*z)}V${fmt(y)}H${fmt(x+sx*z)}" fill="none" stroke="${s}" stroke-width="${fmt(p.strokeWidth)}"/>`);}}
    if(p.dots){let gap=capStep(p.dotSpacing,w,h,1000),dots=[];for(let y=gap/2;y<h;y+=gap)for(let x=gap/2;x<w;x+=gap)dots.push(circle(x,y,p.dotSize/2,s,'none',0));add(dots.join(''));}
    if(p.hatch){const hatch=[];for(let x=-h;x<w;x+=capStep(p.hatchSpacing,w,h,1200))hatch.push(`M${fmt(x)} ${h}L${fmt(x+h)} 0`);add(`<path d="${hatch.join('')}" fill="none" stroke="${s}" stroke-width="${fmt(p.hatchWidth)}"/>`);}
  } else if(type==='rays') {
    const rand=rng(hashSeed(doc.seed,layer.id)),slot=Math.PI*2/p.count;for(let i=0;i<p.count;i++){const angle=(i+.5)*slot,jitter=p.mode==='random'?(rand()-.5)*slot:0,lengthFactor=1-rand()*p.randomLength,a=angle+jitter,r0=p.innerRadius,r1=Math.min(p.outerRadius,r0+(p.outerRadius-r0)*lengthFactor);if(p.mode==='fixedAngle'){const half=slot*.36;if(p.end==='pointed'){const left=a-half,right=a+half,tipR=Math.min(p.outerRadius,r1+p.strokeWidth*2),pts=[[cx+Math.cos(left)*r0,cy+Math.sin(left)*r0],[cx+Math.cos(left)*r1,cy+Math.sin(left)*r1],[cx+Math.cos(a)*tipR,cy+Math.sin(a)*tipR],[cx+Math.cos(right)*r1,cy+Math.sin(right)*r1],[cx+Math.cos(right)*r0,cy+Math.sin(right)*r0]];add(polygon(pts,c,c,p.strokeWidth,`stroke-linejoin="round"`));}else add(`<path d="${sectorPath(cx,cy,r0,r1,a-half,a+half)}" fill="${c}" stroke="${c}" stroke-width="${fmt(p.strokeWidth)}" stroke-linejoin="${p.end==='round'?'round':'miter'}"/>`);continue;}const x0=cx+Math.cos(a)*r0,y0=cy+Math.sin(a)*r0,x1=cx+Math.cos(a)*r1,y1=cy+Math.sin(a)*r1;if(p.end==='pointed'){const vx=Math.cos(a),vy=Math.sin(a),px=-vy,py=vx,sw=p.strokeWidth,tip=[x1+vx*sw*2,y1+vy*sw*2];add(polygon([[x0+px*sw/2,y0+py*sw/2],[x1+px*sw/2,y1+py*sw/2],tip,[x1-px*sw/2,y1-py*sw/2],[x0-px*sw/2,y0-py*sw/2]],c));}else add(line(x0,y0,x1,y1,c,p.strokeWidth,`stroke-linecap="${p.end==='round'?'round':'butt'}"`));}
  }
  return out.join('');
}

export function renderSVG(document, { preview = false, repeat = 1 } = {}) {
  const doc=normalizeDocument(document);assert(repeat===1||repeat===3,'repeat must be 1 or 3');
  const W=doc.width,H=doc.height,fullW=W*repeat,fullH=H*repeat,parts=[];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fullW}" height="${fullH}" viewBox="0 0 ${fullW} ${fullH}"${preview?' data-preview="true"':''}>`);
  const visible=doc.layers.filter(layer=>!isImageMaskLayer(layer)&&layer.visible&&layer.opacity>0),imageMasks=doc.layers.filter(layer=>isImageMaskLayer(layer)&&layer.visible);
  parts.push('<defs><clipPath id="tile-base"><rect x="0" y="0" width="'+W+'" height="'+H+'"/></clipPath>');
  const imageMaskIds=[];
  for(const layer of imageMasks){
    const geometry=imageMaskGeometry(layer,doc),filterId=`image-mask-filter-${esc(layer.id)}`,maskId=`image-mask-${esc(layer.id)}`,cutoff=Math.min(255,Math.floor(layer.threshold*256/255)),table=Array.from({length:256},(_,index)=>((layer.invert?index>cutoff:index<=cutoff)?'1':'0')).join(' ');
    parts.push(`<filter id="${filterId}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB"><feFlood flood-color="white" result="white"/><feComposite in="SourceGraphic" in2="white" operator="over" result="opaque"/><feColorMatrix in="opaque" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .2126 .7152 .0722 0 0" result="luminance"/><feComponentTransfer in="luminance" result="binary"><feFuncA type="discrete" tableValues="${table}"/></feComponentTransfer><feComposite in="binary" in2="SourceAlpha" operator="in"/></filter>`);
    parts.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" mask-type="alpha"><g filter="url(#${filterId})"><image href="${esc(layer.image)}" x="${fmt(-geometry.width/2)}" y="${fmt(-geometry.height/2)}" width="${fmt(geometry.width)}" height="${fmt(geometry.height)}" preserveAspectRatio="none" transform="${esc(geometry.transform)}"/></g></mask>`);
    imageMaskIds.push(maskId);
  }
  if(imageMaskIds.length){
    let content=`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`;
    for(let index=imageMaskIds.length-1;index>=0;index--)content=`<g mask="url(#${imageMaskIds[index]})">${content}</g>`;
    parts.push(`<mask id="all-image-masks" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" mask-type="alpha">${content}</mask>`);
  }
  const sources=new Map(),copyRanges=new Map();
  for(const original of visible){
    const layer=fitSeamlessMotif(original,doc);
    const metrics={};let content=renderPattern(layer,doc,preview,metrics);if(!content)continue;
    content+=renderCellLinks(layer,doc,metrics);
    const renderedLayer=metrics.world?{...layer,rotation:0,scale:1}:layer;
    const cx=W/2,cy=H/2,range=doc.seamless?seamlessCopyRange(renderedLayer,doc,metrics.bounds):{x0:0,x1:0,y0:0,y1:0,ox:layer.offsetX,oy:layer.offsetY},transform=`translate(${fmt(range.ox)} ${fmt(range.oy)}) translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(renderedLayer.rotation)}) scale(${transformNumber(renderedLayer.scale)}) translate(${fmt(-cx)} ${fmt(-cy)})`,source=`source-${layer.id}`;
    if(layer.customMotif&&content.includes(`href="#motif-${layer.id}"`)){
      const motif=`motif-${esc(layer.id)}`,image=`<image href="${esc(layer.customMotif)}" x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid meet"/>`;
      if(layer.motifTint){const mask=`motif-alpha-${esc(layer.id)}`;parts.push(`<mask id="${mask}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" mask-type="alpha">${image}</mask><symbol id="${motif}" viewBox="0 0 1 1"><rect x="0" y="0" width="1" height="1" fill="${layer.color}" mask="url(#${mask})"/></symbol>`);}
      else parts.push(`<symbol id="${motif}" viewBox="0 0 1 1">${image}</symbol>`);
    }
    if(layer.mask){
      const maskTransform=metrics.world?` transform="translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(layer.rotation)}) scale(${fmt(layer.scale)}) translate(${fmt(-cx)} ${fmt(-cy)})"`:'';
      const extent=Math.hypot(cx,cy)*Math.max(1,layer.scale);
      parts.push(`<mask id="mask-${esc(layer.id)}" maskUnits="userSpaceOnUse" x="${fmt(cx-extent)}" y="${fmt(cy-extent)}" width="${fmt(2*extent)}" height="${fmt(2*extent)}" mask-type="alpha"><image href="${esc(layer.mask)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"${maskTransform}/></mask>`);
    }
    copyRanges.set(layer.id,range);
    sources.set(layer.id,source);
    if(repeat===3)parts.push(`<g id="${source}" opacity="1" transform="${transform}">${layer.mask?`<g mask="url(#mask-${esc(layer.id)})">${content}</g>`:content}</g>`);
    else sources.set(layer.id,{content,transform});
  }
  parts.push('</defs>');
  if(!doc.transparent)parts.push(`<rect width="${fullW}" height="${fullH}" fill="${doc.background}"/>`);
  for(let tileY=0;tileY<repeat;tileY++)for(let tileX=0;tileX<repeat;tileX++){
    const tx=tileX*W,ty=tileY*H;parts.push(`<g clip-path="url(#tile-base)" transform="translate(${tx} ${ty})">`);
    if(imageMaskIds.length)parts.push('<g mask="url(#all-image-masks)">');
    for(const layer of visible){const source=sources.get(layer.id),range=copyRanges.get(layer.id);if(!source||!range)continue;
      parts.push(`<g opacity="${fmt(layer.opacity)}">`);
      for(let oy=range.y0;oy<=range.y1;oy++)for(let ox=range.x0;ox<=range.x1;ox++){
        const px=ox*W,py=oy*H;
        if(repeat===3)parts.push(`<use href="#${source}" x="${fmt(px)}" y="${fmt(py)}"${preview?` data-layer="${esc(layer.id)}"`:''}/>`);
        else {const mask=layer.mask?`<g mask="url(#mask-${esc(layer.id)})">${source.content}</g>`:source.content;parts.push(`<g opacity="1" transform="translate(${fmt(px)} ${fmt(py)})"><g transform="${source.transform}">${mask}</g></g>`);}
      }
      parts.push('</g>');
    }
    if(imageMaskIds.length)parts.push('</g>');
    parts.push('</g>');
  }
  parts.push('</svg>');return parts.join('');
}
