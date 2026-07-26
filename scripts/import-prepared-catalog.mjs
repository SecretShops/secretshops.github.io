#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseCsv(text) {
  const rows=[]; let row=[], field='', quote=false;
  for (let i=0;i<text.length;i++) { const c=text[i];
    if (quote) { if(c==='"'&&text[i+1]==='"'){field+='"';i++;} else if(c==='"') quote=false; else field+=c; }
    else if(c==='"') quote=true; else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';} else field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row);} const h=rows.shift();
  return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));
}

const [input, merchant='lounge-eu'] = process.argv.slice(2);
if(!input){console.error('Uso: node scripts/import-prepared-catalog.mjs <catalogo.csv> [merchant-id]');process.exit(1);}
const required=['id','merchant_id','market','currency','source_sku','title','price','availability','affiliate_url','landing_url'];
const rows=parseCsv(fs.readFileSync(path.resolve(input),'utf8').replace(/^\uFEFF/,''));
for(const key of required) if(!rows.every(r=>key in r)) throw new Error(`Falta la columna ${key}`);
const invalid=rows.filter(r=>r.merchant_id!==merchant || !/^https:\/\//.test(r.affiliate_url) || !Number.isFinite(Number(r.price)) || Number(r.price)<=0);
console.log(JSON.stringify({input:path.basename(input),merchant,rows:rows.length,valid:rows.length-invalid.length,invalid:invalid.length,markets:[...new Set(rows.map(r=>r.market))]},null,2));
if(invalid.length) process.exitCode=2;
