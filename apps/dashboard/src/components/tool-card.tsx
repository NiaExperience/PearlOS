import Image from 'next/image';
import { Card, CardContent, CardFooter } from '@dashboard/components/ui/card';
import { Button } from '@dashboard/components/ui/button';
import Link from 'next/link';

interface ToolCardProps {
  name: string;
  description: string;
  image: string;
  category: string;
}

export default function ToolCard({
  name,
  description,
  image,
  category,
}: ToolCardProps) {
  return (
    <Link href={`/dashboard/tools-marketplace/1`}>
      <Card className='overflow-hidden'>
        <CardContent className='p-0'>
          <div className='relative h-36'>
            <Image
              src={'/placeholder.png'}
              alt={name}
              fill
              style={{ objectFit: 'cover' }}
            />
          </div>
          <div className='p-4'>
            <h3 className='font-semibold text-lg mb-1'>{name}</h3>
            <p className='text-sm text-gray-500 mb-2'>{category}</p>
            <p className='text-sm'>{description}</p>
          </div>
        </CardContent>
        <CardFooter>
          <Button className='w-full'>Use Tool</Button>
        </CardFooter>
      </Card>
    </Link>
  );
}
