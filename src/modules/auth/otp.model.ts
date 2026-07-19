import { Schema, model, type InferSchemaType } from 'mongoose';

const otpSchema = new Schema(
  {
    /** Where the code was sent (mobile number or email/contact). */
    channel: { type: String, required: true, index: true },
    purpose: { type: String, enum: ['login', 'forgot'], required: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// TTL cleanup (correctness relies on the explicit expiry check in the service).
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OtpDoc = InferSchemaType<typeof otpSchema>;
export const OtpModel = model('Otp', otpSchema);
