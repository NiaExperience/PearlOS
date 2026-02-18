'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

import { Button } from '@dashboard/components/ui/button';
import { ThemeToggle } from '@dashboard/components/theme-toggle';

const navItems = [
  { name: 'Home', href: '/' },
  { name: 'About', href: '/about' },
  { name: 'Services', href: '/services' },
  { name: 'Contact', href: '/contact' },
];

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className='bg-background w-full'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex items-center justify-between h-16'>
          <div className='flex items-center'>
            <Link href='/' className='text-2xl font-bold text-blue-600'>
              NIA
            </Link>
          </div>
          <div className='hidden md:block'>
            <div className='ml-10 flex items-baseline space-x-4'>
              {navItems.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className='text-foreground hover:bg-accent hover:text-accent-foreground px-3 py-2 rounded-md text-sm font-medium'
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
          <div className='hidden md:block'>
            <ThemeToggle />
          </div>
          <div className='md:hidden flex items-center'>
            <ThemeToggle />
            <Button
              className='inline-flex items-center justify-center p-2 rounded-md text-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring ml-2'
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <span className='sr-only'>Open main menu</span>
              {isMenuOpen ? (
                <X className='block h-6 w-6' aria-hidden='true' />
              ) : (
                <Menu className='block h-6 w-6' aria-hidden='true' />
              )}
            </Button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className='md:hidden'>
          <div className='px-2 pt-2 pb-3 space-y-1 sm:px-3'>
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className='text-foreground hover:bg-accent hover:text-accent-foreground block px-3 py-2 rounded-md text-base font-medium'
                onClick={() => setIsMenuOpen(false)}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
