export async function requestDevRoomDeletion(params: { roomUrl?: string; roomName?: string }): Promise<boolean> {
  const query = new URLSearchParams();

  if (params.roomUrl) {
    query.set('roomUrl', params.roomUrl);
  }

  if (params.roomName) {
    query.set('roomName', params.roomName);
  }

  const response = await fetch(`/api/dailyCall/devRoom${query.toString() ? `?${query.toString()}` : ''}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    return false;
  }

  const data = (await response.json().catch(() => ({}))) as { deleted?: boolean };
  return Boolean(data.deleted);
}
