import { Schema, model } from 'mongoose';

/**
 * Singleton document holding platform-wide module/app on-off overrides.
 * A key absent from the override maps means "enabled" (the default) —
 * only explicit `false` entries are stored.
 */
const platformConfigSchema = new Schema(
  {
    moduleOverrides: { type: Schema.Types.Mixed, default: () => ({}) },
    appOverrides: { type: Schema.Types.Mixed, default: () => ({}) },
    // Platform-wide config forms. Each is stored as-authored by the
    // super-admin UI; there is no encryption-at-rest for the API
    // keys/secrets nested inside smsConfig/whatsappConfig/paymentConfig/
    // emailConfig — acceptable for this stage, but flag before handling
    // real provider credentials in production.
    systemConfig: { type: Schema.Types.Mixed, default: null },
    smsConfig: { type: Schema.Types.Mixed, default: null },
    whatsappConfig: { type: Schema.Types.Mixed, default: null },
    whatsappTemplates: { type: [Schema.Types.Mixed], default: [] },
    paymentConfig: { type: Schema.Types.Mixed, default: null },
    emailConfig: { type: Schema.Types.Mixed, default: null },
    emailTemplates: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export const PlatformConfigModel = model('PlatformConfig', platformConfigSchema);
