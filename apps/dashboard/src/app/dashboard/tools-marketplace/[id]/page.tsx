import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { notFound, redirect } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@dashboard/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@dashboard/components/ui/card';
import { Badge } from '@dashboard/components/ui/badge';
import { Star, Clock, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';

// This would typically come from a database or API
const tools = [
  {
    id: '1',
    name: 'Spa Service Booking',
    description:
      'Book a relaxing spa treatment at your preferred location and time.',
    longDescription:
      'Our Spa Service Booking tool allows you to easily schedule and manage your spa appointments. Choose from a wide range of treatments, select your preferred therapist, and find the perfect time slot that fits your schedule. The tool also provides recommendations based on your preferences and past bookings.',
    image: '/placeholder.png',
    category: 'Productivity',
    rating: 4.8,
    usageTime: '2-3 minutes',
  },
  // ... other tools
];

export default async function ToolDetails({ params }: { params: { id: string } }) {
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  
  if (!session || !session.user) {
    redirect('/login');
  }

  // Deny access to anonymous users
  if (session.user.is_anonymous) {
    redirect('/login');
  }

  // Check if user has admin access to any tenant
  const tenantRoles = await TenantActions.getUserTenantRoles(session.user.id);
  const hasAdminAccess = tenantRoles?.some(role => 
    (role.role === 'admin' || role.role === 'owner')
  ) || false;

  if (!hasAdminAccess) {
    redirect('/login');
  }

  const tool = tools.find((t) => t.id === params.id);

  if (!tool) {
    notFound();
  }

  return (
    <div className='container mx-auto px-4 py-8'>
      <Link
        href='/dashboard/tools-marketplace'
        className='flex items-center mb-4'
      >
        <ArrowLeft className='mr-2' size={20} />
        Back to Tools
      </Link>
      <Card className='overflow-hidden'>
        <CardHeader>
          <CardTitle className='text-3xl'>{tool.name}</CardTitle>
          <CardDescription>{tool.description}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='relative h-64 sm:h-96'>
            <Image
              src={tool.image}
              alt={tool.name}
              fill
              style={{ objectFit: 'cover' }}
              className='rounded-md'
            />
          </div>
          <div className='flex flex-wrap gap-4'>
            <Badge variant='secondary'>{tool.category}</Badge>
            <div className='flex items-center'>
              <Star className='text-yellow-400 mr-1' size={20} />
              <span>{tool.rating.toFixed(1)}</span>
            </div>
            <div className='flex items-center'>
              <Clock className='text-gray-500 mr-1' size={20} />
              <span>{tool.usageTime}</span>
            </div>
          </div>
          <div>
            <h3 className='text-xl font-semibold mb-2'>About this tool</h3>
            <p className='text-gray-700'>{tool.longDescription}</p>
          </div>
          <div>
            <h3 className='text-xl font-semibold mb-2'>How to use</h3>
            <ol className='list-decimal list-inside space-y-2'>
              <li>
                Select the "Spa Service Booking" tool from the assistant's menu.
              </li>
              <li>Specify your preferred treatment type, date, and time.</li>
              <li>Choose from available spa locations or therapists.</li>
              <li>Confirm your booking details.</li>
              <li>
                Receive a confirmation and add the appointment to your calendar.
              </li>
            </ol>
          </div>
        </CardContent>
        <CardFooter>
          <Button className='w-full'>Use This Tool</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
