import { writeFileSync, readFileSync } from 'fs';
import fetch from 'node-fetch';
import { loadTest } from './loadTest';
import { unifiedTest } from './unifiedTest';
import { hlsTest } from './hlsTest';
import { gethp } from './hyperpipe';
import * as cheerio from 'cheerio';

const pipedInstancesUrl = 'https://github.com/TeamPiped/Piped/wiki/Instances';
const invidiousInstances = JSON.parse(readFileSync('./invidious.json', 'utf8'));
const unifiedInstances = JSON.parse(readFileSync('./unified_instances.json', 'utf8'));

const di: {
  piped: string[];
  hls: string[];
  invidious: string[];
  hyperpipe: string;
  status: number;
} = {
  piped: [],
  hls: [],
  invidious: [],
  hyperpipe: '',
  status: 1,
};

async function getSuggestions(instanceUrl: string) {
  const startTime = performance.now();
  const isInvidious = invidiousInstances.includes(instanceUrl);
  const queryPath = isInvidious
    ? '/api/v1/search/suggestions?q=the'
    : '/opensearch/suggestions?query=the';

  try {
    const response = await fetch(instanceUrl + queryPath);
    const data = await response.json();
    const score = Math.floor(1e5 / (performance.now() - startTime));
    if (isInvidious ? data?.suggestions?.length : data[0]?.length) {
      return [score, instanceUrl];
    } else {
      throw new Error('No suggestions found');
    }
  } catch {
    return [0, instanceUrl];
  }
}

async function getInstances(instanceArray: string[]): Promise<string[]> {
  const results = await Promise.all(instanceArray.map(getSuggestions));
  return results
    .sort((a, b) => b[0] - a[0])
    .filter((result) => result[0] > 0)
    .map((result) => result[1]);
}

async function fetchPipedInstances(): Promise<string[]> {
  try {
    const response = await fetch(pipedInstancesUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Piped instances: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const instances: string[] = [];
    $('table tr').each((index, element) => {
      if (index === 0) return; // Skip header row
      const instanceUrl = $(element).find('td').eq(1).text().trim();
      if (instanceUrl) {
        instances.push(instanceUrl);
      }
    });
    return instances;
  } catch (error) {
    console.error('Error fetching Piped instances:', error.message);
    return [];
  }
}

(async () => {
  const pipedInstances = await fetchPipedInstances();
  const rankedPipedInstances = await getInstances(invidiousInstances);
  const rankedInvidiousInstances = await getInstances(invidiousInstances);

  const hlsResults = await Promise.all(rankedPipedInstances.map(hlsTest));
  for (const instance of hlsResults.filter(Boolean)) {
    if (instance in unifiedInstances) {
      const correspondingInvidious = unifiedInstances[instance];
      if (rankedInvidiousInstances.includes(correspondingInvidious)) {
        const passed = await unifiedTest(instance, correspondingInvidious);
        if (passed) {
          di.piped.push(instance);
          di.invidious.push(correspondingInvidious);
        } else {
          di.hls.push(instance);
        }
      } else {
        di.hls.push(instance);
      }
    } else {
      di.hls.push(instance);
    }
  }

  const loadResults = await Promise.all(rankedInvidiousInstances.map(loadTest));
  for (const instance of loadResults.filter(Boolean)) {
    di.invidious.push(instance);
  }

  di.hyperpipe = await gethp();

  if (!di.piped.length) {
    di.status--;
    const fallbackPipedInstances = rankedPipedInstances.filter(
      (instance) => !di.hls.includes(instance) && !di.piped.includes(instance)
    );
    di.piped.push(...fallbackPipedInstances);
  }

  if (!di.invidious.length) {
    di.status--;
    if (rankedInvidiousInstances.length > 0) {
      di.invidious.push(rankedInvidiousInstances[0]);
    }
  }

  writeFileSync('dynamic_instances.json', JSON.stringify(di, null, 4));
})();
