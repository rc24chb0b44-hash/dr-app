import { cookies } from 'next/headers';
import { verifyToken } from './auth';

// Returns { userId, email, name } or null
export async function getCurrentUser() {
  const cookieStore = cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return payload;
}
