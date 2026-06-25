import { STUDIO_SWARM_TEMPLATES, STUDIO_TEMPLATE_GROUPS } from '../studio-templates';

describe('Studio swarm templates', () => {
  it('seeds simple templates for every Studio and Our PearlOS group', () => {
    for (const group of STUDIO_TEMPLATE_GROUPS) {
      const templates = STUDIO_SWARM_TEMPLATES.filter((template) => template.category === group.id);
      expect(templates.length).toBeGreaterThanOrEqual(2);
      expect(templates.every((template) => template.prompt.length > 20)).toBe(true);
    }
  });
});
