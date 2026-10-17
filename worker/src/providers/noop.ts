import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';
import { randomHex } from '../lib/crypto';

/**
 * Noop —— 自测 / 演示模式。不产生任何外网请求，
 * 但完整走一遍校验、配额、日志链路，方便本地预览与联调。
 */
export const noopProvider: MailProvider = {
  kind: 'noop',
  label: 'Noop（自测，不真发）',
  docs: 'https://github.com/wcvjk8tnz8-create/henna',
  fields: [{ key: 'defaultFrom', label: '默认发件人', type: 'text' }],
  async send(mail): Promise<SendResult> {
    console.log('[noop] would send:', mail.subject, '→', mail.to.join(','));
    return { success: true, provider: 'noop', id: `noop_${randomHex(8)}` };
  },
};
