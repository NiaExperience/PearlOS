import React, { useEffect, useState } from 'react';
import { EventMap } from '../../types/assistant-content/event-map';

interface EventMapSectionProps {
  selectedAssistant: any;
  tenantId: string;
}

const EventMapSection: React.FC<EventMapSectionProps> = ({ selectedAssistant: assistant, tenantId }) => {
  const [eventMaps, setEventMaps] = useState<EventMap[]>([]);
  const [loading, setLoading] = useState(false);
  const contentType = 'EventMap';

  // Check if assistant supports this content type
  const isSupported = assistant?.contentTypes?.includes(contentType);

  useEffect(() => {
    if (!isSupported) return;
    setLoading(true);
    fetch(`/api/contentList?type=EventMap&assistantId=${assistant._id}`)
      .then((res) => res.json())
      .then((data) => setEventMaps(data.items || []))
      .finally(() => setLoading(false));
  }, [assistant, tenantId, isSupported]);

  if (!isSupported) {
    return <div>This content type is not supported by {assistant?.name}</div>;
  }

  return (
    <div>
      <h2>Event Maps</h2>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <ul>
          {eventMaps.map((eventMap) => (
            <li key={eventMap._id}>{eventMap.eventName || 'Untitled Event'}</li>
          ))}
        </ul>
      )}
      {/* Add create/update/delete UI here using API routes as needed */}
    </div>
  );
};

export default EventMapSection; 