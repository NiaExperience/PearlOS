/**
 * YouTube Feature Tests
 * Testing YouTube search and playback functionality
 */

import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';
import { GET_impl } from '../routes/route';
import { NextRequest } from 'next/server';

// Mock the YouTube API
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

// Mock environment variables
const originalEnv = process.env;

describe('YouTube Feature', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      YOUTUBE_API_KEY: 'test-api-key'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('YouTube API Integration', () => {
    it('should search for YouTube videos successfully', async () => {
      const mockYouTubeResponse = {
        items: [
          {
            id: { videoId: 'test-video-123' },
            snippet: {
              title: 'Test Video',
              description: 'Test description',
              thumbnails: { default: { url: 'test-thumbnail.jpg' } },
              channelTitle: 'Test Channel',
              publishedAt: '2023-01-01T00:00:00Z'
            }
          }
        ]
      };

      const mockCommentsResponse = {
        items: [
          {
            snippet: {
              topLevelComment: {
                snippet: {
                  authorDisplayName: 'Test User',
                  textDisplay: 'Great video!',
                  publishedAt: '2023-01-01T00:00:00Z',
                  likeCount: 5
                }
              }
            }
          }
        ]
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockYouTubeResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockCommentsResponse,
        } as Response);

      const request = new NextRequest('http://localhost/api/youtube-search?query=test');
      const response = await GET_impl(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.videos).toHaveLength(1);
      expect(data.videos[0].title).toBe('Test Video');
      expect(data.comments).toHaveLength(1);
      expect(data.comments[0].text).toBe('Great video!');
    });

    it('should handle missing query parameter', async () => {
      const request = new NextRequest('http://localhost/api/youtube-search');
      const response = await GET_impl(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Query parameter is required');
    });

    it('should handle YouTube API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const request = new NextRequest('http://localhost/api/youtube-search?query=test');
      const response = await GET_impl(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to search YouTube');
    });
  });

  describe('Keyless search (Invidious fallback)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      process.env = {
        ...originalEnv,
        YOUTUBE_API_KEY: ''
      };
      delete process.env.YOUTUBE_API_KEY;
    });

    it('should search via Invidious when no API key is set', async () => {
      const invidiousResponse = [
        {
          type: 'video',
          videoId: 'invidious-video-1',
          title: 'Invidious Result',
          description: 'Description',
          author: 'Channel',
          published: 1672531200,
          videoThumbnails: [{ url: 'https://example.com/thumb.jpg', quality: 'medium' }]
        }
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => invidiousResponse
      } as Response);

      const request = new NextRequest('http://localhost/api/youtube-search?query=hello');
      const response = await GET_impl(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.videos).toHaveLength(1);
      expect(data.videos[0].videoId).toBe('invidious-video-1');
      expect(data.videos[0].title).toBe('Invidious Result');
      expect(data.currentVideo.videoId).toBe('invidious-video-1');
      expect(data.comments).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/search');
    });

    it('should return 404 when Invidious returns no videos', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      } as Response);

      const request = new NextRequest('http://localhost/api/youtube-search?query=nonexistent');
      const response = await GET_impl(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No videos found');
    });
  });
});
