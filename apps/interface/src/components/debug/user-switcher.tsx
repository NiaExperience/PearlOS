'use client';

import React from 'react';
import { IUser } from '@nia/prism/core/blocks/user.block';

interface UserSwitcherProps {
    currentUser: string;
    setCurrentUser: (userId: string) => void;
    users: IUser[];
}

const UserSwitcher: React.FC<UserSwitcherProps> = ({ currentUser, setCurrentUser, users }) => (
    <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: 'gray',
        color: 'Black',
        padding: 16,
        borderRadius: 8,
        zIndex: 700,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
    }}>
        <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Debug: Switch User</div>
        <select
            value={currentUser}
            onChange={e => setCurrentUser(e.target.value)}
            style={{ padding: 8, borderRadius: 4, width: '100%' }}
        >
            {users.map(user => (
                <option key={user._id || user.name} value={user._id || user.name}>
                    {user.name} {user.email ? `(${user.email})` : ''}
                </option>
            ))}
        </select>
        <div style={{ marginTop: 8, fontSize: 12 }}>
            <strong>Current:</strong> {currentUser}
        </div>
    </div>
);

export default UserSwitcher;