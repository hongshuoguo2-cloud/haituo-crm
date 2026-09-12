import mysql from "mysql2/promise";
import { hashPassword } from "../backend/dist/auth.js";

const email = String(process.env.INITIAL_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.HAITUO_NEW_ADMIN_PASSWORD || "");
const databaseUrl = String(process.env.DATABASE_URL || "").trim();

if (!email) throw new Error("INITIAL_ADMIN_EMAIL is not configured.");
if (password.length < 12 || password.length > 128) throw new Error("Password must contain 12 to 128 characters.");
if (!databaseUrl.startsWith("mysql://")) throw new Error("DATABASE_URL must be a MySQL URL.");

const connection = await mysql.createConnection(databaseUrl);
try {
  const [users] = await connection.execute(
    "SELECT id, role, status FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  const user = users[0];
  if (!user || user.role !== "super_admin" || user.status !== "active") {
    throw new Error("The configured active platform administrator was not found.");
  }
  const passwordHash = await hashPassword(password);
  const [result] = await connection.execute(
    "UPDATE users SET password_hash = ?, must_change_password = FALSE, auth_version = auth_version + 1 WHERE id = ? AND status = 'active'",
    [passwordHash, user.id]
  );
  if (result.affectedRows !== 1) throw new Error("Administrator password update did not change exactly one account.");
  process.stdout.write("Administrator password updated successfully.\n");
} finally {
  await connection.end();
}
