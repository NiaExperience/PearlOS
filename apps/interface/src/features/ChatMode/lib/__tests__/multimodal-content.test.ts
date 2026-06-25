import {
  buildUserTurnContent,
  chatMessageContentText,
} from '../multimodal-content';

describe('multimodal chat content', () => {
  const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

  it('preserves text and image blocks for image chat turns', () => {
    expect(buildUserTurnContent('what is this?', imageDataUrl)).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ]);
  });

  it('keeps image-only chat turns multimodal instead of flattening them to empty text', () => {
    expect(buildUserTurnContent('', imageDataUrl)).toEqual([
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ]);
  });

  it('extracts only text for display/history summaries without mutating the API payload shape', () => {
    const content = buildUserTurnContent('look here', imageDataUrl);

    expect(chatMessageContentText(content)).toBe('look here');
    expect(content).toEqual([
      { type: 'text', text: 'look here' },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ]);
  });
});
