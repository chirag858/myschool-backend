/**
 * Fake SMS/WhatsApp dispatcher — no gateway is wired yet. Swap the body of
 * `sendBulk` for a real provider call (Twilio/Gupshup/etc.) when one exists;
 * every caller already only depends on this shape.
 */
export interface MessagingRecipient {
  id: string;
  name: string;
  mobile: string;
}

export interface MessagingResult {
  recipientId: string;
  recipientName: string;
  recipientMobile: string;
  status: 'delivered' | 'failed';
  failureReason?: string;
}

export type MessagingChannel = 'sms' | 'whatsapp' | 'both';

export async function sendBulk(
  recipients: readonly MessagingRecipient[],
  _channel: MessagingChannel,
  _body: string,
): Promise<MessagingResult[]> {
  // Deterministic-ish fake delivery: everyone succeeds except a mobile
  // number ending in '0' (keeps demo data visibly exercising the failed path).
  return recipients.map((r) => {
    const failed = r.mobile.endsWith('0');
    return {
      recipientId: r.id,
      recipientName: r.name,
      recipientMobile: r.mobile,
      status: failed ? 'failed' : 'delivered',
      failureReason: failed ? 'Unreachable number' : undefined,
    };
  });
}
