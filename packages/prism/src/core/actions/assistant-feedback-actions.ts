import { Prism } from '../../prism';
import { BlockType_AssistantFeedback, IAssistantFeedback } from '../blocks/assistantFeedback.block';


export async function getAssistantFeedbacks(userId?: string): Promise<IAssistantFeedback[]> {
  const prism = await Prism.getInstance();
  const query: any = {
    contentType: BlockType_AssistantFeedback,
    tenantId: 'any',
    where: {},
    orderBy: { createdAt: 'desc' as const },
  };
  if (userId) {
    query.where = { parent_id: userId };
  }
  const result = await prism.query(query);
  return result.items as IAssistantFeedback[];
}

export async function getAssistantFeedbackById(assistantFeedbackId: string): Promise<IAssistantFeedback | null> {
  const prism = await Prism.getInstance();
  if (!assistantFeedbackId) return null;
  const query = {
    contentType: BlockType_AssistantFeedback,
    tenantId: 'any',
    where: { page_id: assistantFeedbackId },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as IAssistantFeedback;
}

export async function getAssistantFeedbackByProviderAssistantFeedbackId(provider: string, providerAssistantFeedbackId: string): Promise<IAssistantFeedback | null> {
  const prism = await Prism.getInstance();
  if (!provider || !providerAssistantFeedbackId) return null;
  
  // Get all assistantFeedbacks and filter by provider and providerAssistantFeedbackId
  const query = {
    contentType: BlockType_AssistantFeedback,
    tenantId: 'any',
    where: {},
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  
  // Filter by provider and providerAssistantFeedbackId
  const assistantFeedback = result.items.find((item: any) => 
    item.provider === provider && item.providerAssistantFeedbackId === providerAssistantFeedbackId
  ) as IAssistantFeedback;
  
  return assistantFeedback || null;
}

export async function createAssistantFeedback(assistantFeedbackData: IAssistantFeedback): Promise<IAssistantFeedback> {
  const prism = await Prism.getInstance();
  if (!assistantFeedbackData.assistant_id || !assistantFeedbackData.call_id || !assistantFeedbackData.description) {
    throw new Error('assistant_id, call_id, and description are required');
  }
  const created = await prism.create(BlockType_AssistantFeedback, assistantFeedbackData, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create assistantFeedback');
  }
  return created.items[0] as unknown as IAssistantFeedback;
}

export async function updateAssistantFeedback(assistantFeedbackId: string, updateData: Partial<IAssistantFeedback>): Promise<IAssistantFeedback> {
  const prism = await Prism.getInstance();
  if (!assistantFeedbackId) {
    throw new Error('AssistantFeedback ID is required');
  }
  
  // Use atomic merge - only send the fields being updated
  const updated = await prism.update(BlockType_AssistantFeedback, assistantFeedbackId, updateData, 'any');
  if (!updated) {
    throw new Error('AssistantFeedback not found');
  }
  return updated as unknown as IAssistantFeedback;
}

export async function deleteAssistantFeedback(assistantFeedbackId: string): Promise<{ success: boolean; message: string }> {
  const prism = await Prism.getInstance();
  if (!assistantFeedbackId) {
    throw new Error('AssistantFeedback ID is required');
  }
  const deleted = await prism.delete(BlockType_AssistantFeedback, assistantFeedbackId, 'any');
  if (!deleted) {
    throw new Error('AssistantFeedback not found');
  }
  return { success: true, message: 'AssistantFeedback deleted successfully' };
} 