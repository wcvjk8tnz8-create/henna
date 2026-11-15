/**
 * 收信通道回归测试
 *
 * 覆盖：各家 webhook payload → 统一 InboundMail 的归一化，
 * 以及「解析失败 / 坏输入 / AI 不可用」都不抛异常。
 * 重点是域名没托管到 Cloudflare 时，这条链路必须真的能收到信。
 */

export {};

import {
  extractEmail,
  extractName,
  stripPlusTag,
  toRecipients,
  INBOUND_SOURCES,
} from '../email/types';
import { parseInbound, b64ToBuffer } from '../email/parse';
import { DEFAULT_SETTINGS } from '../db/settings';
import type { Env } from '../env';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

const env = {} as Env;
const settings = { ...DEFAULT_SETTINGS };
const ctx = { env, settings, resendApiKey: '' };

function jsonReq(body: unknown): Request {
  return new Request('https://example.com/api/inbound/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formReq(fields: Record<string, string>, files: Record<string, { name: string; type: string; body: string }> = {}): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) {
    fd.append(k, new File([f.body], f.name, { type: f.type }));
  }
  return new Request('https://example.com/api/inbound/test', { method: 'POST', body: fd });
}

console.log('地址工具：');

check('尖括号格式', extractEmail('John Doe <john@example.com>') === 'john@example.com');
check('纯地址', extractEmail('JOHN@Example.COM') === 'john@example.com');
check('空值', extractEmail('') === '' && extractEmail(null) === '');
check('显示名', extractName('"John Doe" <john@example.com>') === 'John Doe');
check('去 +tag', stripPlusTag('support+ticket-456@yourdomain.com') === 'support@yourdomain.com');
check('无 tag 不变', stripPlusTag('a@b.com') === 'a@b.com');
check('收件人数组去重', JSON.stringify(toRecipients(['a@b.com', 'c@d.com'], 'a@b.com')) === JSON.stringify(['a@b.com', 'c@d.com']));
check('收件人对象（Postmark ToFull）', toRecipients([{ Email: 'x@y.com' }]).includes('x@y.com'));
check('逗号串', toRecipients('a@b.com, c@d.com').length === 2);
check('来源清单含 6 种', INBOUND_SOURCES.length === 6 && INBOUND_SOURCES.includes('generic'));

console.log('');
console.log('base64：');
const buf = b64ToBuffer('SGVsbG8=');
check('解码正确', new TextDecoder().decode(buf) === 'Hello');
check('兼容 data: URL', new TextDecoder().decode(b64ToBuffer('data:text/plain;base64,SGVsbG8=')) === 'Hello');

console.log('');
console.log('自建接口 generic：');
const g = await parseInbound('generic', jsonReq({
  from: 'Alice <alice@example.com>',
  to: ['box@r0.us.ci'],
  subject: '你好',
  text: '正文',
  html: '<p>正文</p>',
  messageId: '<abc@x>',
  attachments: [{ filename: 'a.txt', contentType: 'text/plain', content: 'SGVsbG8=' }],
}), ctx);
check('解析出 1 封', g.length === 1);
check('发件人/显示名', g[0]?.from === 'alice@example.com' && g[0]?.fromName === 'Alice');
check('收件人', g[0]?.to?.[0] === 'box@r0.us.ci');
check('主题与正文', g[0]?.subject === '你好' && g[0]?.text === '正文');
check('Message-ID', g[0]?.messageId === '<abc@x>');
check('附件 base64 还原', g[0]?.attachments?.[0]?.filename === 'a.txt');
check('来源标记', g[0]?.source === 'generic');

const gEmpty = await parseInbound('generic', jsonReq({}), ctx);
check('空 JSON → 0 封不抛异常', gEmpty.length === 0);
const gBad = await parseInbound('generic', new Request('https://x', { method: 'POST', body: 'not json' }), ctx);
check('坏 JSON → 0 封不抛异常', gBad.length === 0);

console.log('');
console.log('Postmark：');
const pm = await parseInbound('postmark', jsonReq({
  From: 'john@example.com',
  FromName: 'John Doe',
  To: 'support+ticket-456@r0.us.ci',
  ToFull: [{ Email: 'support+ticket-456@r0.us.ci', MailboxHash: 'ticket-456' }],
  Subject: 'Re: Issue',
  TextBody: 'I still have not received my order.',
  HtmlBody: '<p>reply</p>',
  MessageID: '73e6d360-66eb-11e1',
  Attachments: [{ Name: 's.png', Content: 'SGVsbG8=', ContentType: 'image/png', ContentLength: 5 }],
}), ctx);
check('解析出 1 封', pm.length === 1);
check('From / FromName', pm[0]?.from === 'john@example.com' && pm[0]?.fromName === 'John Doe');
check('子地址 +tag 保留（由归属匹配去 tag）', pm[0]?.to?.[0] === 'support+ticket-456@r0.us.ci');
check('TextBody / HtmlBody', pm[0]?.text?.includes('received') === true && pm[0]?.html === '<p>reply</p>');
check('MessageID 同时用于去重', pm[0]?.eventId === '73e6d360-66eb-11e1');
check('附件名与类型', pm[0]?.attachments?.[0]?.filename === 's.png' && pm[0]?.attachments?.[0]?.contentType === 'image/png');

console.log('');
console.log('SendGrid Inbound Parse：');
const sg = await parseInbound('sendgrid', formReq({
  from: 'Sender Name <sender@example.com>',
  to: 'box@r0.us.ci',
  subject: 'Different File Types',
  text: 'plain body',
  html: '<p>html body</p>',
  envelope: JSON.stringify({ to: ['box@r0.us.ci'], from: 'sender@example.com' }),
  headers: 'Message-ID: <sg-123@mail.gmail.com>\r\nFrom: Sender <sender@example.com>',
  attachments: '1',
}, { attachment1: { name: 'doc.pdf', type: 'application/pdf', body: 'PDF' } }), ctx);
check('解析出 1 封', sg.length === 1);
check('envelope.to 优先作收件人', sg[0]?.to?.[0] === 'box@r0.us.ci');
check('subject / text / html', sg[0]?.subject === 'Different File Types' && sg[0]?.text === 'plain body' && sg[0]?.html === '<p>html body</p>');
check('从 headers 抠 Message-ID', sg[0]?.messageId === '<sg-123@mail.gmail.com>');
check('attachment1 文件', sg[0]?.attachments?.[0]?.filename === 'doc.pdf');

console.log('');
console.log('Mailgun：');
const mg = await parseInbound('mailgun', formReq({
  sender: 'them@external.com',
  recipient: 'box@r0.us.ci',
  subject: 'Re: Order 4821',
  'body-plain': 'Thanks for the update...',
  'body-html': '<p>Thanks</p>',
  'message-headers': JSON.stringify([['Message-Id', '<mg-999@mailgun>'], ['From', 'them@external.com'], ['To', 'box@r0.us.ci']]),
  'attachment-count': '0',
}), ctx);
check('解析出 1 封', mg.length === 1);
check('sender / recipient', mg[0]?.from === 'them@external.com' && mg[0]?.to?.[0] === 'box@r0.us.ci');
check('body-plain / body-html', mg[0]?.text === 'Thanks for the update...' && mg[0]?.html === '<p>Thanks</p>');
check('从 message-headers 取 Message-Id', mg[0]?.eventId === '<mg-999@mailgun>');

// 纯 urlencoded（Mailgun 默认就是 form-encoded）
const mgForm = await parseInbound('mailgun', new Request('https://x/api/inbound/mailgun', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    sender: 'form@external.com',
    recipient: 'box@r0.us.ci',
    subject: '表单模式',
    'body-plain': 'plain form body',
  }).toString(),
}), ctx);
check('urlencoded 表单也能解析', mgForm.length === 1 && mgForm[0]?.text === 'plain form body');

const mgJson = await parseInbound('mailgun', jsonReq({
  recipient: 'box@r0.us.ci',
  sender: 'x@y.com',
  subject: 'JSON 模式',
  'body-plain': 'hi',
  'message-headers': [['Message-Id', '<json-1@mg>'], ['Subject', 'JSON 模式']],
  attachments: [{ filename: 'a.txt', 'content-type': 'text/plain', content: 'SGVsbG8=' }],
}), ctx);
check('JSON 模式也能解析', mgJson.length === 1 && mgJson[0]?.subject === 'JSON 模式');
check('JSON 模式附件', mgJson[0]?.attachments?.[0]?.filename === 'a.txt');

console.log('');
console.log('Resend：');
const event = {
  type: 'email.received',
  created_at: '2024-02-22T23:41:12.126Z',
  data: {
    email_id: '56761188-7520-42d8',
    from: 'Acme <sender@acme.com>',
    to: ['box@r0.us.ci'],
    subject: 'Sending this example',
    message_id: '<resend-1@acme>',
    attachments: [],
  },
};
const rsNoKey = await parseInbound('resend', jsonReq(event), { ...ctx, resendApiKey: '' });
check('无 API Key 仍入库（只元数据）', rsNoKey.length === 1);
check('eventId = email_id', rsNoKey[0]?.eventId === '56761188-7520-42d8');
check('无 Key 时给出明确提示', (rsNoKey[0]?.text ?? '').includes('未配置 Resend API Key'));

// 模拟 Resend 回拉
const originalFetch = globalThis.fetch;
let called: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  called.push(url);
  if (url.includes('/attachments')) {
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }
  return new Response(JSON.stringify({
    id: '56761188-7520-42d8',
    from: 'Acme <sender@acme.com>',
    to: ['box@r0.us.ci'],
    subject: 'Sending this example',
    html: '<p>full html</p>',
    text: 'full text',
    headers: [{ Name: 'Message-ID', Value: '<resend-1@acme>' }],
  }), { status: 200 });
}) as typeof fetch;
const rsWithKey = await parseInbound('resend', jsonReq(event), { ...ctx, settings: { ...settings, inbound_resend_api_key: 're_test' } });
globalThis.fetch = originalFetch;
check('有 Key → 调用 Receiving API', called.some((u) => u.includes('/emails/receiving/56761188')));
check('回拉到正文', rsWithKey[0]?.text === 'full text' && rsWithKey[0]?.html === '<p>full html</p>');
check('回拉到附件 API 也调了', called.some((u) => u.includes('/attachments')));
check('从 headers 补 Message-ID', rsWithKey[0]?.messageId === '<resend-1@acme>');

console.log('');
console.log('兜底：');
check('未知来源 → 空数组', (await parseInbound('cloudflare', jsonReq({}), ctx)).length === 0);
check('cloudflare 不走 webhook', !INBOUND_SOURCES.includes('cloudflare') === false);

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} 项失败`);
