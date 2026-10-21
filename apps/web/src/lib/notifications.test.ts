import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotificationService,
  InAppChannel,
  EmailChannel,
  WebhookChannel,
  type NotificationPreferences,
  type NotificationEvent,
  type NotificationChannel,
  type NotificationRecord,
} from './notifications';

const makeEvent = (overrides: Partial<NotificationEvent> = {}): NotificationEvent => ({
  id: 'evt-1',
  type: 'certificate.issued',
  certificateId: 'cert-1',
  certificateName: 'example.com',
  status: 'issued',
  message: 'Certificate issued',
  timestamp: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const makePreferences = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  inApp: true,
  email: true,
  webhook: true,
  emailAddress: 'ops@example.com',
  webhookUrl: 'https://hooks.example.com/certs',
  ...overrides,
});

describe('NotificationService', () => {
  let inApp: InAppChannel;
  let email: EmailChannel;
  let webhook: WebhookChannel;
  let service: NotificationService;

  beforeEach(() => {
    inApp = new InAppChannel();
    email = new EmailChannel();
    webhook = new WebhookChannel();
    vi.spyOn(inApp, 'send').mockResolvedValue(undefined);
    vi.spyOn(email, 'send').mockResolvedValue(undefined);
    vi.spyOn(webhook, 'send').mockResolvedValue(undefined);
    service = new NotificationService({
      channels: { inApp, email, webhook },
      maxAttempts: 3,
      baseDelayMs: 1000,
    });
  });

  describe('channel fan-out based on preferences', () => {
    it('delivers to all enabled channels', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences());

      expect(inApp.send).toHaveBeenCalledTimes(1);
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(webhook.send).toHaveBeenCalledTimes(1);
      expect(inApp.send).toHaveBeenCalledWith(event, expect.objectContaining({ emailAddress: 'ops@example.com' }));
    });

    it('only delivers to channels enabled in preferences', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences({ email: false, webhook: false }));

      expect(inApp.send).toHaveBeenCalledTimes(1);
      expect(email.send).not.toHaveBeenCalled();
      expect(webhook.send).not.toHaveBeenCalled();
    });

    it('skips email when no email address is configured', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences({ emailAddress: undefined }));

      expect(email.send).not.toHaveBeenCalled();
      expect(inApp.send).toHaveBeenCalledTimes(1);
      expect(webhook.send).toHaveBeenCalledTimes(1);
    });

    it('skips webhook when no webhook url is configured', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences({ webhookUrl: undefined }));

      expect(webhook.send).not.toHaveBeenCalled();
      expect(inApp.send).toHaveBeenCalledTimes(1);
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('does not deliver to any channel when all are disabled', async () => {
      const event = makeEvent();
      await service.notify(
        event,
        makePreferences({ inApp: false, email: false, webhook: false }),
      );

      expect(inApp.send).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
      expect(webhook.send).not.toHaveBeenCalled();
    });

    it('records a history entry for each channel delivery', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences());

      const history = service.getHistory();
      expect(history).toHaveLength(3);
      const channels = history.map((r) => r.channel).sort();
      expect(channels).toEqual(['email', 'inApp', 'webhook']);
    });
  });

  describe('retry scheduling with exponential back-off', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a failed delivery up to 3 attempts total', async () => {
      const error = new Error('network down');
      (email.send as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const event = makeEvent();
      const promise = service.notify(event, makePreferences({ inApp: false, webhook: false }));

      // First attempt happens immediately.
      await vi.advanceTimersByTimeAsync(0);
      expect(email.send).toHaveBeenCalledTimes(1);

      // Second attempt after base delay (1000ms).
      await vi.advanceTimersByTimeAsync(1000);
      expect(email.send).toHaveBeenCalledTimes(2);

      // Third attempt after 2x base delay (2000ms).
      await vi.advanceTimersByTimeAsync(2000);
      expect(email.send).toHaveBeenCalledTimes(3);

      // No further retries beyond maxAttempts.
      await vi.advanceTimersByTimeAsync(10000);
      expect(email.send).toHaveBeenCalledTimes(3);

      await promise;
    });

    it('uses exponential back-off delays between attempts', async () => {
      const error = new Error('boom');
      (webhook.send as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const event = makeEvent();
      const promise = service.notify(event, makePreferences({ inApp: false, email: false }));

      await vi.advanceTimersByTimeAsync(0);
      expect(webhook.send).toHaveBeenCalledTimes(1);

      // Not yet retried before the base delay elapses.
      await vi.advanceTimersByTimeAsync(999);
      expect(webhook.send).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(webhook.send).toHaveBeenCalledTimes(2);

      // Second retry should wait 2x base delay (2000ms), not 1000ms.
      await vi.advanceTimersByTimeAsync(1999);
      expect(webhook.send).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(webhook.send).toHaveBeenCalledTimes(3);

      await promise;
    });

    it('stops retrying once a delivery succeeds', async () => {
      const sendMock = webhook.send as ReturnType<typeof vi.fn>;
      sendMock
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValueOnce(undefined);

      const event = makeEvent();
      const promise = service.notify(event, makePreferences({ inApp: false, email: false }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(sendMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10000);
      expect(sendMock).toHaveBeenCalledTimes(2);

      await promise;
    });

    it('marks the record as failed after exhausting retries', async () => {
      (email.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('permanent'));

      const event = makeEvent();
      const promise = service.notify(event, makePreferences({ inApp: false, webhook: false }));

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      const history = service.getHistory();
      const record = history.find((r) => r.channel === 'email');
      expect(record).toBeDefined();
      expect(record?.status).toBe('failed');
      expect(record?.attempts).toBe(3);
    });

    it('marks the record as delivered on success', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences({ inApp: false, webhook: false }));

      const history = service.getHistory();
      const record = history.find((r) => r.channel === 'email');
      expect(record?.status).toBe('delivered');
      expect(record?.attempts).toBe(1);
    });
  });

  describe('history retrieval', () => {
    it('returns an empty history initially', () => {
      expect(service.getHistory()).toEqual([]);
    });

    it('returns records in reverse chronological order', async () => {
      const first = makeEvent({ id: 'evt-1', type: 'certificate.issued' });
      const second = makeEvent({ id: 'evt-2', type: 'certificate.verified' });

      await service.notify(first, makePreferences({ email: false, webhook: false }));
      await service.notify(second, makePreferences({ email: false, webhook: false }));

      const history = service.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].eventId).toBe('evt-2');
      expect(history[1].eventId).toBe('evt-1');
    });

    it('filters history by channel', async () => {
      const event = makeEvent();
      await service.notify(event, makePreferences());

      const emailHistory = service.getHistory({ channel: 'email' as NotificationChannel });
      expect(emailHistory).toHaveLength(1);
      expect(emailHistory[0].channel).toBe('email');
    });

    it('filters history by status', async () => {
      (webhook.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));

      const event = makeEvent();
      await service.notify(event, makePreferences({ inApp: false, email: false }));

      const delivered = service.getHistory({ status: 'delivered' });
      expect(delivered).toHaveLength(0);

      const failed = service.getHistory({ status: 'failed' });
      expect(failed).toHaveLength(1);
      expect(failed[0].channel).toBe('webhook');
    });

    it('limits the number of returned records', async () => {
      for (let i = 0; i < 5; i++) {
        await service.notify(
          makeEvent({ id: `evt-${i}` }),
          makePreferences({ email: false, webhook: false }),
        );
      }

      const limited = service.getHistory({ limit: 2 });
      expect(limited).toHaveLength(2);
      expect(limited[0].eventId).toBe('evt-4');
      expect(limited[1].eventId).toBe('evt-3');
    });

    it('records the event payload on each history entry', async () => {
      const event = makeEvent({ certificateName: 'api.example.com' });
      await service.notify(event, makePreferences({ email: false, webhook: false }));

      const [record] = service.getHistory();
      expect(record.eventId).toBe(event.id);
      expect(record.type).toBe(event.type);
      expect(record.certificateName).toBe('api.example.com');
      expect(record.timestamp).toBeInstanceOf(Date);
    });

    it('clears history when requested', async () => {
      await service.notify(makeEvent(), makePreferences({ email: false, webhook: false }));
      expect(service.getHistory()).toHaveLength(1);

      service.clearHistory();
      expect(service.getHistory()).toEqual([]);
    });
  });
});