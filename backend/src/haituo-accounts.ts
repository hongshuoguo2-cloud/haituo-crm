import { randomBytes } from "node:crypto";

export function normalizeMainlandPhone(value: unknown) {
  let phone = String(value || "").trim().replace(/[\s()-]/gu, "");
  if (phone.startsWith("0086")) phone = phone.slice(4);
  else if (phone.startsWith("+86")) phone = phone.slice(3);
  return /^1[3-9]\d{9}$/u.test(phone) ? phone : "";
}

export function generateAccountCredentials(phoneValue?: unknown) {
  const phone = normalizeMainlandPhone(phoneValue);
  return {
    phone,
    email: phone
      ? `phone_${phone}@accounts.haituo.local`
      : `ht_${randomBytes(8).toString("hex")}@accounts.haituo.local`,
    password: `Ht!${randomBytes(18).toString("base64url")}`
  };
}
