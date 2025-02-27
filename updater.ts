import { writeFileSync, readFileSync } from 'fs';
import { loadTest } from './loadTest';
import { unifiedTest } from './unifiedTest';
import { hlsTest } from './hlsTest';
import { gethp } from './hyperpipe';

const piped_instances = 'https://raw.githubusercontent.com/wiki/TeamPiped/Piped/Instances.md';
const invidious_instances = JSON.parse(readFileSync('./invidious.json', 'utf8'));
const unified_instances = JSON.parse(readFileSync('./unified_instances.json', 'utf8'));
const di: {
  piped: string[],
  invidious: string[],
  hyperpipe: string,
  status: number
} = {
  piped: [],
  hls: [],
  invidious: [],
  hyperpipe: '',
  status: 1
};

async function getSuggestions(i: string) {
  const t = performance.now();
  const isIV = invidious_instances.includes(i);
  const q = isIV ?
    '/api/v1/search/suggestions?q=the' :
    '/opensearch/suggestions?query=the';

  return fetch(i + q)
    .then(_ => _.json())
    .then(data => {
      const score = Math.floor(1e5 / (performance.now() - t));
      if (isIV ? data?.suggestions?.length : data[0].length)
        return [score, i];
      else throw new Error();
    })
    .catch(() => [0, i]);
}

const getInstances = async (instanceArray: string[]): Promise<string[]> => Promise.all(instanceArray.map(getSuggestions)).then(array =>
  array
    .sort((a, b) => <number>b[0] - <number>a[0])
    .filter((i) => i[0])
    .map(i => i[1] as string)
);

fetch(piped_instances)
  .then(r => r.text())
  console.log(r)
  .then(t => t.split('--- | --- | --- | --- | ---')[1])
  console.log(t)
  .then(t => t.split('\n'))
  console.log(t)
  .then(i => i.map(_ => _.split(' | ')[1]))
  .then(async instances => {
    instances.shift();
    const piped_instances = instances
      .filter(i => i !== 'https://pipedapi.kavin.rocks')
      .concat([
        'https://pol1.piapi.ggtyler.dev',
        'https://nyc1.piapi.ggtyler.dev',
        'https://cal1.piapi.ggtyler.dev',
        'https://pipedapi.orangenet.cc'
      ]);

    const pi = await getInstances(piped_instances);
    const iv = await getInstances(invidious_instances);
    
    (await Promise.all(pi.map(hlsTest)))
      .filter(h => h)
      .forEach(async i => {
        if (i in unified_instances) {
          const u = unified_instances[i];
          const isAlive = iv.includes(u);
          if (isAlive) {
            const passed = await unifiedTest(i,u);
            if (passed) {
              di.piped.push(i);
              di.invidious.push(u);
            }
            else di.hls.push(i);
          }
          else di.hls.push(i);
        }
        else di.hls.push(i);
      });

    (await Promise.all(iv.map(loadTest)))
      .filter(p => p)
      .forEach(i => {
        di.invidious.push(i);
      });
    
    di.hyperpipe = await gethp();
    
    console.log(di);
    
    if (!di.piped.length) {
      di.status--;
      pi
        .filter(i => !di.hls.concat(di.piped).includes(i))
        .forEach(i => di.piped.push(i));
    }
    
    if (!di.invidious.length) {
      di.status--;
      di.invidious.push(iv[0]);
    }

    writeFileSync(
      'dynamic_instances.json',
      JSON.stringify(di, null, 4)
    );
  });
