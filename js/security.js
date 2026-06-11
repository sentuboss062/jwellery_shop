import { getSettings, logAudit, updateSettings } from "./data-service.js";
import { isoNow, openDialog, randomId, requireText, showToast } from "./helpers.js";

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function textToBuffer(text) {
  return new TextEncoder().encode(text);
}

export function createSalt() {
  return randomId("SALT");
}

export async function hashOwnerPassword(password, salt) {
  const digest = await crypto.subtle.digest("SHA-256", textToBuffer(`${salt}:${password}`));
  return bytesToHex(digest);
}

export async function setOwnerPassword(password) {
  requireText(password, "Owner password");
  if (password.length < 6) {
    throw new Error("Owner password must be at least 6 characters.");
  }
  const salt = createSalt();
  const ownerPasswordHash = await hashOwnerPassword(password, salt);
  await updateSettings({
    ownerPasswordHash,
    ownerPasswordSalt: salt,
    updatedAt: isoNow()
  });
  await logAudit("PASSWORD_SET", "Settings", "main", "Owner password changed", "Owner password hash and salt were updated.");
}

export async function verifyOwnerPassword(password) {
  const settings = await getSettings();
  if (!settings.ownerPasswordHash || !settings.ownerPasswordSalt) {
    throw new Error("Owner password is not set. Set it in Settings first.");
  }
  const hash = await hashOwnerPassword(password, settings.ownerPasswordSalt);
  return hash === settings.ownerPasswordHash;
}

export async function ensureOwnerPassword(actionLabel, options = {}) {
  const fields = [
    { name: "password", label: "Owner password", type: "password", required: true }
  ];
  if (options.requireReason !== false) {
    fields.push({ name: "reason", label: "Reason", type: "textarea", required: true });
  }
  const result = await openDialog({
    title: actionLabel,
    message: options.message || "Enter the owner password to continue.",
    fields,
    confirmText: options.confirmText || "Continue",
    danger: Boolean(options.danger)
  });
  if (!result) return null;
  if (options.requireReason !== false && !String(result.reason || "").trim()) {
    throw new Error("Reason is required.");
  }
  const ok = await verifyOwnerPassword(result.password);
  if (!ok) {
    showToast("Owner password did not match.", "error");
    throw new Error("Owner password did not match.");
  }
  return { reason: result.reason || "Owner approved" };
}
