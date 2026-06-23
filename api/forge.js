import { ethers } from "ethers";

const FORGE_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(
  "ForgeAttestation(address wallet,string xHandle,uint256 chainId,address contractAddress,uint256 expiry,uint256 nonce)"
));
const DOMAIN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
));

function buildDomainSep(name, version, chainId, contractAddress) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
    [DOMAIN_TYPEHASH, ethers.keccak256(ethers.toUtf8Bytes(name)), ethers.keccak256(ethers.toUtf8Bytes(version)), chainId, contractAddress]
  ));
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const privateKey = process.env.ATTESTATION_SIGNER_KEY || process.env.ATTESTATION_VERIFIER_PRIVATE_KEY;
  if (!privateKey) {
    return json(res, 503, { error: "ATTESTATION_SIGNER_KEY not set" });
  }

  let body;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  if (body.type !== "forge") return json(res, 400, { error: "Invalid type" });
  if (!ethers.isAddress(body.wallet)) return json(res, 400, { error: "Invalid wallet" });
  if (!ethers.isAddress(body.contractAddress)) return json(res, 400, { error: "Invalid contractAddress" });
  if (typeof body.xHandle !== "string" || !body.xHandle) return json(res, 400, { error: "Invalid xHandle" });
  if (!body.chainId || !body.expiry || !body.nonce) return json(res, 400, { error: "Missing fields" });

  const expiry = BigInt(body.expiry);
  const nonce = BigInt(body.nonce);
  const now = BigInt(Date.now());
  if (expiry <= now) return json(res, 400, { error: "Attestation expired" });

  try {
    const structHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "bytes32", "uint256", "address", "uint256", "uint256"],
      [FORGE_TYPEHASH, body.wallet, ethers.keccak256(ethers.toUtf8Bytes(body.xHandle)), body.chainId, body.contractAddress, expiry, nonce]
    ));
    const domainSep = buildDomainSep("RitualAnthem", "1", body.chainId, body.contractAddress);
    const digest = ethers.keccak256(ethers.concat([ethers.getBytes("0x1901"), domainSep, structHash]));
    // Use signTypedData — different code path than signingKey.sign
    const domain = { name: "RitualAnthem", version: "1", chainId: body.chainId, verifyingContract: body.contractAddress };
    const types = { ForgeAttestation: [
      { name: "wallet", type: "address" },
      { name: "xHandle", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "contractAddress", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ]};
    const value = {
      wallet: body.wallet,
      xHandle: body.xHandle,
      chainId: body.chainId,
      contractAddress: body.contractAddress,
      expiry: expiry,
      nonce: nonce,
    };
    const wallet = new ethers.Wallet(privateKey);
    const sig = await wallet.signTypedData(domain, types, value);
    return json(res, 200, {
      signature: sig,
      expiry: String(expiry),
      nonce: String(nonce),
      _debug: { walletAddr: wallet.address, digest, keyStart: privateKey.slice(0, 12) },
    });
  } catch (e) {
    return json(res, 500, { error: e.message || "Signing failed" });
  }
}
