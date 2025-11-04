import 'dotenv/config';
import { Client as Notion } from '@notionhq/client';

const { NOTION_TOKEN, NOTION_DB_ID } = process.env;
if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error('Missing NOTION_TOKEN or NOTION_DB_ID'); process.exit(1);
}
const notion = new Notion({ auth: NOTION_TOKEN });

const PROPS = {
  name: 'Product Name',
  active: 'Active',
  urlLive: 'PaymentURL',
  urlTest: 'Stripe Link (Test)',
};

const getText = (p) => p?.type === 'title' || p?.type === 'rich_text'
  ? p[p.type].map(t => t.plain_text).join('')
  : (p?.type === 'url' ? p.url : undefined);

async function* readAll(database_id) {
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: PROPS.active, checkbox: { equals: true } },
    });
    for (const r of resp.results) yield r;
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}

const missing = { test: [], live: [] };
let total = 0;

for await (const page of readAll(NOTION_DB_ID)) {
  total++;
  const props = page.properties || {};
  const name = getText(props[PROPS.name]);
  const t = getText(props[PROPS.urlTest]);
  const l = getText(props[PROPS.urlLive]);
  if (!t) missing.test.push(name || page.id);
  if (!l) missing.live.push(name || page.id);
}

console.log(JSON.stringify({
  total_active: total,
  missing_test_count: missing.test.length,
  missing_live_count: missing.live.length,
  sample_missing_test: missing.test.slice(0, 5),
  sample_missing_live: missing.live.slice(0, 5),
}, null, 2));
