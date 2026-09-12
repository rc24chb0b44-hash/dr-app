import { SignJWT, jwtVerify } from 'jose';

function getSecret() {
  const secret = process.env.JWT_SECRET || 'dev_secret_change_me_please';
  return new TextEncoder().encode(secret);
}

export async function signToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch (err) {
    return null;
  }
}
