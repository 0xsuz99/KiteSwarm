import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ethers } from "ethers";

type GeneratedAgentSigner = {
  address: string;
  encryptedPrivateKey: string | null;
  encryption: "aes-256-gcm" | "none";
};

function resolveEncryptionKey(): Buffer | null {
  const secret = process.env.AGENT_SIGNER_ENCRYPTION_KEY?.trim();
  if (!secret) {
    return null;
  }

  return createHash("sha256").update(secret).digest();
}

function encryptPrivateKey(privateKey: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function isValidPrivateKey(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function decryptAgentSignerPrivateKey(params: {
  encryptedPrivateKey: string | null | undefined;
  encryption: "aes-256-gcm" | "none" | string | null | undefined;
}): string | null {
  const { encryptedPrivateKey, encryption } = params;
  if (!encryptedPrivateKey || encryptedPrivateKey.trim().length === 0) {
    return null;
  }

  if (encryption === "none") {
    return isValidPrivateKey(encryptedPrivateKey) ? encryptedPrivateKey : null;
  }

  if (encryption !== "aes-256-gcm") {
    return null;
  }

  const key = resolveEncryptionKey();
  if (!key) {
    return null;
  }

  try {
    const parts = encryptedPrivateKey.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
      return null;
    }

    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const encrypted = Buffer.from(parts[3], "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");

    return isValidPrivateKey(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
}

export function generateAgentSigner(): GeneratedAgentSigner {
  const wallet = ethers.Wallet.createRandom();
  const key = resolveEncryptionKey();

  if (!key) {
    return {
      address: wallet.address,
      // Local dev fallback so AA-signed flows can run without a separate KMS.
      encryptedPrivateKey: wallet.privateKey,
      encryption: "none",
    };
  }

  return {
    address: wallet.address,
    encryptedPrivateKey: encryptPrivateKey(wallet.privateKey, key),
    encryption: "aes-256-gcm",
  };
}
