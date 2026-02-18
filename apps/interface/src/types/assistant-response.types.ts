/* eslint-disable @typescript-eslint/no-explicit-any */
export type FunctionCall = {
  name: string;
  parameters: Record<string, any>;
};

export type Call = {
  id: string;
  type: 'webCall';
  createdAt: string;
  updatedAt: string;
  orgId: string;
  cost: number;
  webCallUrl: string;
  assistant: Record<string, any>;
  status: 'queued' | 'inProgress' | 'completed' | 'failed';
};

export type MessageFunctionCall = {
  message: {
    type: 'function-call';
    functionCall: FunctionCall;
  };
};
