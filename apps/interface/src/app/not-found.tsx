import { redirect } from 'next/navigation';

export const dynamic = "force-dynamic";

export default function NotFound() {
  const pearlosOnly = (process.env.PEARLOS_ONLY ?? '').toLowerCase() === 'true';
  
  if (pearlosOnly) {
    redirect('/');
  }

  return (
    <div>
      <h2>Not Found</h2>
      <p>Could not find requested resource</p>
    </div>
  );
}
