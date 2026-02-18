/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';

import { PixelatedLoader, PixelatedLoaderInline } from '../components/PixelatedLoader';

describe('PixelatedLoader', () => {
  describe('PixelatedLoader (full)', () => {
    it('renders without errors', () => {
      const { container } = render(<PixelatedLoader />);
      expect(container).toBeInTheDocument();
    });

    it('has rotating spinner ring', () => {
      const { container } = render(<PixelatedLoader />);
      const spinner = container.querySelector('[style*="border-radius"]');
      expect(spinner).toBeInTheDocument();
      // Should have animation style
      expect(spinner?.getAttribute('style')).toContain('animation');
    });

    it('has red YouTube logo rectangle', () => {
      const { container } = render(<PixelatedLoader />);
      const redSquares = Array.from(container.querySelectorAll('div')).filter(
        div => div.style.backgroundColor === 'rgb(255, 0, 0)' // #FF0000
      );
      expect(redSquares.length).toBeGreaterThan(0);
    });

    it('has white background layer for 3D effect', () => {
      const { container } = render(<PixelatedLoader />);
      const whiteLayer = Array.from(container.querySelectorAll('div')).filter(
        div => div.style.backgroundColor === 'rgb(255, 255, 255)' // #FFFFFF
      );
      expect(whiteLayer.length).toBeGreaterThan(0);
    });

    it('has white play triangle', () => {
      const { container } = render(<PixelatedLoader />);
      // Triangle is made with border-left
      const triangle = Array.from(container.querySelectorAll('div')).find(
        div => div.style.borderLeft && div.style.borderLeft.includes('FFFFFF')
      );
      expect(triangle).toBeInTheDocument();
    });

    it('has layered 3D effect with offset', () => {
      const { container } = render(<PixelatedLoader />);
      const offsetLayer = Array.from(container.querySelectorAll('div')).find(
        div => div.style.top === '-3px' && div.style.left === '-3px'
      );
      expect(offsetLayer).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(<PixelatedLoader className="custom-class" />);
      const wrapper = container.querySelector('.custom-class');
      expect(wrapper).toBeInTheDocument();
    });

    it('has CSS keyframes defined', () => {
      const { container } = render(<PixelatedLoader />);
      const style = container.querySelector('style');
      expect(style).toBeInTheDocument();
      expect(style?.textContent).toContain('@keyframes spin-loader');
    });

    it('respects size prop', () => {
      const customSize = 150;
      const { container } = render(<PixelatedLoader size={customSize} />);
      const mainContainer = container.querySelector('[style*="width"]');
      expect(mainContainer?.getAttribute('style')).toContain(`${customSize}px`);
    });
  });

  describe('PixelatedLoaderInline', () => {
    it('renders without errors', () => {
      const { container } = render(<PixelatedLoaderInline />);
      expect(container).toBeInTheDocument();
    });

    it('has rotating spinner ring', () => {
      const { container } = render(<PixelatedLoaderInline />);
      const spinner = container.querySelector('[style*="border-radius"]');
      expect(spinner).toBeInTheDocument();
      expect(spinner?.getAttribute('style')).toContain('animation');
    });

    it('has red YouTube logo rectangle', () => {
      const { container } = render(<PixelatedLoaderInline />);
      const redSquares = Array.from(container.querySelectorAll('div')).filter(
        div => div.style.backgroundColor === 'rgb(255, 0, 0)'
      );
      expect(redSquares.length).toBeGreaterThan(0);
    });

    it('has white background layer for 3D effect', () => {
      const { container } = render(<PixelatedLoaderInline />);
      const whiteLayer = Array.from(container.querySelectorAll('div')).filter(
        div => div.style.backgroundColor === 'rgb(255, 255, 255)'
      );
      expect(whiteLayer.length).toBeGreaterThan(0);
    });

    it('has white play triangle', () => {
      const { container } = render(<PixelatedLoaderInline />);
      const triangle = Array.from(container.querySelectorAll('div')).find(
        div => div.style.borderLeft && div.style.borderLeft.includes('FFFFFF')
      );
      expect(triangle).toBeInTheDocument();
    });

    it('has layered 3D effect with offset', () => {
      const { container } = render(<PixelatedLoaderInline />);
      const offsetLayer = Array.from(container.querySelectorAll('div')).find(
        div => div.style.top === '-2px' && div.style.left === '-2px'
      );
      expect(offsetLayer).toBeInTheDocument();
    });

    it('has CSS keyframes defined', () => {
      const { container } = render(<PixelatedLoaderInline />);
      const style = container.querySelector('style');
      expect(style).toBeInTheDocument();
      expect(style?.textContent).toContain('@keyframes spin-loader-inline');
    });

    it('is smaller than main loader', () => {
      const { container: mainContainer } = render(<PixelatedLoader />);
      const { container: inlineContainer } = render(<PixelatedLoaderInline />);
      
      const mainWrapper = mainContainer.querySelector('.relative');
      const inlineWrapper = inlineContainer.querySelector('.relative');
      
      const mainWidth = mainWrapper?.getAttribute('style')?.match(/width:\s*(\d+)px/)?.[1];
      const inlineWidth = inlineWrapper?.getAttribute('style')?.match(/width:\s*(\d+)px/)?.[1];
      
      expect(Number(inlineWidth)).toBeLessThan(Number(mainWidth));
    });
  });
});
