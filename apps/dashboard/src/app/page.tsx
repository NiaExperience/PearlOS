import { redirect } from 'next/navigation';

// Redirect root to /login. Keep this minimal to avoid hydration issues.
export default function Home() {
  redirect('/login');
}
