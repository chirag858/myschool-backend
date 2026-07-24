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
  },
  { timestamps: true },
);

export const PlatformConfigModel = model('PlatformConfig', platformConfigSchema);
