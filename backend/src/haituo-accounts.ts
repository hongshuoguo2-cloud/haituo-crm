import { randomBytes } from "node:crypto";

export function generateAccountCredentials() {
  return {
    email: `ht_${randomBytes(8).toString("hex")}@accounts.haituo.local`,
    password: `Ht!${randomBytes(18).toString("base64url")}`
  };
}
