'use client';
import { UserBlock } from '@nia/prism/core/blocks';
import { Plus } from 'lucide-react';
import React, { useState } from 'react';

import { Button } from './ui/button';

const UserCard = ({ 
  user, 
  onExpand
}: { 
  user: UserBlock.IUser;
  onExpand?: (isExpanded: boolean) => void;
}) => {
  const [isExpand, setIsExpand] = useState(false);

  const handleExpand = () => {
    const newExpandState = !isExpand;
    setIsExpand(newExpandState);
    onExpand?.(newExpandState);
  };

  return (
    <div
      className={`rounded-lg shadow p-4 border-2 ${
        isExpand ? 'bg-white border-[#8EC2A7]' : 'bg-accent'
      }`}
    >
      <div className='space-y-3'>
        <h1
          className={`${
            isExpand ? 'text-[#8EC2A7]' : 'text-gray-800'
          } text-lg font-bold`}
        >
          {user.name}
        </h1>
        <p className='text-sm text-muted-foreground line-clamp-3'>
          {(user.messages || []).join(' ')}
        </p>

        <div>
          <h2 className='text-sm font-bold text-gray-800'>Status:</h2>
          <p className='text-sm text-muted-foreground'>{user.status}</p>
        </div>

        <div className='flex items-center justify-end w-full'>
          <Button
            onClick={handleExpand}
            className='text-right'
            variant='outline'
            size='sm'
          >
            <Plus size={16} className={`transform transition-transform ${isExpand ? 'rotate-45' : ''}`} />
          </Button>
        </div>
      </div>

      {isExpand && (
        <div className='space-y-4 mt-4 border-t pt-4'>
          <div>
            <h2 className='text-sm font-bold text-gray-800'>Email:</h2>
            <p className='text-sm text-muted-foreground'>{user.email}</p>
          </div>
          <div>
            <h2 className='text-sm font-bold text-gray-800'>Phone:</h2>
            <p className='text-sm text-muted-foreground'>{user.phone_number}</p>
          </div>
          <div>
            <label
              htmlFor={`messages-toggle`}
              className='block text-sm font-bold text-gray-800'
            >
              Messages:
            </label>
            <div className='mt-1 space-y-2'>
              {(user.messages || []).map((message, idx) => (
                <div key={idx} className='bg-gray-100 p-2 rounded-lg border'>
                  <p className='text-sm text-muted-foreground'>{message.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserCard;
