/**
 * 各家发信商 inbound webhook 的 payload → 统一 InboundMail。
 *
 * 域名没托管到 Cloudflare 时用不上 Email Routing，就靠这几条路收信。
 * 每家的格式都不一样（JSON / multipart / 表单 / 只给元数据要回拉），
 * 全部在这里消化，后面的入库逻辑只认一个结构。
 *
 * 支持的来源：
 *   resend    JSON 事件 email.received，需回拉 Receiving API 拿正文
 *   postmark  JSON（From / TextBody / HtmlBody / Attachments）
 *   sendgrid  multipart/form-data（可选原始 MIME 在 email 字段）
 *   mailgun   表单或 JSON（URL 末尾加 /json），message-headers 里翻 Message-ID
 *   generic   自建接口，最简 JSON，给 curl / n8n / 自己的服务器用
 */
import PostalMime from 'postal-mime';
import type { Env } from '../env';
import type { SettingsMap } from '../db/settings';
import {
  extractEmail,
  extractName,
  toRecipients,
  type InboundAttachment,
  type InboundMail,
  type InboundSource,
} from './types';

export interface ParseContext {
  env: Env;
  settings: SettingsMap;
  /** 从已配置的 Resend 服务商自动取到的 API Key */
  resendApiKey?: string;
  /** 从已配置的 Brevo 服务商自动取到的 API Key（下载附件要用） */
  brevoApiKey?: string;
}

const MAX_ATTACHMENT = 8 * 1024 * 1024;

/** base64 → ArrayBuffer，兼容 data: URL 前缀与 urlsafe 变体 */
export function b64ToBuffer(s: string): ArrayBuffer {
  const clean = s.replace(/^data:[^,]*base64,/, '').replace(/-/g, '+').replace(/_/g, '/').trim();
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** 从 Mailgun 的 message-headers 数组里找某个头 */
function headerFrom(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return '';
  const target = name.toLowerCase();
  for (const h of headers) {
    if (Array.isArray(h) && h.length >= 2 && str(h[0]).toLowerCase() === target) return str(h[1]);
    if (h && typeof h === 'object') {
      const o = h as Record<string, unknown>;
      if (str(o.Name ?? o.name ?? o.key).toLowerCase() === target) return str(o.Value ?? o.value);
    }
  }
  return '';
}

/** 原始 RFC 5322 MIME → InboundMail */
async function fromRawMime(raw: ArrayBuffer | string, source: InboundSource, fallback: Partial<InboundMail> = {}): Promise<InboundMail> {
  const buf = typeof raw === 'string' ? new TextEncoder().encode(raw).buffer : raw;
  const p = (await PostalMime.parse(buf)) as {
    from?: { name?: string; address?: string };
    to?: { name?: string; address?: string }[];
    subject?: string;
    html?: string;
    text?: string;
    messageId?: string;
    attachments?: { filename: string; mimeType: string; content: ArrayBuffer }[];
  };
  return {
    from: extractEmail(p.from?.address) || fallback.from || '',
    fromName: p.from?.name || fallback.fromName || '',
    to: toRecipients(p.to?.map((t) => t.address ?? ''), fallback.to),
    subject: p.subject || fallback.subject || '(无主题)',
    text: p.text ?? fallback.text ?? '',
    html: p.html ?? fallback.html ?? '',
    messageId: p.messageId || fallback.messageId,
    eventId: fallback.eventId,
    attachments: (p.attachments ?? []).map((a) => ({
      filename: a.filename || 'file',
      contentType: a.mimeType || 'application/octet-stream',
      content: a.content,
    })),
    size: buf.byteLength,
    source,
  };
}

/** 读 body 成 JSON 对象，坏 JSON 返回空对象而不是抛异常 */
async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = (await req.json()) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 读成普通对象：multipart / urlencoded / JSON 通吃 */
async function readFields(req: Request): Promise<{ fields: Record<string, unknown>; files: Map<string, File> }> {
  const fields: Record<string, unknown> = {};
  const files = new Map<string, File>();
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return { fields: await readJson(req), files };
  }
  try {
    const fd = await req.formData();
    fd.forEach((v, k) => {
      if (typeof v === 'string') fields[k] = v;
      else files.set(k, v as File);
    });
  } catch {
    // 有些服务商用纯 urlencoded 但 content-type 缺失，手动兜一层
    try {
      const t = await req.text();
      for (const [k, v] of new URLSearchParams(t)) fields[k] = v;
    } catch {
      /* 忽略 */
    }
  }
  return { fields, files };
}

/* ── Resend ──────────────────────────────────────────────────
 * webhook 只有元数据，正文和附件要分别调 API 拉。
 * 没配 API Key 时仍会入库（只存元数据），并在设置页提示。 */
async function parseResend(req: Request, ctx: ParseContext): Promise<InboundMail[]> {
  const body = await readJson(req);
  // 兼容直接 POST data 对象和包在事件里的两种写法
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
  const emailId = str(data.email_id ?? data.id);
  if (!emailId) return [];

  const base: InboundMail = {
    from: extractEmail(str(data.from)),
    fromName: extractName(str(data.from)),
    to: toRecipients(data.to),
    subject: str(data.subject) || '(无主题)',
    text: '',
    html: '',
    messageId: str(data.message_id) || undefined,
    eventId: emailId,
    source: 'resend',
  };

  const key = ctx.settings.inbound_resend_api_key || ctx.resendApiKey || '';
  if (!key) {
    base.text = '(未配置 Resend API Key，仅保存元数据；到「收信通道」填写后回拉正文)';
    return [base];
  }

  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const e = (await r.json()) as Record<string, unknown>;
      base.from = extractEmail(str(e.from)) || base.from;
      base.fromName = extractName(str(e.from)) || base.fromName;
      base.to = toRecipients(e.to, base.to);
      base.subject = str(e.subject) || base.subject;
      base.text = str(e.text);
      base.html = str(e.html);
      base.messageId = str(headerFrom(e.headers, 'Message-ID')) || base.messageId;
    }
  } catch {
    /* 回拉失败仍保留元数据 */
  }

  // 附件：list → download_url（1 小时有效）
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = (await r.json()) as { data?: { filename?: string; content_type?: string; download_url?: string }[] };
      const atts: InboundAttachment[] = [];
      for (const a of j.data ?? []) {
        if (!a.download_url) continue;
        try {
          const f = await fetch(a.download_url, { signal: AbortSignal.timeout(8000) });
          const buf = await f.arrayBuffer();
          if (buf.byteLength > MAX_ATTACHMENT) continue;
          atts.push({
            filename: a.filename || 'file',
            contentType: a.content_type || 'application/octet-stream',
            content: buf,
          });
        } catch {
          /* 单个附件失败跳过 */
        }
      }
      if (atts.length) base.attachments = atts;
    }
  } catch {
    /* 附件失败不影响正文 */
  }

  return [base];
}

/* ── Postmark ──────────────────────────────────────────────── */
function parsePostmark(req: Request): Promise<InboundMail[]> {
  return readJson(req).then((b) => {
    if (!b.From && !b.Subject && !b.TextBody) return [];
    const atts: InboundAttachment[] = [];
    if (Array.isArray(b.Attachments)) {
      for (const a of b.Attachments as Record<string, unknown>[]) {
        const content = str(a.Content);
        if (!content) continue;
        try {
          const buf = b64ToBuffer(content);
          if (buf.byteLength > MAX_ATTACHMENT) continue;
          atts.push({
            filename: str(a.Name) || 'file',
            contentType: str(a.ContentType) || 'application/octet-stream',
            content: buf,
          });
        } catch {
          /* 坏 base64 跳过 */
        }
      }
    }
    return [
      {
        from: extractEmail(str(b.From)),
        fromName: str(b.FromName) || extractName(str(b.From)),
        to: toRecipients(b.To, b.ToFull, b.OriginalRecipient),
        subject: str(b.Subject) || '(无主题)',
        text: str(b.TextBody ?? b.StrippedTextReply),
        html: str(b.HtmlBody),
        messageId: str(b.MessageID) || undefined,
        eventId: str(b.MessageID) || undefined,
        attachments: atts,
        source: 'postmark',
      },
    ];
  });
}

/* ── SendGrid Inbound Parse ─────────────────────────────────── */
async function parseSendGrid(req: Request): Promise<InboundMail[]> {
  const { fields, files } = await readFields(req);
  if (!fields.from && !fields.to && !fields.subject && !files.size) return [];

  // 勾了「POST the raw, full MIME message」时优先用原始邮件，字段最全
  if (typeof fields.email === 'string' && fields.email.includes('\n')) {
    const m = await fromRawMime(fields.email, 'sendgrid');
    if (m.to.length) return [m];
  }

  let envelopeTo: string[] = [];
  try {
    const envObj = JSON.parse(str(fields.envelope)) as { to?: string[] };
    envelopeTo = toRecipients(envObj.to);
  } catch {
    /* 没开 envelope 就用 to 字段 */
  }

  const atts: InboundAttachment[] = [];
  for (const [k, f] of files) {
    if (!/^attachment\d*$/i.test(k)) continue;
    if (f.size > MAX_ATTACHMENT) continue;
    atts.push({
      filename: f.name || 'file',
      contentType: f.type || 'application/octet-stream',
      content: await f.arrayBuffer(),
    });
  }

  const headers = str(fields.headers);
  const messageId = /^Message-ID:\s*(.+)$/im.exec(headers)?.[1]?.trim();

  return [
    {
      from: extractEmail(str(fields.from)),
      fromName: extractName(str(fields.from)),
      to: envelopeTo.length ? envelopeTo : toRecipients(fields.to),
      subject: str(fields.subject) || '(无主题)',
      text: str(fields.text),
      html: str(fields.html),
      messageId,
      attachments: atts,
      source: 'sendgrid',
    },
  ];
}

/* ── Mailgun Routes ─────────────────────────────────────────── */
async function parseMailgun(req: Request): Promise<InboundMail[]> {
  const { fields, files } = await readFields(req);
  if (!fields.recipient && !fields.sender && !fields['body-plain'] && !fields['body-html']) return [];

  let headers: unknown = fields['message-headers'];
  if (typeof headers === 'string') {
    try {
      headers = JSON.parse(headers);
    } catch {
      headers = [];
    }
  }

  const atts: InboundAttachment[] = [];
  for (const [k, f] of files) {
    if (!/^attachment/i.test(k)) continue;
    if (f.size > MAX_ATTACHMENT) continue;
    atts.push({
      filename: f.name || 'file',
      contentType: f.type || 'application/octet-stream',
      content: await f.arrayBuffer(),
    });
  }
  // JSON 模式下附件在数组里、base64 编码
  if (!atts.length && Array.isArray(fields.attachments)) {
    for (const a of fields.attachments as Record<string, unknown>[]) {
      const content = str(a.content ?? a.Content);
      if (!content) continue;
      try {
        const buf = b64ToBuffer(content);
        if (buf.byteLength > MAX_ATTACHMENT) continue;
        atts.push({
          filename: str(a.filename ?? a.Name) || 'file',
          contentType: str(a['content-type'] ?? a.ContentType) || 'application/octet-stream',
          content: buf,
        });
      } catch {
        /* 跳过 */
      }
    }
  }

  const messageId = headerFrom(headers, 'Message-Id') || headerFrom(headers, 'Message-ID');
  return [
    {
      from: extractEmail(str(fields.sender ?? fields.from)) || headerFrom(headers, 'From'),
      fromName: extractName(str(fields.sender ?? fields.from)) || extractName(headerFrom(headers, 'From')),
      to: toRecipients(fields.recipient ?? fields.to, headerFrom(headers, 'To')),
      subject: str(fields.subject) || headerFrom(headers, 'Subject') || '(无主题)',
      text: str(fields['body-plain'] ?? fields.text),
      html: str(fields['body-html'] ?? fields.html),
      messageId: messageId || undefined,
      eventId: messageId || undefined,
      attachments: atts,
      source: 'mailgun',
    },
  ];
}

/* ── Brevo（原 Sendinblue）Inbound Parsing ───────────────────
 * 官方文档：https://developers.brevo.com/docs/inbound-parse-webhooks
 *
 * 和别家最不一样的两点：
 *  1) 顶层 items 是数组 —— 一次 POST 可能带多封邮件（批量）
 *  2) 附件不含内容，只有 DownloadToken，要另调
 *     GET /v3/inbound/attachments/:token 下载（api-key 头）
 *
 * Brevo 不签 webhook，安全靠 URL 里的 ?key= / Basic / Bearer。
 * 另外它自带 Spam.Score（rspamd），只作为参考展示，不覆盖 Workers AI 裁决。 */
function brevoMailbox(v: unknown): { address: string; name: string } {
  if (!v || typeof v !== 'object') return { address: '', name: '' };
  const o = v as Record<string, unknown>;
  return {
    address: extractEmail(str(o.Address ?? o.address ?? o.Email ?? o.email)),
    name: str(o.Name ?? o.name),
  };
}

/** Brevo 的 Headers 是 array<string | string[]>，从里面翻 Message-ID */
function brevoHeader(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return '';
  const target = `${name.toLowerCase()}:`;
  for (const h of headers) {
    const parts = Array.isArray(h) ? h : [h];
    for (const x of parts) {
      if (typeof x === 'string' && x.toLowerCase().startsWith(target)) {
        return x.slice(target.length).trim();
      }
    }
  }
  return '';
}

async function parseBrevo(req: Request, ctx: ParseContext): Promise<InboundMail[]> {
  const body = await readJson(req);
  // 批量是常态；也兼容被转发器解包成单封对象的情况
  const items: unknown[] = Array.isArray(body.items)
    ? body.items
    : body.From || body.Subject || body.RawTextBody
      ? [body]
      : [];
  if (!items.length) return [];

  const key = ctx.settings.inbound_brevo_api_key || ctx.brevoApiKey || '';
  const out: InboundMail[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const from = brevoMailbox(e.From);
    const recipients = toRecipients(e.Recipients, e.To, e.Cc, e.ToFull);
    const uuids = Array.isArray(e.Uuid) ? e.Uuid.map((x) => str(x)).filter(Boolean) : [];
    const messageId = str(e.MessageId) || brevoHeader(e.Headers, 'Message-ID');

    const spamRaw = e.Spam && typeof e.Spam === 'object'
      ? (e.Spam as Record<string, unknown>).Score
      : undefined;
    const spamHint = typeof spamRaw === 'number' && Number.isFinite(spamRaw) ? spamRaw : undefined;

    // 附件：只有 DownloadToken，逐个回拉
    const atts: InboundAttachment[] = [];
    let warning = '';
    if (Array.isArray(e.Attachments) && e.Attachments.length) {
      if (!key) {
        warning = `有 ${e.Attachments.length} 个附件，但未配置 Brevo API Key，附件未下载`;
      } else {
        for (const a of e.Attachments as Record<string, unknown>[]) {
          const token = str(a.DownloadToken ?? a.downloadToken);
          if (!token) continue;
          try {
            const r = await fetch(
              `https://api.brevo.com/v3/inbound/attachments/${encodeURIComponent(token)}`,
              { headers: { 'api-key': key }, signal: AbortSignal.timeout(8000) },
            );
            if (!r.ok) continue;
            const buf = await r.arrayBuffer();
            if (buf.byteLength > MAX_ATTACHMENT) continue;
            atts.push({
              filename: str(a.Name ?? a.name) || 'file',
              contentType: str(a.ContentType ?? a.contentType) || 'application/octet-stream',
              content: buf,
            });
          } catch {
            /* 单个附件失败跳过，不影响正文 */
          }
        }
        if (atts.length < e.Attachments.length) {
          warning = `部分附件下载失败（${atts.length}/${e.Attachments.length}）`;
        }
      }
    }

    out.push({
      from: from.address || extractEmail(str(e.From)),
      fromName: from.name || extractName(str(e.From)),
      to: recipients,
      subject: str(e.Subject) || '(无主题)',
      // Brevo 会把签名剥掉生成 Markdown，没纯文本时用它兜底
      text: str(e.RawTextBody) || str(e.ExtractedMarkdownMessage),
      html: str(e.RawHtmlBody),
      messageId: messageId || undefined,
      eventId: uuids[0] || messageId || undefined,
      attachments: atts,
      spamHint,
      warning: warning || undefined,
      source: 'brevo',
    });
  }
  return out;
}

/* ── 自建接口 ────────────────────────────────────────────────
 * 最通用的一种：POST 一段 JSON 就能入库，给脚本 / n8n / 自己服务器用。
 * 也支持 raw 字段传原始 MIME。 */
async function parseGeneric(req: Request): Promise<InboundMail[]> {
  const b = await readJson(req);
  if (!b.from && !b.to && !b.subject && !b.raw) return [];
  if (typeof b.raw === 'string') {
    const m = await fromRawMime(b.raw, 'generic', {
      eventId: str(b.eventId ?? b.messageId) || undefined,
    });
    return [m];
  }

  const atts: InboundAttachment[] = [];
  if (Array.isArray(b.attachments)) {
    for (const a of b.attachments as Record<string, unknown>[]) {
      const content = str(a.content ?? a.Content);
      if (!content) continue;
      try {
        const buf = b64ToBuffer(content);
        if (buf.byteLength > MAX_ATTACHMENT) continue;
        atts.push({
          filename: str(a.filename ?? a.name ?? a.Name) || 'file',
          contentType: str(a.contentType ?? a.content_type ?? a.ContentType) || 'application/octet-stream',
          content: buf,
        });
      } catch {
        /* 跳过 */
      }
    }
  }

  return [
    {
      from: extractEmail(str(b.from)),
      fromName: str(b.fromName ?? b.from_name) || extractName(str(b.from)),
      to: toRecipients(b.to ?? b.recipient, b.to_addr),
      subject: str(b.subject) || '(无主题)',
      text: str(b.text ?? b.text_body),
      html: str(b.html ?? b.html_body),
      messageId: str(b.messageId ?? b.message_id) || undefined,
      eventId: str(b.eventId ?? b.messageId ?? b.message_id) || undefined,
      attachments: atts,
      size: Number(b.size) || undefined,
      source: 'generic',
    },
  ];
}

/** 主入口：按来源分发解析。永不抛异常，解析不出来返回空数组。 */
export async function parseInbound(
  source: InboundSource,
  req: Request,
  ctx: ParseContext,
): Promise<InboundMail[]> {
  try {
    switch (source) {
      case 'resend':
        return await parseResend(req, ctx);
      case 'postmark':
        return await parsePostmark(req);
      case 'sendgrid':
        return await parseSendGrid(req);
      case 'mailgun':
        return await parseMailgun(req);
      case 'brevo':
        return await parseBrevo(req, ctx);
      case 'generic':
        return await parseGeneric(req);
      default:
        return [];
    }
  } catch (e) {
    console.error('inbound parse failed', source, e);
    return [];
  }
}
