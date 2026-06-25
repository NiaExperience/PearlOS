import { NextRequest } from 'next/server';

import { GET } from '../src/app/api/weather/route';

describe('/api/weather', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('requires an explicit location instead of falling back to the server location', async () => {
    const response = await GET(new NextRequest('http://localhost/api/weather'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('location_required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches named locations from wttr.in', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ nearest_area: [{ areaName: [{ value: 'Seattle' }] }] }), { status: 200 })
    );

    const response = await GET(new NextRequest('http://localhost/api/weather?q=Seattle'));

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith('https://wttr.in/Seattle?format=j1', expect.any(Object));
    expect(response.headers.get('X-Weather-Cache')).toBe('MISS');
  });

  it('fetches coordinate weather from wttr.in', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ nearest_area: [{ areaName: [{ value: 'Queens' }] }] }), { status: 200 })
    );

    const response = await GET(new NextRequest('http://localhost/api/weather?lat=40.7128&lng=-74.0060'));

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith('https://wttr.in/40.7128,-74.0060?format=j1', expect.any(Object));
  });

  it('rejects invalid coordinates before calling wttr.in', async () => {
    const response = await GET(new NextRequest('http://localhost/api/weather?lat=nope&lng=-74.0060'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('invalid_coordinates');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
