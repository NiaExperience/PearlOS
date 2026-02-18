// Import after mocks are set up (no mocking needed for this simple route)
// eslint-disable-next-line import/order
import { GET as closeViewGET, POST as closeViewPOST } from '../src/app/api/close-view/route';

describe('/api/close-view', () => {
  describe('GET /api/close-view', () => {
    it('should return success response', async () => {
      const response = await closeViewGET();
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('View closed successfully');
    });
  });

  describe('POST /api/close-view', () => {
    it('should return success response', async () => {
      const response = await closeViewPOST();
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('View closed successfully');
    });
  });

  describe('Response consistency', () => {
    it('should return identical responses for GET and POST', async () => {
      const getResponse = await closeViewGET();
      const postResponse = await closeViewPOST();
      
      expect(getResponse.status).toBe(postResponse.status);
      
      const getData = await getResponse.json();
      const postData = await postResponse.json();
      
      expect(getData).toEqual(postData);
    });
  });
});
