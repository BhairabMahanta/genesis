import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const ACCESS_COOKIE = 'genesis_access_token';

export default async function Home() {
  const jar = await cookies();
  redirect(jar.has(ACCESS_COOKIE) ? '/home' : '/login');
}
